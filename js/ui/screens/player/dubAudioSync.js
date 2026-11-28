// Dubbed audio from another source (B37, beta, browser only).
//
// The main <video> keeps playing the best picture; a hidden second <video>
// plays the dubbed source (converted by TorBox at a low resolution) and only
// its sound is heard. They are kept in line as
//   dubTime = mainTime * ratio + offset
// - ratio corrects the common speed difference between releases (a 25 fps
//   dub against a 23.976 fps movie): the ratio of the two durations when
//   they differ by 0.4%-6%, otherwise 1.
// - offset is found automatically (B39, dubOffsetEstimator.js) by comparing
//   the loudness of both soundtracks, and refined every few seconds; the
//   -0.5 s / +0.5 s buttons switch to manual fine-tuning.
// The dubbed sound always plays at a constant speed so it never stutters
// (B39): small drifts are corrected by speeding the picture up or down by at
// most 3% (invisible), big ones (a stall, a new offset) by moving the
// picture. The viewer seeking the movie moves the dub. Before the sound
// switches, ~15 s of the dub is loaded while the original sound keeps playing.

import { loadStreamingLibs } from "../../../runtime/loadStreamingLibs.js";
import { COMMON_SPEED_RATIOS, estimateDubAlignment } from "./dubOffsetEstimator.js";

const TICK_MS = 250;
const SAMPLE_MS = 50;
const ESTIMATE_EVERY_MS = 5000;
const MIN_ANALYSIS_S = 20;
const ANALYSIS_WINDOW_S = 45;
const PRELOAD_AHEAD_S = 15;
const PRELOAD_TIMEOUT_MS = 25000;
const JUMP_THRESHOLD_S = 1;
const START_NUDGE_S = 0.12;
const STOP_NUDGE_S = 0.04;
const MAX_NUDGE = 0.03;
const RATE_CHANGE_GAP_MS = 1000;
const SETTLE_AFTER_JUMP_MS = 2000;
const WIDE_SEARCH_S = 20;
const GIVE_UP_HINT_MS = 60000;
const DRIFT_SMOOTHING = 0.3;

// What to do about the (averaged) drift, seen from the dub (positive = the
// dub is ahead of the picture): "jump", change the picture "rate", or "none".
// The returned rate is a factor for the picture: > 1 lets it catch up.
export function planDubCorrection({
  drift = 0,
  currentFactor = 1,
  msSinceRateChange = Infinity,
  nudging = false
} = {}) {
  const size = Math.abs(drift);
  if (size > JUMP_THRESHOLD_S) return { action: "jump" };
  if (msSinceRateChange < RATE_CHANGE_GAP_MS) return { action: "none" };
  if (size < STOP_NUDGE_S || (!nudging && size < START_NUDGE_S)) {
    return Math.abs(currentFactor - 1) > 0.0005
      ? { action: "rate", factor: 1, nudging: false }
      : { action: "none" };
  }
  const factor = 1 + Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, drift * 0.25));
  return Math.abs(currentFactor - factor) > 0.004
    ? { action: "rate", factor, nudging: true }
    : { action: "none" };
}

// Loading progress (B41): 40% when the stream is open, 100% when ~15 s of
// the dub is loaded. Time left = what is missing / loading speed (seconds of
// dub per second), never beyond the 25 s limit; null while unknown.
export function preloadProgress({ ahead = 0, speed = null, msLeft = PRELOAD_TIMEOUT_MS } = {}) {
  const share = Math.max(0, Math.min(1, Number(ahead) / PRELOAD_AHEAD_S));
  const percent = Math.round(40 + 60 * share);
  const missing = Math.max(0, PRELOAD_AHEAD_S - Number(ahead));
  const limit = Math.max(0, Number(msLeft) / 1000);
  let etaSeconds = null;
  if (missing <= 0) etaSeconds = 0;
  else if (Number(speed) > 0.05) etaSeconds = Math.ceil(Math.min(limit, missing / Number(speed)));
  return { percent, etaSeconds };
}

// Speed guess from the two durations (B42): only when the difference is
// exactly a known frame-rate change (25 / 24 / 23.976 fps, within 0.15%).
// A different cut (longer credits, an extra scene) also changes the duration
// and must not be read as a speed change.
export function durationRatio(mainDuration, dubDuration) {
  const main = Number(mainDuration);
  const dub = Number(dubDuration);
  if (!(main > 0) || !(dub > 0) || !Number.isFinite(main) || !Number.isFinite(dub)) return 1;
  const ratio = dub / main;
  const known = COMMON_SPEED_RATIOS.find((candidate) => Math.abs(ratio / candidate - 1) < 0.0015);
  return known || 1;
}

function waitFor(target, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(eventName, onEvent);
      reject(new Error("timeout"));
    }, timeoutMs);
    function onEvent() {
      clearTimeout(timer);
      target.removeEventListener(eventName, onEvent);
      resolve();
    }
    target.addEventListener(eventName, onEvent);
  });
}

function bufferedAhead(media) {
  const now = Number(media?.currentTime || 0);
  const ranges = media?.buffered;
  if (!ranges) return 0;
  for (let i = 0; i < ranges.length; i += 1) {
    if (ranges.start(i) <= now + 0.25 && ranges.end(i) >= now) return ranges.end(i) - now;
  }
  return 0;
}

// One audio engine and one source per <video> for the whole page: a media
// element can be attached to the engine only once.
let sharedContext = null;
const mediaSources = new WeakMap();

export function getDubAudioContext() {
  if (!sharedContext) {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    sharedContext = AudioContextClass ? new AudioContextClass() : null;
    if (sharedContext) installContextKeeper(sharedContext);
  }
  return sharedContext;
}

// A movie whose sound goes through the audio engine FREEZES while the engine
// is suspended (the picture follows the audio clock), and pressing play does
// not help (B40). The browser may suspend it (no tap yet, phone call, ...),
// so any tap, click or key wakes it up again.
function installContextKeeper(context) {
  const wake = () => {
    if (context.state !== "running" && context.state !== "closed") {
      void Promise.resolve(context.resume?.()).catch(() => {});
    }
  };
  for (const type of ["pointerdown", "touchend", "keydown", "click"]) {
    document.addEventListener(type, wake, { capture: true, passive: true });
  }
}

async function ensureRunning(context, timeoutMs = 1200) {
  if (!context) return false;
  if (context.state === "running") return true;
  try {
    await Promise.race([
      Promise.resolve(context.resume?.()),
      new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
  } catch (_) {
    // Not allowed without a tap.
  }
  return context.state === "running";
}

// iPhone / iPad Safari: the engine does not work reliably with video, so
// the dub stays in manual mode there.
function isAppleMobile() {
  const agent = String(globalThis.navigator?.userAgent || "");
  return (
    /iPhone|iPad|iPod/i.test(agent) ||
    (/Macintosh/i.test(agent) && Number(globalThis.navigator?.maxTouchPoints || 0) > 1)
  );
}

function sourceFor(context, media) {
  let source = mediaSources.get(media);
  if (!source) {
    source = context.createMediaElementSource(media);
    mediaSources.set(media, source);
  }
  return source;
}

// The picture's sound can only be listened to when the browser is allowed to
// read it: hls.js (blob:) or this site. Otherwise the engine would silence it.
function canAnalyse(media) {
  const src = String(media?.currentSrc || media?.src || "");
  if (!src) return false;
  if (src.startsWith("blob:")) return true;
  try {
    return new URL(src, globalThis.location?.href).origin === globalThis.location?.origin;
  } catch (_) {
    return false;
  }
}

function rms(analyser, buffer) {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

export class DubAudioSync {
  constructor(mainVideo) {
    this.main = mainVideo;
    this.dub = null;
    this.hls = null;
    this.timer = null;
    this.sampler = null;
    this.offset = 0;
    this.ratio = 1;
    this.userRate = 1;
    this.active = false;
    this.mainWasMuted = false;
    this.listeners = [];
    this.smoothDrift = null;
    this.settleUntil = 0;
    this.lastRateChangeAt = 0;
    this.nudging = false;
    this.rateChanges = 0;
    this.jumps = 0;
    this.internalSeekUntil = 0;
    this.internalRateUntil = 0;
    this.graph = null;
    this.mainSamples = [];
    this.dubSamples = [];
    this.lastEstimateAt = 0;
    this.autoOffset = true;
    this.autoStatus = "listening";
    this.onStatus = null;
  }

  async start(url, { onStatus = null, onProgress = null } = {}) {
    this.stop();
    this.onStatus = onStatus;
    const main = this.main;
    if (!main) throw new Error("no video");
    const dub = document.createElement("video");
    dub.playsInline = true;
    dub.preload = "auto";
    dub.muted = true;
    dub.setAttribute("aria-hidden", "true");
    dub.style.cssText =
      "position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none;";
    document.body.appendChild(dub);
    this.dub = dub;

    const nativeHls = dub.canPlayType("application/vnd.apple.mpegurl");
    await loadStreamingLibs({ hls: true, dash: false }).catch(() => {});
    const Hls = globalThis.Hls;
    if (Hls && typeof Hls.isSupported === "function" && Hls.isSupported()) {
      this.hls = new Hls({ maxBufferLength: 90, maxMaxBufferLength: 120, backBufferLength: 30 });
      this.hls.loadSource(url);
      this.hls.attachMedia(dub);
    } else if (nativeHls) {
      dub.src = url;
    } else {
      throw new Error("hls unsupported");
    }
    const report = (progress) => {
      try {
        onProgress?.(progress);
      } catch (_) {
        // The panel may be gone.
      }
    };
    report({ percent: 35, etaSeconds: null });
    await waitFor(dub, "loadedmetadata", 45000);
    this.ratio = durationRatio(main.duration, dub.duration);
    this.durationGuess = this.ratio;
    this.userRate = Number(main.playbackRate || 1);
    report({ percent: 40, etaSeconds: null });

    // Load ~15 s of the dub while the original sound keeps playing, and tell
    // the panel how far it got and about how long is left (B41).
    const deadline = Date.now() + PRELOAD_TIMEOUT_MS;
    dub.currentTime = Math.max(0, Number(main.currentTime || 0) * this.ratio + this.offset);
    let lastAhead = 0;
    let lastAt = Date.now();
    let speed = null;
    while (Date.now() < deadline && bufferedAhead(dub) < PRELOAD_AHEAD_S) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const target = Number(main.currentTime || 0) * this.ratio + this.offset;
      if (Math.abs(Number(dub.currentTime || 0) - target) > 3) {
        dub.currentTime = Math.max(0, target);
        lastAhead = 0;
      }
      const ahead = bufferedAhead(dub);
      const now = Date.now();
      const sample = Math.max(0, ahead - lastAhead) / Math.max(0.05, (now - lastAt) / 1000);
      speed = speed == null ? sample : speed * 0.7 + sample * 0.3;
      lastAhead = ahead;
      lastAt = now;
      report(preloadProgress({ ahead, speed, msLeft: deadline - now }));
    }
    report({ percent: 100, etaSeconds: 0 });

    this.mainWasMuted = main.muted;
    await this.setupGraph();
    dub.muted = false;
    dub.volume = Math.max(0, Math.min(1, Number(main.volume ?? 1)));
    this.active = true;

    const on = (eventName, handler) => {
      main.addEventListener(eventName, handler);
      this.listeners.push([eventName, handler]);
    };
    on("volumechange", () => {
      if (!this.active || !this.dub) return;
      this.dub.volume = Math.max(0, Math.min(1, Number(main.volume ?? 1)));
    });
    on("seeking", () => {
      if (Date.now() < this.internalSeekUntil) return;
      // The viewer moved the movie: move the dub to the same moment.
      this.jumpDubTo(Number(main.currentTime || 0) * this.ratio + this.offset);
    });
    on("ratechange", () => {
      if (Date.now() < this.internalRateUntil) return;
      // The viewer changed the speed in the player.
      this.userRate = Number(main.playbackRate || 1);
      if (this.dub) this.dub.playbackRate = this.userRate * this.ratio;
      this.nudging = false;
    });
    on("pause", () => this.tick());
    on("play", () => this.tick());
    this.jumpDubTo(Number(main.currentTime || 0) * this.ratio + this.offset);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.listeningSince = Date.now();
    this.missedChecks = 0;
    if (this.graph) this.sampler = setInterval(() => this.sample(), SAMPLE_MS);
    this.setStatus(this.graph ? "listening" : "manual-only");
    return {
      ratio: this.ratio,
      mainDuration: main.duration,
      dubDuration: dub.duration,
      auto: Boolean(this.graph)
    };
  }

  // Sound routing: the dub goes to the speakers; the picture's own sound
  // goes only to a "listener" (for the automatic offset), not to the speakers.
  // Only when the engine is really running: attaching the movie to a
  // suspended engine would freeze it (B40). Otherwise: manual offset mode.
  async setupGraph() {
    const main = this.main;
    const dub = this.dub;
    const context = getDubAudioContext();
    if (!context || !canAnalyse(main) || isAppleMobile() || !(await ensureRunning(context))) {
      main.muted = true;
      return;
    }
    try {
      const mainSource = sourceFor(context, main);
      const dubSource = sourceFor(context, dub);
      const mainAnalyser = context.createAnalyser();
      const dubAnalyser = context.createAnalyser();
      mainAnalyser.fftSize = 2048;
      dubAnalyser.fftSize = 2048;
      const silent = context.createGain();
      silent.gain.value = 0;
      try {
        mainSource.disconnect();
      } catch (_) {
        // Not connected yet.
      }
      mainSource.connect(mainAnalyser);
      mainAnalyser.connect(silent);
      silent.connect(context.destination);
      dubSource.connect(dubAnalyser);
      dubAnalyser.connect(context.destination);
      main.muted = false;
      this.graph = {
        context,
        mainSource,
        dubSource,
        mainAnalyser,
        dubAnalyser,
        silent,
        buffer: new Float32Array(mainAnalyser.fftSize)
      };
    } catch (_) {
      this.graph = null;
      main.muted = true;
    }
  }

  setStatus(status) {
    this.autoStatus = status;
    try {
      this.onStatus?.(status, this.offset);
    } catch (_) {
      // The panel may be gone.
    }
  }

  sample() {
    const main = this.main;
    const dub = this.dub;
    const graph = this.graph;
    if (
      !this.active ||
      !graph ||
      !main ||
      !dub ||
      main.paused ||
      dub.paused ||
      main.seeking ||
      dub.seeking
    )
      return;
    if (dub.readyState < 3 || main.readyState < 3) return;
    this.mainSamples.push({
      t: Number(main.currentTime),
      v: rms(graph.mainAnalyser, graph.buffer)
    });
    this.dubSamples.push({ t: Number(dub.currentTime), v: rms(graph.dubAnalyser, graph.buffer) });
    const keepFrom = Number(main.currentTime) - ANALYSIS_WINDOW_S;
    while (this.mainSamples.length && this.mainSamples[0].t < keepFrom) this.mainSamples.shift();
    const keepDubFrom = Number(dub.currentTime) - ANALYSIS_WINDOW_S - WIDE_SEARCH_S;
    while (this.dubSamples.length && this.dubSamples[0].t < keepDubFrom) this.dubSamples.shift();
    if (this.autoOffset && Date.now() - this.lastEstimateAt > ESTIMATE_EVERY_MS)
      this.refineOffset();
  }

  refineOffset() {
    this.lastEstimateAt = Date.now();
    const first = this.mainSamples[0];
    const last = this.mainSamples[this.mainSamples.length - 1];
    if (!first || !last || last.t - first.t < MIN_ANALYSIS_S) return;
    const quiet = this.mainSamples.every((entry) => entry.v < 1e-4);
    if (quiet) return;
    // Once synced: narrow search around the current speed. When that stops
    // matching 3 times in a row (one version has an extra scene...), or before
    // the first match: wide search, up to 20 s and every common speed (B42).
    const synced = this.autoStatus === "synced";
    const wide = !synced || this.missedChecks >= 3;
    // Once synced, only recent audio counts, so a change in the cut shows
    // within seconds instead of being outvoted by the older, still-matching
    // part of the window.
    const recentFrom = last.t - (!synced ? ANALYSIS_WINDOW_S : wide ? 30 : MIN_ANALYSIS_S);
    const recentMain = this.mainSamples.filter((entry) => entry.t >= recentFrom);
    const result = estimateDubAlignment(recentMain, this.dubSamples, {
      maxLag: wide ? WIDE_SEARCH_S : 2,
      // Around the offset in use (the first search starts from 0).
      center: synced ? this.offset : 0,
      ratios: wide ? [this.durationGuess || 1, this.ratio, ...COMMON_SPEED_RATIOS] : [this.ratio]
    });
    if (!result.confident) {
      this.missedChecks = (this.missedChecks || 0) + 1;
      // A minute without any match: most likely two different versions.
      if (
        !synced &&
        Date.now() - this.listeningSince > GIVE_UP_HINT_MS &&
        this.autoStatus !== "unsure"
      ) {
        this.setStatus("unsure");
      }
      return;
    }
    this.missedChecks = 0;
    if (
      Math.abs(result.ratio - this.ratio) > 0.0005 ||
      Math.abs(result.offset - this.offset) >= 0.06
    ) {
      this.realign(result.ratio, result.offset);
    }
    if (this.autoStatus !== "synced") this.setStatus("synced");
  }

  // New speed and/or offset. First match, or a small change: the picture is
  // moved to the matching moment (no audible cut). A big change in the
  // middle of the movie (one version has an extra scene) skips the dubbed
  // sound once instead, so the movie itself is never replayed or skipped (B42).
  realign(ratio, offset) {
    const wasSynced = this.autoStatus === "synced";
    this.ratio = ratio;
    this.offset = offset;
    if (this.dub) this.dub.playbackRate = this.userRate * this.ratio;
    if (this.main && this.dub) {
      const mainTime = Number(this.main.currentTime || 0);
      const pictureTime = (Number(this.dub.currentTime || 0) - offset) / ratio;
      const gap = Math.abs(pictureTime - mainTime);
      if (wasSynced && gap >= 1) this.jumpDubTo(mainTime * ratio + offset);
      else if (gap >= 0.06) this.seekPicture(pictureTime);
    }
    this.setStatus(this.autoOffset ? "synced" : "manual");
  }

  // A new offset moves the picture, never the sound (no audible cut).
  applyOffset(offset) {
    const delta = offset - this.offset;
    this.offset = offset;
    if (this.main && this.dub && Math.abs(delta) >= 0.06) {
      this.seekPicture(Number(this.main.currentTime || 0) - delta / this.ratio);
    }
    this.setStatus(this.autoOffset ? "synced" : "manual");
  }

  seekPicture(time) {
    if (!this.main) return;
    // If moving the picture keeps failing (3 times in 15 s: this video cannot
    // seek), move the sound to the picture instead from then on.
    const now = Date.now();
    this.pictureSeeks = (this.pictureSeeks || []).filter((at) => now - at < 15000);
    this.pictureSeeks.push(now);
    if (this.pictureSeeks.length >= 3) this.pictureSeekBroken = true;
    if (this.pictureSeekBroken) {
      this.jumpDubTo(Number(this.main.currentTime || 0) * this.ratio + this.offset);
      return;
    }
    this.internalSeekUntil = Date.now() + 1500;
    this.main.currentTime = Math.max(0, time);
    this.smoothDrift = null;
    this.settleUntil = Date.now() + SETTLE_AFTER_JUMP_MS;
    this.jumps += 1;
  }

  jumpDubTo(target) {
    if (!this.dub) return;
    this.dub.currentTime = Math.max(0, target);
    this.dub.playbackRate = this.userRate * this.ratio;
    this.setPictureFactor(1);
    this.smoothDrift = null;
    this.settleUntil = Date.now() + SETTLE_AFTER_JUMP_MS;
    this.jumps += 1;
  }

  setPictureFactor(factor) {
    if (!this.main) return;
    const rate = this.userRate * factor;
    if (Math.abs(Number(this.main.playbackRate || 1) - rate) < 0.0001) return;
    this.internalRateUntil = Date.now() + 300;
    this.main.playbackRate = rate;
    this.pictureFactor = factor;
  }

  tick() {
    const main = this.main;
    const dub = this.dub;
    if (!this.active || !main || !dub) return;
    if (!this.graph && !main.muted) main.muted = true;
    // Watchdog (B40): a suspended engine freezes the movie; try to wake it
    // (a tap always does, see installContextKeeper).
    const context = this.graph?.context;
    if (context && context.state !== "running" && context.state !== "closed") {
      void Promise.resolve(context.resume?.()).catch(() => {});
      if (this.autoStatus !== "tap") this.setStatus("tap");
      return;
    }
    if (this.autoStatus === "tap") this.setStatus(this.autoOffset ? "listening" : "manual");
    const target = Number(main.currentTime || 0) * this.ratio + this.offset;
    const now = Date.now();
    if (main.paused || main.seeking || main.readyState < 3 || target < 0) {
      if (!dub.paused) dub.pause();
      return;
    }
    if (dub.paused) dub.play().catch(() => {});
    const dubRate = this.userRate * this.ratio;
    if (Math.abs(Number(dub.playbackRate || 1) - dubRate) > 0.0001) dub.playbackRate = dubRate;
    // Still loading (after a jump, or TorBox converting): wait, do not chase.
    if (now < this.settleUntil || dub.seeking || dub.readyState < 3) {
      this.smoothDrift = null;
      return;
    }
    const drift = Number(dub.currentTime || 0) - target;
    this.smoothDrift =
      this.smoothDrift == null
        ? drift
        : this.smoothDrift * (1 - DRIFT_SMOOTHING) + drift * DRIFT_SMOOTHING;
    const plan = planDubCorrection({
      drift: this.smoothDrift,
      currentFactor: this.pictureFactor ?? 1,
      msSinceRateChange: now - this.lastRateChangeAt,
      nudging: this.nudging
    });
    if (plan.action === "jump") {
      // The dub got behind or ahead (a stall): move the picture to the sound.
      this.seekPicture((Number(dub.currentTime || 0) - this.offset) / this.ratio);
    } else if (plan.action === "rate") {
      this.setPictureFactor(plan.factor);
      this.nudging = plan.nudging;
      this.lastRateChangeAt = now;
      this.rateChanges += 1;
    }
  }

  toggleMute() {
    if (!this.dub) return false;
    this.dub.muted = !this.dub.muted;
    return this.dub.muted;
  }

  isMuted() {
    return Boolean(this.dub?.muted);
  }

  // The -0.5 s / +0.5 s buttons: manual fine-tuning from here on.
  nudgeOffset(seconds) {
    this.autoOffset = false;
    const next = Math.round((this.offset + Number(seconds || 0)) * 10) / 10;
    this.applyOffset(next);
    this.setStatus("manual");
    return this.offset;
  }

  enableAutoOffset() {
    this.autoOffset = true;
    this.lastEstimateAt = 0;
    this.setStatus(this.graph ? "listening" : "manual-only");
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.sampler) clearInterval(this.sampler);
    this.timer = null;
    this.sampler = null;
    this.listeners.forEach(([eventName, handler]) =>
      this.main?.removeEventListener(eventName, handler)
    );
    this.listeners = [];
    if (this.graph) {
      const { context, mainSource, dubSource, mainAnalyser, dubAnalyser, silent } = this.graph;
      for (const node of [mainSource, dubSource, mainAnalyser, dubAnalyser, silent]) {
        try {
          node.disconnect();
        } catch (_) {
          // Already disconnected.
        }
      }
      // The picture's sound now always goes through the engine: send it back
      // to the speakers.
      try {
        mainSource.connect(context.destination);
      } catch (_) {
        // Engine closed.
      }
    }
    this.graph = null;
    try {
      this.hls?.destroy?.();
    } catch (_) {
      // Already torn down.
    }
    this.hls = null;
    if (this.dub) {
      try {
        this.dub.pause();
        this.dub.removeAttribute("src");
        this.dub.load();
      } catch (_) {
        // Ignore teardown errors.
      }
      this.dub.remove();
    }
    this.dub = null;
    if (this.active && this.main) {
      this.main.muted = this.mainWasMuted;
      this.internalRateUntil = Date.now() + 300;
      this.main.playbackRate = this.userRate;
    }
    this.active = false;
    this.offset = 0;
    this.ratio = 1;
    this.mainSamples = [];
    this.dubSamples = [];
    this.pictureFactor = 1;
  }
}
