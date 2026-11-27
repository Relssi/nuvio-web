// Nuvio audio converter (docs/TRANSCODER.md).
//
// Browsers drop Dolby (AC-3/E-AC-3), DTS and TrueHD audio and iPhones do not
// open MKV at all. This small server takes a direct video link (TorBox, Real
// Debrid...), keeps the picture as it is (no video re-encoding) and converts
// only the audio to stereo AAC, delivered as HLS (MPEG-TS segments) that every
// browser, phone and TV can play.
//
// - Only links signed by the Nuvio site are accepted (TRANSCODER_SECRET, the
//   same value on Render as NUVIO_TRANSCODER_SECRET).
// - Seeking: the playlist lists every 6-second segment of the movie. When a
//   segment far from the running conversion is asked for, the conversion
//   restarts from that point.
// - Links to private/local addresses are refused unless
//   TRANSCODER_ALLOW_LOOPBACK=1 (local tests only).
//
// Needs ffmpeg and ffprobe on PATH. No npm dependencies.

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8090);
const SECRET = String(process.env.TRANSCODER_SECRET || "");
const ALLOW_LOOPBACK = process.env.TRANSCODER_ALLOW_LOOPBACK === "1";
const SEGMENT_SECONDS = 6;
const MAX_SESSIONS = Number(process.env.TRANSCODER_MAX_SESSIONS || 4);
const IDLE_MS = 90_000;
const AHEAD_SEGMENTS = 3;
// Disk guard: the conversion runs at download speed, far ahead of the viewer.
// It pauses once it is MAX_AHEAD segments ahead of the last segment asked
// for (about 2 minutes) and resumes when the viewer catches up. Segments well
// behind the viewer are deleted.
const MAX_AHEAD = 20;
const RESUME_AHEAD = 10;
const KEEP_BEHIND = 5;
const CAN_PAUSE = process.platform !== "win32";
const WORK_ROOT = path.join(os.tmpdir(), "nuvio-transcoder");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

function requireSecret() {
  if (!SECRET || SECRET.length < 16) {
    console.error("TRANSCODER_SECRET must be set (16+ characters).");
    process.exit(1);
  }
}

// ---- Signed links ---------------------------------------------------------
// Token = base64url(JSON {u: url, e: expiry seconds}) + "." + HMAC-SHA256.

function b64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

export function signToken(url, secret = SECRET, ttlSeconds = 12 * 3600) {
  const payload = b64url(JSON.stringify({ u: url, e: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const mac = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function readToken(token) {
  const [payload, mac] = String(token || "").split(".");
  if (!payload || !mac) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data.u !== "string" || Number(data.e) < Date.now() / 1000) return null;
    return data.u;
  } catch (_) {
    return null;
  }
}

// ---- Source checks --------------------------------------------------------

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const lower = address.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80") ||
    lower.startsWith("::ffff:")
  );
}

async function checkSource(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return "bad link";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "bad link";
  if (ALLOW_LOOPBACK) return "";
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host)
    ? [host]
    : (await dns.lookup(host, { all: true })).map((entry) => entry.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) return "private address";
  return "";
}

// ---- Media probe ----------------------------------------------------------

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split("\n").slice(-2).join(" ") || `exit ${code}`));
    });
  });
}

async function probe(url) {
  const out = await run(
    FFPROBE,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=index,codec_type,codec_name",
      "-of",
      "json",
      url
    ],
    30_000
  );
  const data = JSON.parse(out);
  const duration = Number(data?.format?.duration);
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    video: streams.find((s) => s.codec_type === "video")?.codec_name || "",
    audio: streams.find((s) => s.codec_type === "audio")?.codec_name || ""
  };
}

// ---- Sessions -------------------------------------------------------------
// One session per signed link. A session runs at most one ffmpeg job, which
// writes seg-N.ts files into the session folder.

const sessions = new Map();

function sessionKey(url) {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);
}

async function getSession(url) {
  const key = sessionKey(url);
  let session = sessions.get(key);
  if (session) {
    session.lastUsed = Date.now();
    return session;
  }
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (oldest && Date.now() - oldest.lastUsed > 15_000) await closeSession(oldest);
    else throw Object.assign(new Error("busy"), { status: 503 });
  }
  const info = await probe(url);
  if (!info.duration) throw Object.assign(new Error("unknown duration"), { status: 422 });
  const dir = path.join(WORK_ROOT, key);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  session = { key, url, dir, info, job: null, lastUsed: Date.now(), lastRequested: 0 };
  sessions.set(key, session);
  console.log(`[session ${key}] ${info.video}/${info.audio} ${Math.round(info.duration)}s`);
  return session;
}

async function closeSession(session) {
  stopJob(session);
  sessions.delete(session.key);
  await fsp.rm(session.dir, { recursive: true, force: true }).catch(() => {});
}

function stopJob(session) {
  const child = session.job?.child;
  if (child && child.exitCode === null) {
    if (session.job.paused) child.kill("SIGCONT");
    child.kill("SIGKILL");
  }
  session.job = null;
}

function pauseJob(job, paused) {
  if (!CAN_PAUSE || !job || job.done || job.paused === paused) return;
  try {
    job.child.kill(paused ? "SIGSTOP" : "SIGCONT");
    job.paused = paused;
  } catch (_) {
    // The process already ended.
  }
}

async function tidySession(session) {
  const produced = producedUpTo(session);
  const ahead = produced - session.lastRequested;
  if (ahead >= MAX_AHEAD) pauseJob(session.job, true);
  else if (ahead <= RESUME_AHEAD) pauseJob(session.job, false);
  const names = await fsp.readdir(session.dir).catch(() => []);
  for (const name of names) {
    const match = name.match(/^seg-(\d+)\.ts$/);
    if (match && Number(match[1]) < session.lastRequested - KEEP_BEHIND) {
      await fsp.rm(path.join(session.dir, name), { force: true }).catch(() => {});
    }
  }
}

function segmentPath(session, index) {
  return path.join(session.dir, `seg-${index}.ts`);
}

function startJob(session, startIndex) {
  stopJob(session);
  const startSeconds = startIndex * SEGMENT_SECONDS;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
    "-ss",
    String(startSeconds),
    "-i",
    session.url,
    "-copyts",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-ac",
    "2",
    "-b:a",
    "192k",
    "-f",
    "hls",
    "-hls_time",
    String(SEGMENT_SECONDS),
    "-hls_segment_type",
    "mpegts",
    "-start_number",
    String(startIndex),
    "-hls_segment_filename",
    "seg-%d.ts",
    "-hls_flags",
    "temp_file",
    "-hls_playlist_type",
    "event",
    "job.m3u8"
  ];
  // Run inside the session folder so relative segment names land there.
  const child = spawn(FFMPEG, args, { cwd: session.dir, stdio: ["ignore", "ignore", "pipe"] });
  const job = { child, startIndex, error: "" };
  child.stderr.on("data", (chunk) => (job.error = String(chunk).trim().slice(-300)));
  child.on("close", (code) => {
    job.done = true;
    if (code && job.error) console.warn(`[session ${session.key}] ffmpeg: ${job.error}`);
  });
  session.job = job;
  console.log(`[session ${session.key}] converting from ${startSeconds}s`);
  return job;
}

// Highest segment already written by the running job (it writes in order).
function producedUpTo(session) {
  const job = session.job;
  if (!job) return -1;
  let index = job.startIndex - 1;
  while (fs.existsSync(segmentPath(session, index + 1))) index += 1;
  return index;
}

async function waitForFile(file, job, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true;
    if (job?.done) return fs.existsSync(file);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function ensureSegment(session, index) {
  session.lastRequested = index;
  pauseJob(session.job, false);
  const file = segmentPath(session, index);
  if (fs.existsSync(file)) return file;
  const job = session.job;
  const produced = producedUpTo(session);
  const jobCovers =
    job && !job.done && index >= job.startIndex && index <= produced + AHEAD_SEGMENTS + 1;
  const activeJob = jobCovers ? job : startJob(session, index);
  return (await waitForFile(file, activeJob, 60_000)) ? file : null;
}

function playlist(session, token) {
  const count = Math.ceil(session.info.duration / SEGMENT_SECONDS);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS + 4}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS"
  ];
  for (let i = 0; i < count; i += 1) {
    const length = Math.min(SEGMENT_SECONDS, session.info.duration - i * SEGMENT_SECONDS);
    lines.push(`#EXTINF:${length.toFixed(3)},`, `/t/${token}/seg-${i}.ts`);
  }
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

// ---- HTTP -----------------------------------------------------------------

function send(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(body);
}

async function sendFile(response, file, type) {
  const data = await fsp.readFile(file);
  response.writeHead(200, {
    "Content-Type": type,
    "Content-Length": data.length,
    "Cache-Control": "private, max-age=3600",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(data);
}

async function handle(request, response) {
  const { pathname } = new URL(request.url, "http://local");
  if (request.method === "OPTIONS") return send(response, 204, "");
  if (pathname === "/healthz") return send(response, 200, "ok");
  const match = pathname.match(/^\/t\/([A-Za-z0-9_.-]+)\/(master\.m3u8|seg-(\d+)\.ts)$/);
  if (!match || request.method !== "GET") return send(response, 404, "not found");
  const [, token, file, segment] = match;
  const url = readToken(token);
  if (!url) return send(response, 403, "invalid link");
  const problem = await checkSource(url);
  if (problem) return send(response, 403, problem);
  const session = await getSession(url);

  if (file === "master.m3u8")
    return send(response, 200, playlist(session, token), "application/vnd.apple.mpegurl");
  const index = Number(segment);
  if (index * SEGMENT_SECONDS >= session.info.duration) return send(response, 404, "past the end");
  const segmentFile = await ensureSegment(session, index);
  if (!segmentFile) return send(response, 504, session.job?.error || "segment not ready");
  return sendFile(response, segmentFile, "video/mp2t");
}

// Drop sessions nobody asked for in a while (viewer closed the movie) and
// keep running conversions within the disk guard.
setInterval(() => {
  for (const session of sessions.values()) {
    if (Date.now() - session.lastUsed > IDLE_MS) {
      console.log(`[session ${session.key}] idle, closing`);
      void closeSession(session);
    } else {
      void tidySession(session);
    }
  }
}, 2_000).unref();

const isMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  requireSecret();
  await fsp.mkdir(WORK_ROOT, { recursive: true });
  http
    .createServer((request, response) => {
      handle(request, response).catch((error) => {
        console.warn(`request failed: ${error.message}`);
        if (!response.headersSent)
          send(response, error.status || 500, error.status ? error.message : "error");
        else response.destroy();
      });
    })
    .listen(PORT, () => console.log(`Nuvio audio converter on port ${PORT}`));
}
