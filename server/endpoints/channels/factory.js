const {
  ExternalCommunicationConnector,
} = require("../../models/externalCommunicationConnector");
const { encryptCredential } = require("../../utils/channels/crypto");
const { getAdapter } = require("../../utils/channels");
const { reqBody } = require("../../utils/http");
const { EventLogs } = require("../../models/eventLogs");
const { Telemetry } = require("../../models/telemetry");

/**
 * Mount generic channel admin endpoints on the given Express router.
 *
 * Routes created: `/{type}/config`, `/{type}/connect`, `/{type}/disconnect`,
 * `/{type}/status`, `/{type}/update-config`.
 * Pairing routes (`/{type}/pending-users` etc.) only if `AdapterClass.supportsPairing`.
 *
 * @param {import('express').Router} app
 * @param {typeof import('../../utils/channels/BaseChannelAdapter').BaseChannelAdapter} AdapterClass
 * @param {{ middleware?: Function[] }} options
 */
function makeChannelEndpoints(app, AdapterClass, { middleware = [] } = {}) {
  const type = AdapterClass.type;
  const credSchema = AdapterClass.credentialsSchema;

  // ------- GET /{type}/config — non-secret config ----------------------------
  app.get(`/${type}/config`, ...middleware, async (_req, res) => {
    try {
      const connector = await ExternalCommunicationConnector.get(type);
      if (!connector) return res.status(200).json({ config: null });

      const config = { ...connector.config };
      for (const key of Object.keys(credSchema)) delete config[key];

      return res
        .status(200)
        .json({ config: { active: connector.active, ...config } });
    } catch (e) {
      console.error(e.message, e);
      return res.sendStatus(500);
    }
  });

  // ------- POST /{type}/connect ----------------------------------------------
  app.post(`/${type}/connect`, ...middleware, async (req, res) => {
    try {
      const body = reqBody(req);

      // Validate required credential fields from schema
      for (const [field, schema] of Object.entries(credSchema)) {
        if (schema.required && !body[field]) {
          return res.status(400).json({
            success: false,
            error: `Missing required field: ${field}`,
          });
        }
      }

      // Extract credentials
      const creds = {};
      for (const key of Object.keys(credSchema)) creds[key] = body[key];

      // Verify credentials with the adapter
      let verification;
      try {
        verification = await AdapterClass.verifyCredentials(creds);
      } catch (err) {
        return res.status(400).json({
          success: false,
          error: err.message || "Invalid credentials",
        });
      }
      if (!verification.valid) {
        return res.status(400).json({
          success: false,
          error: `Invalid credentials: ${verification.error || "verification failed"}`,
        });
      }

      const { valid: _valid, ...verificationInfo } = verification;

      // Build stored config — encrypt every credential field
      const storedConfig = { ...verificationInfo };
      for (const key of Object.keys(credSchema)) {
        storedConfig[key] = encryptCredential(String(creds[key]));
      }

      const { error } = await ExternalCommunicationConnector.upsert(type, {
        ...storedConfig,
        active: true,
      });
      if (error) return res.status(500).json({ success: false, error });

      // Start adapter with plaintext credentials
      const adapter = getAdapter(type);
      const startConfig = { ...storedConfig };
      for (const key of Object.keys(credSchema)) {
        startConfig[key] = String(creds[key]);
      }
      await adapter.start(startConfig);

      await EventLogs.logEvent(`${type}_bot_connected`, verificationInfo);
      await Telemetry.sendTelemetry(`${type}_bot_connected`);

      return res.status(200).json({ success: true, ...verificationInfo });
    } catch (e) {
      console.error(e.message, e);
      return res.sendStatus(500);
    }
  });

  // ------- POST /{type}/disconnect -------------------------------------------
  app.post(`/${type}/disconnect`, ...middleware, async (_req, res) => {
    try {
      const adapter = getAdapter(type);
      await adapter.stop();
      await ExternalCommunicationConnector.delete(type);
      await EventLogs.logEvent(`${type}_bot_disconnected`);
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error(e.message, e);
      return res.sendStatus(500);
    }
  });

  // ------- GET /{type}/status ------------------------------------------------
  app.get(`/${type}/status`, ...middleware, async (_req, res) => {
    try {
      const connector = await ExternalCommunicationConnector.get(type);
      const adapter = getAdapter(type);

      // Strip credential fields before returning
      const config = connector?.config ? { ...connector.config } : {};
      for (const key of Object.keys(credSchema)) delete config[key];

      return res.status(200).json({
        active: !!(connector?.active && adapter?.isRunning),
        ...config,
      });
    } catch (e) {
      console.error(e.message, e);
      return res.sendStatus(500);
    }
  });

  // ------- POST /{type}/update-config ----------------------------------------
  app.post(`/${type}/update-config`, ...middleware, async (req, res) => {
    try {
      const body = reqBody(req);
      const updateSchema = AdapterClass.configUpdateSchema;

      if (updateSchema) {
        // Reject unknown keys
        const unknownKeys = Object.keys(body).filter((k) => !updateSchema[k]);
        if (unknownKeys.length) {
          return res.status(400).json({
            success: false,
            error: `Unknown config key(s): ${unknownKeys.join(", ")}`,
          });
        }

        // Validate each field against its schema
        for (const [key, value] of Object.entries(body)) {
          const fieldDef = updateSchema[key];
          if (fieldDef.type === "array") {
            if (!Array.isArray(value)) {
              return res
                .status(400)
                .json({ success: false, error: `'${key}' must be an array` });
            }
            for (const item of value) {
              if (typeof item !== "string") {
                return res.status(400).json({
                  success: false,
                  error: `'${key}' items must be strings`,
                });
              }
              if (
                fieldDef.itemPrefix &&
                !item.startsWith(fieldDef.itemPrefix)
              ) {
                return res.status(400).json({
                  success: false,
                  error: `'${key}' items must start with '${fieldDef.itemPrefix}'`,
                });
              }
            }
          } else if (fieldDef.type === "string") {
            if (typeof value !== "string") {
              return res
                .status(400)
                .json({ success: false, error: `'${key}' must be a string` });
            }
          }
        }
      }

      const result = await ExternalCommunicationConnector.updateConfig(
        type,
        body
      );
      if (result.error)
        return res.status(500).json({ success: false, error: result.error });

      return res.status(200).json({ success: true });
    } catch (e) {
      console.error(e.message, e);
      return res.sendStatus(500);
    }
  });

  // ------- Pairing routes (only when adapter supports them) ------------------
  if (AdapterClass.supportsPairing) {
    app.get(`/${type}/pending-users`, ...middleware, async (_req, res) => {
      try {
        const adapter = getAdapter(type);
        return res.status(200).json({ users: adapter.pendingPairings || [] });
      } catch (e) {
        console.error(e.message, e);
        return res.sendStatus(500);
      }
    });
  }
}

module.exports = { makeChannelEndpoints };
