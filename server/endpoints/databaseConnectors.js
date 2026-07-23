const { DatabaseConnector } = require("../models/databaseConnector");
const {
  DatabaseConnectorSyncLog,
} = require("../models/databaseConnectorSyncLog");
const { Workspace } = require("../models/workspace");
const { validateAdminQuery } = require("../utils/DatabaseConnectors");
const {
  removeConnectorDocuments,
} = require("../utils/DatabaseConnectors/ingestion");
const {
  buildConnectionString,
  translatePlaceholders,
  syncConnector,
} = require("../utils/DatabaseConnectors/syncEngine");
const {
  getDBClient,
  validateConnection,
} = require("../utils/agents/aibitat/plugins/sql-agent/SQLConnectors");
const { reqBody, queryParams } = require("../utils/http");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../utils/middleware/validatedRequest");

const ADMIN_MIDDLEWARE = [validatedRequest, flexUserRoleValid([ROLES.admin])];

/**
 * Recalculate whether the db-connector-sync poller job should be running
 * and start/stop it at runtime without a server restart.
 */
async function recalcPollerJob() {
  try {
    const { BackgroundService } = require("../utils/BackgroundWorkers/index");
    const bgService = new BackgroundService();
    const shouldRun = await DatabaseConnector.anyActive();
    await bgService.syncDbConnectorJob(shouldRun);
  } catch {
    /* BackgroundService may not be booted yet (e.g. during tests) */
  }
}

function databaseConnectorEndpoints(app) {
  if (!app) return;

  // ── LIST all connectors ────────────────────────────────────────────
  app.get(
    "/database-connectors",
    ADMIN_MIDDLEWARE,
    async (_request, response) => {
      try {
        const raw = await DatabaseConnector.where();
        const connectors = raw.map((c) => DatabaseConnector.redact(c));
        response.status(200).json({ connectors });
      } catch (e) {
        console.error("GET /database-connectors", e.message);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // ── CREATE a connector ─────────────────────────────────────────────
  app.post(
    "/database-connectors",
    ADMIN_MIDDLEWARE,
    async (request, response) => {
      try {
        const body = reqBody(request);
        // Pass through deletion tracking fields; model validates them
        const { connector, error } = await DatabaseConnector.create({
          ...body,
          trackDeletions: body.trackDeletions,
          reconcileEveryNRuns: body.reconcileEveryNRuns,
          softDeleteColumn: body.softDeleteColumn,
        });
        if (error) {
          response.status(400).json({ connector: null, error });
          return;
        }

        // If connector defaults to active, ensure the poller job is running
        if (connector.active) await recalcPollerJob();

        response
          .status(200)
          .json({ connector: DatabaseConnector.redact(connector) });
      } catch (e) {
        console.error("POST /database-connectors", e.message);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // ── GET a single connector ─────────────────────────────────────────
  app.get(
    "/database-connectors/:id",
    ADMIN_MIDDLEWARE,
    async (request, response) => {
      try {
        const { id } = request.params;
        const connector = await DatabaseConnector.get({ id: Number(id) });
        if (!connector) {
          response.status(404).json({ error: "Connector not found" });
          return;
        }
        response
          .status(200)
          .json({ connector: DatabaseConnector.redact(connector) });
      } catch (e) {
        console.error("GET /database-connectors/:id", e.message);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // ── UPDATE a connector ─────────────────────────────────────────────
  app.put(
    "/database-connectors/:id",
    ADMIN_MIDDLEWARE,
    async (request, response) => {
      try {
        const { id } = request.params;
        const body = reqBody(request);

        const existing = await DatabaseConnector.get({ id: Number(id) });
        if (!existing) {
          response.status(404).json({ error: "Connector not found" });
          return;
        }

        // Build the patch. If connectionConfig is provided, handle password merge.
        const patch = {};
        const allowedFields = [
          "name",
          "engine",
          "query",
          "contentColumns",
          "metadataColumns",
          "idColumn",
          "timestampColumn",
          "refreshFreqMinutes",
          "batchSize",
          "active",
          "trackDeletions",
          "reconcileEveryNRuns",
          "softDeleteColumn",
        ];

        for (const field of allowedFields) {
          if (body[field] !== undefined) {
            // Array fields need to be stringified for DB storage
            if (field === "contentColumns" || field === "metadataColumns") {
              patch[field] = JSON.stringify(body[field]);
            } else {
              patch[field] = body[field];
            }
          }
        }

        // Handle connectionConfig updates — absent password = keep existing
        if (body.connectionConfig) {
          const { EncryptionManager } = require("../utils/EncryptionManager");
          const encManager = new EncryptionManager();
          const existingConfig = DatabaseConnector.decryptedConfig(existing);
          const newConfig = { ...existingConfig, ...body.connectionConfig };
          // If password is not provided in the update, keep existing password
          if (body.connectionConfig.password === undefined && existingConfig) {
            newConfig.password = existingConfig.password;
          }
          const encrypted = encManager.encrypt(JSON.stringify(newConfig));
          if (!encrypted) {
            response
              .status(400)
              .json({ error: "Failed to encrypt connection configuration." });
            return;
          }
          patch.connectionConfig = encrypted;
        }

        // Detect active-state flip before the update
        const activeFlipped =
          body.active !== undefined && body.active !== existing.active;

        const { connector, error } = await DatabaseConnector.update(
          Number(id),
          patch
        );
        if (error) {
          response.status(400).json({ connector: null, error });
          return;
        }

        // Recalc poller job when active state changed
        if (activeFlipped) await recalcPollerJob();

        response
          .status(200)
          .json({ connector: DatabaseConnector.redact(connector) });
      } catch (e) {
        console.error("PUT /database-connectors/:id", e.message);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // ── DELETE a connector ─────────────────────────────────────────────
  app.delete(
    "/database-connectors/:id",
    ADMIN_MIDDLEWARE,
    async (request, response) => {
      try {
        const { id } = request.params;
        const { purgeDocuments } = queryParams(request);

        const connector = await DatabaseConnector.get({ id: Number(id) });
        if (!connector) {
          response.status(404).json({ error: "Connector not found" });
          return;
        }

        // If purge requested, remove connector documents from workspace first
        if (purgeDocuments === "true") {
          const workspace = await Workspace.get({
            id: connector.workspaceId,
          });
          if (workspace) {
            await removeConnectorDocuments({
              workspace,
              connectorId: connector.id,
            });
          }
        }

        const wasActive = connector.active;
        const deleted = await DatabaseConnector.delete(Number(id));
        if (!deleted) {
          response.status(500).json({ error: "Failed to delete connector" });
          return;
        }

        // If the deleted connector was active, recalc poller job
        if (wasActive) await recalcPollerJob();

        response.status(200).json({ success: true });
      } catch (e) {
        console.error("DELETE /database-connectors/:id", e.message);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // ── TEST CONNECTION + PREVIEW QUERY ────────────────────────────────
  app.post(
    "/database-connectors/test",
    ADMIN_MIDDLEWARE,
    async (request, response) => {
      try {
        const { engine, connectionConfig, query, softDeleteColumn } = reqBody(request);

        // Validate engine
        if (!DatabaseConnector.supportedEngines.includes(engine)) {
          response.status(400).json({
            success: false,
            error: `Unsupported engine "${engine}". Must be one of: ${DatabaseConnector.supportedEngines.join(", ")}`,
          });
          return;
        }

        // Validate query first — reject before ever opening a connection
        const queryCheck = validateAdminQuery(query);
        if (!queryCheck.valid) {
          response
            .status(400)
            .json({ success: false, error: queryCheck.error });
          return;
        }

        // Build connection string from config
        const connStr = buildConnectionString(engine, connectionConfig);

        // Step 1: validate connection (with 10s timeout)
        const connResult = await Promise.race([
          validateConnection(engine, { connectionString: connStr }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Connection timed out")), 10000)
          ),
        ]);

        if (!connResult.success) {
          response
            .status(400)
            .json({ success: false, error: connResult.error });
          return;
        }

        // Step 2: execute a LIMIT 5 preview query
        const previewSql = `SELECT * FROM ( ${query} ) AS __preview LIMIT 5`;
        const translatedSql = translatePlaceholders(previewSql, engine);

        const client = getDBClient(engine, { connectionString: connStr });
        const queryResult = await Promise.race([
          client.runQuery(translatedSql),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Query execution timed out")),
              10000
            )
          ),
        ]);

        if (queryResult.error) {
          response
            .status(400)
            .json({ success: false, error: queryResult.error });
          return;
        }

        // Extract column names and sample rows
        const sampleRows = queryResult.rows || [];
        const columns = sampleRows.length > 0 ? Object.keys(sampleRows[0]) : [];

        // Check if softDeleteColumn is present in the preview columns
        const responseBody = { success: true, columns, sampleRows };
        if (softDeleteColumn && !columns.includes(softDeleteColumn)) {
          responseBody.warning = `softDeleteColumn '${softDeleteColumn}' not present in query result columns — soft-delete detection will be inert`;
        }

        response.status(200).json(responseBody);
      } catch (e) {
        console.error("POST /database-connectors/test", e.message);
        response.status(400).json({ success: false, error: e.message });
      }
    }
  );

  // ── SYNC NOW (fire-and-forget) ──────────────────────────────────────
  app.post(
    "/database-connectors/:id/sync-now",
    ADMIN_MIDDLEWARE,
    async (request, response) => {
      try {
        const { id } = request.params;
        const connector = await DatabaseConnector.get({ id: Number(id) });
        if (!connector) {
          response.status(404).json({ error: "Connector not found" });
          return;
        }

        if (!connector.active) {
          response
            .status(400)
            .json({ queued: false, reason: "connector is inactive" });
          return;
        }

        // Check syncInProgress (read-only — TOCTOU race is acceptable
        // because acquireLock inside syncConnector will still refuse)
        if (connector.syncInProgress) {
          response
            .status(200)
            .json({ queued: false, reason: "already running" });
          return;
        }

        // Fire-and-forget — do NOT await in the response path
        syncConnector(Number(id)).catch((err) => {
          console.error(
            `sync-now fire-and-forget error for connector ${id}:`,
            err.message
          );
        });

        response.status(200).json({ queued: true });
      } catch (e) {
        console.error("POST /database-connectors/:id/sync-now", e.message);
        response.status(500).json({ error: e.message });
      }
    }
  );

  // ── SYNC LOGS for a connector ──────────────────────────────────────
  app.get(
    "/database-connectors/:id/logs",
    ADMIN_MIDDLEWARE,
    async (request, response) => {
      try {
        const { id } = request.params;
        const { limit } = queryParams(request);

        const connector = await DatabaseConnector.get({ id: Number(id) });
        if (!connector) {
          response.status(404).json({ error: "Connector not found" });
          return;
        }

        const logLimit = limit ? Number(limit) : 20;
        const logs = await DatabaseConnectorSyncLog.forConnector(
          Number(id),
          logLimit
        );
        response.status(200).json({ logs });
      } catch (e) {
        console.error("GET /database-connectors/:id/logs", e.message);
        response.status(500).json({ error: e.message });
      }
    }
  );
}

module.exports = { databaseConnectorEndpoints };
