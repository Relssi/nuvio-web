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

// Appended to /nuvio.env.js. Runs before the app bundle: a browser that
// has no session yet asks this server for one, synchronously, once.
export function buildHouseholdSessionScript() {
  if (!isHouseholdSessionEnabled()) {
    return "";
  }
  return `
(function nuvioHouseholdAutoSession() {
  try {
    if (localStorage.getItem("refresh_token")) return;
    var request = new XMLHttpRequest();
    request.open("GET", ${JSON.stringify(SESSION_PATH)}, false);
    request.send(null);
    if (request.status !== 200) {
      console.warn("[household] automatic sign-in failed", request.status, request.responseText);
      return;
    }
    var session = JSON.parse(request.responseText);
    if (!session.access_token || !session.refresh_token) return;
    localStorage.setItem("access_token", session.access_token);
    localStorage.setItem("refresh_token", session.refresh_token);
    localStorage.removeItem("is_anonymous_session");
    localStorage.setItem("hasSeenAuthQrOnFirstLaunch", "true");
  } catch (error) {
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
