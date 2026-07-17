const prisma = require("../utils/prisma");

const DatabaseConnectorSyncLog = {
  /**
   * Start a new sync log entry.
   * @param {number} connectorId
   * @param {string|null} cursorBefore - The cursor state before this sync run
   * @returns {Promise<object|null>}
   */
  start: async function (connectorId, cursorBefore = null) {
    try {
      const log = await prisma.database_connector_sync_logs.create({
        data: {
          connectorId: Number(connectorId),
          startedAt: new Date(),
          status: "running",
          cursorBefore: cursorBefore ? String(cursorBefore) : null,
        },
      });
      return log;
    } catch (error) {
      console.error("DatabaseConnectorSyncLog.start", error.message);
      return null;
    }
  },

  /**
   * Finish a sync log entry with results.
   * @param {number} id - Sync log ID
   * @param {object} opts
   * @param {string} opts.status - "success" | "failed"
   * @param {object} [opts.counts={}] - {rowsRead, rowsAdded, rowsUpdated, rowsSkipped}
   * @param {string|null} [opts.cursorAfter=null]
   * @param {string|null} [opts.error=null]
   * @returns {Promise<object|null>}
   */
  finish: async function (id, { status, counts = {}, cursorAfter = null, error: syncError = null } = {}) {
    try {
      const log = await prisma.database_connector_sync_logs.update({
        where: { id: Number(id) },
        data: {
          status: String(status),
          finishedAt: new Date(),
          rowsRead: counts.rowsRead ?? 0,
          rowsAdded: counts.rowsAdded ?? 0,
          rowsUpdated: counts.rowsUpdated ?? 0,
          rowsSkipped: counts.rowsSkipped ?? 0,
          cursorAfter: cursorAfter ? String(cursorAfter) : null,
          error: syncError ? String(syncError) : null,
        },
      });
      return log;
    } catch (error) {
      console.error("DatabaseConnectorSyncLog.finish", error.message);
      return null;
    }
  },

  /**
   * Get sync logs for a connector, most recent first.
   * @param {number} connectorId
   * @param {number} limit
   * @returns {Promise<object[]>}
   */
  forConnector: async function (connectorId, limit = 20) {
    try {
      const logs = await prisma.database_connector_sync_logs.findMany({
        where: { connectorId: Number(connectorId) },
        orderBy: { startedAt: "desc" },
        take: limit,
      });
      return logs;
    } catch (error) {
      console.error("DatabaseConnectorSyncLog.forConnector", error.message);
      return [];
    }
  },

  /**
   * Mark all orphaned "running" sync logs as failed on boot.
   * These are logs from sync runs that were interrupted by a server restart.
   * @returns {Promise<number>} Count of rows updated
   */
  failOrphanedRuns: async function () {
    try {
      const result = await prisma.database_connector_sync_logs.updateMany({
        where: { status: "running" },
        data: {
          status: "failed",
          error: "Orphaned by server restart",
          finishedAt: new Date(),
        },
      });
      return result.count;
    } catch (error) {
      console.error(
        "DatabaseConnectorSyncLog.failOrphanedRuns",
        error.message
      );
      return 0;
    }
  },
};

module.exports = { DatabaseConnectorSyncLog };
