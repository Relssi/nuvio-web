// Builds assets/data/rt-scores.json, a compact copy of the Rotten Tomatoes
// scores that CineRotten scrapes (rt-api/docs/data). Only the numbers ship:
//   { "v": 1, "generated": "...", "s": { "tt0000001": [t, a, tc, ac] } }
// t  = Tomatometer (% of positive critic reviews)
// a  = Popcornmeter (% of viewers rating 3.5+ stars)
// tc = number of critic reviews, ac = number of audience ratings
// Missing values are null; trailing nulls are dropped to keep the file small.
//
// Usage: node scripts/buildRtScores.mjs [path/to/rt-api/docs/data]
// Default source: RT_DATA_DIR env var, else ../../../Documents/Teste rotten/rt-api/docs/data
// next to the user's profile folder.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(rootDir, "assets", "data", "rt-scores.json");
const sourceDir =
  process.argv[2] ||
  process.env.RT_DATA_DIR ||
  path.join(os.homedir(), "Documents", "Teste rotten", "rt-api", "docs", "data");

const BULK_FILES = [
  "scores_bulk.json",
  "scores_bulk_serie.json",
  "scores_bulk_anime.json",
  "scores_bulk_dorama.json"
];
const DETAIL_FILES = ["enrich_core.json", "enrich.json"];

function toScore(value) {
  const n = Number(value);
  return value != null && Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
}

function toCount(value) {
  const n = Number(value);
  return value != null && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

async function readJson(file) {
  const full = path.join(sourceDir, file);
  if (!existsSync(full)) return null;
  return JSON.parse(await readFile(full, "utf8"));
}

export function buildCompactScores({ bulk = [], detail = null } = {}) {
  const scores = {};
  for (const table of bulk) {
    for (const [id, value] of Object.entries(table || {})) {
      if (!/^tt\d+$/.test(id) || !Array.isArray(value)) continue;
      const t = toScore(value[0]);
      const a = toScore(value[1]);
      if (t == null && a == null) continue;
      scores[id] = [t, a, null, null];
    }
  }
  for (const [id, value] of Object.entries(detail || {})) {
    if (!/^tt\d+$/.test(id) || !value || typeof value !== "object") continue;
    const prev = scores[id] || [null, null, null, null];
    const t = toScore(value.tomatometer) ?? prev[0];
    const a = toScore(value.audience) ?? prev[1];
    if (t == null && a == null) continue;
    scores[id] = [t, a, toCount(value.critics_count), toCount(value.audience_count)];
  }
  for (const id of Object.keys(scores)) {
    const row = scores[id];
    while (row.length && row[row.length - 1] == null) row.pop();
  }
  return scores;
}

async function main() {
  if (!existsSync(sourceDir)) {
    console.error(`CineRotten data folder not found: ${sourceDir}`);
    process.exit(1);
  }
  const bulk = (await Promise.all(BULK_FILES.map(readJson))).filter(Boolean);
  let detail = null;
  for (const file of DETAIL_FILES) {
    detail = await readJson(file);
    if (detail) break;
  }
  const scores = buildCompactScores({ bulk, detail });
  const payload = { v: 1, generated: new Date().toISOString(), s: scores };
  await mkdir(path.dirname(outFile), { recursive: true });
  const text = JSON.stringify(payload);
  await writeFile(outFile, text);
  console.log(
    `rt-scores.json: ${Object.keys(scores).length} titles, ${(text.length / 1024).toFixed(0)} KB`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
