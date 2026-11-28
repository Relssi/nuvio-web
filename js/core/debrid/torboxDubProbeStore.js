// Results of the background "does this source really have the preferred
// audio?" check (B35). Filled by DirectDebridResolver.probePreferredAudio
// with TorBox's own track list, read by the source ordering to put confirmed
// dubbed sources first and confirmed non-dubbed ones last. Kept in
// localStorage for 30 days, so a source is only checked once.

const STORAGE_KEY = "nuvioTorboxDubProbe";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;

let entries = null;

function load() {
  if (entries) return entries;
  entries = new Map();
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || "{}");
    const now = Date.now();
    Object.entries(raw || {}).forEach(([key, value]) => {
      if (value && now - Number(value.at || 0) < MAX_AGE_MS) entries.set(key, value);
    });
  } catch (_) {
    // Private mode or broken data: start empty.
  }
  return entries;
}

function save() {
  try {
    const list = [...load().entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(list)));
  } catch (_) {
    // Storage full or blocked: keep the in-memory copy.
  }
}

function infoHashOf(stream = {}) {
  return String(
    stream?.infoHash ||
      stream?.clientResolve?.infoHash ||
      stream?.raw?.infoHash ||
      stream?.raw?.clientResolve?.infoHash ||
      ""
  )
    .trim()
    .toLowerCase();
}

// Same torrent file = same audio tracks, whatever addon listed it.
export function dubProbeKey(stream = {}) {
  const hash = infoHashOf(stream);
  if (!hash) return "";
  const fileIdx = stream?.fileIdx ?? stream?.raw?.fileIdx ?? stream?.clientResolve?.fileIdx ?? "*";
  return `${hash}:${fileIdx}`;
}

// true = has the preferred audio, false = it does not, null = not checked.
export function getDubProbe(stream = {}) {
  const key = dubProbeKey(stream);
  if (!key) return null;
  const entry = load().get(key);
  return entry ? Boolean(entry.hasPreferred) : null;
}

export function setDubProbe(stream = {}, hasPreferred, details = {}) {
  const key = dubProbeKey(stream);
  if (!key) return;
  load().set(key, { hasPreferred: Boolean(hasPreferred), at: Date.now(), ...details });
  save();
}

export function resetDubProbeStoreForTests() {
  entries = new Map();
}
