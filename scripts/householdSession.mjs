// Automatic sign-in to one shared "household" Supabase account.
//
// People only type the site password (serveAuth.mjs) and then pick their
// profile ("Who's watching?"). Behind the scenes this server signs each
// new browser in to a single Supabase account, so nobody types an e-mail.
// Each person is a profile, and the app keeps history/library per profile.
//
// Enabled when NUVIO_SUPABASE_URL, NUVIO_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY and NUVIO_PASSWORD are all set. The service
// role key stays on this server; the browser only receives a normal user
// session (access + refresh token) for the household account.

import crypto from "node:crypto";
import { isAuthEnabled } from "./serveAuth.mjs";

const SESSION_PATH = "/__auto_session";

const supabaseUrl = String(process.env.NUVIO_SUPABASE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const anonKey = String(process.env.NUVIO_SUPABASE_ANON_KEY || "").trim();
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const householdEmail = String(process.env.NUVIO_HOUSEHOLD_EMAIL || "nuvio-household@example.com")
  .trim()
  .toLowerCase();
// Deterministic, never shown to anyone, and changes if the service key does.
const householdPassword = crypto
  .createHmac("sha256", serviceKey || "unset")
  .update("nuvio-household-password-v1")
  .digest("hex");

let ensurePromise = null;

export function isHouseholdSessionEnabled() {
  return Boolean(supabaseUrl && anonKey && serviceKey && isAuthEnabled());
}

async function authRequest(pathAndQuery, { method = "GET", body, admin = false } = {}) {
  const key = admin ? serviceKey : anonKey;
  const response = await fetch(`${supabaseUrl}/auth/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { message: text };
  }
  return { ok: response.ok, status: response.status, data };
}

function signInWithPassword() {
  return authRequest("token?grant_type=password", {
    method: "POST",
    body: { email: householdEmail, password: householdPassword }
  });
}

async function findHouseholdUserId() {
  for (let page = 1; page <= 20; page += 1) {
    const result = await authRequest(`admin/users?page=${page}&per_page=200`, { admin: true });
    if (!result.ok) {
      throw new Error(`Could not list users (${result.status})`);
    }
    const users = Array.isArray(result.data?.users) ? result.data.users : [];
    const match = users.find((user) => String(user?.email || "").toLowerCase() === householdEmail);
    if (match) return match.id;
    if (users.length < 200) return null;
  }
  return null;
}

// Makes sure the household account exists and has the expected password.
async function ensureHouseholdAccount() {
  const created = await authRequest("admin/users", {
    method: "POST",
    admin: true,
    body: { email: householdEmail, password: householdPassword, email_confirm: true }
  });
  if (created.ok) {
    console.log(`[household] created account ${householdEmail}`);
    return;
  }
  // Already exists: reset the password so it matches this server.
  const userId = await findHouseholdUserId();
  if (!userId) {
    throw new Error(
      `Could not create household account (${created.status}): ${JSON.stringify(created.data).slice(0, 200)}`
    );
  }
  const updated = await authRequest(`admin/users/${userId}`, {
    method: "PUT",
    admin: true,
    body: { password: householdPassword, email_confirm: true }
  });
  if (!updated.ok) {
    throw new Error(`Could not update household account (${updated.status})`);
  }
  console.log(`[household] reset password of ${householdEmail}`);
}

async function createSession() {
  let result = await signInWithPassword();
  if (!result.ok && (result.status === 400 || result.status === 401)) {
    if (!ensurePromise) {
      ensurePromise = ensureHouseholdAccount().finally(() => {
        ensurePromise = null;
      });
    }
    await ensurePromise;
    result = await signInWithPassword();
  }
  if (!result.ok || !result.data?.access_token || !result.data?.refresh_token) {
    throw new Error(`Household sign-in failed (${result.status})`);
  }
  return {
    access_token: result.data.access_token,
    refresh_token: result.data.refresh_token
  };
}

// Used by the /__status diagnostic page. Never returns key material.
export async function probeHousehold() {
  const info = {
    enabled: isHouseholdSessionEnabled(),
    email: householdEmail,
    supabaseUrl,
    signIn: "not tried",
    userId: null,
    profiles: null,
    profilesError: null
  };
  if (!info.enabled) {
    return info;
  }
  let session;
  try {
    session = await createSession();
    info.signIn = "ok";
  } catch (error) {
    info.signIn = String(error?.message || error);
    return info;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(session.access_token.split(".")[1] || "", "base64url").toString("utf8") || "{}"
    );
    info.userId = payload.sub || null;
  } catch (_) {
    info.userId = null;
  }
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/sync_pull_profiles`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    });
    const text = await response.text();
    if (!response.ok) {
      info.profilesError = `${response.status}: ${text.slice(0, 300)}`;
    } else {
      const rows = JSON.parse(text || "[]");
      info.profiles = (Array.isArray(rows) ? rows : []).map((row) => ({
        index: row.profile_index,
        name: row.name,
        hasPhoto: Boolean(row.avatar_url),
        updatedAt: row.updated_at || null
      }));
    }
  } catch (error) {
    info.profilesError = String(error?.message || error);
  }
  return info;
}

// Appended to /nuvio.env.js. Runs before the app bundle: a browser that
// has no session yet asks this server for one, synchronously, once.
export function buildHouseholdSessionScript() {
  if (!isHouseholdSessionEnabled()) {
    return "";
  }
  return `
(function nuvioHouseholdAutoSession() {
  var LOG_KEY = "__nuvioAuthDebugLog";
  var originalSetItem = Storage.prototype.setItem;
  var originalRemoveItem = Storage.prototype.removeItem;
  // Small history of what happened to the login in this browser, shown on
  // /__status so problems can be diagnosed from a screenshot.
  function log(event, detail) {
    try {
      var entries = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
      if (!Array.isArray(entries)) entries = [];
      entries.push({ at: new Date().toISOString(), event: event, detail: String(detail || "").slice(0, 300) });
      originalSetItem.call(localStorage, LOG_KEY, JSON.stringify(entries.slice(-15)));
    } catch (error) {}
  }
  function caller() {
    try {
      return String(new Error().stack || "").split("\\n").slice(3, 6).join(" | ");
    } catch (error) {
      return "";
    }
  }
  try {
    Storage.prototype.removeItem = function (key) {
      if (this === localStorage && (key === "refresh_token" || key === "access_token") && this.getItem(key)) {
        log("app removed " + key, caller());
      }
      return originalRemoveItem.apply(this, arguments);
    };
  } catch (error) {}
  try {
    if (localStorage.getItem("refresh_token")) {
      log("page load: already signed in", "");
      return;
    }
    var request = new XMLHttpRequest();
    request.open("GET", ${JSON.stringify(SESSION_PATH)}, false);
    request.send(null);
    if (request.status !== 200) {
      log("auto sign-in failed", request.status + " " + request.responseText);
      console.warn("[household] automatic sign-in failed", request.status, request.responseText);
      return;
    }
    var session = JSON.parse(request.responseText);
    if (!session.access_token || !session.refresh_token) {
      log("auto sign-in returned no tokens", "");
      return;
    }
    localStorage.setItem("access_token", session.access_token);
    localStorage.setItem("refresh_token", session.refresh_token);
    localStorage.removeItem("is_anonymous_session");
    localStorage.setItem("hasSeenAuthQrOnFirstLaunch", "true");
    log("auto sign-in ok", "");
  } catch (error) {
    log("auto sign-in error", error && error.message);
    console.warn("[household] automatic sign-in failed", error);
  }
}());
`;
}

// Returns true when the request was handled.
export async function handleHouseholdSessionRequest(request, response, requestUrl) {
  if (requestUrl.pathname !== SESSION_PATH) {
    return false;
  }
  const send = (statusCode, body) => {
    response.writeHead(statusCode, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify(body));
  };
  if (!isHouseholdSessionEnabled()) {
    send(404, { error: "Automatic sign-in is not enabled" });
    return true;
  }
  try {
    send(200, await createSession());
  } catch (error) {
    console.warn(`[household] ${error?.message || error}`);
    send(502, { error: String(error?.message || error) });
  }
  return true;
}
