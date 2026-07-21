const prisma = require("../utils/prisma");
const { EncryptionManager } = require("../utils/EncryptionManager");
const {
  validateAdminQuery,
  validateIdentifier,
} = require("../utils/DatabaseConnectors");

const SUPPORTED_ENGINES = ["mysql", "postgresql", "sql-server"];

const DatabaseConnector = {
  supportedEngines: SUPPORTED_ENGINES,

  /**
   * Create a new database connector.
   * Validates query, identifiers, engine, workspace existence, name uniqueness,
   * and refreshFreqMinutes >= 1 before inserting.
   * connectionConfig is encrypted before storage.
   *
   * @param {object} data
   * @param {string} data.name - Unique connector name
   * @param {string} data.engine - One of mysql | postgresql | sql-server
   * @param {object} data.connectionConfig - {host, port, database, username, password}
   * @param {string} data.query - Admin SELECT query
   * @param {string[]} data.contentColumns - Columns to use as document content
   * @param {string[]} [data.metadataColumns=[]] - Columns for metadata
   * @param {string} data.idColumn - Primary key column
   * @param {string} data.timestampColumn - Timestamp column for ordering
   * @param {number} [data.refreshFreqMinutes=60]
   * @param {number} [data.batchSize=500]
   * @param {number} data.workspaceId
   * @param {boolean} [data.trackDeletions=false]
   * @param {number} [data.reconcileEveryNRuns=10]
   * @param {string} [data.softDeleteColumn]
   * @returns {Promise<{connector: object|null, error: string|null}>}
   */
  create: async function (data) {
    try {
      const {
        name,
        engine,
        connectionConfig,
        query,
        contentColumns = [],
        metadataColumns = [],
        idColumn,
        timestampColumn,
        refreshFreqMinutes = 60,
        batchSize = 500,
        workspaceId,
        trackDeletions = false,
        reconcileEveryNRuns = 10,
        softDeleteColumn,
      } = data;

      // Validate engine
      if (!SUPPORTED_ENGINES.includes(engine)) {
        return {
          connector: null,
          error: `Unsupported engine "${engine}". Must be one of: ${SUPPORTED_ENGINES.join(", ")}`,
        };
      }

      // Validate query
      const queryCheck = validateAdminQuery(query);
      if (!queryCheck.valid) {
        return { connector: null, error: queryCheck.error };
      }

      // Validate identifiers
      if (!validateIdentifier(idColumn)) {
        return {
          connector: null,
          error: `Invalid idColumn identifier: "${idColumn}"`,
        };
      }
      if (!validateIdentifier(timestampColumn)) {
        return {
          connector: null,
          error: `Invalid timestampColumn identifier: "${timestampColumn}"`,
        };
      }
      for (const col of contentColumns) {
        if (!validateIdentifier(col)) {
          return {
            connector: null,
            error: `Invalid contentColumns identifier: "${col}"`,
          };
        }
      }
      for (const col of metadataColumns) {
        if (!validateIdentifier(col)) {
          return {
            connector: null,
            error: `Invalid metadataColumns identifier: "${col}"`,
          };
        }
      }

      // Validate refreshFreqMinutes
      if (
        typeof refreshFreqMinutes !== "number" ||
        !Number.isFinite(refreshFreqMinutes) ||
        refreshFreqMinutes < 1
      ) {
        return {
          connector: null,
          error: "refreshFreqMinutes must be >= 1.",
        };
      }

      // Validate softDeleteColumn if provided
      if (softDeleteColumn && !validateIdentifier(softDeleteColumn)) {
        return {
          connector: null,
          error: `Invalid softDeleteColumn identifier: "${softDeleteColumn}"`,
        };
      }

      // Validate reconcileEveryNRuns if provided
      if (
        reconcileEveryNRuns !== undefined &&
        (typeof reconcileEveryNRuns !== "number" ||
          !Number.isFinite(reconcileEveryNRuns) ||
          reconcileEveryNRuns < 1)
      ) {
        return {
          connector: null,
          error: "reconcileEveryNRuns must be >= 1.",
        };
      }

      // Validate workspace exists
      const workspace = await prisma.workspaces.findUnique({
        where: { id: Number(workspaceId) },
      });
      if (!workspace) {
        return {
          connector: null,
          error: `Workspace ${workspaceId} does not exist.`,
        };
      }

      // Validate name uniqueness
      const existing = await prisma.database_connectors.findUnique({
        where: { name: String(name) },
      });
      if (existing) {
        return {
          connector: null,
          error: `A connector with name "${name}" already exists.`,
        };
      }

      // Encrypt connectionConfig
      const encManager = new EncryptionManager();
      const encrypted = encManager.encrypt(JSON.stringify(connectionConfig));
      if (!encrypted) {
        return {
          connector: null,
          error: "Failed to encrypt connection configuration.",
        };
      }

      const connector = await prisma.database_connectors.create({
        data: {
          name: String(name),
          engine: String(engine),
          connectionConfig: encrypted,
          query: String(query),
          contentColumns: JSON.stringify(contentColumns),
          metadataColumns: JSON.stringify(metadataColumns),
          idColumn: String(idColumn),
          timestampColumn: String(timestampColumn),
          refreshFreqMinutes: Number(refreshFreqMinutes),
          batchSize: Number(batchSize),
          workspaceId: Number(workspaceId),
          trackDeletions: Boolean(trackDeletions),
          reconcileEveryNRuns: Number(reconcileEveryNRuns),
          softDeleteColumn: softDeleteColumn ? String(softDeleteColumn) : null,
        },
      });

      return { connector, error: null };
    } catch (error) {
      console.error("DatabaseConnector.create", error.message);
      return { connector: null, error: error.message };
    }
  },

  /**
   * Get a single connector by clause.
   * @param {object} clause - Prisma where clause
   * @returns {Promise<object|null>}
   */
  get: async function (clause = {}) {
    try {
      const connector = await prisma.database_connectors.findFirst({
        where: clause,
      });
      return connector || null;
    } catch (error) {
      console.error("DatabaseConnector.get", error.message);
      return null;
    }
  },

  /**
   * Get multiple connectors by clause.
   * @param {object} clause - Prisma where clause
   * @param {number|null} limit
   * @returns {Promise<object[]>}
   */
  where: async function (clause = {}, limit = null) {
    try {
      const results = await prisma.database_connectors.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
      });
      return results;
    } catch (error) {
      console.error("DatabaseConnector.where", error.message);
      return [];
    }
  },

  /**
   * Update a connector by id.
   * Validates softDeleteColumn and reconcileEveryNRuns if provided in patch.
   * @param {number} id
   * @param {object} patch - Fields to update
   * @returns {Promise<{connector: object|null, error: string|null}>}
   */
  update: async function (id, patch = {}) {
    try {
      // Validate softDeleteColumn if provided
      if (patch.softDeleteColumn && !validateIdentifier(patch.softDeleteColumn)) {
        return {
          connector: null,
          error: `Invalid softDeleteColumn identifier: "${patch.softDeleteColumn}"`,
        };
      }

      // Validate reconcileEveryNRuns if provided
      if (
        patch.reconcileEveryNRuns !== undefined &&
        (typeof patch.reconcileEveryNRuns !== "number" ||
          !Number.isFinite(patch.reconcileEveryNRuns) ||
          patch.reconcileEveryNRuns < 1)
      ) {
        return {
          connector: null,
          error: "reconcileEveryNRuns must be >= 1.",
        };
      }

      const connector = await prisma.database_connectors.update({
        where: { id: Number(id) },
        data: { ...patch, lastUpdatedAt: new Date() },
      });
      return { connector, error: null };
    } catch (error) {
      console.error("DatabaseConnector.update", error.message);
      return { connector: null, error: error.message };
    }
  },

  /**
   * Delete a connector by id.
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  delete: async function (id) {
    try {
      await prisma.database_connectors.delete({
        where: { id: Number(id) },
      });
      return true;
    } catch (error) {
      console.error("DatabaseConnector.delete", error.message);
      return false;
    }
  },

  /**
   * Decrypt and parse a connector's connectionConfig JSON.
   *
   * !! SERVER-SIDE ONLY !!
   * This method returns the FULL connection config including passwords.
   * It MUST NEVER be exposed via any API endpoint or serialized to a client.
   * Only the sync engine should call this internally.
   *
   * @param {object} connector - A connector record with encrypted connectionConfig
   * @returns {object|null} Parsed {host, port, database, username, password} or null on failure
   */
  decryptedConfig: function (connector) {
    try {
      const encManager = new EncryptionManager();
      const decrypted = encManager.decrypt(connector.connectionConfig);
      if (!decrypted) return null;
      return JSON.parse(decrypted);
    } catch (error) {
      console.error("DatabaseConnector.decryptedConfig", error.message);
      return null;
    }
  },

  /**
   * Return a redacted version of a connector safe for API responses.
   * Decrypts connectionConfig internally but strips the password before returning.
   * Returns all other connector fields as-is plus a redacted connectionConfig.
   * Includes new deletion tracking fields: trackDeletions, reconcileEveryNRuns, softDeleteColumn, runsSinceReconcile.
   *
   * @param {object} connector - A connector record with encrypted connectionConfig
   * @returns {object} Connector with connectionConfig = {host, port, database, username}
   */
  redact: function (connector) {
    const config = this.decryptedConfig(connector);
    const { connectionConfig: _enc, ...rest } = connector;
    return {
      ...rest,
      connectionConfig: config
        ? {
            host: config.host,
            port: config.port,
            database: config.database,
            username: config.username,
          }
        : {},
    };
  },

  /**
   * Check if any active connectors exist.
   * Used to decide whether the background poller job should run.
   * @returns {Promise<boolean>}
   */
  anyActive: async function () {
    try {
      const count = await prisma.database_connectors.count({
        where: { active: true },
      });
      return count > 0;
    } catch (error) {
      console.error("DatabaseConnector.anyActive", error.message);
      return false;
    }
  },

  /**
   * Find connectors that are due for sync.
   * Returns active connectors where:
   *   - syncInProgress = false AND (lastSyncAt IS NULL OR lastSyncAt < now - refreshFreqMinutes)
   *   - PLUS stale-lock recovery: connectors with syncInProgress=true AND
   *     syncStartedAt < now - 2*refreshFreqMinutes get their lock cleared and are included.
   *
   * @returns {Promise<object[]>}
   */
  dueForSync: async function () {
    try {
      const now = new Date();

      // Step 1: Stale-lock recovery — clear locks older than 2x refreshFreqMinutes
      const allActive = await prisma.database_connectors.findMany({
        where: { active: true, syncInProgress: true },
      });

      for (const c of allActive) {
        const staleThresholdMs = c.refreshFreqMinutes * 2 * 60 * 1000;
        if (
          c.syncStartedAt &&
          now.getTime() - new Date(c.syncStartedAt).getTime() > staleThresholdMs
        ) {
          await prisma.database_connectors.update({
            where: { id: c.id },
            data: { syncInProgress: false },
          });
        }
      }

      // Step 2: Find all active connectors not currently syncing that are due
      const dueConnectors = await prisma.database_connectors.findMany({
        where: { active: true, syncInProgress: false },
      });

      return dueConnectors.filter((c) => {
        if (!c.lastSyncAt) return true;
        const thresholdMs = c.refreshFreqMinutes * 60 * 1000;
        return now.getTime() - new Date(c.lastSyncAt).getTime() > thresholdMs;
      });
    } catch (error) {
      console.error("DatabaseConnector.dueForSync", error.message);
      return [];
    }
  },

  /**
   * Atomically acquire a sync lock on a connector.
   * Uses updateMany with a syncInProgress=false filter to ensure mutual exclusion.
   *
   * @param {number} id
   * @returns {Promise<boolean>} true if lock acquired, false if already locked
   */
  acquireLock: async function (id) {
    try {
      const result = await prisma.database_connectors.updateMany({
        where: { id: Number(id), syncInProgress: false },
        data: {
          syncInProgress: true,
          syncStartedAt: new Date(),
        },
      });
      return result.count > 0;
    } catch (error) {
      console.error("DatabaseConnector.acquireLock", error.message);
      return false;
    }
  },

  /**
   * Release a sync lock on a connector and record sync results.
   *
   * @param {number} id
   * @param {object} opts
   * @param {string} opts.status - "success" | "failed"
   * @param {string|null} opts.error - Error message if failed
   * @param {object|null} opts.cursor - {ts, id} cursor to persist
   * @returns {Promise<boolean>}
   */
  releaseLock: async function (id, { status, error: syncError, cursor } = {}) {
    try {
      const data = {
        syncInProgress: false,
        lastSyncStatus: status,
        lastSyncError: syncError || null,
        lastSyncAt: new Date(),
        lastUpdatedAt: new Date(),
      };

      if (cursor) {
        data.lastSyncCursorTs = String(cursor.ts);
        data.lastSyncCursorId = String(cursor.id);
      }

      await prisma.database_connectors.update({
        where: { id: Number(id) },
        data,
      });
      return true;
    } catch (error) {
      console.error("DatabaseConnector.releaseLock", error.message);
      return false;
    }
  },
};

module.exports = { DatabaseConnector };
