// Profile-scoped store read memo.
//
// Hot-path readers (Home card render, player and ambient 1 s ticks) call the
// store getters constantly on single-core Tizen TVs. Repeated reads of an
// unchanged envelope must not reparse, re-normalize or re-serialize it, while
// every write (through the store or straight into localStorage) must still be
// observed on the next read and callers must keep receiving independent copies.
import test from "node:test";
import assert from "node:assert/strict";

const storage = new Map();
let getItemCalls = 0;
globalThis.localStorage = {
  getItem(key) {
    getItemCalls += 1;
    return storage.has(String(key)) ? storage.get(String(key)) : null;
  },
  setItem(key, value) {
    storage.set(String(key), String(value));
  },
  removeItem(key) {
    storage.delete(String(key));
  },
  key(index) {
    return Array.from(storage.keys())[index] ?? null;
  },
  get length() {
    return storage.size;
  }
};

const realParse = JSON.parse;
let parseCalls = 0;
JSON.parse = function countedParse(...args) {
  parseCalls += 1;
  return realParse.apply(this, args);
};

const { createProfileScopedStore } = await import("../js/data/local/profileScopedStore.js");

const KEY = "profileScopedStoreCacheTest";
const DEFAULTS = { theme: "dark", volume: 50, tags: [] };
let normalizeCalls = 0;
const normalize = (value = {}) => {
  normalizeCalls += 1;
  return {
    theme: String(value?.theme || DEFAULTS.theme),
    volume: Number.isFinite(Number(value?.volume)) ? Number(value.volume) : DEFAULTS.volume,
    tags: Array.isArray(value?.tags) ? value.tags.map(String) : []
  };
};
const store = createProfileScopedStore({ key: KEY, normalize });

const envelope = (profiles) => JSON.stringify({ __profileScoped: true, version: 1, profiles });
const resetCounters = () => {
  getItemCalls = 0;
  parseCalls = 0;
  normalizeCalls = 0;
};

test("repeated reads of unchanged storage do not reparse or re-normalize", () => {
  storage.clear();
  storage.set(
    KEY,
    envelope({ 1: normalize({ theme: "light", volume: 10 }), 2: normalize({ volume: 20 }) })
  );
  resetCounters();

  const first = store.getForProfile("1");
  assert.deepEqual(first, { theme: "light", volume: 10, tags: [] });
  const parsesForFirstRead = parseCalls;
  assert.ok(parsesForFirstRead >= 1, "the first read must parse the stored envelope");
  const normalizeForFirstRead = normalizeCalls;
  assert.ok(normalizeForFirstRead >= 2, "the first read normalizes every stored profile");

  for (let index = 0; index < 25; index += 1) {
    assert.deepEqual(store.getForProfile("1"), { theme: "light", volume: 10, tags: [] });
    // Settings are shared: every profile reads the primary profile's value.
    assert.deepEqual(store.getForProfile("2"), { theme: "light", volume: 10, tags: [] });
  }
  assert.equal(
    normalizeCalls,
    normalizeForFirstRead,
    "cached reads must not run the normalizer again"
  );
  // Each cached read still costs one getItem (to detect external writes) plus
  // one single-profile clone (one JSON.parse) for the caller's independent copy.
  assert.equal(parseCalls - parsesForFirstRead, 50, "cached reads only clone the one profile");
  assert.ok(getItemCalls >= 51, "every read checks the raw stored string");
  assert.equal(
    storage.get(KEY),
    envelope({
      1: { theme: "light", volume: 10, tags: [] },
      2: { theme: "dark", volume: 20, tags: [] }
    }),
    "an already-normalized envelope is never rewritten"
  );
});

test("an un-normalized stored envelope is written back once and then served from the memo", () => {
  storage.clear();
  storage.set(KEY, envelope({ 1: { theme: "light", volume: "7", stale: true } }));
  resetCounters();

  assert.deepEqual(store.getForProfile("1"), { theme: "light", volume: 7, tags: [] });
  const normalizedText = envelope({ 1: { theme: "light", volume: 7, tags: [] } });
  assert.equal(storage.get(KEY), normalizedText, "normalization is persisted back to storage");

  const normalizeAfterFirstRead = normalizeCalls;
  assert.deepEqual(store.getForProfile("1"), { theme: "light", volume: 7, tags: [] });
  assert.equal(normalizeCalls, normalizeAfterFirstRead, "the written-back envelope is memoized");
  assert.equal(storage.get(KEY), normalizedText);
});

test("a direct external write to localStorage is picked up on the next read", () => {
  storage.clear();
  storage.set(KEY, envelope({ 1: normalize({ theme: "light" }) }));
  resetCounters();
  assert.equal(store.getForProfile("1").theme, "light");

  // Cloud sync, profile cleanup and tests write the key without going through
  // the store module.
  localStorage.setItem(KEY, envelope({ 1: normalize({ theme: "solar", volume: 3 }) }));
  assert.deepEqual(store.getForProfile("1"), { theme: "solar", volume: 3, tags: [] });

  localStorage.removeItem(KEY);
  assert.deepEqual(store.getForProfile("1"), DEFAULTS, "a removed key falls back to defaults");

  // Same text again must be served again without a change in semantics.
  localStorage.setItem(KEY, envelope({ 1: normalize({ theme: "solar", volume: 3 }) }));
  assert.deepEqual(store.getForProfile("1"), { theme: "solar", volume: 3, tags: [] });
});

test("setForProfile invalidates the memo and the next read returns the new value", () => {
  storage.clear();
  storage.set(KEY, envelope({ 1: normalize({ theme: "light" }), 2: normalize({ theme: "red" }) }));
  resetCounters();
  assert.equal(store.getForProfile("1").theme, "light");

  const returned = store.setForProfile("1", { volume: 99 }, { silentSync: true });
  assert.deepEqual(returned, { theme: "light", volume: 99, tags: [] });
  assert.deepEqual(store.getForProfile("1"), { theme: "light", volume: 99, tags: [] });
  assert.deepEqual(
    JSON.parse(storage.get(KEY)).profiles["1"],
    { theme: "light", volume: 99, tags: [] },
    "the write reached storage"
  );
  assert.deepEqual(
    store.getForProfile("2"),
    { theme: "light", volume: 99, tags: [] },
    "settings are shared, so another profile sees the same value"
  );

  store.replaceForProfile("2", { theme: "blue", tags: ["x"] }, { silentSync: true });
  assert.deepEqual(store.getForProfile("2"), { theme: "blue", volume: 50, tags: ["x"] });
  assert.deepEqual(
    store.getForProfile("1"),
    { theme: "blue", volume: 50, tags: ["x"] },
    "a write from any profile updates the shared settings"
  );

  store.clearProfile("2", { silentSync: true });
  assert.equal(
    Object.prototype.hasOwnProperty.call(JSON.parse(storage.get(KEY)).profiles, "2"),
    false
  );
  assert.deepEqual(
    store.getForProfile("1"),
    { theme: "blue", volume: 50, tags: ["x"] },
    "removing a secondary profile never clears the shared settings"
  );
});

test("values returned by getForProfile are independent copies of the memoized envelope", () => {
  storage.clear();
  storage.set(KEY, envelope({ 1: normalize({ theme: "light", tags: ["a"] }) }));
  resetCounters();

  const first = store.getForProfile("1");
  first.theme = "mutated";
  first.tags.push("b");
  first.volume = -1;

  const second = store.getForProfile("1");
  assert.notEqual(second, first, "each read hands out a new object");
  assert.deepEqual(second, { theme: "light", volume: 50, tags: ["a"] });
  assert.notEqual(second.tags, first.tags, "nested values are copied as well");

  const third = store.getForProfile("1");
  assert.notEqual(third, second);
  assert.notEqual(third.tags, second.tags);
  assert.deepEqual(third, second);

  assert.equal(
    storage.get(KEY),
    envelope({ 1: { theme: "light", volume: 50, tags: ["a"] } }),
    "caller mutations never leak into storage"
  );
});

test("another profile reads the shared settings without creating its own copy", () => {
  storage.clear();
  storage.set(KEY, envelope({ 1: normalize({ theme: "light", volume: 4 }) }));
  resetCounters();

  assert.deepEqual(store.getForProfile("3"), { theme: "light", volume: 4, tags: [] });
  const persisted = storage.get(KEY);
  assert.equal(
    Object.prototype.hasOwnProperty.call(JSON.parse(persisted).profiles, "3"),
    false,
    "no per-profile copy is seeded"
  );

  const normalizeAfterFirstRead = normalizeCalls;
  for (let index = 0; index < 5; index += 1) {
    store.getForProfile("3");
    store.getForProfile("1");
  }
  assert.equal(normalizeCalls, normalizeAfterFirstRead, "repeated reads are memoized");
  assert.equal(storage.get(KEY), persisted, "no further writes happen");
});

test.after(() => {
  JSON.parse = realParse;
});
