// Finds how far the dubbed audio is shifted from the movie (B39).
//
// A dub follows the timing of the original: lines start and stop at the same
// moments, and music and effects are the same. So the loudness "shape" of the
// two soundtracks matches when they are aligned. Both are sampled while they
// play (time in each one's own timeline + loudness). The rises in loudness
// (onsets) are compared at every shift from -maxLag to +maxLag; the shift with
// the clearest match is the offset:
//   dubTime = mainTime * ratio + offset
// It is only trusted when the match is clearly better than any other shift.

const STEP_S = 0.05;
const MIN_PAIRS = 200; // 10 s of overlap
const MIN_SCORE = 0.2;
const MIN_MARGIN = 0.06;

function resample(samples, from, to) {
  const grid = [];
  if (!samples.length) return grid;
  let j = 0;
  for (let t = from; t <= to; t += STEP_S) {
    while (j < samples.length - 2 && samples[j + 1].t < t) j += 1;
    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    if (!a || !b || t < a.t - STEP_S || t > b.t + STEP_S || b.t - a.t > 0.5) {
      grid.push(null);
      continue;
    }
    const span = b.t - a.t;
    const k = span > 0 ? Math.max(0, Math.min(1, (t - a.t) / span)) : 0;
    grid.push(a.v + (b.v - a.v) * k);
  }
  return grid;
}

// Loudness rises, on a log scale (so quiet and loud scenes count alike).
function onsets(grid) {
  const out = new Array(grid.length).fill(null);
  for (let i = 1; i < grid.length; i += 1) {
    if (grid[i] == null || grid[i - 1] == null) continue;
    const rise = Math.log(grid[i] + 1e-4) - Math.log(grid[i - 1] + 1e-4);
    out[i] = rise > 0 ? rise : 0;
  }
  return out;
}

function sortedByTime(samples = []) {
  return samples
    .filter((sample) => sample && Number.isFinite(sample.t) && Number.isFinite(sample.v))
    .sort((left, right) => left.t - right.t);
}

export function estimateDubOffset(
  mainSamples = [],
  dubSamples = [],
  { ratio = 1, maxLag = 3 } = {}
) {
  const main = sortedByTime(mainSamples);
  const dub = sortedByTime(dubSamples);
  if (main.length < 50 || dub.length < 50) return { confident: false, reason: "not-enough-audio" };
  const mainFrom = main[0].t;
  const mainTo = main[main.length - 1].t;
  const dubFrom = dub[0].t;
  const dubTo = dub[dub.length - 1].t;
  const mainOn = onsets(resample(main, mainFrom, mainTo));
  const dubOn = onsets(resample(dub, dubFrom, dubTo));
  const scores = [];
  for (let lag = -maxLag; lag <= maxLag + 1e-9; lag += STEP_S) {
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < mainOn.length; i += 1) {
      const x = mainOn[i];
      if (x == null) continue;
      const dubTime = (mainFrom + i * STEP_S) * ratio + lag;
      const j = Math.round((dubTime - dubFrom) / STEP_S);
      const y = j >= 0 && j < dubOn.length ? dubOn[j] : null;
      if (y == null) continue;
      n += 1;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    if (n < MIN_PAIRS) {
      scores.push({ lag, score: -1 });
      continue;
    }
    const cov = sxy - (sx * sy) / n;
    const vx = sxx - (sx * sx) / n;
    const vy = syy - (sy * sy) / n;
    const score = vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : -1;
    scores.push({ lag, score });
  }
  const best = scores.reduce((top, entry) => (entry.score > top.score ? entry : top), {
    lag: 0,
    score: -1
  });
  const runnerUp = scores
    .filter((entry) => Math.abs(entry.lag - best.lag) > 0.4)
    .reduce((top, entry) => (entry.score > top.score ? entry : top), { lag: 0, score: -1 });
  const offset = Math.round(best.lag * 100) / 100;
  const confident = best.score >= MIN_SCORE && best.score - runnerUp.score >= MIN_MARGIN;
  return { confident, offset, score: best.score, margin: best.score - runnerUp.score };
}

// Speed pairs that exist between releases: the same speed, 25 fps (PAL TV
// dubs) against 23.976 / 24 fps, and 24 against 23.976.
export const COMMON_SPEED_RATIOS = [
  1,
  23.976 / 25,
  25 / 23.976,
  24 / 25,
  25 / 24,
  23.976 / 24,
  24 / 23.976
];

// Speed and offset together: tries every candidate speed and keeps the one
// whose best offset matches most clearly (B39). The duration-based guess is
// tried too.
export function estimateDubAlignment(
  mainSamples = [],
  dubSamples = [],
  { ratios = COMMON_SPEED_RATIOS, maxLag = 3 } = {}
) {
  const unique = [];
  ratios.forEach((ratio) => {
    if (
      Number.isFinite(ratio) &&
      ratio > 0 &&
      !unique.some((known) => Math.abs(known - ratio) < 0.0005)
    )
      unique.push(ratio);
  });
  let best = { confident: false, score: -1 };
  for (const ratio of unique) {
    const result = estimateDubOffset(mainSamples, dubSamples, { ratio, maxLag });
    if (result.score > best.score) best = { ...result, ratio };
  }
  return best;
}
