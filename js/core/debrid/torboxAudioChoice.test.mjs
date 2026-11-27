import test from "node:test";
import assert from "node:assert/strict";
import { pickTorboxAudioIndex, preferredAudioTargets } from "./torboxAudioChoice.js";

test("settings become language targets", () => {
  assert.deepEqual(preferredAudioTargets({ preferredAudioLanguage: "pt-br" }), ["pt-br"]);
  assert.deepEqual(preferredAudioTargets({ preferredAudioLanguage: "system" }, "pt-BR"), ["pt-br"]);
  assert.deepEqual(preferredAudioTargets({ preferredAudioLanguage: "system" }, "en-US"), ["en"]);
  assert.deepEqual(
    preferredAudioTargets({ preferredAudioLanguage: "pt", secondaryPreferredAudioLanguage: "en" }),
    ["pt", "en"]
  );
  assert.deepEqual(preferredAudioTargets({ preferredAudioLanguage: "original" }), []);
});

test("picks the Brazilian Portuguese track over the European one", () => {
  const audios = [
    { language: "eng", language_full: "English" },
    { language: "por", title: "Portuguese (Portugal)" },
    { language: "por", title: "Português Brasileiro" }
  ];
  assert.equal(pickTorboxAudioIndex(audios, ["pt-br"]), 2);
  assert.equal(pickTorboxAudioIndex(audios, ["pt"]), 1);
  assert.equal(pickTorboxAudioIndex(audios, ["en"]), 0);
});

test("unlabelled Portuguese still counts for pt-br; missing language gives -1", () => {
  assert.equal(pickTorboxAudioIndex([{ language: "eng" }, { language: "pt" }], ["pt-br"]), 1);
  assert.equal(pickTorboxAudioIndex([{ language: "eng" }], ["pt-br"]), -1);
  assert.equal(
    pickTorboxAudioIndex(
      [{ language: "eng" }, { language: "eng", title: "Commentary" }, { language: "por" }],
      ["pt-br", "en"]
    ),
    2
  );
});
