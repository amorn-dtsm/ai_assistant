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

// Pure-JS SHA-256 (no Web Crypto) so PKCE works in non-secure (HTTP) contexts
// where window.crypto.subtle is undefined. Input/Output: Uint8Array.
function sha256Bytes(bytes) {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,
      h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const l = bytes.length;
  const padLen = Math.ceil((l + 1 + 8) / 64) * 64;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  const bitLen = l * 8;
  dv.setUint32(padLen - 4, bitLen >>> 0, false);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < padLen; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t-15],7) ^ rotr(w[t-15],18) ^ (w[t-15] >>> 3);
      const s1 = rotr(w[t-2],17) ^ rotr(w[t-2],19) ^ (w[t-2] >>> 10);
      w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0;
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,hh=h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0;
    h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+hh)|0;
  }
  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  [h0,h1,h2,h3,h4,h5,h6,h7].forEach((h, idx) => outDv.setUint32(idx * 4, h >>> 0, false));
  return out;
}

async function computeCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  let hashBytes;
  if (window.crypto?.subtle?.digest) {
    hashBytes = new Uint8Array(await window.crypto.subtle.digest("SHA-256", data));
  } else {
    hashBytes = sha256Bytes(data);
  }
  return base64url(hashBytes);
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

  const codeChallenge = await computeCodeChallenge(codeVerifier);

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

  clearSsoAutoAttempt();
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

// ── SSO auto-redirect loop guard ─────────────────────────────────────

const SSO_AUTO_GUARD_KEY = "kc_sso_auto_attempt";

export function markSsoAutoAttempt() {
  sessionStorage.setItem(SSO_AUTO_GUARD_KEY, String(Date.now()));
}

export function recentSsoAutoAttempt(windowMs = 30_000) {
  const ts = Number(sessionStorage.getItem(SSO_AUTO_GUARD_KEY) || "0");
  return Date.now() - ts < windowMs;
}

export function clearSsoAutoAttempt() {
  sessionStorage.removeItem(SSO_AUTO_GUARD_KEY);
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
