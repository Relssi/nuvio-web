// Regression checks for the web build. Run before every change/push:
//
//   node scripts/check-regressions.mjs            (builds first)
//   node scripts/check-regressions.mjs --no-build (reuses dist/)
//
// Each check names the docs/BUGS.md entry it protects. Exit code 1 on failure.

import http from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const skipBuild = process.argv.includes("--no-build");
const PASSWORD = "regression-check-password";

const results = [];
function record(id, name, ok, detail = "") {
  results.push({ id, name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${id}  ${name}${!ok && detail ? `\n        ${detail}` : ""}`
  );
}

async function check(id, name, fn) {
  try {
    const detail = await fn();
    record(
      id,
      name,
      detail === true || detail === undefined,
      typeof detail === "string" ? detail : ""
    );
  } catch (error) {
    record(id, name, false, String(error?.message || error));
  }
}

function run(command, args, { env = {}, quiet = true } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, ...env },
      // Only .cmd shims (npm.cmd) need a shell on Windows; node itself must
      // not go through one because its path contains spaces.
      shell: /\.cmd$/i.test(command),
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
  });
}

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port))
  );
}

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startEchoServer() {
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8")
      })
    );
  });
  const port = await listen(server);
  return { server, port };
}

const FAKE_ANON_KEY = "fake-anon-key";
const FAKE_SERVICE_KEY = "fake-service-role-key";

// Minimal stand-in for Supabase Auth (GoTrue), enough for householdSession.mjs.
// It starts with the household account already present but with a stale
// password, so the "reset password" path is exercised too.
async function startFakeSupabase() {
  const users = new Map([
    ["nuvio-household@example.com", { id: "user-household", password: "stale-password" }]
  ]);
  let tokenCounter = 0;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    const url = new URL(request.url, "http://fake");
    const bearer = String(request.headers.authorization || "").replace(/^Bearer /, "");
    const send = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      if (bearer !== FAKE_ANON_KEY) return send(401, { message: "bad apikey" });
      const user = users.get(String(body.email || "").toLowerCase());
      if (!user || user.password !== body.password) return send(400, { error: "invalid_grant" });
      tokenCounter += 1;
      const claims = Buffer.from(JSON.stringify({ sub: user.id, role: "authenticated" })).toString(
        "base64url"
      );
      return send(200, {
        access_token: `eyJhbGciOiJIUzI1NiJ9.${claims}.sig${tokenCounter}`,
        refresh_token: `refresh-${tokenCounter}`
      });
    }
    if (url.pathname === "/rest/v1/rpc/sync_pull_profiles") {
      return send(200, [
        { profile_index: 1, name: "Relssi", avatar_url: "data:image/jpeg;base64,AAAA" }
      ]);
    }
    if (url.pathname === "/rest/v1/addons") {
      // Simulates a project that does not expose tables to the API (B18).
      return send(403, { code: "42501", message: "permission denied for table addons" });
    }
    if (url.pathname === "/rest/v1/rpc/sync_pull_addons") {
      return send(200, [{ url: "https://torrentio.strem.fun", name: "Torrentio", enabled: true }]);
    }
    if (url.pathname === "/rest/v1/rpc/sync_pull_provider_credentials") {
      return send(200, [
        { provider: "debrid:torbox", credential_json: { apiKey: "SECRET-TORBOX-KEY" } }
      ]);
    }
    if (url.pathname.startsWith("/auth/v1/admin/users")) {
      if (bearer !== FAKE_SERVICE_KEY) return send(401, { message: "not admin" });
      const id = url.pathname.split("/")[5];
      if (request.method === "POST") {
        if (users.has(body.email)) return send(422, { msg: "already registered" });
        users.set(body.email, { id: `user-${users.size + 1}`, password: body.password });
        return send(200, { id: `user-${users.size}` });
      }
      if (request.method === "GET") {
        return send(200, { users: [...users].map(([email, user]) => ({ id: user.id, email })) });
      }
      if (request.method === "PUT" && id) {
        const entry = [...users.values()].find((user) => user.id === id);
        if (!entry) return send(404, {});
        entry.password = body.password;
        return send(200, { id });
      }
    }
    send(404, { message: "not found" });
  });
  const port = await listen(server);
  return { server, url: `http://127.0.0.1:${port}` };
}

async function startAppServer(port, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(rootDir, "scripts", "serve.mjs")], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NUVIO_PASSWORD: PASSWORD,
      NUVIO_DISABLE_MEDIA_RUNTIME: "1",
      NUVIO_PROXY_ALLOW_LOOPBACK: "1",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return { child, base, getLog: () => log };
    } catch (_) {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`serve.mjs did not start:\n${log}`);
}

const encodeHeaders = (headers) => Buffer.from(JSON.stringify(headers)).toString("base64");

async function main() {
  // ---- Build -------------------------------------------------------------
  if (!skipBuild) {
    console.log("Building (npm run build)...");
    const build = await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
    record("BUILD", "npm run build", build.code === 0, build.output.slice(-800));
    if (build.code !== 0) return;
  }

  // ---- Static source checks ---------------------------------------------
  const source = async (file) => readFile(path.join(rootDir, file), "utf8");
  await check("B05", "proxy requests send the session cookie", async () => {
    const text = await source("js/core/network/browserProxy.js");
    const block = text.slice(text.indexOf("export function fetchViaBrowserProxy"));
    if (!/credentials:\s*"same-origin"/.test(block.slice(0, 1500))) {
      return 'fetchViaBrowserProxy must use credentials: "same-origin"';
    }
  });
  await check("B01", "httpClient falls back to the proxy on CORS", async () => {
    const text = await source("js/core/network/httpClient.js");
    if (!text.includes("fetchWithBrowserCorsFallback(url, fetchInit)")) {
      return "httpClient.js no longer uses fetchWithBrowserCorsFallback";
    }
  });
  await check("B01", "plugin fetches go through the proxy in the browser", async () => {
    const text = await source("js/platform/pluginServiceClient.js");
    if (!text.includes("fetchViaBrowserProxy(validation.url")) {
      return "pluginServiceClient.js no longer uses fetchViaBrowserProxy";
    }
  });
  await check("B03", "debrid API calls fall back to the proxy", async () => {
    const text = await source("js/data/remote/api/debridApi.js");
    if (!text.includes("fetchWithBrowserCorsFallback(url, init)")) {
      return "debridApi.js no longer uses fetchWithBrowserCorsFallback";
    }
  });
  await check("B07", "profile editor has the photo upload", async () => {
    const overlay = await source(
      "js/core/profile/profileSelectionScreenMethods-02-render-editor-overlay.js"
    );
    const actions = await source(
      "js/core/profile/profileSelectionScreenMethods-07-activate-focused-node.js"
    );
    if (
      !overlay.includes('data-action="upload-avatar"') ||
      !actions.includes("pickAvatarImage()")
    ) {
      return "upload-avatar button or handler missing";
    }
  });
  await check("B08", "addons/plugins/settings resolve to the shared profile", async () => {
    const addons = await source("js/data/repository/addonRepository.js");
    const plugins = await source("js/data/local/pluginStore.js");
    const settings = await source("js/data/local/profileScopedStore.js");
    const ok =
      /getActiveStorageProfileId\(_profileId = null\) \{\s*\/\/[^\n]*\n\s*return sharedProfileId\(\);/.test(
        addons
      ) &&
      /getEffectivePluginProfileId\(_profileId = null\) \{\s*\/\/[^\n]*\n\s*return sharedProfileId\(\);/.test(
        plugins
      ) &&
      settings.includes("isGeneral ? sharedProfileId() : normalizeProfileId(profileId)");
    if (!ok) return "a store no longer resolves general settings to sharedProfileId()";
  });

  await check("B15", "only the primary profile changes general settings", async () => {
    const addons = await source("js/data/repository/addonRepository.js");
    const library = await source("js/core/profile/librarySyncService.js");
    const plugins = await source("js/core/profile/pluginSyncService.js");
    const sections = await source(
      "js/ui/screens/settings/settingsScreenHelpers-08-update-settings-scroll-indicators.js"
    );
    const problems = [];
    if (!/canEdit\(_profileId = null\) \{[^}]*return isPrimaryProfileActive\(\);/.test(addons)) {
      problems.push("addonRepository.canEdit must require the primary profile");
    }
    if (!/if \(!isPrimaryProfileActive\(\)\) \{\s*return true;\s*\}\s*const urls/.test(library)) {
      problems.push("addon cloud push must be primary-only");
    }
    if (
      !/async push\(profileId = null\) \{[\s\S]{0,200}if \(!isPrimaryProfileActive\(\)\)/.test(
        plugins
      )
    ) {
      problems.push("plugin cloud push must be primary-only");
    }
    for (const id of ["contentDiscovery", "plugins", "integration", "streams"]) {
      if (
        !sections.includes(`"${id}"`) ||
        !sections.includes("GENERAL_SETTINGS_SECTION_IDS.has(section.id)")
      ) {
        problems.push(`settings section ${id} must be hidden for other profiles`);
      }
    }
    return problems.length ? problems.join("; ") : true;
  });
  await check("B15", "stage 3 SQL keeps general settings on the primary profile", async () => {
    const sql = await source("docs/supabase/03-general-vs-personal.sql");
    const needed = [
      "nuvio_general_features",
      "nuvio_settings_blobs",
      "if v_profile <> 1 then",
      "if coalesce(p_profile_id, 1) <> 1 then return; end if;"
    ];
    const missing = needed.filter((text) => !sql.includes(text));
    if (missing.length) return `missing in SQL: ${missing.join(", ")}`;
  });

  await check("B14", "cloud addon sync always uses the shared list", async () => {
    const text = await source("js/core/profile/librarySyncService.js");
    const block = text.slice(text.indexOf("async function resolveAddonProfileId"));
    if (!/return Number\(sharedProfileId\(\)\);/.test(block.slice(0, 400))) {
      return "resolveAddonProfileId must return the shared profile id";
    }
    if (/if \(requestedProfileId !== profileId\) \{\s*return true;/.test(text)) {
      return "push still skips secondary profiles";
    }
  });
  await check("B14", "stage 2 SQL keeps settings/credentials/addons shared", async () => {
    const sql = await source("docs/supabase/02-shared-addons-settings.sql");
    const needed = [
      "sync_push_addons",
      "sync_push_plugins",
      "sync_pull_profile_settings_blob",
      "sync_push_profile_settings_blob",
      "sync_pull_provider_credentials",
      "sync_push_provider_credentials",
      "sync_seed_provider_credentials",
      "nuvio_force_shared_profile"
    ];
    const missing = needed.filter((name) => !sql.includes(name));
    if (missing.length) return `missing in SQL: ${missing.join(", ")}`;
  });

  await check("B16", "build rewrites every vw/vh to follow the browser scale", async () => {
    const css = await source("dist/css/bundle.css");
    const rewritten = (css.match(/var\(--nuvio-v[wh],\s*1v[wh]\)/g) || []).length;
    const raw = (css.match(/[^0-9a-z.(-]-?\d*\.?\d+v[wh]/gi) || []).filter(
      (match) => !/^.1v[wh]$/.test(match)
    );
    if (rewritten < 100) return `only ${rewritten} rewritten units in dist/css/bundle.css`;
    if (raw.length)
      return `${raw.length} vw/vh left unrewritten, e.g. ${raw.slice(0, 3).join(" ")}`;
    const build = await source("scripts/build.mjs");
    if (!build.includes(String.raw`/var\(--nuvio-v[wh]\b/i.test(text)`)) {
      return "rewriteViewportUnits lost its idempotency guard (infinite build loop)";
    }
  });
  await check("B17", "browser scaling is loaded and skips TV apps and phones", async () => {
    const html = await source("dist/index.html");
    const script = await source("assets/runtime/browser-viewport-scale.js");
    const problems = [];
    if (!html.includes("assets/runtime/browser-viewport-scale.js"))
      problems.push("script not in dist/index.html");
    for (const needle of [
      "root.tizen",
      "root.PalmSystem",
      "MIN_WIDTH = 1000",
      "html.style.zoom",
      "--nuvio-vw"
    ]) {
      if (!script.includes(needle)) problems.push(`missing ${needle}`);
    }
    return problems.length ? problems.join("; ") : true;
  });

  await check("B18", "addon pull falls back to the RPC when the table read is denied", async () => {
    const text = await source("js/core/profile/librarySyncService.js");
    if (!/isTableAccessDeniedError\(addonsTableError\)[\s\S]{0,400}"sync_pull_addons"/.test(text)) {
      return "librarySyncService no longer retries sync_pull_addons after a permission error";
    }
    const sql = await source("docs/supabase/04-table-access.sql");
    if (
      !sql.includes("grant select, insert, update, delete on table public.addons to authenticated")
    ) {
      return "04-table-access.sql must grant the addons table to authenticated";
    }
  });

  await check("B19", "phone layout rules only apply on phones", async () => {
    const css = await source("css/mobile.css");
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [];
    withoutComments.replace(/([^{}]+)\{/g, (match, group) => {
      group
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((selector) => selectors.push(selector));
      return match;
    });
    // "@media (...)" is the condition of a block whose rules are checked too.
    const unscoped = selectors.filter(
      (selector) =>
        !selector.startsWith('html[data-layout="mobile"]') && !selector.startsWith("@media")
    );
    if (!selectors.length) return "css/mobile.css has no rules";
    if (unscoped.length) return `unscoped selectors: ${unscoped.slice(0, 3).join(" | ")}`;
    const script = await source("assets/runtime/browser-viewport-scale.js");
    if (!script.includes('setLayout("mobile")') || !script.includes('setLayout("desktop")')) {
      return "browser-viewport-scale.js no longer marks data-layout";
    }
    const bundle = await source("dist/css/bundle.css");
    if (!bundle.includes("html[data-layout=mobile]"))
      return "mobile rules missing from dist/css/bundle.css";
  });

  await check("B20", "phone Home: page scrolls and rows do not move by themselves", async () => {
    const css = await source("css/mobile.css");
    const problems = [];
    if (
      !/\.home-modern-rows-viewport \{[^}]*position: relative;[^}]*overflow: visible;/.test(css)
    ) {
      problems.push("rows viewport must flow in the scrolling page on phones");
    }
    if (!/\.home-main \{[^}]*overflow-y: auto;/.test(css)) {
      problems.push("home-main must scroll on phones");
    }
    const anim = await source(
      "js/ui/screens/home/homeScreenMethods-02-restore-modern-focus-state.js"
    );
    // B28 widened the guard from horizontal only to both directions.
    if (!anim.includes("if (!options?.allowOnPhone && isPhoneTouchScroll())")) {
      problems.push("animateScroll no longer blocks automatic scrolling on phones");
    }
    const hover = await source("js/ui/screens/home/homeScreenMethods-19-handle-home-dpad.js");
    if (
      !/boundHomeMouseOverHandler = \(event\) => \{[\s\S]{0,400}if \(isPhoneLayout\(\)\) \{\s*return;/.test(
        hover
      )
    ) {
      problems.push("hover focus must be disabled on phones");
    }
    return problems.length ? problems.join("; ") : true;
  });

  await check(
    "B21",
    "phone Home follows the CineRotten look and the hero opens the title",
    async () => {
      const css = await source("css/mobile.css");
      const problems = [];
      if (!css.includes("content: attr(data-item-title)"))
        problems.push("poster title overlay missing");
      if (!/\.home-nav-label \{[^}]*display: block;/.test(css))
        problems.push("bottom bar labels hidden");
      if (!css.includes("Ver detalhes")) problems.push("hero button missing");
      const script = await source("assets/runtime/browser-viewport-scale.js");
      if (!script.includes("openHeroTitleOnPhone"))
        problems.push("hero tap no longer opens the title");
      return problems.length ? problems.join("; ") : true;
    }
  );

  await check(
    "B24",
    "browser player video fills the zoomed canvas so it stays centered",
    async () => {
      const code = await source(
        "js/ui/screens/player/playerScreenMethods-64-move-sources-focus.js"
      );
      if (!/useFullViewport = [^;]*usingBrowserVideo/.test(code))
        return "browser video no longer uses the full viewport";
      if (!code.includes("var(--nuvio-vw, 1vw)"))
        return "browser video size ignores the zoomed canvas";
      return true;
    }
  );

  await check(
    "B25",
    "browser asks TorBox for its converted stream and plays it as HLS",
    async () => {
      const code = await source("js/core/debrid/directDebridResolver.js");
      if (!code.includes("requestTorboxWebStream(apiKey, torrentId, file.id"))
        return "TorBox resolve no longer asks for the converted stream";
      if (!code.includes("mimeType: result.mimeType"))
        return "converted stream is no longer marked as HLS";
      return true;
    }
  );

  await check("B26", "TorBox conversion asks for the preferred audio language", async () => {
    const code = await source("js/core/debrid/directDebridResolver.js");
    if (!code.includes("decideTorboxAudio(")) return "preferred audio track is no longer chosen";
    return true;
  });

  await check(
    "B27",
    "phone layout shrinks TV screens and the player, and has a full screen button",
    async () => {
      const problems = [];
      const css = await source("css/mobile.css");
      if (!css.includes("--mobile-ui-zoom")) problems.push("phone zoom rules missing");
      if (!css.includes("#playerUiRoot")) problems.push("player overlay not sized for phones");
      const build = await source("scripts/build.mjs");
      if (!build.includes("/^--nuvio-v[wh]$/i.test(decl.prop)"))
        problems.push("build rewrites the canvas variables themselves");
      const controls = await source(
        "js/ui/screens/player/playerScreenMethods-28-unbind-video-events.js"
      );
      if (!controls.includes('action: "fullscreen"')) problems.push("full screen button missing");
      return problems.length ? problems.join("; ") : true;
    }
  );

  await check(
    "B28",
    "touch: tapping the picture toggles the player controls; finger drags are not hovers",
    async () => {
      const problems = [];
      const player = await source(
        "js/ui/screens/player/playerScreenMethods-69-sync-pointer-focus.js"
      );
      if (!player.includes('target?.closest?.("#playerUiRoot")'))
        problems.push("taps on the player layer are ignored");
      const focus = await source("js/ui/navigation/focusEngine.js");
      if (!focus.includes('event?.pointerType === "touch"'))
        problems.push("touch drags move the focus");
      return problems.length ? problems.join("; ") : true;
    }
  );

  await check(
    "B29",
    "phone hero swipe moves the Home focus (and the hero) along the row",
    async () => {
      const runtime = await source("assets/runtime/browser-viewport-scale.js");
      if (!runtime.includes("nuvio:phone-hero-swipe")) return "hero swipe event missing";
      const home = await source("js/ui/screens/home/homeScreenMethods-19-handle-home-dpad.js");
      if (!home.includes("moveFocusFromHeroSwipe")) return "Home no longer handles the hero swipe";
      return true;
    }
  );

  await check("B30", "Brazilian Portuguese is the default audio language", async () => {
    const store = await source("js/data/local/playerSettingsStore.js");
    if (!store.includes('preferredAudioLanguage: "pt-br"')) return "default audio language changed";
    return true;
  });

  await check("B31", "series seasons, episodes and cast are phone-sized", async () => {
    const css = await source("css/mobile.css");
    if (!css.includes(":not(:has(.detail-hero-section))"))
      return "lower part of the details screen is not sized for phones";
    return true;
  });

  await check("B32", "rows follow a finger or mouse drag like a carousel", async () => {
    const runtime = await source("assets/runtime/browser-viewport-scale.js");
    if (!runtime.includes("carouselDragStart")) return "carousel drag missing";
    if (!runtime.includes("swallowClickAfterDrag")) return "a drag would open the poster";
    return true;
  });

  await check("B33", "Discover / See all show three posters per row on phones", async () => {
    const css = await source("css/mobile.css");
    if (!/\.seeall-grid \{[^}]*repeat\(3/.test(css)) return "phone grid is not three columns";
    return true;
  });

  await check("B35", "dubbed sources first and confirmed in the background", async () => {
    const ordering = await source("js/core/streams/streamOrdering.js");
    if (!ordering.includes("export function preferDubbedStreams"))
      return "dubbed-first ordering missing";
    if (/[\u0000-\u0008]/.test(ordering)) return "control character in streamOrdering.js";
    const helpers = await source(
      "js/ui/screens/stream/streamScreenHelpers-03-render-image-badge-chip.js"
    );
    if (!helpers.includes("preferDubbedStreams(")) return "source list is not dubbed-first";
    const loader = await source("js/ui/screens/stream/streamScreenMethods-04-load-streams.js");
    if (!loader.includes("checkDubbedSourcesInBackground("))
      return "background dub check not started";
    const resolver = await source("js/core/debrid/directDebridResolver.js");
    if (!resolver.includes("probePreferredAudio(")) return "TorBox audio probe missing";
    return true;
  });

  // ---- Unit tests --------------------------------------------------------
  const tests = await run(process.execPath, [
    "--test",
    "js/core/streams/dubbedStreamOrdering.test.mjs",
    "js/core/debrid/torboxAudioChoice.test.mjs",
    "js/core/debrid/torboxWebStream.test.mjs",
    "scripts/test-profile-scoped-store-cache.mjs",
    "scripts/test-general-settings-store.mjs",
    "scripts/test-supports-root-dedupe.mjs",
    "scripts/test-flex-gap-fallback-selectors.mjs",
    "js/core/network/httpClientCooldown.test.mjs",
    "js/data/remote/api/debridApiTimeout.test.mjs",
    "scripts/test-plugin-service-lifecycle.mjs"
  ]);
  record(
    "B08",
    "unit tests (profile store, http client, debrid, plugins)",
    tests.code === 0,
    tests.output.slice(-1500)
  );

  // ---- Live server checks -----------------------------------------------
  const echo = await startEchoServer();
  const fakeSupabase = await startFakeSupabase();
  const appPort = await freePort();
  let app;
  try {
    app = await startAppServer(appPort, {
      NUVIO_SUPABASE_URL: fakeSupabase.url,
      NUVIO_SUPABASE_ANON_KEY: FAKE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE_KEY
    });
    const echoUrl = `http://127.0.0.1:${echo.port}/echo`;
    const proxyUrl = (target) => `${app.base}/__nuvio_proxy?url=${encodeURIComponent(target)}`;

    await check("B06", "site redirects to the login page without a session", async () => {
      const response = await fetch(`${app.base}/`, {
        redirect: "manual",
        headers: { Accept: "text/html" }
      });
      if (
        response.status !== 302 ||
        !String(response.headers.get("location")).includes("/__login")
      ) {
        return `expected 302 to /__login, got ${response.status} ${response.headers.get("location")}`;
      }
    });
    await check("B06", "proxy refuses requests without a session", async () => {
      const response = await fetch(proxyUrl(echoUrl));
      if (response.status !== 401) return `expected 401, got ${response.status}`;
    });
    await check("B06", "wrong password is rejected", async () => {
      const response = await fetch(`${app.base}/__login`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "password=wrong"
      });
      if (response.status !== 401) return `expected 401, got ${response.status}`;
    });

    const login = await fetch(`${app.base}/__login`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(PASSWORD)}`
    });
    const cookie = String(login.headers.get("set-cookie") || "").split(";")[0];
    record(
      "B06",
      "correct password logs in",
      login.status === 302 && cookie.startsWith("nuvio_session="),
      `status ${login.status}`
    );
    const withCookie = (init = {}) => ({
      ...init,
      headers: { ...(init.headers || {}), Cookie: cookie }
    });

    await check("B01", "nuvio.env.js enables the proxy and browser plugins", async () => {
      const text = await (await fetch(`${app.base}/nuvio.env.js`, withCookie())).text();
      if (
        !text.includes("__NUVIO_WEB_PROXY__") ||
        !text.includes("__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__ = true")
      ) {
        return "web dev flags missing from nuvio.env.js";
      }
    });
    await check("B05", "proxy works with the session cookie and forwards headers", async () => {
      const response = await fetch(
        proxyUrl(echoUrl),
        withCookie({
          headers: {
            "X-Nuvio-Proxy-Headers": encodeHeaders({
              "User-Agent": "RegressionUA/1",
              Referer: "https://example.com/"
            })
          }
        })
      );
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      const echoed = await response.json();
      if (
        echoed.headers["user-agent"] !== "RegressionUA/1" ||
        echoed.headers.referer !== "https://example.com/"
      ) {
        return `headers not forwarded: ${JSON.stringify(echoed.headers)}`;
      }
    });
    await check(
      "B04",
      "multipart form bodies keep their content type through the proxy",
      async () => {
        const form = new FormData();
        form.set("magnet", "magnet:?xt=urn:btih:regression");
        form.set("add_only_if_cached", "true");
        const response = await fetch(proxyUrl(echoUrl), withCookie({ method: "POST", body: form }));
        const echoed = await response.json();
        const contentType = String(echoed.headers["content-type"] || "");
        if (!/^multipart\/form-data; boundary=/.test(contentType))
          return `content-type lost: "${contentType}"`;
        if (!echoed.body.includes("magnet:?xt=urn:btih:regression"))
          return "form field missing from body";
      }
    );
    await check("B02", "proxy refuses metadata/link-local targets", async () => {
      const response = await fetch(
        proxyUrl("http://169.254.169.254/latest/meta-data"),
        withCookie()
      );
      if (response.status !== 403) return `expected 403, got ${response.status}`;
    });
    await check("BUILD", "app bundle is served after login", async () => {
      const response = await fetch(`${app.base}/app.bundle.js`, withCookie());
      if (response.status !== 200) return `expected 200, got ${response.status}`;
    });

    await check("B11", "automatic sign-in requires the site password", async () => {
      const response = await fetch(`${app.base}/__auto_session`);
      if (response.status !== 401) return `expected 401 without a session, got ${response.status}`;
    });
    await check("B11", "automatic sign-in returns a household session", async () => {
      const response = await fetch(`${app.base}/__auto_session`, withCookie());
      if (response.status !== 200) {
        return `expected 200, got ${response.status}: ${await response.text()}\n${app.getLog().slice(-600)}`;
      }
      const session = await response.json();
      if (!session.access_token || !session.refresh_token) return "tokens missing";
    });
    await check("B11", "nuvio.env.js signs a new browser in before the app starts", async () => {
      const text = await (await fetch(`${app.base}/nuvio.env.js`, withCookie())).text();
      if (!text.includes("nuvioHouseholdAutoSession") || !text.includes('"/__auto_session"')) {
        return "auto sign-in snippet missing from nuvio.env.js";
      }
      if (text.includes(FAKE_SERVICE_KEY)) return "service role key leaked into nuvio.env.js";
      if (!text.includes("__nuvioAuthDebugLog"))
        return "login history (B13) missing from nuvio.env.js";
    });
    await check("B12", "status page needs the site password", async () => {
      const response = await fetch(`${app.base}/__status`);
      if (response.status !== 401) return `expected 401 without a session, got ${response.status}`;
    });
    await check("B12", "status page shows Supabase profiles without leaking keys", async () => {
      const response = await fetch(`${app.base}/__status`, withCookie());
      const html = await response.text();
      if (response.status !== 200) return `expected 200, got ${response.status}`;
      if (html.includes(FAKE_SERVICE_KEY) || html.includes(FAKE_ANON_KEY)) {
        return "a key leaked into /__status";
      }
      if (!html.includes("1. Relssi (foto)")) return "profiles from Supabase not listed";
      if (!html.includes("user-household")) return "household account id missing";
      if (!html.includes("1: Torrentio")) return "saved addons not listed";
      if (!html.includes("conectado: torbox")) return "TorBox connection not shown";
      if (!html.includes("04-table-access.sql")) return "denied table read (B18) not reported";
      if (html.includes("SECRET-TORBOX-KEY")) return "TorBox credential leaked into /__status";
    });
  } finally {
    app?.child.kill();
    echo.server.close();
    fakeSupabase.server.close();
  }
}

main()
  .catch((error) => record("RUN", "check script crashed", false, String(error?.stack || error)))
  .finally(() => {
    const failed = results.filter((entry) => !entry.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length) {
      console.log("See docs/BUGS.md for the failing entries.");
      process.exitCode = 1;
    }
  });
