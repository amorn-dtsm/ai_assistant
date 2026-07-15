# Keycloak SSO Relay for AnythingLLM

A small OIDC relay that bridges **Keycloak** logins to AnythingLLM's built-in
[Simple SSO passthrough](https://docs.anythingllm.com/configuration#simple-sso-passthrough).
No AnythingLLM core code is modified, so upstream updates keep merging cleanly.

```
Browser ── /login ──> Relay ── Auth Code + PKCE ──> Keycloak
Browser <── redirect ─ Relay <──── callback ─────── Keycloak
                        │
                        │ 1. find-or-create user   (POST /api/v1/admin/users/new)
                        │ 2. sync role             (POST /api/v1/admin/users/:id)
                        │ 3. issue single-use token (GET /api/v1/users/:id/issue-auth-token)
                        ▼
Browser ──> AnythingLLM /sso/simple?token=... ──> logged-in session
```

## Features

- **Authorization Code + PKCE** against any Keycloak realm (`openid-client` v6)
- **JIT provisioning** — AnythingLLM users are created on first login
- **Role mapping** — Keycloak roles → AnythingLLM `admin` / `manager` / `default`,
  re-synced on every login
- **Deep links** — `/login?redirectTo=/workspace/foo` lands the user there after login

---

## 1. AnythingLLM setup

1. Complete onboarding and **enable multi-user mode** (create the first admin in the UI).
2. Create a **developer API key**: Settings → Tools → Developer API. Use a
   dedicated key so it can be revoked independently.
3. Add to the server env (`docker/.env` for Docker, `server/.env` bare metal):

   ```env
   SIMPLE_SSO_ENABLED=1
   # Optional: hide the username/password form and force SSO-only login
   SIMPLE_SSO_NO_LOGIN=1
   # Optional: send unauthenticated users straight to the relay
   SIMPLE_SSO_NO_LOGIN_REDIRECT=http://localhost:3002/login
   # Recommended: shorten sessions so Keycloak deactivation takes effect sooner
   JWT_EXPIRY=8h
   ```

> With `SIMPLE_SSO_NO_LOGIN=1`, local passwords become unusable — exactly what
> you want. JIT-provisioned users get a random throwaway password.

## 2. Keycloak setup

In your realm (examples assume realm `anythingllm`):

1. **Create a client**
   - Client ID: `anythingllm-relay`
   - Client authentication: **ON** (confidential)
   - Standard flow: **ON**; other flows: off
   - Valid redirect URIs: `http://localhost:3002/oidc/callback` (exact URI —
     avoid wildcards in production)
   - Valid post logout redirect URIs: `http://localhost:3001`
2. **Create roles** (realm roles, or roles on the `anythingllm-relay` client):
   - `anythingllm-admin` → AnythingLLM `admin`
   - `anythingllm-manager` → AnythingLLM `manager`
   - no role → AnythingLLM `default`
3. Assign roles to users/groups as needed. Users need `preferred_username`
   (always present) — it becomes the AnythingLLM username, normalized to
   lowercase `[a-z][a-z0-9._@-]*`.

## 3. Run it

### Docker Compose (includes a dev Keycloak)

```powershell
cd docker
# .env must contain SIMPLE_SSO_ENABLED=1 etc. (step 1) plus:
#   ANYTHINGLLM_API_KEY=<your developer API key>
#   KEYCLOAK_CLIENT_SECRET=<client secret from Keycloak>
docker compose -f docker-compose.yml -f docker-compose.keycloak.yml up -d --build
```

- AnythingLLM: <http://localhost:3001>
- Relay login: <http://localhost:3002/login>
- Keycloak admin console: <http://localhost:8080> (`admin` / `admin` by default)

The bundled Keycloak runs `start-dev` with an in-memory database — **local
evaluation only**. For production, point `KEYCLOAK_ISSUER` at your real
Keycloak (HTTPS) and remove the `keycloak` service from the override file.

> **Hostname note:** the Keycloak issuer must be reachable under the *same*
> hostname by both the browser and the relay container. The compose file pins
> `KC_HOSTNAME` to `http://host.docker.internal:8080`, which Docker Desktop
> resolves on the host as well. On Linux, add `127.0.0.1 host.docker.internal`
> to `/etc/hosts`, or use a real DNS name.

### Standalone (relay on the host)

```powershell
cd keycloak-sso-relay
copy .env.example .env   # fill in values; set ANYTHINGLLM_API_URL=http://localhost:3001
npm install
npm start
```

Requires Node.js 20+.

## 4. Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3002` | Relay listen port |
| `KEYCLOAK_ISSUER` | — | Realm issuer URL, e.g. `https://auth.example.com/realms/anythingllm` |
| `KEYCLOAK_CLIENT_ID` | — | Confidential client ID |
| `KEYCLOAK_CLIENT_SECRET` | — | Client secret |
| `KEYCLOAK_ROLE_ADMIN` | `anythingllm-admin` | Keycloak role mapped to `admin` |
| `KEYCLOAK_ROLE_MANAGER` | `anythingllm-manager` | Keycloak role mapped to `manager` |
| `RELAY_PUBLIC_URL` | — | Browser-facing relay URL; redirect URI is `{RELAY_PUBLIC_URL}/oidc/callback` |
| `ANYTHINGLLM_API_URL` | — | Server-to-server AnythingLLM URL |
| `ANYTHINGLLM_PUBLIC_URL` | — | Browser-facing AnythingLLM URL |
| `ANYTHINGLLM_API_KEY` | — | AnythingLLM developer API key |
| `JIT_PROVISIONING` | `true` | Create missing users on first login |
| `ROLE_SYNC` | `true` | Re-apply Keycloak role on every login |

## 5. Operational notes

- **Session lifetime**: after the handoff, the user holds a normal AnythingLLM
  JWT. Disabling a user in Keycloak blocks *new* logins immediately, but the
  existing session lives until `JWT_EXPIRY`. Keep it short (e.g. `8h`).
- **Suspension**: suspending the user inside AnythingLLM kills API access on
  the next request — use that for immediate revocation.
- **HTTP vs HTTPS**: plain-HTTP issuers are only allowed for local dev (the
  relay auto-enables `allowInsecureRequests` for `http://`). Always use HTTPS
  in production.
- **Scaling**: pending login state is in-memory; run a single relay instance
  (it is stateless between logins otherwise).
