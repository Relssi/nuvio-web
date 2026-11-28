import test from "node:test";
import assert from "node:assert/strict";

import {
  RT_LISTS_BASE_URL,
  isRtListsBase,
  rtListMetas,
  rtListsAddons,
  setRtLists
} from "./rtLists.js";
import { buildCompactLists } from "../../../scripts/buildRtLists.mjs";

const LISTS = [
  {
    id: "movie-fresh",
    type: "movie",
    title: "Certified Fresh · os mais populares",
    home: true,
    items: [["tt1", "A", 2020, "p.jpg"]]
  },
  {
    id: "movie-guerra",
    type: "movie",
    title: "Guerra · populares",
    home: false,
    items: [["tt2", "B", 0, ""]]
  },
  {
    id: "series-popular",
    type: "series",
    title: "Populares no Rotten Tomatoes",
    home: true,
    items: [["tt3", "C", 2024, "c.jpg"]]
  }
];

test("no addon before the lists load", () => {
  setRtLists(null);
  assert.deepEqual(rtListsAddons(), []);
  assert.deepEqual(rtListMetas("movie-fresh"), []);
});

test("lists become one catalog-only addon with Home flags", () => {
  setRtLists(LISTS);
  const [addon] = rtListsAddons();
  assert.equal(addon.baseUrl, RT_LISTS_BASE_URL);
  assert.ok(isRtListsBase(addon.baseUrl));
  assert.ok(!isRtListsBase("https://v3-cinemeta.strem.io"));
  assert.deepEqual(
    addon.resources.map((r) => r.name),
    ["catalog"]
  );
  assert.deepEqual(addon.types.sort(), ["movie", "series"]);
  const byId = Object.fromEntries(addon.catalogs.map((c) => [c.id, c]));
  assert.equal(byId["movie-fresh"].name, "RT · Certified Fresh · os mais populares");
  assert.equal(byId["series-popular"].name, "Populares no Rotten Tomatoes");
  assert.equal(byId["movie-fresh"].showInHome, true);
  assert.equal(byId["movie-guerra"].showInHome, false);
  assert.equal(byId["movie-guerra"].hasExplicitShowInHome, true);
  assert.equal(byId["series-popular"].apiType, "series");
});

test("catalog metas carry the IMDb id, poster and year; one page only", () => {
  setRtLists(LISTS);
  assert.deepEqual(rtListMetas("movie-fresh"), [
    {
      id: "tt1",
      imdb_id: "tt1",
      type: "movie",
      name: "A",
      poster: "p.jpg",
      releaseInfo: "2020",
      year: 2020
    }
  ]);
  assert.equal(rtListMetas("movie-guerra")[0].poster, undefined);
  assert.deepEqual(rtListMetas("movie-fresh", { skip: 100 }), []);
  assert.deepEqual(rtListMetas("nope"), []);
});

test("buildCompactLists keeps only real lists with IMDb ids", () => {
  const lists = buildCompactLists({
    hype: { items: [{ imdb: "tt9", title: "Hype", year: "2026", poster: "h.jpg" }] },
    movieLists: {
      lists: [
        {
          id: "fresh",
          title: "Certified Fresh",
          items: [
            { imdb: "tt1", title: "A", year: 2020, poster: "p" },
            { imdb: "tt1", title: "A" },
            { imdb: null, title: "X" }
          ]
        },
        { id: "vazia", title: "Vazia", items: [{ imdb: "", title: "Y" }] }
      ]
    },
    seriesLists: {
      lists: [
        {
          id: "drama",
          title: "Drama",
          items: [{ imdb: "tt5", title: "S", year: 2019, poster: "" }]
        }
      ]
    }
  });
  assert.deepEqual(
    lists.map((l) => [l.id, l.type, l.home, l.items.length]),
    [
      ["movie-cinema", "movie", true, 1],
      ["movie-fresh", "movie", true, 1],
      ["series-drama", "series", true, 1]
    ]
  );
  assert.deepEqual(lists[0].items[0], ["tt9", "Hype", 2026, "h.jpg"]);
});
