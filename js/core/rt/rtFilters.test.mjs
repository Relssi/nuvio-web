import test from "node:test";
import assert from "node:assert/strict";

import {
  RT_FILTER_DEFAULTS,
  applyRtFilters,
  countActiveRtFilters,
  hasRtScoreFilter,
  itemYear,
  matchesDecade,
  normalizeRtFilters,
  rtFilterLabel
} from "./rtFilters.js";

const SCORES = {
  a: { tomatometer: 95, audience: 60, criticsCount: 320, audienceCount: 10000 },
  b: { tomatometer: 72, audience: 91, criticsCount: 45, audienceCount: 900 },
  c: { tomatometer: 40, audience: 85, criticsCount: null, audienceCount: null },
  d: null
};
const ITEMS = [
  { id: "a", name: "Zebra", releaseInfo: "2019" },
  { id: "b", name: "apple", year: 2003 },
  { id: "c", name: "Mango", released: "1985-06-01T00:00:00Z" },
  { id: "d", name: "Banana", releaseInfo: "2022-" }
];
const getScore = (item) => SCORES[item.id] || null;
const ids = (list) => list.map((item) => item.id);
const run = (filters) => ids(applyRtFilters(ITEMS, filters, { getScore }));

test("no filters keep the catalog order", () => {
  assert.deepEqual(run({}), ["a", "b", "c", "d"]);
  assert.equal(countActiveRtFilters(RT_FILTER_DEFAULTS), 0);
});

test("minimum critics score", () => {
  assert.deepEqual(run({ minCritics: 70 }), ["a", "b"]);
  assert.deepEqual(run({ minCritics: 90 }), ["a"]);
});

test("minimum number of critic reviews drops titles without a count", () => {
  assert.deepEqual(run({ minReviews: 20 }), ["a", "b"]);
  assert.deepEqual(run({ minReviews: 300 }), ["a"]);
});

test("minimum audience score", () => {
  assert.deepEqual(run({ minAudience: 80 }), ["b", "c"]);
});

test("decade", () => {
  assert.deepEqual(run({ decade: "2010" }), ["a"]);
  assert.deepEqual(run({ decade: "2020" }), ["d"]);
  assert.deepEqual(run({ decade: "older" }), []);
  assert.deepEqual(run({ decade: "1980" }), ["c"]);
  assert.equal(matchesDecade(0, "2000"), false);
  assert.equal(matchesDecade(1965, "older"), true);
});

test("sorting", () => {
  assert.deepEqual(run({ sort: "critics" }), ["a", "b", "c", "d"]);
  assert.deepEqual(run({ sort: "audience" }), ["b", "c", "a", "d"]);
  assert.deepEqual(run({ sort: "newest" }), ["d", "a", "b", "c"]);
  assert.deepEqual(run({ sort: "oldest" }), ["c", "b", "a", "d"]);
  assert.deepEqual(run({ sort: "az" }), ["b", "d", "c", "a"]);
});

test("filters combine and count as active", () => {
  const filters = { minCritics: 60, minAudience: 60, decade: "2000", sort: "az" };
  assert.deepEqual(run(filters), ["b"]);
  assert.equal(countActiveRtFilters(filters), 4);
  assert.equal(hasRtScoreFilter(filters), true);
  assert.equal(hasRtScoreFilter({ decade: "2000", sort: "az" }), false);
});

test("unknown values fall back to the defaults", () => {
  assert.deepEqual(
    normalizeRtFilters({ minCritics: 65, minReviews: "50", decade: 1990, sort: "x" }),
    {
      ...RT_FILTER_DEFAULTS,
      minReviews: 50,
      decade: "1990"
    }
  );
});

test("years and labels", () => {
  assert.equal(itemYear({ releaseInfo: "2011–2019" }), 2011);
  assert.equal(itemYear({}), 0);
  assert.equal(rtFilterLabel("minCritics", 0), "Qualquer");
  assert.equal(rtFilterLabel("minCritics", 80), "🍅 80%+");
  assert.equal(rtFilterLabel("decade", "2010"), "Anos 2010");
  assert.equal(rtFilterLabel("sort", "az"), "A–Z");
});
