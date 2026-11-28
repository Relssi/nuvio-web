// "Choose the audio" window shown before a TorBox movie starts in the browser
// (B34). The resolver asks only when it cannot tell which track is the
// preferred language, or when the file has none (js/core/debrid/
// torboxAudioChoice.js, decideTorboxAudio). Works with touch, mouse and keys.
import { setTorboxAudioPrompt } from "../../core/debrid/torboxAudioPrompt.js";

const STYLE_ID = "nuvio-audio-choice-style";

const CSS = `
.nuvio-audio-choice {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.72);
  font-family: inherit;
  zoom: 1;
}
.nuvio-audio-choice-card {
  width: min(440px, 100%);
  max-height: calc(100% - 32px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 20px;
  border-radius: 18px;
  background: #16161c;
  color: #ffffff;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.nuvio-audio-choice-title {
  margin: 0 0 6px;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.25;
}
.nuvio-audio-choice-text {
  margin: 0 0 14px;
  font-size: 14px;
  line-height: 1.4;
  color: #b9b9c4;
  overflow-wrap: anywhere;
}
.nuvio-audio-choice-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nuvio-audio-choice-btn {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #ffffff;
  font: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}
.nuvio-audio-choice-btn:hover,
.nuvio-audio-choice-btn:focus-visible {
  outline: none;
  border-color: #e50914;
  background: rgba(229, 9, 20, 0.16);
}
.nuvio-audio-choice-btn.is-suggested::after {
  content: "sugerida";
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #ff6b72;
}
.nuvio-audio-choice-back {
  margin-top: 12px;
  justify-content: center;
  color: #b9b9c4;
  background: transparent;
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function textFor(request) {
  const name = String(request?.fileName || "").trim();
  if (request?.reason === "no-preferred-language") {
    return {
      title: "Este arquivo não tem áudio em português",
      text: `${name ? `${name}\n` : ""}Escolha um dos áudios disponíveis ou volte para escolher outra fonte (as marcadas como Dual/PT-BR costumam ter dublagem).`
    };
  }
  return {
    title: "Escolha o áudio",
    text: `${name ? `${name}\n` : ""}Não deu para saber com certeza qual faixa é a dublada. Escolha o idioma antes de começar.`
  };
}

export function showTorboxAudioChoice(request = {}) {
  ensureStyle();
  return new Promise((resolve) => {
    const tracks = Array.isArray(request.tracks) ? request.tracks : [];
    const copy = textFor(request);
    const overlay = document.createElement("div");
    overlay.className = "nuvio-audio-choice";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const card = document.createElement("div");
    card.className = "nuvio-audio-choice-card";
    const title = document.createElement("h2");
    title.className = "nuvio-audio-choice-title";
    title.textContent = copy.title;
    const text = document.createElement("p");
    text.className = "nuvio-audio-choice-text";
    text.style.whiteSpace = "pre-line";
    text.textContent = copy.text;
    const list = document.createElement("div");
    list.className = "nuvio-audio-choice-list";
    card.append(title, text, list);
    overlay.appendChild(card);

    const buttons = [];
    let done = false;
    const finish = (answer) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(answer);
    };

    tracks.forEach((track) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nuvio-audio-choice-btn";
      if (track.index === request.suggested) button.classList.add("is-suggested");
      button.textContent = String(track.label || `Faixa ${track.index + 1}`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        finish({ index: track.index });
      });
      list.appendChild(button);
      buttons.push(button);
    });

    const back = document.createElement("button");
    back.type = "button";
    back.className = "nuvio-audio-choice-btn nuvio-audio-choice-back";
    back.textContent = "← Escolher outra fonte";
    back.addEventListener("click", (event) => {
      event.stopPropagation();
      finish({ cancelled: true });
    });
    card.appendChild(back);
    buttons.push(back);

    // The app's focus engine listens to keys and clicks on the page: keep
    // this window's own keys and taps to itself.
    function onKey(event) {
      const key = event.key;
      const current = buttons.indexOf(document.activeElement);
      if (key === "ArrowDown" || key === "ArrowUp") {
        const step = key === "ArrowDown" ? 1 : -1;
        const next = buttons[(Math.max(0, current) + step + buttons.length) % buttons.length];
        next?.focus();
      } else if (key === "Enter" || key === " ") {
        (buttons[current] || buttons[0])?.click();
      } else if (
        key === "Escape" ||
        key === "Backspace" ||
        key === "GoBack" ||
        event.keyCode === 10009 ||
        event.keyCode === 461
      ) {
        finish({ cancelled: true });
      } else {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    document.addEventListener("keydown", onKey, true);
    for (const type of ["click", "pointerdown", "mousedown", "pointermove", "mousemove"]) {
      overlay.addEventListener(type, (event) => event.stopPropagation());
    }

    document.body.appendChild(overlay);
    const suggestedButton = buttons[tracks.findIndex((track) => track.index === request.suggested)];
    (suggestedButton || buttons[0])?.focus();
  });
}

// Browser only: TV apps decode every audio track themselves.
export function installTorboxAudioChoice({ enabled = true } = {}) {
  setTorboxAudioPrompt(enabled ? showTorboxAudioChoice : null);
}
