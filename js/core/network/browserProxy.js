// Dev-only helper for running Nuvio in a desktop browser via `npm run serve`.
// The dev server sets globalThis.__NUVIO_WEB_PROXY__ (see scripts/serve.mjs);
// packaged TV builds never set it, so every helper here is a no-op on TV.

const PROXY_HEADERS_HEADER = "X-Nuvio-Proxy-Headers";
const FINAL_URL_HEADER = "X-Nuvio-Final-Url";
const corsBlockedOrigins = new Set();

export function getBrowserProxyPath() {
  const value = globalThis.__NUVIO_WEB_PROXY__;
  return typeof value === "string" && value ? value : "";
}

function currentOrigin() {
  try {
    return globalThis.location?.origin || "";
  } catch (_) {
    return "";
  }
}

function parseUrl(url) {
  try {
    return new URL(String(url || ""), globalThis.location?.href);
  } catch (_) {
    return null;
  }
}

export function isBrowserProxyable(url) {
  if (!getBrowserProxyPath()) {
    return false;
  }
  const parsed = parseUrl(url);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return false;
  }
  return parsed.origin !== currentOrigin();
}

function headersToObject(headers) {
  if (!headers) {
    return {};
  }
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

function encodeHeaders(headers) {
  const json = JSON.stringify(headers || {});
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

export function getProxiedResponseUrl(response, fallbackUrl = "") {
  return response?.headers?.get?.(FINAL_URL_HEADER) || fallbackUrl || response?.url || "";
}

// Sends the request through the dev server. Headers the browser would refuse
// to send itself (User-Agent, Referer, Cookie, ...) travel encoded in a single
// header and are applied server-side.
export function fetchViaBrowserProxy(url, init = {}) {
  const proxyPath = getBrowserProxyPath();
  const target = parseUrl(url);
  const proxyUrl = `${proxyPath}?url=${encodeURIComponent(target ? target.href : String(url))}`;
  const method = String(init.method || "GET").toUpperCase();
  return fetch(proxyUrl, {
    method,
    headers: { [PROXY_HEADERS_HEADER]: encodeHeaders(headersToObject(init.headers)) },
    body: method === "GET" || method === "HEAD" ? undefined : init.body,
    signal: init.signal,
    cache: "no-store",
    // The proxy is same-origin; its session cookie (password login) must be
    // sent. Upstream cookies never travel here: they go in the encoded header.
    credentials: "same-origin"
  });
}

// Tries the request directly first (most Stremio addons and APIs send CORS
// headers) and falls back to the dev proxy when the browser blocks it. Origins
// that failed once go straight to the proxy afterwards.
export async function fetchWithBrowserCorsFallback(url, init = {}) {
  if (!isBrowserProxyable(url)) {
    return fetch(url, init);
  }
  const origin = parseUrl(url)?.origin || "";
  if (!corsBlockedOrigins.has(origin)) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (error?.name === "AbortError" || init?.signal?.aborted) {
        throw error;
      }
      corsBlockedOrigins.add(origin);
      console.info(`[Nuvio web] ${origin} blocked by CORS/network, using dev proxy`);
    }
  }
  return fetchViaBrowserProxy(url, init);
}
