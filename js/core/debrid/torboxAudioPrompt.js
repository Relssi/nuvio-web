// Bridge between the TorBox resolver (core) and the "choose audio" window
// (UI, js/ui/components/torboxAudioChoiceDialog.js), B34. The UI registers a
// function; without one (TV apps, tests) the resolver never waits.
let promptHandler = null;

export function setTorboxAudioPrompt(handler) {
  promptHandler = typeof handler === "function" ? handler : null;
}

// Resolves to { index } with the chosen track, or { cancelled: true }.
export async function askTorboxAudio(request) {
  if (!promptHandler) {
    return { index: request?.suggested ?? 0 };
  }
  try {
    const answer = await promptHandler(request);
    if (answer?.cancelled) return { cancelled: true };
    const index = Number(answer?.index);
    return { index: Number.isFinite(index) && index >= 0 ? index : (request?.suggested ?? 0) };
  } catch (_) {
    return { index: request?.suggested ?? 0 };
  }
}
