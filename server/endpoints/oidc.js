const { keycloakOIDCEnabled, initKeycloakOIDC } = require("../utils/oidc/keycloak");
const { userFromSession } = require("../utils/http");
const { User } = require("../models/user");
const { validatedRequest } = require("../utils/middleware/validatedRequest");

function oidcEndpoints(router) {
  initKeycloakOIDC(); // eager JWKS warm-up at boot

  // Public — no middleware
  router.get("/oidc/config", (_request, response) => {
    try {
      response.status(200).json({
        enabled: keycloakOIDCEnabled(),
        issuer: process.env.KEYCLOAK_OIDC_ISSUER || null,
        clientId: process.env.KEYCLOAK_OIDC_CLIENT_ID || null,
      });
    } catch (error) {
      console.error(error);
      response.status(500).json({ enabled: false, issuer: null, clientId: null });
    }
  });

  // Authenticated — uses validatedRequest middleware
  router.get("/oidc/me", [validatedRequest], async (request, response) => {
    try {
      const user = await userFromSession(request, response);
      if (!user) {
        response.status(401).json({ user: null });
        return;
      }
      response.status(200).json({ user: User.filterFields(user), valid: true });
    } catch (error) {
      console.error(error);
      response.status(500).json({ user: null });
    }
  });
}

module.exports = { oidcEndpoints };
