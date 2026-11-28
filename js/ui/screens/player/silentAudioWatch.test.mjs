import test from "node:test";
import assert from "node:assert/strict";
import { isSilentPlayback, nextSourceWithSound, SILENT_AFTER_SECONDS } from "./silentAudioWatch.js";

test("silent only after a few seconds with no audio decoded (B49)", () => {
  assert.equal(
    isSilentPlayback({ decodedAudioBytes: 0, playedSeconds: SILENT_AFTER_SECONDS }),
    true
  );
  assert.equal(isSilentPlayback({ decodedAudioBytes: 0, playedSeconds: 2 }), false);
  assert.equal(isSilentPlayback({ decodedAudioBytes: 5120, playedSeconds: 30 }), false);
  // Safari / Firefox do not report it: never switch there.
  assert.equal(isSilentPlayback({ decodedAudioBytes: undefined, playedSeconds: 30 }), false);
});

test("next source skips the current one and the silent ones (B49)", () => {
  const a = { url: "https://x/a" };
  const b = { url: "https://x/b" };
  const c = { url: "https://x/c" };
  assert.equal(nextSourceWithSound([a, b, c], a, new Set()), b);
  assert.equal(nextSourceWithSound([a, b, c], a, new Set(["https://x/b"])), c);
  assert.equal(nextSourceWithSound([a, b, c], c, new Set(["https://x/a"])), b);
  assert.equal(nextSourceWithSound([a], a, new Set()), null);
});
