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
    // Desktop-only styles must not reach the phone layout (B44): the hover
    // hero, for one, kept the phone hero invisible.
    if (html.getAttribute("data-desktop-web") === "1" && html.classList) {
      html.classList.toggle("desktop-web", layout !== "mobile");
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

  // Phone layout: swiping the hero sideways shows the next / previous title
  // of the same row, like CineRotten's featured carousel (B29). The hero
  // follows the focused card, so the swipe moves the focus along the row.
  var swipeStart = null;

  // The Home screen moves its own focus (it keeps track of the focused card);
  // it listens for this event in homeScreenMethods-19.
  function moveHeroBy(step, hero) {
    var target = hero || document.querySelector(".home-screen-shell .home-hero-modern");
    if (!target || typeof CustomEvent !== "function") {
      return;
    }
    target.dispatchEvent(new CustomEvent("nuvio:phone-hero-swipe", { bubbles: true, detail: { step: step } }));
  }

  document.addEventListener(
    "touchstart",
    function heroSwipeStart(event) {
      swipeStart = null;
      if (html.getAttribute("data-layout") !== "mobile" || !event.touches || event.touches.length !== 1) {
        return;
      }
      var target = event.target;
      if (!target || !target.closest || !target.closest(".home-screen-shell .home-hero-modern")) {
        return;
      }
      swipeStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    "touchend",
    function heroSwipeEnd(event) {
      var start = swipeStart;
      swipeStart = null;
      if (!start || !event.changedTouches || !event.changedTouches.length) {
        return;
      }
      var dx = event.changedTouches[0].clientX - start.x;
      var dy = event.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) {
        return;
      }
      moveHeroBy(dx < 0 ? 1 : -1);
    },
    { capture: true, passive: true }
  );

  root.__NUVIO_MOVE_PHONE_HERO__ = moveHeroBy;

  // Carousel drag (B32): rows of posters, episodes and cast follow a finger
  // (phone) or a held mouse button (computer) and keep gliding on release.
  // The page handles this itself instead of relying on the browser's own
  // horizontal scrolling, which some phones did not start inside the app.
  var DRAG_TRACKS =
    ".home-track, .home-grid-track, .series-episode-track, .series-cast-track, .movie-cast-track, .search-results-track, .seeall-track";
  var drag = null;
  var suppressClickUntil = 0;

  function dragTrackFor(target) {
    var track = target && target.closest ? target.closest(DRAG_TRACKS) : null;
    if (!track || track.scrollWidth <= track.clientWidth + 2) {
      return null;
    }
    return track;
  }

  function stopGlide(state) {
    if (state && state.glide) {
      cancelAnimationFrame(state.glide);
      state.glide = 0;
    }
  }

  document.addEventListener(
    "pointerdown",
    function carouselDragStart(event) {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      if (event.pointerType === "touch" && html.getAttribute("data-layout") !== "mobile") {
        return;
      }
      var track = dragTrackFor(event.target);
      if (!track) {
        return;
      }
      stopGlide(drag);
      drag = {
        track: track,
        id: event.pointerId,
        type: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: track.scrollLeft,
        lastX: event.clientX,
        lastT: performance.now(),
        velocity: 0,
        moved: false,
        horizontal: null,
        glide: 0
      };
    },
    true
  );

  document.addEventListener(
    "pointermove",
    function carouselDragMove(event) {
      if (!drag || event.pointerId !== drag.id) {
        return;
      }
      var dx = event.clientX - drag.startX;
      var dy = event.clientY - drag.startY;
      if (drag.horizontal === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
          return;
        }
        drag.horizontal = Math.abs(dx) > Math.abs(dy);
        if (!drag.horizontal) {
          drag = null;
          return;
        }
        drag.moved = true;
        drag.track.classList.add("is-carousel-dragging");
      }
      var now = performance.now();
      var dt = Math.max(1, now - drag.lastT);
      drag.velocity = (event.clientX - drag.lastX) / dt;
      drag.lastX = event.clientX;
      drag.lastT = now;
      drag.track.scrollLeft = drag.startLeft - dx;
      if (event.cancelable) {
        event.preventDefault();
      }
    },
    { capture: true, passive: false }
  );

  function carouselDragEnd(event) {
    if (!drag || event.pointerId !== drag.id) {
      return;
    }
    var state = drag;
    drag = null;
    state.track.classList.remove("is-carousel-dragging");
    if (!state.moved) {
      return;
    }
    // A drag is not a tap: do not open the poster under the finger.
    suppressClickUntil = Date.now() + 400;
    var velocity = state.velocity;
    var track = state.track;
    var last = performance.now();
    function glide(now) {
      var dt = Math.max(1, now - last);
      last = now;
      velocity *= Math.pow(0.94, dt / 16);
      if (Math.abs(velocity) < 0.02) {
        state.glide = 0;
        return;
      }
      track.scrollLeft -= velocity * dt;
      state.glide = requestAnimationFrame(glide);
    }
    if (Math.abs(velocity) > 0.1) {
      state.glide = requestAnimationFrame(glide);
    }
  }

  document.addEventListener("pointerup", carouselDragEnd, true);
  document.addEventListener("pointercancel", carouselDragEnd, true);

  root.addEventListener(
    "click",
    function swallowClickAfterDrag(event) {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true
  );

  // Holding the mouse on a poster image would start dragging the image.
  document.addEventListener(
    "dragstart",
    function noImageDragInTracks(event) {
      if (dragTrackFor(event.target)) {
        event.preventDefault();
      }
    },
    true
  );

  // Phone back button (B44): some screens (Addons, Discover, settings
  // pages...) have neither the bottom tab bar nor their own "Voltar" button,
  // and a phone has no remote with a Back key. Show a floating "Voltar" there;
  // it goes back through the browser history, which the app's router follows.
  var NO_BACK_SCREENS = { home: 1, player: 1, account: 1, authQrSignIn: 1, profileSelection: 1 };
  var backButton = null;

  function isShown(element) {
    if (!element) {
      return false;
    }
    var rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && root.getComputedStyle(element).visibility !== "hidden";
  }

  function activeScreen() {
    var screens = document.querySelectorAll(".screen");
    for (var i = screens.length - 1; i >= 0; i -= 1) {
      if (isShown(screens[i])) {
        return screens[i];
      }
    }
    return null;
  }

  function updatePhoneBackButton() {
    var screen = html.getAttribute("data-layout") === "mobile" ? activeScreen() : null;
    var needed = Boolean(
      screen &&
        !NO_BACK_SCREENS[screen.id] &&
        !isShown(screen.querySelector(".home-sidebar")) &&
        !isShown(screen.querySelector(".nuvio-web-back-btn")) &&
        !document.querySelector(".nuvio-dialog-backdrop.nuvio-dialog-backdrop-enter")
    );
    if (!needed) {
      if (backButton) {
        backButton.style.display = "none";
      }
      return;
    }
    if (!backButton) {
      backButton = document.createElement("button");
      backButton.type = "button";
      backButton.className = "nuvio-phone-back-btn";
      backButton.setAttribute("aria-label", "Voltar");
      backButton.textContent = "← Voltar";
      backButton.addEventListener("click", function goBack(event) {
        event.preventDefault();
        event.stopPropagation();
        root.history.back();
      });
      document.body.appendChild(backButton);
    }
    backButton.style.display = "";
  }

  root.setInterval(updatePhoneBackButton, 400);
})();
