/**
 * Native Keycloak OIDC support ("Option B").
 *
 * Validates Keycloak-issued RS256 access tokens directly so that
 * `Authorization: Bearer <keycloak access token>` works against the API,
 * with per-request role sync and near-instant revocation (token TTL).
 *
 * decodeJWT() in utils/http is SYNCHRONOUS and called from ~300 sites, so we
 * keep verification sync by pre-fetching Keycloak's JWKS and caching the
 * public keys as PEMs (refreshed in the background). Zero new dependencies.
 *
 * Enabled only when KEYCLOAK_OIDC_ISSUER is set. All failures fall through
 * to "not a Keycloak token" so native HS256 sessions keep working untouched.
 */
const crypto = require("crypto");
const JWT = require("jsonwebtoken");

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const keyCache = new Map(); // kid -> PEM public key
let refreshTimer = null;
let lastFetchAt = 0;
let initialized = false;

function keycloakOIDCEnabled() {
  return !!process.env.KEYCLOAK_OIDC_ISSUER;
}

function issuer() {
  return String(process.env.KEYCLOAK_OIDC_ISSUER || "").replace(/\/+$/, "");
}

function adminRoleName() {
  return process.env.KEYCLOAK_ROLE_ADMIN || "anythingllm-admin";
}

function managerRoleName() {
  return process.env.KEYCLOAK_ROLE_MANAGER || "anythingllm-manager";
}

async function refreshJWKS() {
  if (!keycloakOIDCEnabled()) return;
  try {
    lastFetchAt = Date.now();
    const response = await fetch(`${issuer()}/protocol/openid-connect/certs`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`JWKS fetch failed (${response.status})`);
    const { keys = [] } = await response.json();
    for (const jwk of keys) {
      if (jwk.kty !== "RSA" || !jwk.kid) continue;
      try {
        const pem = crypto
          .createPublicKey({ key: jwk, format: "jwk" })
          .export({ type: "spki", format: "pem" });
        keyCache.set(jwk.kid, pem);
      } catch (error) {
        console.error(
          `[keycloak-oidc] Failed to import JWK kid=${jwk.kid}: ${error.message}`
        );
      }
    }
    console.log(
      `[keycloak-oidc] JWKS refreshed - ${keyCache.size} signing key(s) cached.`
    );
  } catch (error) {
    console.error(`[keycloak-oidc] JWKS refresh error: ${error.message}`);
  }
}

function initKeycloakOIDC() {
  if (initialized || !keycloakOIDCEnabled()) return;
  initialized = true;
  refreshJWKS(); // eager, fire-and-forget
  refreshTimer = setInterval(refreshJWKS, REFRESH_INTERVAL_MS);
  refreshTimer.unref();
  console.log(
    `[keycloak-oidc] Native Keycloak token validation ENABLED for issuer ${issuer()}`
  );
}

/**
 * Normalize a Keycloak username to AnythingLLM's rules:
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
 * Map Keycloak roles (realm + any client roles) to an AnythingLLM role.
 */
function mapRole(claims) {
  const roles = new Set(claims?.realm_access?.roles || []);
  for (const resource of Object.values(claims?.resource_access || {})) {
    for (const role of resource?.roles || []) roles.add(role);
  }
  if (roles.has(adminRoleName())) return "admin";
  if (roles.has(managerRoleName())) return "manager";
  return "default";
}

/**
 * SYNCHRONOUSLY verify a Keycloak RS256 access token against the cached JWKS.
 * Returns a kcIdentity object or null when not a valid Keycloak token.
 */
function verifyKeycloakToken(token) {
  if (!keycloakOIDCEnabled() || !token) return null;
  initKeycloakOIDC();

  let header;
  try {
    header = JSON.parse(
      Buffer.from(String(token).split(".")[0], "base64url").toString("utf8")
    );
  } catch {
    return null;
  }
  if (header?.alg !== "RS256" || !header?.kid) return null;

  const pem = keyCache.get(header.kid);
  if (!pem) {
    if (Date.now() - lastFetchAt > 30_000) refreshJWKS();
    return null;
  }

  try {
    const claims = JWT.verify(token, pem, {
      algorithms: ["RS256"],
      issuer: issuer(),
    });
    const rawUsername = claims.preferred_username || claims.email || claims.sub;
    return {
      username: normalizeUsername(rawUsername),
      role: mapRole(claims),
      sub: claims.sub,
      claims,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a verified Keycloak identity to a LOCAL user row.
 * Finds by username; JIT-creates when missing (unless
 * KEYCLOAK_JIT_PROVISIONING="false"); syncs role per-request (unless
 * KEYCLOAK_ROLE_SYNC="false"), refusing to demote the last admin.
 */
async function resolveLocalUser(kcIdentity) {
  if (!kcIdentity?.username) return null;
  const { User } = require("../../models/user");

  let user = await User.get({ username: kcIdentity.username });

  if (!user) {
    const jitEnabled =
      (process.env.KEYCLOAK_JIT_PROVISIONING || "true") === "true";
    if (!jitEnabled) return null;
    const randomPassword = `Aa1!${crypto.randomBytes(24).toString("base64url")}`;
    const { user: created, error } = await User.create({
      username: kcIdentity.username,
      password: randomPassword,
      role: kcIdentity.role,
    });
    if (error || !created) {
      console.error(
        `[keycloak-oidc] JIT provisioning failed for "${kcIdentity.username}": ${error}`
      );
      return null;
    }
    console.log(
      `[keycloak-oidc] JIT-provisioned user "${created.username}" (role: ${created.role})`
    );
    return await User.get({ id: created.id });
  }

  const roleSync = (process.env.KEYCLOAK_ROLE_SYNC || "true") === "true";
  if (roleSync && user.role !== kcIdentity.role) {
    if (user.role === "admin") {
      const admins = await User.where({ role: "admin" });
      if (admins.length <= 1) {
        console.warn(
          `[keycloak-oidc] Skipping role sync for "${user.username}" (${user.role} -> ${kcIdentity.role}): last admin.`
        );
        return user;
      }
    }
    const { success, error } = await User.update(user.id, {
      role: kcIdentity.role,
    });
    if (success) {
      console.log(
        `[keycloak-oidc] Role synced for "${user.username}": ${user.role} -> ${kcIdentity.role}`
      );
      user = await User.get({ id: user.id });
    } else {
      console.warn(
        `[keycloak-oidc] Role sync failed for "${user.username}": ${error}`
      );
    }
  }

  return user;
}

module.exports = {
  keycloakOIDCEnabled,
  initKeycloakOIDC,
  verifyKeycloakToken,
  resolveLocalUser,
  normalizeUsername,
  mapRole,
};
