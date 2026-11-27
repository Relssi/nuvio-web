// Optional password gate for `npm run serve` when the app is exposed online.
//
// Enabled only when the NUVIO_PASSWORD environment variable is set. Every
// route (app files, the CORS proxy, /settings, /tracks) then requires a
// session cookie obtained through the login page. Without NUVIO_PASSWORD the
// server behaves exactly as before.

import crypto from "node:crypto";

const COOKIE_NAME = "nuvio_session";
const LOGIN_PATH = "/__login";
const LOGOUT_PATH = "/__logout";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const FAILED_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_BODY_BYTES = 4096;

const password = String(process.env.NUVIO_PASSWORD || "");
const enabled = password.length > 0;
// Derived from the password (plus an optional secret) so sessions survive
// restarts and are invalidated whenever the password changes.
const signingKey = crypto
  .createHash("sha256")
  .update(`nuvio-session:${process.env.NUVIO_SESSION_SECRET || ""}:${password}`)
  .digest();
const failedAttempts = new Map();

export function isAuthEnabled() {
  return enabled;
}

function sign(value) {
  return crypto.createHmac("sha256", signingKey).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function passwordMatches(candidate) {
  const a = crypto.createHash("sha256").update(String(candidate)).digest();
  const b = crypto.createHash("sha256").update(password).digest();
  return crypto.timingSafeEqual(a, b);
}

function readCookie(request, name) {
  const header = String(request.headers.cookie || "");
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch (_) {
        return "";
      }
    }
  }
  return "";
}

function hasValidSession(request) {
  const [expiresAt, signature] = readCookie(request, COOKIE_NAME).split(".");
  if (!expiresAt || !signature || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) < Date.now()) return false;
  return safeEqual(signature, sign(expiresAt));
}

function isSecureRequest(request) {
  const forwarded = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  return forwarded.split(",")[0].trim() === "https" || Boolean(request.socket?.encrypted);
}

function clientKey(request) {
  const forwarded = String(
    request.headers["cf-connecting-ip"] || request.headers["x-forwarded-for"] || ""
  );
  return forwarded.split(",")[0].trim() || request.socket?.remoteAddress || "unknown";
}

function isRateLimited(key) {
  const entry = failedAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > FAILED_WINDOW_MS) {
    failedAttempts.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(key) {
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (!entry || now - entry.firstAt > FAILED_WINDOW_MS) {
    failedAttempts.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function renderLoginPage(message = "") {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Entrar</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    background: #0d0d0f; color: #f2f2f2; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  form { width: 100%; max-width: 360px; background: #18181b; border: 1px solid #2a2a2e;
    border-radius: 16px; padding: 28px; display: grid; gap: 14px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  label { font-size: 14px; color: #a1a1aa; }
  input { width: 100%; padding: 12px 14px; font-size: 16px; border-radius: 10px;
    border: 1px solid #3f3f46; background: #0d0d0f; color: inherit; }
  input:focus { outline: 2px solid #8b5cf6; outline-offset: 1px; }
  button { padding: 12px; font-size: 16px; font-weight: 600; border: 0; border-radius: 10px;
    background: #8b5cf6; color: #fff; cursor: pointer; }
  .error { color: #f87171; font-size: 14px; margin: 0; min-height: 1em; }
</style>
</head>
<body>
<form method="post" action="${LOGIN_PATH}">
  <h1>Acesso restrito</h1>
  <label for="password">Senha</label>
  <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
  <p class="error" role="alert">${escapeHtml(message)}</p>
  <button type="submit">Entrar</button>
</form>
</body>
</html>`;
}

function sendLoginPage(response, statusCode, message) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow"
  });
  response.end(renderLoginPage(message));
}

async function readSmallBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_LOGIN_BODY_BYTES) {
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function setSessionCookie(response, request, value, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isSecureRequest(request)) {
    parts.push("Secure");
  }
  response.setHeader("Set-Cookie", parts.join("; "));
}

function redirect(response, location) {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
}

// Returns true when the request was fully handled here (login page, redirect,
// 401) and the caller must stop.
export async function handleAuth(request, response, requestUrl) {
  if (!enabled) {
    return false;
  }
  const pathname = requestUrl.pathname;
  const method = String(request.method || "GET").toUpperCase();

  if (pathname === "/healthz") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("ok");
    return true;
  }

  if (pathname === LOGOUT_PATH) {
    setSessionCookie(response, request, "", 0);
    redirect(response, LOGIN_PATH);
    return true;
  }

  if (pathname === LOGIN_PATH) {
    if (method !== "POST") {
      if (hasValidSession(request)) {
        redirect(response, "/");
      } else {
        sendLoginPage(response, 200, "");
      }
      return true;
    }
    const key = clientKey(request);
    if (isRateLimited(key)) {
      sendLoginPage(response, 429, "Muitas tentativas. Tente novamente em alguns minutos.");
      return true;
    }
    const body = await readSmallBody(request);
    const candidate = body === null ? "" : new URLSearchParams(body).get("password") || "";
    if (!candidate || !passwordMatches(candidate)) {
      recordFailure(key);
      sendLoginPage(response, 401, "Senha incorreta.");
      return true;
    }
    failedAttempts.delete(key);
    const expiresAt = String(Date.now() + SESSION_TTL_MS);
    setSessionCookie(response, request, `${expiresAt}.${sign(expiresAt)}`, SESSION_TTL_MS / 1000);
    redirect(response, "/");
    return true;
  }

  if (hasValidSession(request)) {
    return false;
  }

  const acceptsHtml = /text\/html/i.test(String(request.headers.accept || ""));
  if (method === "GET" && (pathname === "/" || pathname === "/index.html" || acceptsHtml)) {
    redirect(response, LOGIN_PATH);
    return true;
  }
  response.writeHead(401, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify({ error: "Login required" }));
  return true;
}
