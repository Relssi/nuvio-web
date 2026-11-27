// /__status: a diagnostic page for people who cannot open the server logs.
// Shows whether Supabase is configured, which profiles the shared account
// has, and which account THIS browser is signed in to. It never prints any
// key: only which kind of key is configured.
// Protected by the site password like every other route.

import { isAuthEnabled } from "./serveAuth.mjs";
import { probeHousehold } from "./householdSession.mjs";

const STATUS_PATH = "/__status";

function keyKind(value) {
  const key = String(value || "").trim();
  if (!key) return "não configurada";
  if (key.startsWith("sb_publishable_")) return "publishable (formato novo)";
  if (key.startsWith("sb_secret_")) return "secret (formato novo)";
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      return `JWT, role = ${payload.role || "?"}`;
    } catch (_) {
      return "JWT ilegível";
    }
  }
  return "formato desconhecido";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function row(label, value, ok) {
  const mark = ok === true ? "✅" : ok === false ? "❌" : "ℹ️";
  return `<tr><td>${mark}</td><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

async function renderStatusPage() {
  const anonKind = keyKind(process.env.NUVIO_SUPABASE_ANON_KEY);
  const serviceKind = keyKind(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const household = await probeHousehold();
  const profiles = household.profiles || [];
  const addons = household.addons || [];
  const debridProviders = (household.providers || []).filter((name) => name.startsWith("debrid:"));

  const serverRows = [
    row("Senha do site", isAuthEnabled() ? "ativa" : "DESLIGADA", isAuthEnabled()),
    row(
      "NUVIO_SUPABASE_URL",
      household.supabaseUrl || "não configurada",
      Boolean(household.supabaseUrl)
    ),
    row(
      "NUVIO_SUPABASE_ANON_KEY",
      anonKind,
      anonKind.includes("role = anon") || anonKind.startsWith("publishable")
    ),
    row(
      "SUPABASE_SERVICE_ROLE_KEY",
      serviceKind,
      serviceKind.includes("role = service_role") || serviceKind.startsWith("secret")
    ),
    row("Login automático", household.enabled ? "ligado" : "desligado", household.enabled),
    row("Entrar na conta da casa", household.signIn, household.signIn === "ok"),
    row("ID da conta da casa", household.userId || "-", Boolean(household.userId)),
    row(
      "Perfis no Supabase",
      household.profilesError
        ? `erro ${household.profilesError}`
        : `${profiles.length}: ${profiles.map((p) => `${p.index}. ${p.name}${p.hasPhoto ? " (foto)" : ""}`).join(", ") || "nenhum"}`,
      !household.profilesError && profiles.length > 0
    ),
    row(
      "Addons no Supabase",
      household.addonsError
        ? `erro ${household.addonsError}`
        : addons.length
          ? `${addons.length}: ${addons
              .map((addon) => `${addon.name || addon.url}${addon.enabled ? "" : " (desligado)"}`)
              .join(", ")}`
          : "nenhum (no perfil principal, mude algo na tela Addons para enviar)",
      !household.addonsError && addons.length > 0
    ),
    row(
      "App consegue ler a tabela de addons",
      household.addonsTableRead === "ok"
        ? "sim"
        : `não (${household.addonsTableRead || "não testado"}) — rode docs/supabase/04-table-access.sql`,
      household.addonsTableRead === "ok"
    ),
    row(
      "TorBox / debrid no Supabase",
      household.providersError
        ? `erro ${household.providersError}`
        : debridProviders.length
          ? `conectado: ${debridProviders.map((name) => name.replace(/^debrid:/, "")).join(", ")}`
          : "não conectado (conecte pelo perfil principal)",
      !household.providersError && debridProviders.length > 0
    )
  ].join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Status</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 16px; background: #0d0d0f; color: #f2f2f2;
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 22px; } h2 { font-size: 17px; margin-top: 28px; }
  table { width: 100%; border-collapse: collapse; background: #18181b; border-radius: 12px; overflow: hidden; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #27272a; vertical-align: top; word-break: break-word; }
  th { width: 34%; font-weight: 600; color: #d4d4d8; }
  td:first-child { width: 28px; }
  .hint { color: #a1a1aa; font-size: 14px; }
  button { padding: 10px 16px; font-size: 15px; font-weight: 600; border: 0; border-radius: 10px; background: #8b5cf6; color: #fff; cursor: pointer; }
</style>
</head>
<body>
<main>
<h1>Status do site</h1>
<p class="hint">Nenhuma chave é mostrada aqui. Pode mandar print desta página.</p>
<h2>Servidor</h2>
<table>${serverRows}</table>
<h2>Este navegador</h2>
<table id="browser"></table>
<p class="hint">Se "Conta deste navegador" for diferente da conta da casa, ou se não estiver logado, use o botão abaixo.</p>
<p><button id="connect" type="button">Conectar este navegador à conta da casa</button> <span id="connect-result" class="hint"></span></p>
<h2>Histórico do login neste navegador</h2>
<table id="auth-log"></table>
</main>
<script>
(function () {
  var householdId = ${JSON.stringify(household.userId || "")};
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function line(label, value, ok) {
    var mark = ok === true ? "✅" : ok === false ? "❌" : "ℹ️";
    return "<tr><td>" + mark + "</td><th>" + esc(label) + "</th><td>" + esc(value) + "</td></tr>";
  }
  var rows = [];
  var token = localStorage.getItem("access_token") || "";
  var claims = null;
  try { claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch (e) { claims = null; }
  rows.push(line("Logado no Supabase", token ? "sim" : "não", Boolean(token)));
  if (claims) {
    var same = householdId && claims.sub === householdId;
    rows.push(line("Conta deste navegador", (claims.email || "sem e-mail") + " (" + claims.sub + ")", Boolean(same)));
    rows.push(line("Sessão expira", new Date(claims.exp * 1000).toLocaleString(), claims.exp * 1000 > Date.now() ? true : null));
  }
  var profiles = [];
  try { profiles = JSON.parse(localStorage.getItem("profiles") || "[]"); } catch (e) { profiles = []; }
  rows.push(line("Perfis neste navegador", profiles.length + ": " + profiles.map(function (p) { return (p.profileIndex || p.id) + ". " + p.name + (p.avatarUrl ? " (foto)" : ""); }).join(", "), null));
  var active = "";
  try { active = JSON.parse(localStorage.getItem("activeProfileId") || '""'); } catch (e) { active = ""; }
  rows.push(line("Perfil ativo", active || "-", null));
  document.getElementById("browser").innerHTML = rows.join("");

  var log = [];
  try { log = JSON.parse(localStorage.getItem("__nuvioAuthDebugLog") || "[]"); } catch (e) { log = []; }
  document.getElementById("auth-log").innerHTML = log.length
    ? log.slice().reverse().map(function (entry) {
        var bad = /failed|error|removed|no tokens/.test(entry.event);
        return line(new Date(entry.at).toLocaleString() + " — " + entry.event, entry.detail || "", bad ? false : true);
      }).join("")
    : line("Nada registrado ainda", "abra o app (página inicial) e volte aqui", null);

  document.getElementById("connect").addEventListener("click", function () {
    var result = document.getElementById("connect-result");
    result.textContent = "Conectando...";
    fetch("/__auto_session", { credentials: "same-origin", cache: "no-store" })
      .then(function (response) {
        return response.text().then(function (text) { return { status: response.status, text: text }; });
      })
      .then(function (reply) {
        if (reply.status !== 200) {
          result.textContent = "Falhou (" + reply.status + "): " + reply.text.slice(0, 200);
          return;
        }
        var session = JSON.parse(reply.text);
        localStorage.setItem("access_token", session.access_token);
        localStorage.setItem("refresh_token", session.refresh_token);
        localStorage.removeItem("is_anonymous_session");
        localStorage.setItem("hasSeenAuthQrOnFirstLaunch", "true");
        result.textContent = "Conectado. Abra o site de novo (página inicial).";
        setTimeout(function () { location.reload(); }, 800);
      })
      .catch(function (error) { result.textContent = "Erro: " + error.message; });
  });
}());
</script>
</body>
</html>`;
}

// Returns true when the request was handled.
export async function handleStatusRequest(request, response, requestUrl) {
  if (requestUrl.pathname !== STATUS_PATH) {
    return false;
  }
  let html;
  try {
    html = await renderStatusPage();
  } catch (error) {
    html = `<pre>${escapeHtml(error?.stack || error)}</pre>`;
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
    "X-Robots-Tag": "noindex, nofollow"
  });
  response.end(html);
  return true;
}
