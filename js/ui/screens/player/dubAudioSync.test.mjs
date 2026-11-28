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

test("planDubCorrection is gentle: ignore small drifts, nudge rarely, jump only far", () => {
  // Small drift: leave the speed alone.
  assert.deepEqual(planDubCorrection({ drift: 0.08, baseRate: 1, currentRate: 1 }), {
    action: "none"
  });
  // Above 0.12 s: a small speed change toward the target.
  const ahead = planDubCorrection({ drift: 0.2, baseRate: 1, currentRate: 1 });
  assert.equal(ahead.action, "rate");
  assert.ok(ahead.rate < 1 && ahead.rate >= 0.97);
  // Not again within a second.
  assert.deepEqual(
    planDubCorrection({ drift: 0.2, baseRate: 1, currentRate: 1, msSinceRateChange: 300 }),
    {
      action: "none"
    }
  );
  // Back near zero while nudging: return to the normal speed.
  assert.deepEqual(
    planDubCorrection({ drift: 0.02, baseRate: 0.959, currentRate: 0.95, nudging: true }),
    {
      action: "rate",
      rate: 0.959,
      nudging: false
    }
  );
  // Far off (a seek): jump.
  assert.deepEqual(planDubCorrection({ drift: 1.4 }), { action: "jump" });
  // 0.5 s off is corrected by speed, not by a jump (no audible cut).
  assert.equal(planDubCorrection({ drift: -0.5, baseRate: 1, currentRate: 1 }).action, "rate");
});
