// Rotten Tomatoes scores from CineRotten (assets/data/rt-scores.json, built by
// scripts/buildRtScores.mjs). Lookup is synchronous once loaded; screens that
// render before the file arrives emit empty slots that fillRtSlots() fills.
//
// Score row: [tomatometer, popcornmeter, criticReviews, audienceRatings].

const SCORES_URL = "assets/data/rt-scores.json";
const CACHE_KEY = "nuvio.rtScores.v1";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let scoreTable = null;
let loadPromise = null;
const readyListeners = new Set();

export const FRESH_THRESHOLD = 60;

export function setRtScoreTable(table) {
  scoreTable = table && typeof table === "object" ? table : null;
}

export function isRtScoresLoaded() {
  return Boolean(scoreTable);
}

function rowToScore(row) {
  if (!Array.isArray(row)) return null;
  const num = (value) => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));
  const score = {
    tomatometer: num(row[0]),
    audience: num(row[1]),
    criticsCount: num(row[2]),
    audienceCount: num(row[3])
  };
  return score.tomatometer == null && score.audience == null ? null : score;
}

const IMDB_ID_PATTERN = /\btt\d{5,10}\b/;

export function resolveImdbId(item) {
  if (!item) return "";
  if (typeof item === "string") {
    const match = item.match(IMDB_ID_PATTERN);
    return match ? match[0] : "";
  }
  const candidates = [
    item.imdb_id,
    item.imdbId,
    item.imdb,
    item.externalIds?.imdb,
    item.externalIds?.imdb_id,
    item.external_ids?.imdb_id,
    item.behaviorHints?.imdbId,
    item.id,
    item.metaId,
    item.contentId
  ];
  for (const value of candidates) {
    if (value == null) continue;
    const match = String(value).match(IMDB_ID_PATTERN);
    if (match) return match[0];
  }
  return "";
}

export function getRtScore(itemOrId) {
  if (!scoreTable) return null;
  const id = resolveImdbId(itemOrId);
  return id ? rowToScore(scoreTable[id]) : null;
}

function readCache() {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.s && typeof parsed.s === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    globalThis.localStorage?.setItem(
      CACHE_KEY,
      JSON.stringify({ ...payload, cachedAt: Date.now() })
    );
  } catch {
    // Quota or private mode: the in-memory copy is enough.
  }
}

function notifyReady() {
  readyListeners.forEach((listener) => {
    try {
      listener();
    } catch (err) {
      console.warn("rtScores listener failed", err);
    }
  });
  if (typeof document !== "undefined") {
    fillRtSlots(document);
  }
}

export function onRtScoresReady(listener) {
  if (typeof listener !== "function") return () => {};
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

export function loadRtScores({ fetchImpl = globalThis.fetch } = {}) {
  if (loadPromise) return loadPromise;
  const cached = readCache();
  if (cached) {
    setRtScoreTable(cached.s);
    queueMicrotask(notifyReady);
  }
  const fresh = cached && Date.now() - Number(cached.cachedAt || 0) < CACHE_MAX_AGE_MS;
  if (fresh || typeof fetchImpl !== "function") {
    loadPromise = Promise.resolve(scoreTable);
    return loadPromise;
  }
  loadPromise = fetchImpl(SCORES_URL)
    .then((response) => (response && response.ok ? response.json() : null))
    .then((payload) => {
      if (payload && payload.s && typeof payload.s === "object") {
        const changed = !cached || cached.generated !== payload.generated;
        setRtScoreTable(payload.s);
        writeCache(payload);
        if (changed) notifyReady();
      }
      return scoreTable;
    })
    .catch((err) => {
      console.warn("rtScores: could not load scores", err);
      return scoreTable;
    });
  return loadPromise;
}

// ---- Markup -------------------------------------------------------------

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

// Posters show the Popcornmeter; titles without one fall back to the Tomatometer.
export function pickPosterScore(score) {
  if (!score) return null;
  if (score.audience != null) return { kind: "audience", value: score.audience };
  if (score.tomatometer != null) return { kind: "critics", value: score.tomatometer };
  return null;
}

function posterBadgeInner(score) {
  const pick = pickPosterScore(score);
  if (!pick) return "";
  const icon = pick.kind === "audience" ? "🍿" : "🍅";
  const tone = pick.value >= FRESH_THRESHOLD ? "good" : "bad";
  const label = pick.kind === "audience" ? `Público ${pick.value}%` : `Crítica ${pick.value}%`;
  return `<span class="rt-poster-badge rt-${pick.kind} rt-${tone}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><span class="rt-poster-icon" aria-hidden="true">${icon}</span>${pick.value}%</span>`;
}

// Returns the badge if scores are loaded, otherwise an empty slot that fills
// itself when the scores arrive. Empty string for titles without an IMDb id.
export function renderRtPosterBadge(item) {
  const id = resolveImdbId(item);
  if (!id) return "";
  if (scoreTable) return posterBadgeInner(getRtScore(id));
  return `<span class="rt-slot" data-rt-slot="poster" data-rt-id="${escapeAttr(id)}" hidden></span>`;
}

function scorePill(kind, value, count, countLabel) {
  if (value == null) return "";
  const icon = kind === "critics" ? "🍅" : "🍿";
  const tone = value >= FRESH_THRESHOLD ? "good" : "bad";
  const name =
    kind === "critics" ? (tone === "good" ? "Fresh" : "Rotten") : tone === "good" ? "Hot" : "Stale";
  const countText = formatCount(count);
  const title = `${kind === "critics" ? "Tomatometer" : "Popcornmeter"} ${value}% (${name})${countText ? ` · ${countText} ${countLabel}` : ""}`;
  return `<span class="rt-detail-pill rt-${kind} rt-${tone}" title="${escapeAttr(title)}"><span class="rt-detail-icon" aria-hidden="true">${icon}</span><span class="rt-detail-value">${value}%</span>${countText ? `<span class="rt-detail-count">${escapeAttr(countText)} ${escapeAttr(countLabel)}</span>` : ""}</span>`;
}

function detailBadgeInner(score) {
  if (!score) return "";
  const parts = [
    scorePill("critics", score.tomatometer, score.criticsCount, "críticas"),
    scorePill("audience", score.audience, score.audienceCount, "notas")
  ].filter(Boolean);
  return parts.length ? `<span class="rt-detail-badges">${parts.join("")}</span>` : "";
}

export function renderRtDetailBadges(item) {
  const id = resolveImdbId(item);
  if (!id) return "";
  if (scoreTable) return detailBadgeInner(getRtScore(id));
  return `<span class="rt-slot" data-rt-slot="detail" data-rt-id="${escapeAttr(id)}" hidden></span>`;
}

export function fillRtSlots(root) {
  if (!scoreTable || !root || typeof root.querySelectorAll !== "function") return 0;
  let filled = 0;
  root.querySelectorAll("[data-rt-slot]").forEach((slot) => {
    const id = slot.getAttribute("data-rt-id");
    const kind = slot.getAttribute("data-rt-slot");
    const score = getRtScore(id);
    const html = kind === "detail" ? detailBadgeInner(score) : posterBadgeInner(score);
    if (html) {
      slot.insertAdjacentHTML("afterend", html);
      filled += 1;
    }
    slot.remove();
  });
  return filled;
}
