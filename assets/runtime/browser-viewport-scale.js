// Proportional scaling for the browser build (docs/ANALISE-RESPONSIVO.md, phase 1).
//
// The UI is designed for a 1920x1080 TV. In a desktop/notebook browser the
// whole page is treated as a virtual canvas of about 1920x1080 and zoomed to
// fit the window, so a 1366x768 notebook and a 4K monitor show the same
// layout at a comfortable size.
//
// - Packaged TV apps (Tizen/webOS) are left untouched: they already render
//   at 1920x1080.
// - Small or portrait screens (phones, tablets standing up) are left
//   untouched for now; they get their own layout in phase 2.
// - CSS vw/vh units are rewritten at build time to
//   calc(N * var(--nuvio-vw, 1vw)); this script sets --nuvio-vw/--nuvio-vh to
//   the virtual canvas so those sizes follow the zoom too. Without the
//   variables (TV apps) they behave exactly like plain vw/vh.
(function nuvioBrowserViewportScale() {
  var root = window;
  var userAgent = String((root.navigator && root.navigator.userAgent) || "").toLowerCase();
  var isTvApp = Boolean(
    root.__NUVIO_PLATFORM__ === "tizen" ||
    root.__NUVIO_PLATFORM__ === "webos" ||
    root.tizen ||
    root.PalmSystem ||
    root.webOS ||
    userAgent.indexOf("tizen") !== -1 ||
    userAgent.indexOf("web0s") !== -1 ||
    userAgent.indexOf("webos") !== -1
  );
  if (isTvApp) {
    return;
  }

  var DESIGN_WIDTH = 1920;
  var DESIGN_HEIGHT = 1080;
  // Below this the screen is a phone or a tablet standing up (phase 2).
  var MIN_WIDTH = 1000;
  var MIN_HEIGHT = 560;
  var html = document.documentElement;
  var lastKey = "";

  function clear() {
    html.style.zoom = "";
    html.style.removeProperty("--nuvio-vw");
    html.style.removeProperty("--nuvio-vh");
    html.removeAttribute("data-viewport-scale");
  }

  // css/mobile.css styles phones and standing tablets through
  // html[data-layout="mobile"] (phase 2 of docs/ANALISE-RESPONSIVO.md).
  function setLayout(layout) {
    if (html.getAttribute("data-layout") !== layout) {
      html.setAttribute("data-layout", layout);
    }
  }

  function apply() {
    var width = Number(root.innerWidth) || 0;
    var height = Number(root.innerHeight) || 0;
    var key = width + "x" + height;
    if (key === lastKey) {
      return;
    }
    lastKey = key;
    if (width < MIN_WIDTH || height < MIN_HEIGHT) {
      clear();
      setLayout("mobile");
      return;
    }
    var scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
    scale = Math.round(scale * 1000) / 1000;
    if (!(scale > 0)) {
      clear();
      setLayout("mobile");
      return;
    }
    setLayout("desktop");
    html.style.zoom = String(scale);
    // Size of the virtual canvas in CSS px; zoom maps it back to the window.
    html.style.setProperty("--nuvio-vw", width / scale / 100 + "px");
    html.style.setProperty("--nuvio-vh", height / scale / 100 + "px");
    html.setAttribute("data-viewport-scale", String(scale));
  }

  root.__NUVIO_APPLY_VIEWPORT_SCALE__ = function reapply() {
    lastKey = "";
    apply();
  };
  apply();
  root.addEventListener("resize", apply);
  root.addEventListener("orientationchange", apply);

  // Phone layout: the Home hero card (with its "Ver detalhes" button drawn by
  // css/mobile.css) opens the title it is showing, which is the focused card.
  document.addEventListener(
    "click",
    function openHeroTitleOnPhone(event) {
      if (html.getAttribute("data-layout") !== "mobile") {
        return;
      }
      var target = event.target;
      var hero = target && target.closest ? target.closest(".home-screen-shell .home-hero-modern") : null;
      if (!hero) {
        return;
      }
      var card =
        document.querySelector(".home-screen-shell .home-content-card.focused") ||
        document.querySelector(".home-screen-shell .home-content-card");
      if (card && typeof card.click === "function") {
        event.preventDefault();
        event.stopPropagation();
        card.click();
      }
    },
    true
  );
})();
