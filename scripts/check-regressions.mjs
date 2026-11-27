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

async function startAppServer(port) {
  const child = spawn(process.execPath, [path.join(rootDir, "scripts", "serve.mjs")], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NUVIO_PASSWORD: PASSWORD,
      NUVIO_DISABLE_MEDIA_RUNTIME: "1",
      NUVIO_PROXY_ALLOW_LOOPBACK: "1"
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
      settings.includes("const profileId = sharedProfileId();");
    if (!ok) return "a store no longer resolves to sharedProfileId()";
  });

  // ---- Unit tests --------------------------------------------------------
  const tests = await run(process.execPath, [
    "--test",
    "scripts/test-profile-scoped-store-cache.mjs",
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
  const appPort = await freePort();
  let app;
  try {
    app = await startAppServer(appPort);
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
  } finally {
    app?.child.kill();
    echo.server.close();
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
