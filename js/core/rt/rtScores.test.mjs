import test from "node:test";
import assert from "node:assert/strict";

import {
  formatCount,
  getRtScore,
  pickPosterScore,
  renderRtDetailBadges,
  renderRtPosterBadge,
  resolveImdbId,
  setRtScoreTable
} from "./rtScores.js";
import { buildCompactScores } from "../../../scripts/buildRtScores.mjs";

const TABLE = {
  tt0468569: [94, 94, 349, 250000],
  tt0000002: [55],
  tt0000003: [null, 40],
  tt0000004: [null, null]
};

test("resolveImdbId finds the IMDb id on ids, fields and strings", () => {
  assert.equal(resolveImdbId({ id: "tt0468569" }), "tt0468569");
  assert.equal(resolveImdbId({ id: "tmdb:155", imdb_id: "tt0468569" }), "tt0468569");
  assert.equal(resolveImdbId({ id: "tmdb:155", externalIds: { imdb: "tt0468569" } }), "tt0468569");
  assert.equal(resolveImdbId("tt0468569:1:2"), "tt0468569");
  assert.equal(resolveImdbId({ id: "tmdb:155" }), "");
  assert.equal(resolveImdbId(null), "");
});

test("getRtScore returns null before the scores load", () => {
  setRtScoreTable(null);
  assert.equal(getRtScore({ id: "tt0468569" }), null);
});

test("getRtScore maps the compact row to named fields", () => {
  setRtScoreTable(TABLE);
  assert.deepEqual(getRtScore({ id: "tt0468569" }), {
    tomatometer: 94,
    audience: 94,
    criticsCount: 349,
    audienceCount: 250000
  });
  assert.deepEqual(getRtScore("tt0000002"), {
    tomatometer: 55,
    audience: null,
    criticsCount: null,
    audienceCount: null
  });
  assert.equal(getRtScore("tt0000004"), null);
  assert.equal(getRtScore("tt9999999"), null);
});

test("posters show the audience score, else the critics score", () => {
  assert.deepEqual(pickPosterScore({ tomatometer: 80, audience: 70 }), {
    kind: "audience",
    value: 70
  });
  assert.deepEqual(pickPosterScore({ tomatometer: 80, audience: null }), {
    kind: "critics",
    value: 80
  });
  assert.equal(pickPosterScore(null), null);

  setRtScoreTable(TABLE);
  assert.match(renderRtPosterBadge({ id: "tt0468569" }), /🍿.*94%/);
  assert.match(renderRtPosterBadge({ id: "tt0000002" }), /🍅.*55%/);
  assert.match(renderRtPosterBadge({ id: "tt0000003" }), /rt-bad/);
  assert.equal(renderRtPosterBadge({ id: "tt9999999" }), "");
  assert.equal(renderRtPosterBadge({ id: "tmdb:1" }), "");
});

test("before loading, badges render an empty slot to fill later", () => {
  setRtScoreTable(null);
  assert.match(
    renderRtPosterBadge({ id: "tt0468569" }),
    /data-rt-slot="poster" data-rt-id="tt0468569"/
  );
  assert.match(renderRtDetailBadges({ id: "tt0468569" }), /data-rt-slot="detail"/);
});

test("detail badges show both scores with review and rating counts", () => {
  setRtScoreTable(TABLE);
  const html = renderRtDetailBadges({ id: "tt0468569" });
  assert.match(html, /🍅/);
  assert.match(html, /🍿/);
  assert.match(html, /349 críticas/);
  assert.match(html, /250k notas/);
  assert.match(html, /Fresh/);
  const partial = renderRtDetailBadges({ id: "tt0000002" });
  assert.match(partial, /55%/);
  assert.doesNotMatch(partial, /🍿/);
});

test("formatCount shortens large numbers", () => {
  assert.equal(formatCount(62), "62");
  assert.equal(formatCount(2500), "2.5k");
  assert.equal(formatCount(250000), "250k");
  assert.equal(formatCount(1200000), "1.2M");
  assert.equal(formatCount(null), "");
});

test("buildCompactScores merges bulk scores with detailed ones", () => {
  const scores = buildCompactScores({
    bulk: [{ tt0000001: [55, 85], tt0000002: [null, null], bad: [1, 2] }],
    detail: {
      tt0000001: { tomatometer: 60, audience: null, critics_count: 12, audience_count: null },
      tt0000003: { tomatometer: 90, audience: 80, critics_count: 300, audience_count: 5000 },
      tt0000004: null
    }
  });
  assert.deepEqual(scores, {
    tt0000001: [60, 85, 12],
    tt0000003: [90, 80, 300, 5000]
  });
});
