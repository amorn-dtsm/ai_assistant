/**
 * Keycloak -> AnythingLLM Simple SSO relay.
 *
 * Flow:
 *  1. Browser hits GET /login on this relay.
 *  2. Relay redirects to Keycloak (Authorization Code + PKCE).
 *  3. Keycloak redirects back to GET /oidc/callback.
 *  4. Relay exchanges the code, reads the user's identity + roles,
 *     JIT-provisions (or looks up) the matching AnythingLLM user via the
 *     developer API, requests a single-use Simple SSO token, and redirects
 *     the browser to AnythingLLM's /sso/simple?token=... login path.
 *
 * Requires on the AnythingLLM side:
 *  - Multi-user mode enabled (onboarding completed, at least one admin).
 *  - SIMPLE_SSO_ENABLED=1 (and optionally SIMPLE_SSO_NO_LOGIN=1).
 *  - A developer API key (Settings > Tools > Developer API).
 */
import crypto from "node:crypto";
import express from "express";
import * as client from "openid-client";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const config = {
  port: Number(process.env.PORT || 3002),
  // e.g. http://host.docker.internal:8080/realms/anythingllm
  keycloakIssuer: required("KEYCLOAK_ISSUER"),
  keycloakClientId: required("KEYCLOAK_CLIENT_ID"),
  keycloakClientSecret: required("KEYCLOAK_CLIENT_SECRET"),
  // Browser-facing base URL of THIS relay, e.g. http://localhost:3002
  relayPublicUrl: stripTrailingSlash(required("RELAY_PUBLIC_URL")),
  // Server-to-server base URL of AnythingLLM, e.g. http://anything-llm:3001
  anythingllmApiUrl: stripTrailingSlash(required("ANYTHINGLLM_API_URL")),
  // Browser-facing base URL of AnythingLLM, e.g. http://localhost:3001
  anythingllmPublicUrl: stripTrailingSlash(required("ANYTHINGLLM_PUBLIC_URL")),
  // AnythingLLM developer API key (Settings > Tools > Developer API)
  anythingllmApiKey: required("ANYTHINGLLM_API_KEY"),
  // Keycloak role names that map to AnythingLLM roles. Checked against both
  // realm roles (realm_access.roles) and this client's roles (resource_access).
  adminRole: process.env.KEYCLOAK_ROLE_ADMIN || "anythingllm-admin",
  managerRole: process.env.KEYCLOAK_ROLE_MANAGER || "anythingllm-manager",
  // Create AnythingLLM users on first login when they don't exist yet.
  jitProvisioning: (process.env.JIT_PROVISIONING || "true") === "true",
  // Keep the AnythingLLM role in sync with Keycloak roles on every login.
  roleSync: (process.env.ROLE_SYNC || "true") === "true",
};

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[relay] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Pending login state (state -> PKCE verifier). Single-instance in-memory
// store; entries expire after 10 minutes.
// ---------------------------------------------------------------------------
const PENDING_TTL_MS = 10 * 60 * 1000;
const pendingLogins = new Map();

function rememberLogin(state, data) {
  pendingLogins.set(state, { ...data, createdAt: Date.now() });
}

function consumeLogin(state) {
  const entry = pendingLogins.get(state);
  if (!entry) return null;
  pendingLogins.delete(state);
  if (Date.now() - entry.createdAt > PENDING_TTL_MS) return null;
  return entry;
}

setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of pendingLogins.entries()) {
    if (now - entry.createdAt > PENDING_TTL_MS) pendingLogins.delete(state);
  }
}, 60 * 1000).unref();

// ---------------------------------------------------------------------------
// AnythingLLM developer API helpers
// ---------------------------------------------------------------------------
async function anythingllmApi(path, options = {}) {
  const response = await fetch(`${config.anythingllmApiUrl}/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.anythingllmApiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `AnythingLLM API ${path} failed (${response.status}): ${body.slice(0, 300)}`
    );
  }
  return response.json();
}

/**
 * Normalize a Keycloak username so it passes AnythingLLM's validation:
 * /^[a-z][a-z0-9._@-]*$/ with 2-64 characters.
 */
function normalizeUsername(rawUsername) {
  let username = String(rawUsername || "")
    .toLowerCase()
    .replace(/[^a-z0-9._@-]/g, "_");
  if (!/^[a-z]/.test(username)) username = `u${username}`;
  if (username.length < 2) username = `${username}0`;
  return username.slice(0, 64);
}

/**
 * Map Keycloak roles (realm + client) to an AnythingLLM role.
 */
function mapRole(accessTokenClaims) {
  const realmRoles = accessTokenClaims?.realm_access?.roles || [];
  const clientRoles =
    accessTokenClaims?.resource_access?.[config.keycloakClientId]?.roles || [];
  const roles = new Set([...realmRoles, ...clientRoles]);
  if (roles.has(config.adminRole)) return "admin";
  if (roles.has(config.managerRole)) return "manager";
  return "default";
}

/**
 * Decode a JWT payload WITHOUT signature verification. Safe here because the
 * token was received directly from Keycloak's token endpoint over a trusted
 * channel - we never accept this token from the browser.
 */
function decodeJwtPayload(jwt) {
  try {
    const payload = String(jwt).split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/**
 * Random throwaway password for JIT-provisioned users. Never used for login
 * (the login form should be disabled via SIMPLE_SSO_NO_LOGIN=1), but must
 * satisfy any configured password complexity rules.
 */
function randomPassword() {
  return `Aa1!${crypto.randomBytes(24).toString("base64url")}`;
}

/**
 * Find-or-create the AnythingLLM user for this Keycloak identity and keep
 * the role in sync. Returns the AnythingLLM user record { id, username, role }.
 */
async function ensureAnythingllmUser(username, role) {
  const { users = [] } = await anythingllmApi("/v1/users");
  let user = users.find((u) => u.username === username);

  if (!user) {
    if (!config.jitProvisioning) {
      throw new Error(
        `User "${username}" does not exist in AnythingLLM and JIT provisioning is disabled.`
      );
    }
    const created = await anythingllmApi("/v1/admin/users/new", {
      method: "POST",
      body: JSON.stringify({ username, password: randomPassword(), role }),
    });
    if (!created?.user) {
      throw new Error(
        `Failed to create AnythingLLM user "${username}": ${created?.error || "unknown error"}`
      );
    }
    return created.user;
  }

  if (config.roleSync && user.role !== role) {
    const result = await anythingllmApi(`/v1/admin/users/${user.id}`, {
      method: "POST",
      body: JSON.stringify({ role }),
    });
    if (result?.success) {
      user = { ...user, role };
    } else {
      // e.g. demoting the last admin is rejected by AnythingLLM - log, but
      // do not block the login.
      console.warn(
        `[relay] Role sync for "${username}" (${user.role} -> ${role}) was rejected: ${result?.error || "unknown"}`
      );
    }
  }

  return user;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
function errorPage(response, message) {
  response
    .status(500)
    .set("Content-Type", "text/html; charset=utf-8")
    .send(
      `<!doctype html><html><body style="font-family:sans-serif;max-width:38rem;margin:4rem auto;">
        <h2>Single sign-on failed</h2>
        <p>${escapeHtml(message)}</p>
        <p><a href="/login">Try again</a></p>
      </body></html>`
    );
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function main() {
  // Allow plain-HTTP Keycloak for local development only.
  const discoveryOptions = config.keycloakIssuer.startsWith("http://")
    ? { execute: [client.allowInsecureRequests] }
    : undefined;

  let oidc;
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      oidc = await client.discovery(
        new URL(config.keycloakIssuer),
        config.keycloakClientId,
        config.keycloakClientSecret,
        undefined,
        discoveryOptions
      );
      break;
    } catch (error) {
      console.log(
        `[relay] Keycloak discovery failed (attempt ${attempt}/30): ${error.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  if (!oidc) {
    console.error("[relay] Could not reach Keycloak - giving up.");
    process.exit(1);
  }
  console.log(`[relay] Discovered Keycloak issuer: ${config.keycloakIssuer}`);

  const app = express();
  const redirectUri = `${config.relayPublicUrl}/oidc/callback`;

  app.get("/healthz", (_request, response) => response.json({ ok: true }));

  // Entry point - kick off the Keycloak login.
  app.get(["/", "/login"], async (request, response) => {
    try {
      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();

      // Optional deep link into AnythingLLM after login, e.g. /login?redirectTo=/workspace/foo
      const redirectTo = String(request.query.redirectTo || "");
      rememberLogin(state, { codeVerifier, redirectTo });

      const authorizationUrl = client.buildAuthorizationUrl(oidc, {
        redirect_uri: redirectUri,
        scope: "openid profile email",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
      });
      response.redirect(authorizationUrl.href);
    } catch (error) {
      console.error("[relay] /login error:", error);
      errorPage(response, "Could not start the login flow.");
    }
  });

  // Keycloak redirects here after authentication.
  app.get("/oidc/callback", async (request, response) => {
    try {
      const state = String(request.query.state || "");
      const pending = consumeLogin(state);
      if (!pending) {
        return errorPage(
          response,
          "Login session expired or was already used. Please try again."
        );
      }

      const currentUrl = new URL(request.originalUrl, config.relayPublicUrl);
      const tokens = await client.authorizationCodeGrant(oidc, currentUrl, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: state,
      });

      const idClaims = tokens.claims() || {};
      const accessClaims = decodeJwtPayload(tokens.access_token);

      const rawUsername =
        idClaims.preferred_username || idClaims.email || idClaims.sub;
      const username = normalizeUsername(rawUsername);
      const role = mapRole(accessClaims);

      const user = await ensureAnythingllmUser(username, role);

      // Request a single-use Simple SSO token and hand the browser off.
      const { loginPath } = await anythingllmApi(
        `/v1/users/${user.id}/issue-auth-token`
      );
      let target = `${config.anythingllmPublicUrl}${loginPath}`;
      if (pending.redirectTo && pending.redirectTo.startsWith("/")) {
        target += `&redirectTo=${encodeURIComponent(pending.redirectTo)}`;
      }

      console.log(
        `[relay] Logged in "${username}" (role: ${user.role ?? role}) -> ${config.anythingllmPublicUrl}/sso/simple`
      );
      response.redirect(target);
    } catch (error) {
      console.error("[relay] /oidc/callback error:", error);
      errorPage(response, `Login failed: ${error.message}`);
    }
  });

  // Optional: log the user out of Keycloak as well.
  app.get("/logout", (_request, response) => {
    try {
      const endSessionUrl = client.buildEndSessionUrl(oidc, {
        post_logout_redirect_uri: config.anythingllmPublicUrl,
        client_id: config.keycloakClientId,
      });
      response.redirect(endSessionUrl.href);
    } catch (error) {
      console.error("[relay] /logout error:", error);
      response.redirect(config.anythingllmPublicUrl);
    }
  });

  app.listen(config.port, () => {
    console.log(`[relay] Listening on port ${config.port}`);
    console.log(`[relay] Login URL: ${config.relayPublicUrl}/login`);
    console.log(`[relay] Redirect URI (register in Keycloak): ${redirectUri}`);
  });
}

main().catch((error) => {
  console.error("[relay] Fatal:", error);
  process.exit(1);
});
