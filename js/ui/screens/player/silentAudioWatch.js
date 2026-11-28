// Sources that play without sound (B49).
//
// Chrome, Brave and Opera drop Dolby (AC-3 / E-AC-3), DTS and TrueHD audio:
// the picture plays and nothing is heard. Addons that hand out direct files
// (FrostStream's 4K HDR / 1080p, for example) cannot go through TorBox's
// converted stream, and their site blocks servers, so the sound cannot be
// converted for them. The browser does say how much audio it decoded
// (webkitAudioDecodedByteCount, Chrome/Edge only): when the movie has played
// for a few seconds and not one byte of audio was decoded, the player tells
// the viewer and moves to the next source at the same moment of the movie.

export const SILENT_AFTER_SECONDS = 6;
const CHECK_EVERY_MS = 1000;
const MAX_SWITCHES = 4;

// Pure rule, unit tested: is this a source the browser cannot play the sound of?
export function isSilentPlayback({ decodedAudioBytes, playedSeconds }) {
  if (typeof decodedAudioBytes !== "number") return false; // browser does not tell
  return playedSeconds >= SILENT_AFTER_SECONDS && decodedAudioBytes === 0;
}

function streamUrlOf(candidate) {
  return String(candidate?.url || candidate?.externalUrl || "").trim();
}

function candidateKey(candidate) {
  const hash = String(candidate?.infoHash || candidate?.raw?.infoHash || "").toLowerCase();
  if (hash) return `${hash}:${candidate?.fileIdx ?? ""}`;
  return streamUrlOf(candidate) || String(candidate?.id || "");
}

// Next source after the current one in the player's order, skipping the ones
// already found silent. Pure, unit tested.
export function nextSourceWithSound(ordered = [], current = null, silentKeys = new Set()) {
  const currentKey = current ? candidateKey(current) : "";
  const start = Math.max(0, ordered.findIndex((entry) => candidateKey(entry) === currentKey) + 1);
  for (let step = 0; step < ordered.length; step += 1) {
    const entry = ordered[(start + step) % ordered.length];
    const key = candidateKey(entry);
    if (!entry || key === currentKey || silentKeys.has(key)) continue;
    return entry;
  }
  return null;
}

export function stopSilentAudioWatch(screen) {
  if (screen?.silentAudioTimer) clearInterval(screen.silentAudioTimer);
  if (screen) screen.silentAudioTimer = null;
}

export function startSilentAudioWatch(screen) {
  stopSilentAudioWatch(screen);
  if (!screen) return;
  const url = String(screen.activePlaybackUrl || "");
  let played = 0;
  let lastTime = null;
  screen.silentAudioTimer = setInterval(() => {
    if (String(screen.activePlaybackUrl || "") !== url) {
      stopSilentAudioWatch(screen);
      return;
    }
    // Looked up on every check: on the first source the <video> is created
    // after this starts.
    const video = globalThis.document?.querySelector?.("#videoPlayer");
    if (!video) return;
    if (typeof video.webkitAudioDecodedByteCount !== "number") {
      stopSilentAudioWatch(screen); // Safari / Firefox: no way to tell
      return;
    }
    if (video.paused || video.seeking || video.readyState < 3) {
      lastTime = null;
      return;
    }
    const now = Number(video.currentTime || 0);
    if (lastTime != null && now > lastTime && now - lastTime < 3) played += now - lastTime;
    lastTime = now;
    const decoded = Number(video.webkitAudioDecodedByteCount);
    if (decoded > 0) {
      // Sound is coming through: nothing to do for this source.
      stopSilentAudioWatch(screen);
      return;
    }
    if (!isSilentPlayback({ decodedAudioBytes: decoded, playedSeconds: played })) return;
    stopSilentAudioWatch(screen);
    void switchAwayFromSilentSource(screen);
  }, CHECK_EVERY_MS);
}

async function switchAwayFromSilentSource(screen) {
  // The Dub β plays its own sound over a muted movie: nothing to fix then.
  if (screen.dubAudio?.active) return;
  const current = screen.getCurrentStreamCandidate?.() || null;
  const silent = screen.silentSourceKeys || (screen.silentSourceKeys = new Set());
  if (current) silent.add(candidateKey(current));
  screen.silentSourceSwitches = Number(screen.silentSourceSwitches || 0) + 1;
  const ordered = screen.getOrderedStreamCandidates?.() || screen.streamCandidates || [];
  const next =
    screen.silentSourceSwitches <= MAX_SWITCHES
      ? nextSourceWithSound(ordered, current, silent)
      : null;
  if (!next) {
    screen.showAspectToast?.(
      "Esta fonte está sem som neste navegador (áudio Dolby). Escolha outra fonte, use o Dub β ou abra no Edge.",
      6000
    );
    return;
  }
  screen.showAspectToast?.(
    "Fonte sem som neste navegador (áudio Dolby). Trocando para outra…",
    3500
  );
  await screen.playStreamCandidate?.(next, { preservePlaybackState: true });
}
