import test from "node:test";
import assert from "node:assert/strict";
import { durationRatio, syncPlaybackRate } from "./dubAudioSync.js";

test("durationRatio corrects a 25 fps dub against a 23.976 fps movie", () => {
  const movie = 7200; // 2 h at 23.976 fps
  const palDub = movie * (23.976 / 25); // same film sped up to 25 fps
  const ratio = durationRatio(movie, palDub);
  assert.ok(Math.abs(ratio - 0.95904) < 0.0001);
  assert.equal(durationRatio(7200, 7210), 1); // 10 s apart: same speed
  assert.equal(durationRatio(7200, 5400), 1); // different cut: no guess
  assert.equal(durationRatio(NaN, 7200), 1);
});

test("syncPlaybackRate nudges small drifts and asks to jump on big ones", () => {
  assert.equal(syncPlaybackRate({ mainRate: 1, ratio: 1, drift: 0 }), 1);
  assert.ok(syncPlaybackRate({ mainRate: 1, ratio: 1, drift: 0.2 }) < 1); // dub ahead: slow down
  assert.ok(syncPlaybackRate({ mainRate: 1, ratio: 1, drift: -0.2 }) > 1); // dub behind: speed up
  assert.equal(syncPlaybackRate({ mainRate: 1, ratio: 1, drift: 1.5 }), null);
});
