// Builds assets/data/rt-lists.json: the Rotten Tomatoes lists CineRotten
// scrapes (rt-api/docs/data/rt_lists.json, rt_lists_serie.json, hype.json),
// shown as Home rows by js/core/rt/rtLists.js.
//   { v: 1, generated, lists: [{ id, type, title, home, items: [[imdb, title, year, poster]] }] }
// Only lists CineRotten really has are written; nothing is invented.
//
// Usage: node scripts/buildRtLists.mjs [path/to/rt-api/docs/data]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(rootDir, "assets", "data", "rt-lists.json");
const sourceDir =
  process.argv[2] ||
  process.env.RT_DATA_DIR ||
  path.join(os.homedir(), "Documents", "Teste rotten", "rt-api", "docs", "data");

// Lists that get a Home row by default. The others still appear in Discover
// (Type → catalog) so the Home tab does not grow by 28 rows.
const HOME_LISTS = new Set([
  "movie:cinema",
  "movie:popular",
  "movie:fresh",
  "series:popular",
  "movie:acao",
  "movie:comedia",
  "movie:terror",
  "movie:animacao",
  "series:drama",
  "series:crime"
]);

function compactItem(item) {
  const imdb = String(item?.imdb || "");
  if (!/^tt\d+$/.test(imdb)) return null;
  const year = Number(item?.year) || 0;
  return [imdb, String(item?.title || ""), year, String(item?.poster || "")];
}

export function buildCompactLists({ movieLists = null, seriesLists = null, hype = null } = {}) {
  const lists = [];
  const push = (type, id, title, rawItems) => {
    const seen = new Set();
    const items = [];
    for (const raw of rawItems || []) {
      const item = compactItem(raw);
      if (!item || seen.has(item[0])) continue;
      seen.add(item[0]);
      items.push(item);
    }
    if (!items.length) return;
    lists.push({ id: `${type}-${id}`, type, title, home: HOME_LISTS.has(`${type}:${id}`), items });
  };
  if (hype?.items?.length) {
    push("movie", "cinema", "Populares nos cinemas", hype.items);
  }
  for (const list of movieLists?.lists || []) push("movie", list.id, list.title, list.items);
  for (const list of seriesLists?.lists || []) push("series", list.id, list.title, list.items);
  return lists;
}

async function readJson(file) {
  const full = path.join(sourceDir, file);
  return existsSync(full) ? JSON.parse(await readFile(full, "utf8")) : null;
}

async function main() {
  if (!existsSync(sourceDir)) {
    console.error(`CineRotten data folder not found: ${sourceDir}`);
    process.exit(1);
  }
  const lists = buildCompactLists({
    movieLists: await readJson("rt_lists.json"),
    seriesLists: await readJson("rt_lists_serie.json"),
    hype: await readJson("hype.json")
  });
  const payload = { v: 1, generated: new Date().toISOString(), lists };
  await mkdir(path.dirname(outFile), { recursive: true });
  const text = JSON.stringify(payload);
  await writeFile(outFile, text);
  console.log(`rt-lists.json: ${lists.length} lists, ${(text.length / 1024).toFixed(0)} KB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
