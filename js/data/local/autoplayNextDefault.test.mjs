import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { normalizePlayerSettings } = await import("./playerSettingsStore.js");

test("autoplay of the next episode is on unless a profile chose it (B51)", () => {
  assert.equal(normalizePlayerSettings({}).autoplayNextEpisode, true);
  // Saved before B51: the old default, not a choice.
  assert.equal(normalizePlayerSettings({ autoplayNextEpisode: false }).autoplayNextEpisode, true);
  // Turned off in the settings after B51.
  assert.equal(
    normalizePlayerSettings({ autoplayNextEpisode: false, autoplayNextEpisodeChosen: true })
      .autoplayNextEpisode,
    false
  );
});
