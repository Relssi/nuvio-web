// Dubbed audio from another source (B37, beta, browser only).
//
// The main <video> keeps playing the best picture with its own sound muted.
// A hidden second <video> plays the dubbed source (converted by TorBox at a
// low resolution) and only its sound is heard. Every 250 ms the second one is
// brought back in line with the first:
//   dubTime = mainTime * ratio + offset
// - ratio corrects the common speed difference between releases (a 25 fps
//   dub against a 23.976 fps movie): it is the ratio of the two durations
//   when they differ by 0.4%-6%, otherwise 1.
// - offset is set by the viewer with the -0.5 s / +0.5 s buttons.
// Corrections are gentle so the sound does not stutter (B38): the drift is
// averaged over several readings; the speed changes only above 0.12 s of
// drift, at most once per second and by at most 3%, and goes back to normal
// below 0.04 s; the dub only jumps beyond 1 s (a seek) and then waits 2 s
// before measuring again; nothing is corrected while the dub is still loading.

import { loadStreamingLibs } from "../../../runtime/loadStreamingLibs.js";

const TICK_MS = 250;
const JUMP_THRESHOLD_S = 1;
const START_NUDGE_S = 0.12;
const STOP_NUDGE_S = 0.04;
const MAX_NUDGE = 0.03;
const RATE_CHANGE_GAP_MS = 1000;
const SETTLE_AFTER_JUMP_MS = 2000;
const DRIFT_SMOOTHING = 0.3;

// What to do about the (averaged) drift: "jump", change the "rate", or "none".
export function planDubCorrection({
  drift = 0,
  baseRate = 1,
  currentRate = baseRate,
  msSinceRateChange = Infinity,
  nudging = false
} = {}) {
  const size = Math.abs(drift);
  if (size > JUMP_THRESHOLD_S) return { action: "jump" };
  if (msSinceRateChange < RATE_CHANGE_GAP_MS) return { action: "none" };
  if (size < STOP_NUDGE_S || (!nudging && size < START_NUDGE_S)) {
    return Math.abs(currentRate - baseRate) > 0.0005
      ? { action: "rate", rate: baseRate, nudging: false }
      : { action: "none" };
  }
  const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -drift * 0.25));
  const rate = baseRate * (1 + nudge);
  return Math.abs(currentRate - rate) > 0.004
    ? { action: "rate", rate, nudging: true }
    : { action: "none" };
}

export function durationRatio(mainDuration, dubDuration) {
  const main = Number(mainDuration);
  const dub = Number(dubDuration);
  if (!(main > 0) || !(dub > 0) || !Number.isFinite(main) || !Number.isFinite(dub)) return 1;
  const ratio = dub / main;
  if (Math.abs(ratio - 1) < 0.004) return 1;
  if (ratio > 0.94 && ratio < 1.06) return ratio;
  return 1;
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

export class DubAudioSync {
  constructor(mainVideo) {
    this.main = mainVideo;
    this.dub = null;
    this.hls = null;
    this.timer = null;
    this.offset = 0;
    this.ratio = 1;
    this.active = false;
    this.mainWasMuted = false;
    this.listeners = [];
    this.smoothDrift = null;
    this.settleUntil = 0;
    this.lastRateChangeAt = 0;
    this.nudging = false;
    this.rateChanges = 0;
    this.jumps = 0;
  }

  async start(url) {
    this.stop();
    const main = this.main;
    if (!main) throw new Error("no video");
    const dub = document.createElement("video");
    dub.playsInline = true;
    dub.preload = "auto";
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
    await waitFor(dub, "loadedmetadata", 45000);

    this.ratio = durationRatio(main.duration, dub.duration);
    this.mainWasMuted = main.muted;
    main.muted = true;
    dub.muted = false;
    dub.volume = Math.max(0, Math.min(1, Number(main.volume ?? 1)));
    this.active = true;

    const on = (eventName, handler) => {
      main.addEventListener(eventName, handler);
      this.listeners.push([eventName, handler]);
    };
    // The volume slider acts on the main element: copy its level to the dub.
    // The mute button calls toggleMute() while the dub is on.
    on("volumechange", () => {
      if (!this.active || !this.dub) return;
      this.dub.volume = Math.max(0, Math.min(1, Number(main.volume ?? 1)));
    });
    on("seeking", () => this.tick({ force: true }));
    on("pause", () => this.tick());
    on("play", () => this.tick({ force: true }));
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick({ force: true });
    return { ratio: this.ratio, mainDuration: main.duration, dubDuration: dub.duration };
  }

  tick({ force = false } = {}) {
    const main = this.main;
    const dub = this.dub;
    if (!this.active || !main || !dub) return;
    if (!main.muted) main.muted = true;
    const target = Number(main.currentTime || 0) * this.ratio + this.offset;
    const baseRate = Number(main.playbackRate || 1) * this.ratio;
    const now = Date.now();
    if (main.paused || main.seeking || main.readyState < 3 || target < 0) {
      if (!dub.paused) dub.pause();
      if (force && target >= 0) this.jumpTo(target, baseRate, now);
      return;
    }
    if (force) {
      this.jumpTo(target, baseRate, now);
      if (dub.paused) dub.play().catch(() => {});
      return;
    }
    if (dub.paused) dub.play().catch(() => {});
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
      baseRate,
      currentRate: dub.playbackRate,
      msSinceRateChange: now - this.lastRateChangeAt,
      nudging: this.nudging
    });
    if (plan.action === "jump") {
      this.jumpTo(target, baseRate, now);
    } else if (plan.action === "rate") {
      dub.playbackRate = plan.rate;
      this.nudging = plan.nudging;
      this.lastRateChangeAt = now;
      this.rateChanges += 1;
    }
  }

  jumpTo(target, baseRate, now = Date.now()) {
    if (!this.dub) return;
    this.dub.currentTime = target;
    this.dub.playbackRate = baseRate;
    this.nudging = false;
    this.smoothDrift = null;
    this.settleUntil = now + SETTLE_AFTER_JUMP_MS;
    this.lastRateChangeAt = now;
    this.jumps += 1;
  }

  toggleMute() {
    if (!this.dub) return false;
    this.dub.muted = !this.dub.muted;
    return this.dub.muted;
  }

  isMuted() {
    return Boolean(this.dub?.muted);
  }

  nudgeOffset(seconds) {
    this.offset = Math.round((this.offset + Number(seconds || 0)) * 10) / 10;
    this.tick({ force: true });
    return this.offset;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.forEach(([eventName, handler]) =>
      this.main?.removeEventListener(eventName, handler)
    );
    this.listeners = [];
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
    if (this.active && this.main) this.main.muted = this.mainWasMuted;
    this.active = false;
    this.offset = 0;
    this.ratio = 1;
  }
}
