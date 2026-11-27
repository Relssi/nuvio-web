import { audioTagsFromText } from "../debrid/debridStreamPresentationHelpers-02-has-token.js";

// Desktop browsers decode AAC, MP3, Opus and Vorbis inside a direct file.
// AC-3, E-AC-3, DTS and TrueHD render the picture and drop the audio, and
// Chrome does not expose the other tracks of an MKV, so a second AAC track
// in the same file cannot be selected.

const PLAYABLE_TAGS = new Set(["AAC", "OPUS"]);
const SURROUND_TAGS = new Set([
  "ATMOS",
  "DD_PLUS",
  "DD",
  "DTS_X",
  "DTS_HD_MA",
  "DTS_HD",
  "DTS_ES",
  "DTS",
  "TRUEHD"
]);

export function probeBrowserAudioCapabilities(video = null) {
  const supports = (mimeType) => {
    if (!video || typeof video.canPlayType !== "function") {
      return false;
    }
    try {
      const result = String(video.canPlayType(mimeType) || "").toLowerCase();
      return result === "probably" || result === "maybe";
    } catch (_) {
      return false;
    }
  };
  const probed = Boolean(video && typeof video.canPlayType === "function");
  return {
    aac: probed ? supports('audio/mp4; codecs="mp4a.40.2"') || supports("audio/aac") : true,
    mp3: probed ? supports("audio/mpeg") : true,
    opus: probed
      ? supports('audio/webm; codecs="opus"') || supports('audio/ogg; codecs="opus"')
      : true,
    vorbis: probed ? supports('audio/ogg; codecs="vorbis"') : true,
    flac: probed ? supports("audio/flac") || supports('audio/mp4; codecs="flac"') : false,
    ac3: supports('audio/mp4; codecs="ac-3"') || supports('audio/mp4; codecs="dac3"'),
    eac3: supports('audio/mp4; codecs="ec-3"') || supports('audio/mp4; codecs="dec3"'),
    dts: false,
    truehd: false
  };
}

export function streamAudioSearchText(stream = {}) {
  const presentation = stream?.streamPresentation || stream?.raw?.streamPresentation || {};
  return [
    stream?.title,
    stream?.label,
    stream?.name,
    stream?.description,
    stream?.behaviorHints?.filename,
    stream?.raw?.behaviorHints?.filename,
    stream?.raw?.filename,
    stream?.raw?.title,
    stream?.raw?.name,
    stream?.raw?.description,
    presentation.resolution,
    presentation.quality,
    presentation.encode,
    ...(Array.isArray(presentation.audioTags) ? presentation.audioTags : []),
    ...(Array.isArray(presentation.visualTags) ? presentation.visualTags : []),
    ...(Array.isArray(presentation.audioChannels) ? presentation.audioChannels : [])
  ]
    .filter(Boolean)
    .join(" ");
}

function tagIsPlayable(tag, capabilities) {
  if (tag === "AAC") return capabilities.aac;
  if (tag === "OPUS") return capabilities.opus;
  if (tag === "FLAC") return capabilities.flac;
  if (tag === "DD") return capabilities.ac3;
  if (tag === "DD_PLUS" || tag === "ATMOS") return capabilities.eac3;
  if (tag.startsWith("DTS")) return capabilities.dts;
  if (tag === "TRUEHD") return capabilities.truehd;
  return false;
}

// "playable" has only codecs this browser can decode.
// "unsupported" names a codec the browser will play as silence.
// "unknown" has no audio label, so the file is left alone.
function textMentions(text, pattern) {
  return pattern.test(String(text || "").toLowerCase());
}

export function classifyBrowserStreamAudio(
  stream = {},
  capabilities = probeBrowserAudioCapabilities()
) {
  const text = streamAudioSearchText(stream);
  const normalized = text.toLowerCase();
  const presentation = stream?.streamPresentation || stream?.raw?.streamPresentation || {};
  const tags = audioTagsFromText(presentation.audioTags, text).filter(
    (tag) => tag && tag !== "UNKNOWN"
  );
  const playable = [];
  const unsupported = [];
  const mentionsEac3 = textMentions(
    normalized,
    /\b(e-?ac-?3|ec-3|dd\+|ddp|dolby digital plus|atmos)\b/
  );
  const mentionsDts = textMentions(normalized, /\bdts/);
  const mentionsTrueHd = textMentions(normalized, /true[\s-]?hd/);
  // "DD5.1" has no separator, so the shared tag parser misses it. "EAC3" also
  // contains "ac3"; that case is the E-AC-3 check above.
  const mentionsAc3 =
    !mentionsEac3 &&
    (textMentions(normalized, /\b(ac-?3|dolby digital)\b/) ||
      textMentions(normalized, /(^|[^a-z0-9])dd\d/));
  tags.forEach((tag) => {
    if (!PLAYABLE_TAGS.has(tag) && !SURROUND_TAGS.has(tag) && tag !== "FLAC") {
      return;
    }
    if (tag === "DD" && mentionsEac3) {
      if (capabilities.eac3) playable.push(tag);
      else unsupported.push(tag);
      return;
    }
    if (tagIsPlayable(tag, capabilities)) playable.push(tag);
    else unsupported.push(tag);
  });
  if (mentionsTrueHd && !capabilities.truehd) unsupported.push("TRUEHD");
  if (mentionsDts && !capabilities.dts) unsupported.push("DTS");
  if (mentionsEac3 && !capabilities.eac3) unsupported.push("EAC3");
  if (mentionsAc3 && !capabilities.ac3) unsupported.push("AC3");
  if (/\b(mp3|mpeg-?audio)\b/i.test(normalized)) {
    if (capabilities.mp3) playable.push("MP3");
    else unsupported.push("MP3");
  }
  if (/\bvorbis\b/i.test(normalized)) {
    if (capabilities.vorbis) playable.push("VORBIS");
    else unsupported.push("VORBIS");
  }
  // A file that lists AAC next to DTS still starts on the surround track,
  // and the browser cannot switch MKV audio tracks.
  if (unsupported.length) return "unsupported";
  if (playable.length) return "playable";
  return "unknown";
}

function resolutionScore(text = "") {
  const normalized = String(text || "").toLowerCase();
  if (normalized.includes("2160") || normalized.includes("4k")) return 60;
  if (normalized.includes("1440")) return 50;
  if (normalized.includes("1080")) return 40;
  if (normalized.includes("720")) return 20;
  if (normalized.includes("480")) return 10;
  return 0;
}

function sameStream(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftId = String(left.id || "");
  const rightId = String(right.id || "");
  if (leftId && leftId === rightId) return true;
  const leftUrl = String(left.url || left.externalUrl || "").trim();
  const rightUrl = String(right.url || right.externalUrl || "").trim();
  return Boolean(leftUrl && leftUrl === rightUrl);
}

export function browserAudioScoreAdjustment(
  stream = {},
  capabilities = probeBrowserAudioCapabilities()
) {
  const kind = classifyBrowserStreamAudio(stream, capabilities);
  if (kind === "playable") return 80;
  if (kind === "unsupported") return -500;
  return 0;
}

export function chooseBrowserAudibleStream({
  candidate = null,
  streams = [],
  capabilities = probeBrowserAudioCapabilities(),
  enabled = true
} = {}) {
  if (!enabled || !candidate) {
    return { candidate, notice: "" };
  }
  if (classifyBrowserStreamAudio(candidate, capabilities) !== "unsupported") {
    return { candidate, notice: "" };
  }
  const audible = pickPlayableBrowserStream(streams, capabilities, candidate);
  if (!audible) {
    return { candidate, notice: "silent" };
  }
  return { candidate: audible, notice: "swapped" };
}

export function pickPlayableBrowserStream(
  streams = [],
  capabilities = probeBrowserAudioCapabilities(),
  current = null
) {
  let best = null;
  let bestScore = -1;
  (Array.isArray(streams) ? streams : []).forEach((stream) => {
    if (!stream || sameStream(stream, current)) return;
    if (classifyBrowserStreamAudio(stream, capabilities) !== "playable") return;
    const score = resolutionScore(streamAudioSearchText(stream));
    if (!best || score > bestScore) {
      best = stream;
      bestScore = score;
    }
  });
  return best;
}

// Stream labels often leave the audio codec out, so the label check above
// cannot catch every silent file. Once the picture has run for a few seconds,
// the media element itself says whether any audio was decoded: Chromium
// counts decoded audio bytes, Firefox reports mozHasAudio.
// A muted element still decodes its audio, so mute does not hide the result.
// Returns "pending" (keep watching), "audible", "silent" or "unknown".
export const SILENT_AUDIO_MIN_PLAYED_SECONDS = 3;

export function browserAudioDecodeVerdict(video = null, startSeconds = 0) {
  if (!video) return "unknown";
  const played = Number(video.currentTime) - Number(startSeconds || 0);
  if (!Number.isFinite(played) || played < SILENT_AUDIO_MIN_PLAYED_SECONDS) return "pending";
  const decodedBytes = video.webkitAudioDecodedByteCount;
  if (typeof decodedBytes === "number") return decodedBytes > 0 ? "audible" : "silent";
  if (typeof video.mozHasAudio === "boolean") return video.mozHasAudio ? "audible" : "silent";
  return "unknown";
}
