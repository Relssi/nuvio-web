// Player side of "dubbed audio from another source" (B37, beta, browser).
// The "Dub β" button shows when the playing source is not known to be dubbed
// and the source list has a dubbed one. Pressing it plays the dubbed sound
// (dubAudioSync.js) next to the current picture and opens a small panel with
// -0.5 s / +0.5 s and "Desligar".
import { Environment } from "../../../platform/environment.js";
import { DirectDebridResolver } from "../../../core/debrid/directDebridResolver.js";
import {
  dubRank,
  preferDubbedStreams,
  prefersPortugueseAudio
} from "../../../core/streams/streamOrdering.js";
import { DubAudioSync, getDubAudioContext } from "./dubAudioSync.js";

const PANEL_ID = "nuvio-dub-audio-panel";

function releaseFamily(stream = {}) {
  const text = [stream.title, stream.name, stream.description, stream.behaviorHints?.filename]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  if (/remux/.test(text)) return "remux";
  if (/blu-?ray|bdrip|brrip/.test(text)) return "bluray";
  if (/web-?dl|webrip|\bweb\b/.test(text)) return "web";
  return "";
}

function sameStream(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.id && right.id && left.id === right.id) return true;
  const leftHash = String(left.infoHash || left.clientResolve?.infoHash || "").toLowerCase();
  const rightHash = String(right.infoHash || right.clientResolve?.infoHash || "").toLowerCase();
  return (
    Boolean(leftHash) &&
    leftHash === rightHash &&
    (left.fileIdx ?? null) === (right.fileIdx ?? null)
  );
}

// Best dubbed source to borrow the sound from: dubbed first, and among those
// the same kind of release as the movie playing (WEB-DL with WEB-DL...), which
// usually means the same cut and speed.
export function findDubSource(current = null, candidates = []) {
  const dubbed = preferDubbedStreams(candidates, { enabled: true }).filter(
    (stream) =>
      dubRank(stream) <= 2 &&
      !sameStream(stream, current) &&
      DirectDebridResolver.canResolveStream(stream)
  );
  if (!dubbed.length) return null;
  const family = releaseFamily(current);
  return (family && dubbed.find((stream) => releaseFamily(stream) === family)) || dubbed[0];
}

export function canOfferDubAudio(screen) {
  if (!Environment.isBrowser() || !prefersPortugueseAudio()) return false;
  if (screen?.dubAudio?.active) return true;
  const current = screen?.getCurrentStreamCandidate?.() || null;
  if (!current || dubRank(current) <= 1) return false;
  return Boolean(findDubSource(current, screen?.streamCandidates || []));
}

export function isDubAudioActive(screen) {
  return Boolean(screen?.dubAudio?.active);
}

function removePanel() {
  document.getElementById(PANEL_ID)?.remove();
}

function formatOffset(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1).replace(".", ",")}s`;
}

function showPanel(screen, sourceLabel) {
  removePanel();
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = [
    "position:fixed",
    "top:12px",
    "right:12px",
    "z-index:2147483000",
    "display:flex",
    "align-items:center",
    "gap:6px",
    "flex-wrap:wrap",
    "max-width:calc(100vw - 24px)",
    "padding:8px 10px",
    "border-radius:12px",
    "background:rgba(10,10,13,0.85)",
    "color:#fff",
    "font:600 13px/1.2 system-ui,sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,0.5)"
  ].join(";");
  const label = document.createElement("span");
  label.textContent = "Dublado β";
  label.title = sourceLabel || "";
  const status = document.createElement("span");
  status.style.cssText = "color:#b9b9c4;font-weight:500";
  const offset = document.createElement("span");
  offset.style.cssText = "min-width:48px;text-align:center;color:#ff6b72";
  offset.textContent = formatOffset(screen.dubAudio?.offset ?? 0);
  const makeButton = (text, onClick, title) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.title = title;
    button.style.cssText =
      "appearance:none;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.08);color:#fff;border-radius:8px;min-width:40px;min-height:36px;padding:0 10px;font:inherit;cursor:pointer";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  };
  const autoButton = makeButton(
    "Auto",
    () => {
      screen.dubAudio?.enableAutoOffset();
    },
    "Voltar ao ajuste automático do atraso"
  );
  const nudge = (seconds) => {
    screen.dubAudio?.nudgeOffset(seconds);
  };
  // Automatic offset status (B39), updated by DubAudioSync.
  const STATUS_TEXT = {
    loading: "carregando…",
    listening: "sincronizando…",
    synced: "auto ✓",
    manual: "manual",
    "manual-only": "ajuste manual",
    tap: "toque na tela para continuar"
  };
  panel.__update = (state, value) => {
    status.textContent = STATUS_TEXT[state] || "";
    offset.textContent = formatOffset(Number(value) || 0);
    autoButton.style.display = state === "manual" ? "" : "none";
  };
  panel.append(
    label,
    status,
    makeButton("−0,5s", () => nudge(-0.5), "Atrasar a dublagem"),
    offset,
    makeButton("+0,5s", () => nudge(0.5), "Adiantar a dublagem"),
    autoButton,
    makeButton("Desligar", () => stopDubAudio(screen, { notify: true }), "Voltar ao áudio original")
  );
  panel.__update(screen.dubAudio?.autoStatus || "loading", screen.dubAudio?.offset ?? 0);
  for (const type of ["click", "pointerdown", "mousedown", "pointermove", "mousemove"]) {
    panel.addEventListener(type, (event) => event.stopPropagation());
  }
  document.body.appendChild(panel);
  // Show the panel only together with the player controls.
  const root = document.getElementById("playerUiRoot");
  const sync = () => {
    panel.style.display = !root || root.classList.contains("controls-visible") ? "flex" : "none";
  };
  sync();
  if (root && typeof MutationObserver === "function") {
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    panel.__observer = observer;
  }
}

export function stopDubAudio(screen, { notify = false } = {}) {
  const panel = document.getElementById(PANEL_ID);
  panel?.__observer?.disconnect?.();
  removePanel();
  if (screen?.dubAudio) {
    screen.dubAudio.stop();
    screen.dubAudio = null;
    if (notify) screen.showAspectToast?.("Áudio original de volta", 1800);
    screen.renderControlButtons?.();
  }
}

export async function toggleDubAudio(screen, video) {
  if (screen?.dubAudio?.active) {
    stopDubAudio(screen, { notify: true });
    return;
  }
  const current = screen?.getCurrentStreamCandidate?.() || null;
  const source = findDubSource(current, screen?.streamCandidates || []);
  if (!source || !video) {
    screen?.showAspectToast?.("Nenhuma fonte dublada na lista", 2200);
    return;
  }
  // The tap on "Dub β" is what lets the browser start the audio engine.
  void getDubAudioContext()?.resume?.();
  screen.showAspectToast?.("Carregando a dublagem…", 4000);
  const resolved = await DirectDebridResolver.resolveDubbedAudioSource(source, {
    season: screen?.params?.season ?? null,
    episode: screen?.params?.episode ?? null
  }).catch(() => null);
  if (resolved?.status !== "success") {
    screen.showAspectToast?.("Não deu para carregar a dublagem desta fonte", 2600);
    return;
  }
  const sync = new DubAudioSync(video);
  screen.dubAudio = sync;
  try {
    const info = await sync.start(resolved.url, {
      onStatus: (state, value) => document.getElementById(PANEL_ID)?.__update?.(state, value)
    });
    const durationGap = Math.abs(
      Number(info.dubDuration || 0) / Number(info.ratio || 1) - Number(info.mainDuration || 0)
    );
    showPanel(screen, String(source.title || source.name || ""));
    screen.showAspectToast?.(
      durationGap > 8
        ? "Dublagem ligada (β). As versões têm durações diferentes: pode sair de sincronia"
        : info.auto
          ? "Dublagem ligada (β). Ajustando o atraso sozinho…"
          : "Dublagem ligada (β). Ajuste o atraso se precisar",
      3200
    );
    screen.renderControlButtons?.();
  } catch (_) {
    sync.stop();
    screen.dubAudio = null;
    screen.showAspectToast?.("Não deu para tocar a dublagem", 2600);
  }
}
