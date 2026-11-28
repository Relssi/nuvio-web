// Rotten Tomatoes lists from CineRotten (assets/data/rt-lists.json, built by
// scripts/buildRtLists.mjs) exposed as a built-in catalog addon, the same way
// media servers are (baseUrl "nuvio-rt://lists"). Home and Discover then show
// them like any other addon catalog.

const LISTS_URL = "assets/data/rt-lists.json";
const CACHE_KEY = "nuvio.rtLists.v1";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const RT_LISTS_ADDON_ID = "nuvio-rotten-tomatoes";
export const RT_LISTS_BASE_URL = "nuvio-rt://lists";

let lists = null;
let loadPromise = null;

export function setRtLists(value) {
  lists = Array.isArray(value) ? value : null;
}

export function isRtListsBase(url) {
  return String(url || "").startsWith("nuvio-rt://");
}

function readCache() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) || "null");
    return parsed && Array.isArray(parsed.lists) ? parsed : null;
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

export function loadRtLists({ fetchImpl = globalThis.fetch } = {}) {
  if (loadPromise) return loadPromise;
  const cached = readCache();
  if (cached) setRtLists(cached.lists);
  const fresh = cached && Date.now() - Number(cached.cachedAt || 0) < CACHE_MAX_AGE_MS;
  if (fresh || typeof fetchImpl !== "function") {
    loadPromise = Promise.resolve(lists);
    return loadPromise;
  }
  const request = fetchImpl(LISTS_URL)
    .then((response) => (response && response.ok ? response.json() : null))
    .then((payload) => {
      if (payload && Array.isArray(payload.lists)) {
        setRtLists(payload.lists);
        writeCache(payload);
      }
      return lists;
    })
    .catch((err) => {
      console.warn("rtLists: could not load lists", err);
      return lists;
    });
  // With a cached copy, answer at once and refresh in the background.
  loadPromise = cached ? Promise.resolve(lists) : request;
  return loadPromise;
}

function catalogName(list) {
  const title = String(list.title || "");
  return /rotten tomatoes/i.test(title) ? title : `RT · ${title}`;
}

// Sync: [] until the lists are loaded.
export function rtListsAddons() {
  if (!lists || !lists.length) return [];
  const types = [...new Set(lists.map((list) => list.type))];
  return [
    {
      id: RT_LISTS_ADDON_ID,
      name: "Rotten Tomatoes",
      displayName: "Rotten Tomatoes",
      version: "1",
      baseUrl: RT_LISTS_BASE_URL,
      types,
      resources: [{ name: "catalog", types }],
      catalogs: lists.map((list) => ({
        id: list.id,
        type: list.type,
        apiType: list.type,
        name: catalogName(list),
        extra: [],
        showInHome: Boolean(list.home),
        hasExplicitShowInHome: true
      }))
    }
  ];
}

// Stremio-style metas for one list (empty when unknown or past page one).
export function rtListMetas(catalogId, { skip = 0 } = {}) {
  if (skip) return [];
  const list = (lists || []).find((entry) => entry.id === catalogId);
  if (!list) return [];
  return list.items.map(([id, name, year, poster]) => ({
    id,
    imdb_id: id,
    type: list.type,
    name,
    poster: poster || undefined,
    releaseInfo: year ? String(year) : undefined,
    year: year || undefined
  }));
}
