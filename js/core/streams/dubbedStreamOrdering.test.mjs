import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  store: {},
  getItem(key) {
    return this.store[key] ?? null;
  },
  setItem(key, value) {
    this.store[key] = String(value);
  },
  removeItem(key) {
    delete this.store[key];
  }
};

const { preferDubbedStreams, dubRank } = await import("./streamOrdering.js");
const { setDubProbe, resetDubProbeStoreForTests } =
  await import("../debrid/torboxDubProbeStore.js");

const make = (id, title, hash) => ({ id, title, infoHash: hash || id.padEnd(40, "0") });

test("dubbed sources first: confirmed, labelled PT-BR, Dual, others, confirmed without PT", () => {
  resetDubProbeStoreForTests();
  const plain = make("plain", "Movie 1080p WEB-DL");
  const dual = make("dual", "Movie 1080p DUAL 5.1");
  const ptbr = make("ptbr", "Movie 1080p 🇧🇷 Dublado");
  const confirmed = make("conf", "Movie 2160p");
  const noPt = make("nopt", "Movie 720p Dual");
  setDubProbe(confirmed, true);
  setDubProbe(noPt, false);
  const ids = preferDubbedStreams([plain, noPt, dual, ptbr, confirmed], { enabled: true }).map(
    (s) => s.id
  );
  assert.deepEqual(ids, ["conf", "ptbr", "dual", "plain", "nopt"]);
  assert.equal(dubRank(confirmed), 0);
  assert.equal(dubRank(noPt), 4);
});

test("order is unchanged when the preferred audio is not Portuguese", () => {
  resetDubProbeStoreForTests();
  const list = [make("a", "Movie"), make("b", "Movie Dublado")];
  assert.deepEqual(
    preferDubbedStreams(list, { enabled: false }).map((s) => s.id),
    ["a", "b"]
  );
});

test("inside each language group the highest resolution comes first", async () => {
  const { streamResolutionScore } = await import("./streamOrdering.js");
  resetDubProbeStoreForTests();
  const pt720 = make("pt720", "Filme 720p Dublado");
  const pt4k = make("pt4k", "Filme 2160p 4K Dublado");
  const pt1080 = make("pt1080", "Filme 1080p WEB-DL Dublado");
  const ptUnknown = make("ptx", "Filme Dublado");
  const en4k = make("en4k", "Movie 2160p");
  const ids = preferDubbedStreams([pt720, en4k, ptUnknown, pt1080, pt4k], { enabled: true }).map(
    (s) => s.id
  );
  assert.deepEqual(ids, ["pt4k", "pt1080", "pt720", "ptx", "en4k"]);
  assert.equal(streamResolutionScore({ title: "Movie UHD HDR" }), 2160);
  assert.equal(streamResolutionScore({ name: "FHD TB Instant" }), 1080);
  assert.equal(streamResolutionScore({ title: "Movie WEB-DL" }), 0);
});
