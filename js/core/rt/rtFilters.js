// Discover filters based on Rotten Tomatoes scores (CineRotten-style).
// Pure functions so they can be unit tested without a DOM.
import { getRtScore } from "./rtScores.js";

export const RT_FILTER_DEFAULTS = Object.freeze({
  minCritics: 0,
  minReviews: 0,
  minAudience: 0,
  decade: "",
  sort: "default"
});

export const RT_FILTER_OPTIONS = Object.freeze({
  minCritics: [0, 60, 70, 80, 90],
  minReviews: [0, 20, 50, 100, 200, 300],
  minAudience: [0, 60, 70, 80, 90],
  decade: ["", "2020", "2010", "2000", "1990", "1980", "1970", "older"],
  sort: ["default", "critics", "audience", "newest", "oldest", "az"]
});

export function normalizeRtFilters(filters = {}) {
  const pick = (key) => {
    const value = filters?.[key];
    const options = RT_FILTER_OPTIONS[key];
    const typed = typeof options[0] === "number" ? Number(value) : String(value ?? "");
    return options.includes(typed) ? typed : RT_FILTER_DEFAULTS[key];
  };
  return {
    minCritics: pick("minCritics"),
    minReviews: pick("minReviews"),
    minAudience: pick("minAudience"),
    decade: pick("decade"),
    sort: pick("sort")
  };
}

export function countActiveRtFilters(filters = {}) {
  const f = normalizeRtFilters(filters);
  return Object.keys(RT_FILTER_DEFAULTS).filter((key) => f[key] !== RT_FILTER_DEFAULTS[key]).length;
}

export function hasRtScoreFilter(filters = {}) {
  const f = normalizeRtFilters(filters);
  return f.minCritics > 0 || f.minReviews > 0 || f.minAudience > 0;
}

export function itemYear(item = {}) {
  const candidates = [
    item?.year,
    item?.releaseInfo,
    item?.released,
    item?.releaseDate,
    item?.release_date
  ];
  for (const value of candidates) {
    if (value == null) continue;
    const match = String(value).match(/\b(18|19|20)\d{2}\b/);
    if (match) return Number(match[0]);
  }
  return 0;
}

export function matchesDecade(year, decade) {
  if (!decade) return true;
  if (!year) return false;
  if (decade === "older") return year < 1970;
  const start = Number(decade);
  return year >= start && year < start + 10;
}

function titleOf(item) {
  return String(item?.name || item?.title || "");
}

// Returns a new array: filtered, then sorted. "default" keeps catalog order.
export function applyRtFilters(
  items = [],
  filters = {},
  { getScore = getRtScore, getYear = itemYear } = {}
) {
  const f = normalizeRtFilters(filters);
  const list = (Array.isArray(items) ? items : []).filter((item) => {
    if (f.minCritics || f.minReviews || f.minAudience) {
      const score = getScore(item);
      if (!score) return false;
      if (f.minCritics && !(score.tomatometer != null && score.tomatometer >= f.minCritics))
        return false;
      if (f.minReviews && !(score.criticsCount != null && score.criticsCount >= f.minReviews))
        return false;
      if (f.minAudience && !(score.audience != null && score.audience >= f.minAudience))
        return false;
    }
    if (f.decade && !matchesDecade(getYear(item), f.decade)) return false;
    return true;
  });
  if (f.sort === "default") return list;
  const indexed = list.map((item, index) => ({ item, index }));
  const scoreValue = (item, key) => {
    const value = getScore(item)?.[key];
    return value == null ? -1 : value;
  };
  const compare = {
    critics: (a, b) => scoreValue(b.item, "tomatometer") - scoreValue(a.item, "tomatometer"),
    audience: (a, b) => scoreValue(b.item, "audience") - scoreValue(a.item, "audience"),
    newest: (a, b) => getYear(b.item) - getYear(a.item),
    oldest: (a, b) => (getYear(a.item) || 9999) - (getYear(b.item) || 9999),
    az: (a, b) => titleOf(a.item).localeCompare(titleOf(b.item), "pt", { sensitivity: "base" })
  }[f.sort];
  indexed.sort((a, b) => compare(a, b) || a.index - b.index);
  return indexed.map((entry) => entry.item);
}

const LABELS = {
  minCritics: (v) => (v ? `🍅 ${v}%+` : "Qualquer"),
  minReviews: (v) => (v ? `${v}+ críticas` : "Qualquer"),
  minAudience: (v) => (v ? `🍿 ${v}%+` : "Qualquer"),
  decade: (v) => (!v ? "Todas" : v === "older" ? "Antes de 1970" : `Anos ${v}`),
  sort: (v) =>
    ({
      default: "Padrão",
      critics: "Crítica 🍅",
      audience: "Público 🍿",
      newest: "Mais novos",
      oldest: "Mais antigos",
      az: "A–Z"
    })[v] || "Padrão"
};

export const RT_FILTER_TITLES = Object.freeze({
  minCritics: "Crítica mín.",
  minReviews: "Nº de críticas",
  minAudience: "Público mín.",
  decade: "Década",
  sort: "Ordenar"
});

export function rtFilterLabel(key, value) {
  const fn = LABELS[key];
  return fn ? fn(value) : String(value ?? "");
}
