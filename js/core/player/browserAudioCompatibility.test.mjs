import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {}
};

const {
  classifyBrowserStreamAudio,
  chooseBrowserAudibleStream,
  pickPlayableBrowserStream,
  browserAudioScoreAdjustment,
  probeBrowserAudioCapabilities
} = await import("./browserAudioCompatibility.js");

const chrome = probeBrowserAudioCapabilities();

test("desktop defaults treat surround codecs as silent and AAC as playable", () => {
  assert.equal(chrome.ac3, false);
  assert.equal(chrome.eac3, false);
  assert.equal(chrome.dts, false);
  assert.equal(chrome.aac, true);
  assert.equal(
    classifyBrowserStreamAudio({ title: "Movie 1080p BluRay DTS-HD MA" }, chrome),
    "unsupported"
  );
  assert.equal(
    classifyBrowserStreamAudio({ title: "Movie 1080p WEB-DL DDP5.1 Atmos" }, chrome),
    "unsupported"
  );
  assert.equal(classifyBrowserStreamAudio({ title: "Movie 1080p DD5.1" }, chrome), "unsupported");
  assert.equal(
    classifyBrowserStreamAudio({ title: "Movie 720p WEBRip AAC 2.0" }, chrome),
    "playable"
  );
  assert.equal(classifyBrowserStreamAudio({ title: "Movie 1080p Opus" }, chrome), "playable");
  assert.equal(classifyBrowserStreamAudio({ title: "Movie 1080p MP3" }, chrome), "playable");
  assert.equal(classifyBrowserStreamAudio({ title: "Movie 2160p" }, chrome), "unknown");
});

test("a surround track listed next to AAC stays unsupported because the browser cannot switch MKV tracks", () => {
  assert.equal(classifyBrowserStreamAudio({ title: "Movie 1080p DTS AAC" }, chrome), "unsupported");
});

test("AC-3 is playable only when the browser reports it", () => {
  const edge = { ...chrome, ac3: true, eac3: true };
  assert.equal(classifyBrowserStreamAudio({ title: "Movie DD 5.1" }, edge), "playable");
  assert.equal(classifyBrowserStreamAudio({ title: "Movie DTS" }, edge), "unsupported");
});

test("a silent labeled source loses to a lower-resolution source with sound", () => {
  const silent = { id: "dts", title: "Movie 1080p DTS-HD", url: "https://cdn/dts.mkv" };
  const audible = { id: "aac", title: "Movie 720p AAC", url: "https://cdn/aac.mkv" };
  const unlabeled = { id: "uhd", title: "Movie 2160p", url: "https://cdn/uhd.mkv" };
  assert.ok(
    browserAudioScoreAdjustment(audible, chrome) > browserAudioScoreAdjustment(silent, chrome)
  );
  assert.equal(pickPlayableBrowserStream([silent, unlabeled, audible], chrome, silent)?.id, "aac");
  assert.equal(pickPlayableBrowserStream([silent, unlabeled], chrome, silent), null);
  const streams = [unlabeled, silent, audible];
  const ranked = streams
    .map((stream) => ({ id: stream.id, score: browserAudioScoreAdjustment(stream, chrome) }))
    .sort((left, right) => right.score - left.score);
  assert.equal(ranked[0].id, "aac");
});

test("playback starts on the audible source when the requested one would be silent", () => {
  const silent = { id: "dts", title: "Movie 1080p DTS", url: "https://cdn/dts.mkv" };
  const audible = { id: "aac", title: "Movie 1080p AAC", url: "https://cdn/aac.mkv" };
  const swapped = chooseBrowserAudibleStream({
    candidate: silent,
    streams: [silent, audible],
    capabilities: chrome
  });
  assert.equal(swapped.notice, "swapped");
  assert.equal(swapped.candidate.id, "aac");
  const stuck = chooseBrowserAudibleStream({
    candidate: silent,
    streams: [silent],
    capabilities: chrome
  });
  assert.equal(stuck.notice, "silent");
  assert.equal(stuck.candidate.id, "dts");
  const unlabeled = chooseBrowserAudibleStream({
    candidate: { id: "raw", title: "Movie 1080p", url: "https://cdn/raw.mkv" },
    streams: [audible],
    capabilities: chrome
  });
  assert.equal(unlabeled.notice, "");
  assert.equal(unlabeled.candidate.id, "raw");
});
