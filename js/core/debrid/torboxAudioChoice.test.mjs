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

test("decideTorboxAudio plays straight when sure and asks when not", async () => {
  const { decideTorboxAudio } = await import("./torboxAudioChoice.js");
  const ptFirst = [
    { language: "por", title: "PT-BR 5.1" },
    { language: "eng", title: "Inglês 5.1" }
  ];
  assert.deepEqual(decideTorboxAudio(ptFirst, ["pt-br"]), {
    index: 0,
    ask: false,
    reason: "match"
  });
  // Two tracks, none labelled: ask, suggest the first.
  const unlabelled = [{ language: "und" }, { language: "und" }];
  const unsure = decideTorboxAudio(unlabelled, ["pt-br"]);
  assert.equal(unsure.ask, true);
  assert.equal(unsure.reason, "unsure");
  // English only, several tracks: ask and say there is no Portuguese.
  const englishOnly = [{ language: "eng" }, { language: "eng", title: "Commentary" }];
  assert.equal(decideTorboxAudio(englishOnly, ["pt-br"]).reason, "no-preferred-language");
  // One English track: ask (no Portuguese); one unknown track: just play.
  assert.equal(decideTorboxAudio([{ language: "eng" }], ["pt-br"]).ask, true);
  assert.equal(decideTorboxAudio([{ language: "und" }], ["pt-br"]).ask, false);
  // No preferred language set: never ask.
  assert.equal(decideTorboxAudio(unlabelled, []).ask, false);
});
