import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {}
};

const { DebridApi } = await import("../../data/remote/api/debridApi.js");
const { requestTorboxWebStream, resetTorboxWebStreamAvailability } =
  await import("./directDebridResolver.js");

function fakeCreateStream(response) {
  const calls = [];
  DebridApi.torboxCreateStream = async (apiKey, options) => {
    calls.push({ apiKey, ...options });
    return response;
  };
  return calls;
}

test("uses the TorBox HLS stream when the file needs converting", async () => {
  resetTorboxWebStreamAvailability();
  const calls = fakeCreateStream({
    ok: true,
    status: 200,
    data: {
      success: true,
      data: { hls_url: "https://cdn.example/hls/abc", needs_transcoding: true }
    }
  });
  const url = await requestTorboxWebStream("key", 12, 3, { enabled: true });
  assert.equal(url, "https://cdn.example/hls/abc");
  assert.deepEqual(calls, [{ apiKey: "key", id: 12, fileId: 3 }]);
});

test("keeps the direct link when TorBox says the file already plays", async () => {
  resetTorboxWebStreamAvailability();
  fakeCreateStream({
    ok: true,
    status: 200,
    data: { data: { hls_url: "https://cdn.example/x", needs_transcoding: false } }
  });
  assert.equal(await requestTorboxWebStream("key", 12, 3, { enabled: true }), null);
});

test("stops asking after TorBox refuses the plan (not Pro)", async () => {
  resetTorboxWebStreamAvailability();
  const calls = fakeCreateStream({
    ok: false,
    status: 403,
    data: { success: false, error: "PLAN_RESTRICTED_FEATURE" }
  });
  assert.equal(await requestTorboxWebStream("key", 1, 1, { enabled: true }), null);
  assert.equal(await requestTorboxWebStream("key", 2, 2, { enabled: true }), null);
  assert.equal(calls.length, 1);
});

test("TV apps (not a browser) never ask for the converted stream", async () => {
  resetTorboxWebStreamAvailability();
  const calls = fakeCreateStream({
    ok: true,
    status: 200,
    data: { data: { hls_url: "https://cdn.example/x" } }
  });
  assert.equal(await requestTorboxWebStream("key", 1, 1, { enabled: false }), null);
  assert.equal(calls.length, 0);
});

test("asks TorBox for the Portuguese track when it is not the first one", async () => {
  resetTorboxWebStreamAvailability();
  const calls = [];
  DebridApi.torboxCreateStream = async (apiKey, options) => {
    calls.push(options);
    const index = options.audioIndex ?? 0;
    return {
      ok: true,
      status: 200,
      data: {
        data: {
          hls_url: `https://cdn.example/hls/audio-${index}`,
          needs_transcoding: true,
          metadata: {
            audios: [
              { index: 1, language: "eng", language_full: "English" },
              {
                index: 2,
                language: "por",
                language_full: "Portuguese",
                title: "Português (Brasil)"
              }
            ]
          }
        }
      }
    };
  };
  const url = await requestTorboxWebStream("key", 7, 1, { enabled: true, audioTargets: ["pt-br"] });
  assert.equal(url, "https://cdn.example/hls/audio-1");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].audioIndex, 1);
});
