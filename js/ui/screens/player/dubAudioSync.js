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
// Small drifts are corrected by nudging the playback speed, big ones (a
// seek, a stall) by jumping.

import { loadStreamingLibs } from "../../../runtime/loadStreamingLibs.js";

const TICK_MS = 250;
const JUMP_THRESHOLD_S = 0.35;
const MAX_NUDGE = 0.05;

export function durationRatio(mainDuration, dubDuration) {
  const main = Number(mainDuration);
  const dub = Number(dubDuration);
  if (!(main > 0) || !(dub > 0) || !Number.isFinite(main) || !Number.isFinite(dub)) return 1;
  const ratio = dub / main;
  if (Math.abs(ratio - 1) < 0.004) return 1;
  if (ratio > 0.94 && ratio < 1.06) return ratio;
  return 1;
}

// Speed for the dub element: follows the main speed and pulls the dub back
// toward the target time; null means "too far, jump instead".
export function syncPlaybackRate({ mainRate = 1, ratio = 1, drift = 0 } = {}) {
  if (Math.abs(drift) > JUMP_THRESHOLD_S) return null;
  const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -drift * 0.5));
  return Number(mainRate || 1) * ratio * (1 + nudge);
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
      this.hls = new Hls({ maxBufferLength: 60, backBufferLength: 30 });
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
    if (main.paused || main.seeking || main.readyState < 3 || target < 0) {
      if (!dub.paused) dub.pause();
      if (force && target >= 0) dub.currentTime = target;
      return;
    }
    const drift = Number(dub.currentTime || 0) - target;
    const rate = force
      ? null
      : syncPlaybackRate({ mainRate: main.playbackRate, ratio: this.ratio, drift });
    if (rate === null) {
      dub.currentTime = target;
      dub.playbackRate = Number(main.playbackRate || 1) * this.ratio;
    } else {
      dub.playbackRate = rate;
    }
    if (dub.paused) dub.play().catch(() => {});
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
