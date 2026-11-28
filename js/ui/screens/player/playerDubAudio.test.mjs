import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { DirectDebridResolver } = await import("../../../core/debrid/directDebridResolver.js");
const { findDubSource } = await import("./playerDubAudio.js");

test("findDubSource prefers a dubbed source with the same title", () => {
  DirectDebridResolver.canResolveStream = () => true;
  const current = { id: "c", title: "Wicker.2026.2160p.WEB-DL.DDP5.1", infoHash: "c".repeat(40) };
  const otherFilm = {
    id: "o",
    title: "A.Ladra.Solitaria.2026.WEB-DL.1080p.DUAL.5.1",
    infoHash: "o".repeat(40)
  };
  const sameFilm = { id: "s", title: "Wicker.2026.DUAL.1080p.WEB.H265", infoHash: "s".repeat(40) };
  const picked = findDubSource(current, [current, otherFilm, sameFilm], { title: "Wicker" });
  assert.equal(picked.id, "s");
  // Without a title the usual order still works.
  assert.ok(findDubSource(current, [current, otherFilm, sameFilm]));
});
