import { DebridSettingsStore } from "../../data/local/debridSettingsStore.js";
import { DebridApi } from "../../data/remote/api/debridApi.js";
import { DEBRID_CAPABILITIES, DEBRID_PROVIDER_IDS, DebridProviders } from "./debridProviders.js";
import {
  getDebridFileDisplayName,
  getDebridFileSize,
  selectDebridFile
} from "./debridFileSelection.js";
import { resolveAlternativeHashMatches, torboxCachedEntries } from "./torboxCacheAliases.js";
import { Environment } from "../../platform/environment.js";
import { PlayerSettingsStore } from "../../data/local/playerSettingsStore.js";
import {
  decideTorboxAudio,
  describeTorboxAudioTrack,
  preferredAudioTargets
} from "./torboxAudioChoice.js";
import { askTorboxAudio } from "./torboxAudioPrompt.js";
import { isStreamPtBrAvailable } from "../streams/streamOrdering.js";

const HLS_MIME_TYPE = "application/vnd.apple.mpegurl";
// Set once TorBox says this account cannot use web streaming (not Pro), so
// later titles skip the extra request until the page is reloaded.
let torboxWebStreamUnavailable = false;
const torboxStreamMetaCache = new Map();
let pendingPreferSecondaryForDual = false;

// Browser only (TV apps decode Dolby/DTS themselves): ask TorBox for its
// converted HLS stream, which plays everywhere, iPhone included (B25).
// Returns null when it is not available, so the caller uses the direct link.
export async function requestTorboxWebStream(
  apiKey,
  torrentId,
  fileId,
  {
    enabled = Environment.isBrowser(),
    audioTargets = null,
    preferSecondaryForDual = false,
    fileName = ""
  } = {}
) {
  const useDualFallback = Boolean(preferSecondaryForDual || pendingPreferSecondaryForDual);
  pendingPreferSecondaryForDual = false;
  if (!enabled || torboxWebStreamUnavailable || torrentId == null || fileId == null) {
    return null;
  }
  const response = await DebridApi.torboxCreateStream(apiKey, { id: torrentId, fileId });
  const data = response?.data?.data || null;
  if (!response?.ok || !data) {
    const error = String(response?.data?.error || "");
    if (response?.status === 403 || error === "PLAN_RESTRICTED_FEATURE") {
      torboxWebStreamUnavailable = true;
    }
    return null;
  }
  const audios = Array.isArray(data?.metadata?.audios) ? data.metadata.audios : [];
  // The first answer lists the audio tracks. Browsers only play the first one,
  // so when the preferred language is another track, ask for that one (B26).
  // When the site cannot tell which track is the preferred language, or the
  // file has none, the viewer chooses before the movie starts (B34).
  const targets = audioTargets || preferredAudioTargets(PlayerSettingsStore.get(), browserLocale());
  const decision = decideTorboxAudio(audios, targets, { preferSecondaryForDual: useDualFallback });
  let audioIndex = decision.index;
  if (decision.ask) {
    const answer = await askTorboxAudio({
      fileName,
      reason: decision.reason,
      suggested: decision.index,
      tracks: audios.map((audio, position) => ({
        index: position,
        label: describeTorboxAudioTrack(audio, position)
      }))
    });
    if (answer.cancelled) {
      return { cancelled: true };
    }
    audioIndex = answer.index;
  }
  let selectedAudioIndex = 0;
  let resolvedHlsUrl = typeof data.hls_url === "string" ? data.hls_url.trim() : "";
  if (audioIndex > 0) {
    const chosen = await DebridApi.torboxCreateStream(apiKey, {
      id: torrentId,
      fileId,
      audioIndex
    });
    const chosenUrl =
      typeof chosen?.data?.data?.hls_url === "string" ? chosen.data.data.hls_url.trim() : "";
    if (chosen?.ok && chosenUrl) {
      selectedAudioIndex = audioIndex;
      resolvedHlsUrl = chosenUrl;
      torboxStreamMetaCache.set(`${torrentId}:${fileId}`, {
        torrentId,
        fileId,
        audios,
        selectedAudioIndex
      });
      return chosenUrl;
    }
  }
  torboxStreamMetaCache.set(`${torrentId}:${fileId}`, {
    torrentId,
    fileId,
    audios,
    selectedAudioIndex
  });
  // TorBox says the original file already plays in browsers: keep it direct.
  if (!resolvedHlsUrl || data.needs_transcoding === false) {
    return null;
  }
  return resolvedHlsUrl;
}

function browserLocale() {
  return String(globalThis.navigator?.language || "");
}

export function resetTorboxWebStreamAvailability() {
  torboxWebStreamUnavailable = false;
}

function isHlsStreamUrl(url = "", mimeType = "") {
  if (
    String(mimeType || "")
      .trim()
      .toLowerCase() === HLS_MIME_TYPE
  ) {
    return true;
  }
  return /\.m3u8(\?|$)/i.test(String(url || "").trim());
}

function hlsFilename(filename) {
  const name = String(filename || "").trim();
  return name ? `${name.replace(/\.[a-z0-9]{2,4}$/i, "")}.m3u8` : null;
}

const RESOLVE_CACHE_TTL_MS = 15 * 60 * 1000;
const RESOLVE_CACHE_MAX_ENTRIES = 100;
const resolvedCache = new Map();
const inFlightResolves = new Map();

function isMagnetLink(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("magnet:");
}

function getStreamUrl(stream = {}) {
  return [stream.url, stream.externalUrl].find((value) => value && !isMagnetLink(value)) || null;
}

function torrentMagnetUri(stream = {}) {
  return [stream.url, stream.externalUrl].find((value) => isMagnetLink(value)) || null;
}

function isDirectDebrid(stream = {}) {
  const resolve = stream.clientResolve || stream.raw?.clientResolve;
  return Boolean(
    resolve &&
    String(resolve.type || "").toLowerCase() === "debrid" &&
    DebridProviders.isSupported(resolve.service) &&
    resolve.isCached === true
  );
}

function needsLocalDebridResolve(stream = {}) {
  return (
    !isDirectDebrid(stream) &&
    !getStreamUrl(stream) &&
    Boolean(stream.infoHash || torrentMagnetUri(stream))
  );
}

function stableFingerprint(value) {
  const text = String(value || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function trackerUrl(source) {
  const value = String(source || "").trim();
  if (!value || value.toLowerCase().startsWith("dht:")) {
    return null;
  }
  return value.replace(/^tracker:/i, "").trim() || null;
}

function buildMagnetUri(resolve = {}) {
  const existing = String(resolve.magnetUri || "").trim();
  if (existing) {
    return existing;
  }
  const hash = String(resolve.infoHash || "").trim();
  if (!hash) {
    return null;
  }
  const displayName = String(resolve.filename || resolve.torrentName || "").trim();
  const trackers = (Array.isArray(resolve.sources) ? resolve.sources : [])
    .map(trackerUrl)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
  return `magnet:?xt=urn:btih:${encodeURIComponent(hash)}${displayName ? `&dn=${encodeURIComponent(displayName)}` : ""}${trackers.map((source) => `&tr=${encodeURIComponent(source)}`).join("")}`;
}

function buildLocalResolve(stream = {}, season, episode, providerId) {
  const magnet =
    torrentMagnetUri(stream) ||
    buildMagnetUri({
      infoHash: stream.infoHash,
      sources: stream.sources
    });
  if (!magnet) {
    return null;
  }
  return {
    type: "torrent",
    infoHash: stream.infoHash || null,
    fileIdx: stream.fileIdx ?? null,
    magnetUri: magnet,
    sources: Array.isArray(stream.sources) ? stream.sources : [],
    torrentName: stream.title || stream.name || null,
    filename: stream.behaviorHints?.filename || null,
    title: stream.title || stream.name || null,
    season,
    episode,
    service: providerId,
    isCached: stream.debridCacheStatus?.state === "CACHED"
  };
}

function getResolve(
  stream = {},
  season = null,
  episode = null,
  settings = DebridSettingsStore.get()
) {
  const directResolve = stream.clientResolve || stream.raw?.clientResolve || null;
  if (directResolve) {
    return directResolve;
  }
  if (!needsLocalDebridResolve(stream)) {
    return null;
  }
  const credential = DebridProviders.preferredResolverService(settings);
  if (
    !credential ||
    !DebridProviders.supports(credential.provider.id, DEBRID_CAPABILITIES.LOCAL_TORRENT_RESOLVE)
  ) {
    return null;
  }
  return buildLocalResolve(stream, season, episode, credential.provider.id);
}

function cacheKeyFor(
  stream = {},
  season = null,
  episode = null,
  settings = DebridSettingsStore.get()
) {
  const resolve = getResolve(stream, season, episode, settings);
  if (!resolve) {
    return null;
  }
  const provider = DebridProviders.byId(resolve.service);
  const apiKey = DebridProviders.apiKeyFor(settings, provider?.id);
  if (!provider || !apiKey) {
    return null;
  }
  const identity = resolve.infoHash || resolve.magnetUri || resolve.torrentName || resolve.filename;
  if (!identity) {
    return null;
  }
  return [
    provider.id,
    stableFingerprint(apiKey),
    String(identity).trim().toLowerCase(),
    String(resolve.fileIdx ?? ""),
    String(resolve.filename || stream.behaviorHints?.filename || "")
      .trim()
      .toLowerCase(),
    String(season ?? resolve.season ?? ""),
    String(episode ?? resolve.episode ?? "")
  ].join("|");
}

function cachedResult(cacheKey) {
  const entry = resolvedCache.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.cachedAtMs > RESOLVE_CACHE_TTL_MS) {
    resolvedCache.delete(cacheKey);
    return null;
  }
  return entry.result;
}

function rememberResolved(cacheKey, result) {
  resolvedCache.set(cacheKey, { result, cachedAtMs: Date.now() });
  while (resolvedCache.size > RESOLVE_CACHE_MAX_ENTRIES) {
    const oldestKey = resolvedCache.keys().next().value;
    if (oldestKey == null) {
      break;
    }
    resolvedCache.delete(oldestKey);
  }
}

function failure(status, detail = "") {
  return { status, detail };
}

function success(url, filename = null, videoSize = null, mimeType = null) {
  return { status: "success", url, filename, videoSize, ...(mimeType ? { mimeType } : {}) };
}

function isServiceDegradedResponse(response = {}) {
  const status = Number(response?.status || 0);
  return status === 502 || status === 503 || status === 504;
}

function serviceDegradedFailure(response = {}, providerName = "Debrid") {
  if (!isServiceDegradedResponse(response)) {
    return null;
  }
  const status = Number(response?.status || 0);
  return failure("service_degraded", `${providerName} service returned HTTP ${status}.`);
}

async function resolveTorbox(
  resolve,
  apiKey,
  season,
  episode,
  { preferDirectDownload = false, preferSecondaryForDual = false } = {}
) {
  const magnet = buildMagnetUri(resolve);
  if (!magnet) {
    return failure("stale");
  }
  const create = await DebridApi.torboxCreateTorrent(apiKey, magnet);
  const torrentId = create.data?.data?.torrent_id ?? create.data?.data?.id;
  if (!create.ok || !torrentId) {
    const degraded = serviceDegradedFailure(create, "Torbox");
    if (degraded) {
      return degraded;
    }
    return create.status === 409
      ? failure("not_cached")
      : failure(create.status === 401 || create.status === 403 ? "error" : "stale");
  }
  const torrent = await DebridApi.torboxGetTorrent(apiKey, torrentId);
  const files = torrent.data?.data?.files || [];
  if (!torrent.ok || !Array.isArray(files)) {
    const degraded = serviceDegradedFailure(torrent, "Torbox");
    if (degraded) {
      return degraded;
    }
    return failure("stale");
  }
  const file = selectDebridFile(files, resolve, { season, episode, kind: "torbox" });
  if (!file) {
    return failure("stale");
  }
  if (!preferDirectDownload) {
    pendingPreferSecondaryForDual = Boolean(preferSecondaryForDual);
    const webStreamUrl = await requestTorboxWebStream(apiKey, torrentId, file.id, {
      fileName: getDebridFileDisplayName(file)
    }).catch(() => null);
    // "Choose another source" in the audio window (B34).
    if (webStreamUrl?.cancelled) {
      return failure("cancelled");
    }
    const torboxStreamMeta = torboxStreamMetaCache.get(`${torrentId}:${file.id}`) || null;
    if (webStreamUrl) {
      return {
        ...success(
          webStreamUrl,
          hlsFilename(getDebridFileDisplayName(file)),
          getDebridFileSize(file),
          HLS_MIME_TYPE
        ),
        ...(torboxStreamMeta ? { torboxStreamMeta } : {})
      };
    }
    const link = await DebridApi.torboxRequestDownloadLink(apiKey, torrentId, file.id);
    const url = typeof link.data?.data === "string" ? link.data.data : "";
    if (!link.ok || !url) {
      const degraded = serviceDegradedFailure(link, "Torbox");
      if (degraded) {
        return degraded;
      }
      return failure("stale");
    }
    return {
      ...success(url, getDebridFileDisplayName(file), getDebridFileSize(file)),
      ...(torboxStreamMeta ? { torboxStreamMeta } : {})
    };
  }
  const link = await DebridApi.torboxRequestDownloadLink(apiKey, torrentId, file.id);
  const url = typeof link.data?.data === "string" ? link.data.data : "";
  if (!link.ok || !url) {
    const degraded = serviceDegradedFailure(link, "Torbox");
    if (degraded) {
      return degraded;
    }
    return failure("stale");
  }
  return success(url, getDebridFileDisplayName(file), getDebridFileSize(file));
}

async function resolvePremiumize(resolve, apiKey, season, episode, stream = {}) {
  const source = buildMagnetUri(resolve) || getStreamUrl(stream);
  if (!source) {
    return failure("stale");
  }
  const response = await DebridApi.premiumizeDirectDownload(apiKey, source);
  if (!response.ok) {
    return failure(response.status === 401 || response.status === 403 ? "error" : "stale");
  }
  const body = response.data || {};
  if (String(body.status || "").toLowerCase() === "error") {
    const message = `${body.message || ""} ${body.code || ""}`.toLowerCase();
    return failure(
      message.includes("cache") || message.includes("not found") ? "not_cached" : "stale",
      message
    );
  }
  const file = selectDebridFile(body.content || [], resolve, {
    season,
    episode,
    kind: "premiumize"
  });
  const url = file?.link || "";
  if (!file || !url) {
    return failure("stale");
  }
  return success(
    url,
    getDebridFileDisplayName(file) || stream.behaviorHints?.filename || null,
    getDebridFileSize(file) || stream.behaviorHints?.videoSize || null
  );
}

async function resolveRealDebrid(resolve, apiKey, season, episode) {
  const magnet = buildMagnetUri(resolve);
  if (!magnet) {
    return failure("stale");
  }
  const add = await DebridApi.realDebridAddMagnet(apiKey, magnet);
  const torrentId = add.data?.id;
  if (!add.ok || !torrentId) {
    return failure(add.status === 401 || add.status === 403 ? "error" : "stale");
  }
  let resolved = false;
  try {
    const infoBefore = await DebridApi.realDebridTorrentInfo(apiKey, torrentId);
    const files = infoBefore.data?.files || [];
    if (!infoBefore.ok || !Array.isArray(files)) {
      return failure("stale");
    }
    const file = selectDebridFile(files, resolve, { season, episode, kind: "realdebrid" });
    if (file?.id == null) {
      return failure("stale");
    }
    const select = await DebridApi.realDebridSelectFiles(apiKey, torrentId, String(file.id));
    if (!select.ok && select.status !== 202) {
      return failure("stale");
    }
    const infoAfter = await DebridApi.realDebridTorrentInfo(apiKey, torrentId);
    if (!infoAfter.ok || String(infoAfter.data?.status || "").toLowerCase() !== "downloaded") {
      return failure("stale");
    }
    const link = (Array.isArray(infoAfter.data?.links) ? infoAfter.data.links : []).find(Boolean);
    if (!link) {
      return failure("stale");
    }
    const unrestricted = await DebridApi.realDebridUnrestrictLink(apiKey, link);
    const url = unrestricted.data?.download || "";
    if (!unrestricted.ok || !url) {
      return failure("stale");
    }
    resolved = true;
    return success(
      url,
      unrestricted.data?.filename || getDebridFileDisplayName(file),
      unrestricted.data?.filesize || getDebridFileSize(file)
    );
  } finally {
    if (!resolved) {
      DebridApi.realDebridDeleteTorrent(apiKey, torrentId).catch(() => null);
    }
  }
}

async function getLocalTorrentCacheStatus(provider, apiKey, hash) {
  const normalized = String(hash || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return { status: "unknown" };
  }
  if (provider.id === DEBRID_PROVIDER_IDS.TORBOX) {
    const response = await DebridApi.torboxCheckCached(apiKey, [normalized]);
    const degraded = serviceDegradedFailure(response, "Torbox");
    if (degraded) {
      return degraded;
    }
    if (!response.ok || response.data?.success === false) {
      return { status: "unknown" };
    }
    const cached = await resolveAlternativeHashMatches(torboxCachedEntries(response), [normalized]);
    return { status: "success", cached: Boolean(cached[normalized]) };
  }
  if (provider.id === DEBRID_PROVIDER_IDS.PREMIUMIZE) {
    const response = await DebridApi.premiumizeCheckCache(apiKey, [normalized]);
    const degraded = serviceDegradedFailure(response, "Premiumize");
    if (degraded) {
      return degraded;
    }
    if (!response.ok || String(response.data?.status || "").toLowerCase() === "error") {
      return { status: "unknown" };
    }
    return { status: "success", cached: response.data?.response?.[0] === true };
  }
  return { status: "unknown" };
}

function withResolvedUrl(stream = {}, result) {
  // A converted TorBox stream is HLS: say so, or the player treats it as the
  // original file (MKV) and plays it as a direct file.
  const typeHints = result.mimeType
    ? { mimeType: result.mimeType, sourceType: result.mimeType }
    : {};
  return {
    ...stream,
    ...typeHints,
    ...(result.torboxStreamMeta ? { torboxStreamMeta: result.torboxStreamMeta } : {}),
    url: result.url,
    externalUrl: null,
    behaviorHints: {
      ...(stream.behaviorHints || {}),
      filename: result.filename || stream.behaviorHints?.filename || null,
      videoSize: result.videoSize || stream.behaviorHints?.videoSize || null
    },
    raw: {
      ...(stream.raw || stream),
      ...typeHints,
      ...(result.torboxStreamMeta ? { torboxStreamMeta: result.torboxStreamMeta } : {}),
      url: result.url,
      externalUrl: null,
      behaviorHints: {
        ...(stream.raw?.behaviorHints || stream.behaviorHints || {}),
        filename: result.filename || stream.behaviorHints?.filename || null,
        videoSize: result.videoSize || stream.behaviorHints?.videoSize || null
      }
    }
  };
}

export const DirectDebridResolver = {
  canResolveStream(stream = {}, { season = null, episode = null } = {}) {
    const settings = DebridSettingsStore.get();
    if (!settings.enabled) {
      return false;
    }
    const resolve = getResolve(stream, season, episode, settings);
    if (!resolve) {
      return false;
    }
    const provider = DebridProviders.byId(resolve.service);
    if (!provider) {
      return false;
    }
    const activeProvider = DebridProviders.preferredResolverService(settings)?.provider || null;
    if (isDirectDebrid(stream) && activeProvider?.id && provider.id !== activeProvider.id) {
      return false;
    }
    if (
      needsLocalDebridResolve(stream) &&
      !provider.capabilities.includes(DEBRID_CAPABILITIES.LOCAL_TORRENT_RESOLVE)
    ) {
      return false;
    }
    if (needsLocalDebridResolve(stream) && stream.debridCacheStatus?.state === "NOT_CACHED") {
      return false;
    }
    return Boolean(DebridProviders.apiKeyFor(settings, provider.id));
  },

  shouldListStream(stream = {}) {
    return Boolean(getStreamUrl(stream) || stream.ytId || this.canResolveStream(stream));
  },

  cachedPlayableStream(stream = {}, { season = null, episode = null } = {}) {
    const key = cacheKeyFor(stream, season, episode);
    const cached = key ? cachedResult(key) : null;
    return cached ? withResolvedUrl(stream, cached) : null;
  },

  // forceRefresh drops the remembered link first, so the provider is asked for a new one.
  async resolve(
    stream = {},
    { season = null, episode = null, forceRefresh = false, preferDirectDownload = false } = {}
  ) {
    if (getStreamUrl(stream)) {
      return { status: "success", stream };
    }
    const settings = DebridSettingsStore.get();
    if (!settings.enabled) {
      return failure("disabled");
    }
    const resolve = getResolve(stream, season, episode, settings);
    if (!resolve) {
      return failure("stale");
    }
    const provider = DebridProviders.byId(resolve.service);
    const apiKey = DebridProviders.apiKeyFor(settings, provider?.id);
    if (!provider || !apiKey) {
      return failure("missing_api_key");
    }
    const activeProvider = DebridProviders.preferredResolverService(settings)?.provider || null;
    if (isDirectDebrid(stream) && activeProvider?.id && provider.id !== activeProvider.id) {
      return failure("stale");
    }
    if (needsLocalDebridResolve(stream) && stream.debridCacheStatus?.state === "NOT_CACHED") {
      return failure("not_cached");
    }
    if (
      needsLocalDebridResolve(stream) &&
      stream.infoHash &&
      stream.debridCacheStatus?.state !== "CACHED" &&
      provider.capabilities.includes(DEBRID_CAPABILITIES.LOCAL_TORRENT_CACHE_CHECK)
    ) {
      const cacheStatus = await getLocalTorrentCacheStatus(provider, apiKey, stream.infoHash).catch(
        (error) => failure("error", error?.message || "")
      );
      if (cacheStatus?.status === "service_degraded") {
        return cacheStatus;
      }
      if (cacheStatus?.status === "success" && cacheStatus.cached === false) {
        return failure("not_cached");
      }
    }

    const baseKey = cacheKeyFor(stream, season, episode, settings);
    const key = baseKey && preferDirectDownload ? `${baseKey}|direct-download` : baseKey;
    if (key && forceRefresh) {
      resolvedCache.delete(key);
    }
    if (key) {
      const cached = cachedResult(key);
      if (cached) {
        return { status: "success", stream: withResolvedUrl(stream, cached) };
      }
      const inFlight = inFlightResolves.get(key);
      if (inFlight) {
        const result = await inFlight;
        return result.status === "success"
          ? { status: "success", stream: withResolvedUrl(stream, result) }
          : result;
      }
    }

    const task = (async () => {
      switch (provider.id) {
        case DEBRID_PROVIDER_IDS.TORBOX:
          return resolveTorbox(resolve, apiKey, season, episode, {
            preferDirectDownload,
            preferSecondaryForDual: isStreamPtBrAvailable(stream)
          });
        case DEBRID_PROVIDER_IDS.PREMIUMIZE:
          return resolvePremiumize(resolve, apiKey, season, episode, stream);
        case DEBRID_PROVIDER_IDS.REAL_DEBRID:
          return resolveRealDebrid(resolve, apiKey, season, episode);
        default:
          return failure("error");
      }
    })();

    if (key) {
      inFlightResolves.set(key, task);
    }
    try {
      const result = await task;
      if (key && result.status === "success") {
        rememberResolved(key, result);
      }
      return result.status === "success"
        ? { status: "success", stream: withResolvedUrl(stream, result) }
        : result;
    } catch (error) {
      return failure("error", error?.message || "");
    } finally {
      if (key && inFlightResolves.get(key) === task) {
        inFlightResolves.delete(key);
      }
    }
  },

  async resolveDownloadUrl(stream = {}, { season = null, episode = null } = {}) {
    const directUrl = getStreamUrl(stream);
    if (directUrl && !isHlsStreamUrl(directUrl, stream.mimeType || stream.sourceType)) {
      return {
        status: "success",
        url: directUrl,
        filename: String(stream.filename || stream.behaviorHints?.filename || "").trim()
      };
    }

    const hasDebridSource = Boolean(
      stream.clientResolve ||
      stream.raw?.clientResolve ||
      stream.infoHash ||
      torrentMagnetUri(stream)
    );
    if (hasDebridSource) {
      const downloadCandidate = {
        ...stream,
        url: null,
        externalUrl: null
      };
      const resolved = await this.resolve(downloadCandidate, {
        season,
        episode,
        preferDirectDownload: true
      });
      if (resolved?.status === "success" && resolved.stream?.url) {
        if (
          isHlsStreamUrl(
            resolved.stream.url,
            resolved.stream.mimeType || resolved.stream.sourceType
          )
        ) {
          return { status: "unsupported_hls" };
        }
        return {
          status: "success",
          url: resolved.stream.url,
          filename: String(resolved.stream.behaviorHints?.filename || stream.filename || "").trim()
        };
      }
      return resolved;
    }

    if (directUrl && isHlsStreamUrl(directUrl, stream.mimeType || stream.sourceType)) {
      return { status: "unsupported_hls" };
    }
    return failure("unavailable");
  },

  async switchTorboxAudioTrack(torboxStreamMeta = null, audioIndex = 0) {
    const torrentId = torboxStreamMeta?.torrentId;
    const fileId = torboxStreamMeta?.fileId;
    if (torrentId == null || fileId == null) {
      return failure("unavailable");
    }
    const settings = DebridSettingsStore.get();
    const apiKey = DebridProviders.apiKeyFor(settings, DEBRID_PROVIDER_IDS.TORBOX);
    if (!apiKey) {
      return failure("missing_api_key");
    }
    const response = await DebridApi.torboxCreateStream(apiKey, {
      id: torrentId,
      fileId,
      audioIndex: Math.max(0, Number(audioIndex) || 0)
    });
    const hlsUrl =
      typeof response?.data?.data?.hls_url === "string" ? response.data.data.hls_url.trim() : "";
    if (!response?.ok || !hlsUrl) {
      return failure("error");
    }
    return {
      status: "success",
      url: hlsUrl,
      mimeType: HLS_MIME_TYPE
    };
  }
};
