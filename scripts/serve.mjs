import http from "node:http";
import os from "node:os";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildRuntimeEnvScript, readEnvProperties } from "./envProperties.mjs";
import { handleAuth, isAuthEnabled } from "./serveAuth.mjs";
import {
  buildHouseholdSessionScript,
  handleHouseholdSessionRequest,
  isHouseholdSessionEnabled
} from "./householdSession.mjs";
import { handleStatusRequest } from "./statusPage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
const mediaRuntimePath = path.join(rootDir, "services", "webos", "runtime", "media-http.cjs");
const mediaServerPorts = [2710, 2711, 2712, 2713, 2714];
const mediaProbeTimeoutMs = 1200;
let mediaRuntimeProcess = null;
let cachedMediaServerPort = mediaServerPorts[0];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8"
};

function getContentType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function getLanUrls() {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== "IPv4" || entry.internal) {
        continue;
      }
      urls.push(`http://${entry.address}:${port}/`);
    }
  }
  return Array.from(new Set(urls)).sort();
}

function resolveRequestPath(urlPathname) {
  let pathname;
  try {
    pathname = decodeURIComponent(String(urlPathname || "/"));
  } catch (_) {
    return null;
  }
  if (pathname === "/") {
    pathname = "/index.html";
  }
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) {
    return null;
  }
  const resolved = path.resolve(rootDir, normalized.replace(/^[\\/]+/, ""));
  if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
    return null;
  }
  return resolved;
}

function resolveDistPathForRootFile(rootFilePath) {
  const relativePath = path.relative(rootDir, rootFilePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return "";
  }
  return path.join(distDir, relativePath);
}

async function resolveRequestFile(pathname) {
  const rootPath = resolveRequestPath(pathname);
  if (!rootPath) {
    return { invalid: true, filePath: "", fileStat: null };
  }
  const rootStat = await stat(rootPath).catch(() => null);
  const distPath = resolveDistPathForRootFile(rootPath);
  const distStat = distPath ? await stat(distPath).catch(() => null) : null;
  if (distStat?.isFile()) {
    return { filePath: distPath, fileStat: distStat };
  }

  return { filePath: rootPath, fileStat: rootStat };
}

function requestLocalMediaPath(
  portNumber,
  requestPath,
  { method = "GET", timeoutMs = mediaProbeTimeoutMs } = {}
) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: portNumber,
        path: requestPath,
        method
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            port: portNumber,
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Local media request timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

async function findLocalMediaServerPort() {
  const candidates = Array.from(new Set([cachedMediaServerPort, ...mediaServerPorts]));
  for (const candidatePort of candidates) {
    try {
      const result = await requestLocalMediaPath(candidatePort, "/settings", {
        timeoutMs: mediaProbeTimeoutMs
      });
      if (result.statusCode >= 200 && result.statusCode < 500) {
        cachedMediaServerPort = candidatePort;
        return candidatePort;
      }
    } catch (_) {
      // Try the next local media server port.
    }
  }
  return null;
}

async function ensureLocalMediaRuntime() {
  if (process.env.NUVIO_DISABLE_MEDIA_RUNTIME === "1") {
    return null;
  }
  const existingPort = await findLocalMediaServerPort();
  if (existingPort) {
    return existingPort;
  }
  mediaRuntimeProcess = spawn(process.execPath, [mediaRuntimePath], {
    cwd: rootDir,
    stdio: ["ignore", "inherit", "inherit"]
  });
  mediaRuntimeProcess.on("exit", (code, signal) => {
    mediaRuntimeProcess = null;
    if (code || signal) {
      console.warn(`Local media runtime exited (${signal || code}).`);
    }
  });

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const portNumber = await findLocalMediaServerPort();
    if (portNumber) {
      return portNumber;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

async function proxyLocalMediaRequest(request, response, pathname) {
  const mediaPort = await findLocalMediaServerPort();
  if (!mediaPort) {
    response.writeHead(503, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify({ error: "Local media server unavailable" }));
    return true;
  }

  const proxied = await requestLocalMediaPath(mediaPort, pathname, {
    method: request.method || "GET",
    timeoutMs: 6000
  });
  response.writeHead(proxied.statusCode || 502, {
    "Cache-Control": "no-store",
    "Content-Type": proxied.headers["content-type"] || "application/json; charset=utf-8"
  });
  response.end(proxied.body);
  return true;
}

// ---------------------------------------------------------------------------
// Dev-only CORS proxy for running the app in a desktop browser.
// On the TV, addon/plugin requests go through the packaged Node service and
// are not subject to CORS. In a browser they are, so the page sends them to
// this route instead and the request is made server-side.
// Disable with NUVIO_WEB_PROXY=0.
// ---------------------------------------------------------------------------
const WEB_PROXY_PATH = "/__nuvio_proxy";
const WEB_PROXY_ENABLED = process.env.NUVIO_WEB_PROXY !== "0";
const WEB_PROXY_HEADERS_HEADER = "x-nuvio-proxy-headers";
const WEB_PROXY_TIMEOUT_MS = 60_000;
const WEB_PROXY_DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const WEB_PROXY_DROP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "proxy-connection",
  "accept-encoding"
]);
const WEB_PROXY_PASS_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "expires",
  "retry-after",
  "content-range",
  "accept-ranges",
  "content-disposition"
];

function isBlockedProxyHost(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^169\.254\./.test(host)
  );
}

function decodeProxyHeaders(rawValue) {
  if (!rawValue) {
    return {};
  }
  try {
    const parsed = JSON.parse(Buffer.from(String(rawValue), "base64").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function logProxyRequest(method, target, status, detail) {
  // Query strings can carry API keys/tokens, so only host + path are printed.
  const where = `${target.host}${target.pathname}`;
  const line = `[proxy] ${method} ${where} -> ${status}`;
  if (detail) {
    console.warn(`${line} ${String(detail).replace(/\s+/g, " ")}`);
  } else if (status >= 400) {
    console.warn(line);
  } else {
    console.log(line);
  }
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleWebProxyRequest(request, response, requestUrl) {
  const method = String(request.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "600"
    });
    response.end();
    return;
  }

  const sendError = (statusCode, message) => {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(statusCode, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Nuvio-Proxy-Error": "1"
    });
    response.end(JSON.stringify({ error: message }));
  };

  let target;
  try {
    target = new URL(String(requestUrl.searchParams.get("url") || ""));
  } catch (_) {
    sendError(400, "Missing or invalid ?url=");
    return;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    sendError(400, "Only http(s) URLs can be proxied");
    return;
  }
  // NUVIO_PROXY_ALLOW_LOOPBACK=1 is only used by scripts/check-regressions.mjs
  // so it can test the proxy against a local echo server. Never set it online.
  const allowLoopback =
    process.env.NUVIO_PROXY_ALLOW_LOOPBACK === "1" &&
    /^(127\.0\.0\.1|localhost)$/.test(target.hostname);
  if (isBlockedProxyHost(target.hostname) && !allowLoopback) {
    sendError(403, "Proxying to local/loopback hosts is not allowed");
    return;
  }

  const forwardedHeaders = {};
  for (const [name, value] of Object.entries(
    decodeProxyHeaders(request.headers[WEB_PROXY_HEADERS_HEADER])
  )) {
    const key = String(name || "").toLowerCase();
    if (!key || WEB_PROXY_DROP_REQUEST_HEADERS.has(key) || key.startsWith("x-nuvio-")) {
      continue;
    }
    forwardedHeaders[key] = String(value ?? "");
  }
  if (!forwardedHeaders["user-agent"]) {
    forwardedHeaders["user-agent"] = WEB_PROXY_DEFAULT_USER_AGENT;
  }
  // FormData / URLSearchParams bodies get their Content-Type (including the
  // multipart boundary) from the browser on the request to this proxy, not
  // from the page's header object, so carry it over.
  if (!forwardedHeaders["content-type"] && request.headers["content-type"]) {
    forwardedHeaders["content-type"] = String(request.headers["content-type"]);
  }

  const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_PROXY_TIMEOUT_MS);
  response.on("close", () => {
    if (!response.writableFinished) {
      controller.abort();
    }
  });

  let upstream;
  try {
    upstream = await fetch(target.href, {
      method,
      headers: forwardedHeaders,
      body: body && body.length ? body : undefined,
      redirect: "follow",
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    const cause = error?.cause?.code || error?.cause?.message || "";
    const message = `Upstream request failed: ${error?.message || error}${cause ? ` (${cause})` : ""}`;
    logProxyRequest(method, target, 502, message);
    sendError(502, message);
    return;
  }

  // Small JSON API responses are buffered so failures can be logged to the
  // terminal (status + error text only; successful bodies are never printed).
  const upstreamType = String(upstream.headers.get("content-type") || "");
  if (/json/i.test(upstreamType) && method !== "HEAD") {
    let text = "";
    try {
      text = await upstream.text();
    } catch (error) {
      clearTimeout(timeout);
      logProxyRequest(method, target, 502, `body read failed: ${error?.message || error}`);
      sendError(502, "Upstream body read failed");
      return;
    }
    clearTimeout(timeout);
    const failed = !upstream.ok || /"success"\s*:\s*false/.test(text);
    logProxyRequest(method, target, upstream.status, failed ? text.slice(0, 400) : "");
    response.writeHead(upstream.status, upstream.statusText || undefined, {
      "Cache-Control": "no-store",
      "Content-Type": upstreamType,
      "X-Nuvio-Final-Url": upstream.url || target.href,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-Nuvio-Final-Url"
    });
    response.end(text);
    return;
  }
  logProxyRequest(method, target, upstream.status, "");

  const headers = {
    "Cache-Control": "no-store",
    "X-Nuvio-Final-Url": upstream.url || target.href,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "X-Nuvio-Final-Url"
  };
  for (const name of WEB_PROXY_PASS_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) {
      headers[name] = value;
    }
  }
  response.writeHead(upstream.status, upstream.statusText || undefined, headers);
  if (!upstream.body || method === "HEAD") {
    clearTimeout(timeout);
    response.end();
    return;
  }
  try {
    for await (const chunk of upstream.body) {
      if (!response.write(chunk)) {
        await new Promise((resolve) => response.once("drain", resolve));
      }
    }
    response.end();
  } catch (_) {
    response.destroy();
  } finally {
    clearTimeout(timeout);
  }
}

function buildWebDevFlagsScript() {
  if (!WEB_PROXY_ENABLED) {
    return "";
  }
  return `
(function enableNuvioWebDevMode() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  root.__NUVIO_WEB_PROXY__ = ${JSON.stringify(WEB_PROXY_PATH)};
  root.__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ = true;
}());
`;
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (await handleAuth(request, response, requestUrl)) {
      return;
    }
    if (await handleHouseholdSessionRequest(request, response, requestUrl)) {
      return;
    }
    if (await handleStatusRequest(request, response, requestUrl)) {
      return;
    }
    if (requestUrl.pathname === "/nuvio.env.js") {
      const { env } = await readEnvProperties({ rootDir });
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/javascript; charset=utf-8"
      });
      response.end(
        buildRuntimeEnvScript(env) + buildWebDevFlagsScript() + buildHouseholdSessionScript()
      );
      return;
    }

    if (WEB_PROXY_ENABLED && requestUrl.pathname === WEB_PROXY_PATH) {
      await handleWebProxyRequest(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/settings" || requestUrl.pathname.startsWith("/tracks/")) {
      await proxyLocalMediaRequest(
        request,
        response,
        `${requestUrl.pathname}${requestUrl.search || ""}`
      );
      return;
    }

    let { invalid, filePath, fileStat } = await resolveRequestFile(requestUrl.pathname);

    if (invalid) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bad request");
      return;
    }

    if (fileStat?.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      fileStat = await stat(filePath).catch(() => null);
    }

    if (!fileStat?.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const fileContents = await readFile(filePath);
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": getContentType(filePath)
    });
    response.end(fileContents);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`Server error: ${error?.message || error}`);
  }
});

await ensureLocalMediaRuntime();

server.listen(port, host, async () => {
  const localHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const mediaPort = await findLocalMediaServerPort();
  console.log(`Serving Nuvio TV from ${rootDir}`);
  console.log(`Local URL: http://${localHost}:${port}/`);
  for (const lanUrl of getLanUrls()) {
    console.log(`LAN URL: ${lanUrl}`);
  }
  console.log(
    mediaPort
      ? `Local media tracks endpoint: http://${localHost}:${port}/tracks/<media-url> -> 127.0.0.1:${mediaPort}`
      : "Local media tracks endpoint unavailable. Install/enable the media runtime to inspect internal tracks."
  );
  console.log(
    isHouseholdSessionEnabled()
      ? "Automatic household sign-in: ON"
      : "Automatic household sign-in: OFF (needs NUVIO_SUPABASE_URL, NUVIO_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NUVIO_PASSWORD)"
  );
  console.log(
    isAuthEnabled()
      ? "Password login: ON (NUVIO_PASSWORD is set)"
      : "Password login: OFF (set NUVIO_PASSWORD to require a password)"
  );
  console.log(
    WEB_PROXY_ENABLED
      ? `Browser CORS proxy: http://${localHost}:${port}${WEB_PROXY_PATH}?url=<target> (plugins enabled in browser; NUVIO_WEB_PROXY=0 disables)`
      : "Browser CORS proxy disabled (NUVIO_WEB_PROXY=0)."
  );
  console.log(
    "Use one of the URLs above if you want to test the app over http(s) during development."
  );
});

function stopMediaRuntime() {
  if (!mediaRuntimeProcess) {
    return;
  }
  mediaRuntimeProcess.kill("SIGTERM");
  mediaRuntimeProcess = null;
}

process.on("SIGINT", () => {
  stopMediaRuntime();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopMediaRuntime();
  process.exit(0);
});
