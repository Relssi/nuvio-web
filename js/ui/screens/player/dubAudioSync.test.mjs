import test from "node:test";
import assert from "node:assert/strict";
import { durationRatio, planDubCorrection } from "./dubAudioSync.js";

test("durationRatio corrects a 25 fps dub against a 23.976 fps movie", () => {
  const movie = 7200; // 2 h at 23.976 fps
  const palDub = movie * (23.976 / 25); // same film sped up to 25 fps
  const ratio = durationRatio(movie, palDub);
  assert.ok(Math.abs(ratio - 0.95904) < 0.0001);
  assert.equal(durationRatio(7200, 7210), 1); // 10 s apart: same speed
  assert.equal(durationRatio(7200, 5400), 1); // different cut: no guess
  assert.equal(durationRatio(NaN, 7200), 1);
});

test("planDubCorrection moves the picture gently and never the sound", () => {
  // Small drift: leave everything alone.
  assert.deepEqual(planDubCorrection({ drift: 0.08 }), { action: "none" });
  // Dub 0.2 s ahead: the picture speeds up a little (at most 3%).
  const ahead = planDubCorrection({ drift: 0.2 });
  assert.equal(ahead.action, "rate");
  assert.ok(ahead.factor > 1 && ahead.factor <= 1.03);
  // Dub behind: the picture slows down.
  assert.ok(planDubCorrection({ drift: -0.5 }).factor < 1);
  // Not again within a second.
  assert.deepEqual(planDubCorrection({ drift: 0.2, msSinceRateChange: 300 }), { action: "none" });
  // Back near zero while nudging: normal speed.
  assert.deepEqual(planDubCorrection({ drift: 0.02, currentFactor: 1.02, nudging: true }), {
    action: "rate",
    factor: 1,
    nudging: false
  });
  // Far off (a stall): jump.
  assert.deepEqual(planDubCorrection({ drift: 1.4 }), { action: "jump" });
});

test("preloadProgress: percent from loaded seconds, time left from loading speed", async () => {
  const { preloadProgress } = await import("./dubAudioSync.js");
  assert.deepEqual(preloadProgress({ ahead: 0, speed: null }), { percent: 40, etaSeconds: null });
  // 6 of 15 s loaded at 1.5 s of dub per second: 64%, ~6 s left.
  assert.deepEqual(preloadProgress({ ahead: 6, speed: 1.5, msLeft: 20000 }), {
    percent: 64,
    etaSeconds: 6
  });
  // Never more than the time limit left.
  assert.equal(preloadProgress({ ahead: 1, speed: 0.1, msLeft: 4000 }).etaSeconds, 4);
  assert.deepEqual(preloadProgress({ ahead: 20, speed: 2 }), { percent: 100, etaSeconds: 0 });
});
