import test from "node:test";
import assert from "node:assert/strict";
import { estimateDubOffset } from "./dubOffsetEstimator.js";

// A "soundtrack": bursts of sound at irregular moments (like lines and effects).
function loudness(t, seed) {
  const bursts = [];
  let x = seed;
  for (let i = 0; i < 80; i += 1) {
    x = (x * 9301 + 49297) % 233280;
    bursts.push((x / 233280) * 60);
  }
  return bursts.reduce((sum, at) => sum + Math.exp(-((t - at) ** 2) / 0.02), 0.05);
}

function sample(from, to, fn, jitter = 0) {
  const out = [];
  for (let t = from; t <= to; t += 0.05 + jitter * ((t * 7919) % 1)) out.push({ t, v: fn(t) });
  return out;
}

test("finds the offset of a dub that starts 1.3 s later", () => {
  const offset = 1.3;
  const main = sample(5, 45, (t) => loudness(t, 42));
  // The dub has the same timing (and different noise on top, like another language).
  const dub = sample(
    5 + offset,
    45 + offset,
    (t) => loudness(t - offset, 42) * (0.6 + 0.4 * Math.abs(Math.sin(t * 13)))
  );
  const result = estimateDubOffset(main, dub, { ratio: 1 });
  assert.equal(result.confident, true);
  assert.ok(Math.abs(result.offset - offset) <= 0.05, `got ${result.offset}`);
});

test("works together with the 25/23.976 speed ratio", () => {
  const ratio = 23.976 / 25;
  const offset = -0.8;
  const main = sample(100, 140, (t) => loudness(t - 100, 7));
  const dub = sample(100 * ratio + offset, 140 * ratio + offset, (d) =>
    loudness((d - offset) / ratio - 100, 7)
  );
  const result = estimateDubOffset(main, dub, { ratio });
  assert.equal(result.confident, true);
  assert.ok(Math.abs(result.offset - offset) <= 0.05, `got ${result.offset}`);
});

test("does not guess when the two soundtracks do not match", () => {
  const main = sample(5, 45, (t) => loudness(t, 1));
  const dub = sample(5, 45, (t) => loudness(t, 999));
  assert.equal(estimateDubOffset(main, dub, { ratio: 1 }).confident, false);
  assert.equal(estimateDubOffset([], dub).confident, false);
});

test("estimateDubAlignment finds speed and offset when the duration guess is wrong", async () => {
  const { estimateDubAlignment } = await import("./dubOffsetEstimator.js");
  const ratio = 23.976 / 25;
  const offset = 1.2;
  const main = sample(30, 75, (t) => loudness(t - 30, 11));
  const dub = sample(30 * ratio + offset, 75 * ratio + offset, (d) =>
    loudness((d - offset) / ratio - 30, 11)
  );
  const result = estimateDubAlignment(main, dub, {
    maxLag: 8,
    ratios: [0.969, 1, ratio, 25 / 23.976]
  });
  assert.equal(result.confident, true);
  assert.ok(Math.abs(result.ratio - ratio) < 0.0005, `ratio ${result.ratio}`);
  assert.ok(Math.abs(result.offset - offset) <= 0.1, `offset ${result.offset}`);
});
