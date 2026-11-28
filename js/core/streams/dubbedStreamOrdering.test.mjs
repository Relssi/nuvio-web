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
