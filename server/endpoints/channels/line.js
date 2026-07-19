const { makeChannelEndpoints } = require("./factory");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  isSingleUserMode,
} = require("../../utils/middleware/multiUserProtected");
const {
  lineSignatureMiddleware,
} = require("../../utils/channels/line/signature");
const { decryptCredential } = require("../../utils/channels/crypto");
const {
  ExternalCommunicationConnector,
} = require("../../models/externalCommunicationConnector");
const { getAdapter } = require("../../utils/channels");

/**
 * Retrieve the decrypted channel secret from the LINE connector config.
 * Passed as the `getSecret` callback for `lineSignatureMiddleware`.
 * @returns {Promise<string>}
 */
async function getChannelSecret() {
  const connector = await ExternalCommunicationConnector.get("line");
  if (!connector?.config?.channel_secret) {
    throw new Error("LINE connector not configured");
  }
  return decryptCredential(connector.config.channel_secret);
}

/**
 * Mount all LINE channel endpoints on the given router.
 *
 * Admin routes use `[validatedRequest, isSingleUserMode]` middleware.
 * Webhook route uses HMAC signature verification ONLY — no other auth.
 *
 * @param {import('express').Router} app
 */
function lineEndpoints(app) {
  if (!app) return;

  // Lazy-require LineAdapter so parallel tasks can build it independently
  let LineAdapter;
  try {
    LineAdapter = require("../../utils/channels/line");
  } catch {
    console.warn("[LINE endpoints] LineAdapter module not available, skipping");
    return;
  }

  // Admin endpoints via the generic factory
  makeChannelEndpoints(app, LineAdapter, {
    middleware: [validatedRequest, isSingleUserMode],
  });

  // Webhook — HMAC signature verification ONLY (no validatedRequest)
  app.post(
    "/line/webhook",
    lineSignatureMiddleware(getChannelSecret),
    (req, res) => {
      // Respond 200 immediately per LINE platform spec
      res.status(200).end();

      // Fire-and-forget event processing
      const adapter = getAdapter("line");
      if (adapter && typeof adapter.handleWebhookEvents === "function") {
        adapter.handleWebhookEvents(req.body.events || []).catch((err) => {
          console.error("[LINE webhook] event processing error:", err.message);
        });
      }
    }
  );
}

module.exports = { lineEndpoints };
