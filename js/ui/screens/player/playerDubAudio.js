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
function streamText(stream = {}) {
  return [
    stream.title,
    stream.name,
    stream.description,
    stream.behaviorHints?.filename,
    stream.raw?.title
  ]
    .map((value) => String(value || ""))
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function titleWords(title = "") {
  return String(title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !["the", "and", "for", "dos", "das"].includes(word));
}

// Best dubbed source to borrow the sound from (B42): sources whose name has
// the same title as the movie playing first (an addon can list another film
// or edition), then the same kind of release (WEB-DL with WEB-DL...), then
// the usual dubbed-first order.
export function findDubSource(current = null, candidates = [], { title = "" } = {}) {
  const dubbed = preferDubbedStreams(candidates, { enabled: true }).filter(
    (stream) =>
      dubRank(stream) <= 2 &&
      !sameStream(stream, current) &&
      DirectDebridResolver.canResolveStream(stream)
  );
  if (!dubbed.length) return null;
  const words = titleWords(title);
  const family = releaseFamily(current);
  const score = (stream) => {
    const text = streamText(stream);
    const sameTitle = words.length > 0 && words.every((word) => text.includes(word));
    return (sameTitle ? 2 : 0) + (family && releaseFamily(stream) === family ? 1 : 0);
  };
  return dubbed
    .map((stream, index) => ({ stream, index, score: score(stream) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0].stream;
}

export function canOfferDubAudio(screen) {
  if (!Environment.isBrowser() || !prefersPortugueseAudio()) return false;
  if (screen?.dubAudio?.active || screen?.dubAudioLoading) return true;
  const current = screen?.getCurrentStreamCandidate?.() || null;
  if (!current || dubRank(current) <= 1) return false;
  return Boolean(
    findDubSource(current, screen?.streamCandidates || [], {
      title: screen?.params?.playerTitle || ""
    })
  );
}

export function isDubAudioActive(screen) {
  return Boolean(screen?.dubAudio?.active || screen?.dubAudioLoading);
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
    tap: "toque na tela para continuar",
    unsure: "não achei o atraso: versões diferentes? Ajuste ou troque a fonte"
  };
  const minus = makeButton("−0,5s", () => nudge(-0.5), "Atrasar a dublagem");
  const plus = makeButton("+0,5s", () => nudge(0.5), "Adiantar a dublagem");
  const setLoading = (loading) => {
    panel.__loading = loading;
    for (const node of [minus, offset, plus]) node.style.display = loading ? "none" : "";
    panel.__sync?.();
  };
  panel.__update = (state, value) => {
    setLoading(false);
    status.textContent = STATUS_TEXT[state] || "";
    offset.textContent = formatOffset(Number(value) || 0);
    autoButton.style.display = state === "manual" ? "" : "none";
  };
  // Loading progress (B41): "carregando 45% · ~6s".
  panel.__progress = (percent, etaSeconds) => {
    setLoading(true);
    autoButton.style.display = "none";
    const eta = Number.isFinite(etaSeconds) && etaSeconds > 0 ? ` · ~${etaSeconds}s` : "";
    status.textContent = `carregando ${Math.max(0, Math.min(100, Math.round(percent)))}%${eta}`;
  };
  panel.append(
    label,
    status,
    minus,
    offset,
    plus,
    autoButton,
    makeButton("Desligar", () => stopDubAudio(screen, { notify: true }), "Voltar ao áudio original")
  );
  panel.__progress(0, null);
  for (const type of ["click", "pointerdown", "mousedown", "pointermove", "mousemove"]) {
    panel.addEventListener(type, (event) => event.stopPropagation());
  }
  document.body.appendChild(panel);
  // Show the panel together with the player controls (always while loading).
  const root = document.getElementById("playerUiRoot");
  const sync = () => {
    panel.style.display =
      panel.__loading || !root || root.classList.contains("controls-visible") ? "flex" : "none";
  };
  panel.__sync = sync;
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
  if (screen?.dubAudioLoading) {
    // "Desligar" while loading cancels it (B41).
    screen.dubAudioLoading = null;
    if (notify) screen.showAspectToast?.("Dublagem cancelada", 1800);
  }
  if (screen?.dubAudio) {
    screen.dubAudio.stop();
    screen.dubAudio = null;
    if (notify) screen.showAspectToast?.("Áudio original de volta", 1800);
    screen.renderControlButtons?.();
  }
}

export async function toggleDubAudio(screen, video) {
  if (screen?.dubAudio?.active || screen?.dubAudioLoading) {
    stopDubAudio(screen, { notify: true });
    return;
  }
  const current = screen?.getCurrentStreamCandidate?.() || null;
  const source = findDubSource(current, screen?.streamCandidates || [], {
    title: screen?.params?.playerTitle || ""
  });
  if (!source || !video) {
    screen?.showAspectToast?.("Nenhuma fonte dublada na lista", 2200);
    return;
  }
  // The tap on "Dub β" is what lets the browser start the audio engine.
  void getDubAudioContext()?.resume?.();
  // The panel shows up at once with the loading progress (B41).
  const token = {};
  screen.dubAudioLoading = token;
  const stillLoading = () => screen.dubAudioLoading === token;
  showPanel(screen, String(source.title || source.name || ""));
  const progress = (percent, eta) => document.getElementById(PANEL_ID)?.__progress?.(percent, eta);
  // Asking TorBox has no progress of its own: creep from 5% to 30%.
  let askPercent = 5;
  progress(askPercent, null);
  const creep = setInterval(() => {
    askPercent = Math.min(30, askPercent + 2);
    progress(askPercent, null);
  }, 500);
  screen.renderControlButtons?.();
  const resolved = await DirectDebridResolver.resolveDubbedAudioSource(source, {
    season: screen?.params?.season ?? null,
    episode: screen?.params?.episode ?? null
  })
    .catch(() => null)
    .finally(() => clearInterval(creep));
  if (!stillLoading()) return;
  if (resolved?.status !== "success") {
    screen.dubAudioLoading = null;
    removePanel();
    screen.renderControlButtons?.();
    screen.showAspectToast?.("Não deu para carregar a dublagem desta fonte", 2600);
    return;
  }
  const sync = new DubAudioSync(video);
  screen.dubAudio = sync;
  try {
    const info = await sync.start(resolved.url, {
      onStatus: (state, value) => document.getElementById(PANEL_ID)?.__update?.(state, value),
      onProgress: ({ percent, etaSeconds }) => {
        if (stillLoading()) progress(percent, etaSeconds);
      }
    });
    if (!stillLoading()) {
      sync.stop();
      if (screen.dubAudio === sync) screen.dubAudio = null;
      return;
    }
    screen.dubAudioLoading = null;
    const durationGap = Math.abs(
      Number(info.dubDuration || 0) / Number(info.ratio || 1) - Number(info.mainDuration || 0)
    );
    document.getElementById(PANEL_ID)?.__update?.(sync.autoStatus, sync.offset);
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
    screen.dubAudioLoading = null;
    removePanel();
    screen.renderControlButtons?.();
    screen.showAspectToast?.("Não deu para tocar a dublagem", 2600);
  }
}
