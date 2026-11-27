// Full screen button of the browser player (B27).
//
// - Android / desktop: the whole page goes full screen; on phones the screen
//   also locks to landscape so the movie fills the phone sideways.
// - iPhone: pages cannot go full screen, only the video element can, through
//   the system player, which rotates with the phone.

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function isBrowserFullscreen() {
  return Boolean(fullscreenElement());
}

function isPhoneLayout() {
  return document.documentElement.getAttribute("data-layout") === "mobile";
}

export async function toggleBrowserFullscreen(video = null) {
  if (fullscreenElement()) {
    try {
      globalThis.screen?.orientation?.unlock?.();
    } catch (_) {
      // Orientation lock is not supported everywhere.
    }
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    await Promise.resolve(exit?.call(document)).catch(() => {});
    return false;
  }
  const root = document.documentElement;
  if (typeof root.requestFullscreen === "function") {
    const entered = await root
      .requestFullscreen({ navigationUI: "hide" })
      .then(() => true)
      .catch(() => false);
    if (entered) {
      if (isPhoneLayout()) {
        await Promise.resolve(globalThis.screen?.orientation?.lock?.("landscape")).catch(() => {});
      }
      return true;
    }
  }
  if (typeof root.webkitRequestFullscreen === "function") {
    root.webkitRequestFullscreen();
    return true;
  }
  if (video && typeof video.webkitEnterFullscreen === "function") {
    video.webkitEnterFullscreen();
    return true;
  }
  return false;
}
