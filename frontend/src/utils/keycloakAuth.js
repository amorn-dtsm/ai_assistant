/**
 * Plain-JS OIDC PKCE client for the SPA.
 * No new npm dependencies — uses window.crypto.subtle + fetch.
 */
import { API_BASE, AUTH_TOKEN, AUTH_USER } from "./constants";

let _oidcConfig = null;
let _refreshTimerId = null;

// ── helpers ──────────────────────────────────────────────────────────

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── public API ───────────────────────────────────────────────────────

export async function fetchOidcConfig() {
  if (_oidcConfig) return _oidcConfig;
  const res = await fetch(`${API_BASE}/oidc/config`);
  _oidcConfig = await res.json();
  return _oidcConfig;
}

export async function loginWithKeycloak() {
  const config = await fetchOidcConfig();
  if (!config.enabled) throw new Error("OIDC is not enabled on this server.");

  const verifierBytes = new Uint8Array(48);
  window.crypto.getRandomValues(verifierBytes);
  const codeVerifier = base64url(verifierBytes);

  const challengeBuffer = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  const codeChallenge = base64url(challengeBuffer);

  const stateBytes = new Uint8Array(16);
  window.crypto.getRandomValues(stateBytes);
  const state = base64url(stateBytes);

  sessionStorage.setItem(
    `kc-pkce-${state}`,
    JSON.stringify({ verifier: codeVerifier })
  );

  const issuer = String(config.issuer).replace(/\/+$/, "");
  const redirectUri = `${window.location.origin}/oidc/callback`;
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  window.location.assign(
    `${issuer}/protocol/openid-connect/auth?${params.toString()}`
  );
}

export async function completeOidcLogin() {
  const config = await fetchOidcConfig();
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) throw new Error("Missing code or state in callback URL.");

  const stored = sessionStorage.getItem(`kc-pkce-${state}`);
  sessionStorage.removeItem(`kc-pkce-${state}`);
  if (!stored) throw new Error("Missing PKCE verifier — session may have expired.");

  const { verifier } = JSON.parse(stored);
  const issuer = String(config.issuer).replace(/\/+$/, "");
  const redirectUri = `${window.location.origin}/oidc/callback`;

  const tokenRes = await fetch(
    `${issuer}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    }
  );

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text}`);
  }

  const tokenData = await tokenRes.json();
  const { access_token, refresh_token, expires_in } = tokenData;

  localStorage.setItem(AUTH_TOKEN, access_token);
  if (refresh_token) localStorage.setItem("kc_refresh_token", refresh_token);
  localStorage.setItem(
    "kc_token_expires_at",
    String(Date.now() + (expires_in || 300) * 1000)
  );

  // Fetch the local user profile via /oidc/me
  const meRes = await fetch(`${API_BASE}/oidc/me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (meRes.ok) {
    const meData = await meRes.json();
    if (meData.user) {
      localStorage.setItem(AUTH_USER, JSON.stringify(meData.user));
    }
  }

  scheduleTokenRefresh();
  return true;
}

export function scheduleTokenRefresh() {
  if (_refreshTimerId) clearTimeout(_refreshTimerId);
  _refreshTimerId = null;

  const rt = localStorage.getItem("kc_refresh_token");
  if (!rt) return;

  const expiresAt = Number(localStorage.getItem("kc_token_expires_at") || "0");
  const delayMs = Math.max(expiresAt - Date.now() - 60_000, 5_000);

  _refreshTimerId = setTimeout(() => {
    refreshKeycloakToken();
  }, delayMs);
}

export async function refreshKeycloakToken() {
  try {
    const config = await fetchOidcConfig();
    const refreshToken = localStorage.getItem("kc_refresh_token");
    if (!refreshToken || !config.enabled) return;

    const issuer = String(config.issuer).replace(/\/+$/, "");
    const res = await fetch(`${issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!res.ok) throw new Error("Refresh failed");

    const data = await res.json();
    localStorage.setItem(AUTH_TOKEN, data.access_token);
    if (data.refresh_token)
      localStorage.setItem("kc_refresh_token", data.refresh_token);
    localStorage.setItem(
      "kc_token_expires_at",
      String(Date.now() + (data.expires_in || 300) * 1000)
    );
    scheduleTokenRefresh();
  } catch {
    localStorage.removeItem(AUTH_TOKEN);
    localStorage.removeItem(AUTH_USER);
    localStorage.removeItem("kc_refresh_token");
    localStorage.removeItem("kc_token_expires_at");
    window.location.replace("/login");
  }
}

export function initKeycloakSession() {
  const rt = localStorage.getItem("kc_refresh_token");
  if (!rt) return;

  const expiresAt = Number(localStorage.getItem("kc_token_expires_at") || "0");
  if (Date.now() >= expiresAt) {
    refreshKeycloakToken();
  } else {
    scheduleTokenRefresh();
  }
}

export async function keycloakLogout() {
  const config = await fetchOidcConfig();
  localStorage.removeItem(AUTH_TOKEN);
  localStorage.removeItem(AUTH_USER);
  localStorage.removeItem("kc_refresh_token");
  localStorage.removeItem("kc_token_expires_at");

  if (config?.issuer) {
    const issuer = String(config.issuer).replace(/\/+$/, "");
    const postLogoutRedirect = encodeURIComponent(window.location.origin);
    window.location.assign(
      `${issuer}/protocol/openid-connect/logout?client_id=${encodeURIComponent(config.clientId)}&post_logout_redirect_uri=${postLogoutRedirect}`
    );
  } else {
    window.location.replace("/login");
  }
}
