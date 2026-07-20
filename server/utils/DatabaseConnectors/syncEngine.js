const prisma = require("../prisma");
const { DatabaseConnector } = require("../../models/databaseConnector");
const {
  DatabaseConnectorSyncLog,
} = require("../../models/databaseConnectorSyncLog");
const {
  buildSyncQuery,
  assembleRowContent,
  extractRowMetadata,
  computeNextCursor,
  rowDocPath,
  validateIdentifier,
} = require("./index");
const { upsertRowDocument, removeRowDocument } = require("./ingestion");
const {
  getDBClient,
} = require("../agents/aibitat/plugins/sql-agent/SQLConnectors");

/**
 * Maximum rows processed in a single sync run.
 * When hit the run finishes with status "success" — remaining rows
 * are picked up on the next scheduled run.
 */
const MAX_ROWS_PER_RUN = 10_000;

// ── Placeholder translation ─────────────────────────────────────────

/**
 * Translate `?` placeholders from buildSyncQuery into engine-specific syntax.
 *
 * - mysql:      `?` (native — no change)
 * - postgresql: `$1, $2, $3, ...`
 * - sql-server: `@p0, @p1, @p2, ...`
 *
 * @param {string} sql
 * @param {string} engine
 * @returns {string} translated SQL
 */
function translatePlaceholders(sql, engine) {
  if (engine === "mysql") return sql;

  let idx = 0;
  return sql.replace(/\?/g, () => {
    if (engine === "postgresql") return `$${++idx}`;
    if (engine === "sql-server") return `@p${idx++}`;
    return "?"; // fallback — shouldn't happen
  });
}

// ── Connection-string builder ───────────────────────────────────────

/**
 * Build an RFC-3986 connection string from decrypted config fields.
 *
 * @param {string} engine - mysql | postgresql | sql-server
 * @param {{host:string, port:number, database:string, username:string, password:string}} config
 * @returns {string}
 */
function buildConnectionString(engine, config) {
  const user = encodeURIComponent(config.username || "");
  const pass = encodeURIComponent(config.password || "");
  const host = config.host || "localhost";
  const port = config.port || "";
  const db = config.database || "";

  const schemes = {
    mysql: "mysql",
    postgresql: "postgresql",
    "sql-server": "mssql",
  };
  const scheme = schemes[engine];
  if (!scheme) throw new Error(`Unsupported engine: ${engine}`);

  return `${scheme}://${user}:${pass}@${host}:${port}/${db}`;
}

// ── Core sync ───────────────────────────────────────────────────────

/**
 * Sync a single connector: lock → query batches → upsert rows → release.
 *
 * @param {number|string} connectorId
 * @returns {Promise<object>} result summary
 */
async function syncConnector(connectorId) {
  const id = Number(connectorId);

  // 1. Load connector
  const connector = await DatabaseConnector.get({ id });
  if (!connector) return { success: false, error: "Connector not found" };

  // 2. Acquire lock — if already running, skip
  const locked = await DatabaseConnector.acquireLock(id);
  if (!locked) return { skipped: true, reason: "already running" };

  // Build cursor-before for the log
  const cursorBefore =
    connector.lastSyncCursorTs != null
      ? JSON.stringify({
          ts: connector.lastSyncCursorTs,
          id: connector.lastSyncCursorId,
        })
      : null;

  // 3. Start sync log
  const log = await DatabaseConnectorSyncLog.start(id, cursorBefore);

  const counts = {
    rowsRead: 0,
    rowsAdded: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    rowsDeleted: 0,
  };

  // Track the last-known-good cursor (what's already persisted on the row)
  let finalCursor =
    connector.lastSyncCursorTs != null
      ? { ts: connector.lastSyncCursorTs, id: connector.lastSyncCursorId }
      : null;

  try {
    // Decrypt connection config → build connection string
    const config = DatabaseConnector.decryptedConfig(connector);
    if (!config) throw new Error("Failed to decrypt connection config");

    const connectionString = buildConnectionString(connector.engine, config);
    const contentColumns = JSON.parse(connector.contentColumns);
    const metadataColumns = JSON.parse(connector.metadataColumns || "[]");
    const batchSize = connector.batchSize || 500;

    // Load workspace for upsert calls
    const workspace = await prisma.workspaces.findUnique({
      where: { id: connector.workspaceId },
    });
    if (!workspace) throw new Error("Workspace not found");

    let cursor = finalCursor;

    // ── Batch loop ────────────────────────────────────────────────
    while (true) {
      // Per-run cap check
      if (counts.rowsRead >= MAX_ROWS_PER_RUN) break;

      // Build the keyset-pagination query (uses `?` placeholders)
      const { sql: rawSql, params } = buildSyncQuery({
        query: connector.query,
        timestampColumn: connector.timestampColumn,
        idColumn: connector.idColumn,
        batchSize,
        cursor,
      });

      // Translate `?` to engine-specific placeholders
      const sql = translatePlaceholders(rawSql, connector.engine);

      // New client per batch — each connector closes its connection
      // after runQuery, so reuse is unsafe (especially pg).
      const client = getDBClient(connector.engine, { connectionString });
      const result = await client.runQuery(sql, params);
      if (result.error) throw new Error(`Query failed: ${result.error}`);

      const rows = result.rows;
      if (!rows || rows.length === 0) break;

      counts.rowsRead += rows.length;

      // ── Process rows sequentially (no parallel fan-out) ───────
      for (const row of rows) {
        const content = assembleRowContent(row, contentColumns);
        if (content === null) {
          // All content columns null → skip
          counts.rowsSkipped++;
          continue;
        }

        const idValue = row[connector.idColumn];
        const docPath = rowDocPath(connector.id, idValue);

        // ── Soft-delete check ──────────────────────────────────
        // If softDeleteColumn is set and the row's value is truthy,
        // remove the document instead of upserting.
        // undefined (column not in SELECT) → treated as not-deleted.
        if (
          connector.softDeleteColumn &&
          typeof connector.softDeleteColumn === "string" &&
          row[connector.softDeleteColumn] !== undefined &&
          row[connector.softDeleteColumn]
        ) {
          try {
            const removeResult = await removeRowDocument({
              workspace,
              docPath,
            });
            if (removeResult.success) {
              counts.rowsDeleted++;
            } else {
              console.error(
                `syncEngine: row ${idValue} soft-delete failed: ${removeResult.error}`
              );
              counts.rowsSkipped++;
            }
          } catch (rowError) {
            console.error(
              `syncEngine: row ${idValue} soft-delete error: ${rowError.message}`
            );
            counts.rowsSkipped++;
          }
          continue;
        }

        const metadata = extractRowMetadata(row, metadataColumns);
        const title = `Row ${idValue}`;

        try {
          const upsertResult = await upsertRowDocument({
            workspace,
            connector,
            docPath,
            title,
            content,
            metadata,
          });

          if (upsertResult.status === "added") counts.rowsAdded++;
          else if (upsertResult.status === "updated") counts.rowsUpdated++;
          else {
            // status === "failed" — log but continue
            console.error(
              `syncEngine: row ${idValue} upsert failed: ${upsertResult.error}`
            );
            counts.rowsSkipped++;
          }
        } catch (rowError) {
          console.error(
            `syncEngine: row ${idValue} error: ${rowError.message}`
          );
          counts.rowsSkipped++;
        }
      }

      // Batch fully processed → persist cursor immediately so a crash
      // loses at most the CURRENT batch on next run.
      const batchCursor = computeNextCursor(
        rows,
        connector.timestampColumn,
        connector.idColumn
      );

      await prisma.database_connectors.update({
        where: { id },
        data: {
          lastSyncCursorTs: String(batchCursor.ts),
          lastSyncCursorId: String(batchCursor.id),
        },
      });

      finalCursor = batchCursor;
      cursor = batchCursor;

      // Stop when the batch is smaller than requested (no more rows)
      if (rows.length < batchSize) break;
    }

    // ── Reconciliation phase (same lock held) ─────────────────────
    const nextCounter = (connector.runsSinceReconcile || 0) + 1;
    const shouldReconcile =
      connector.trackDeletions &&
      nextCounter >= connector.reconcileEveryNRuns;
    let reconcileWarning = null;

    if (shouldReconcile) {
      try {
        // Defense-in-depth: validate idColumn (model already guarantees it)
        if (!validateIdentifier(connector.idColumn)) {
          throw new Error(
            `Invalid idColumn identifier: "${connector.idColumn}"`
          );
        }

        // IDs-only query — full scan, no cursor/WHERE needed
        const reconcileSql = translatePlaceholders(
          `SELECT ${connector.idColumn} FROM ( ${connector.query} ) AS __src`,
          connector.engine
        );

        const reconcileClient = getDBClient(connector.engine, {
          connectionString,
        });
        const reconcileResult = await reconcileClient.runQuery(
          reconcileSql,
          []
        );

        if (reconcileResult.error) {
          throw new Error(reconcileResult.error);
        }

        // Build source-ID set with EXACT same sanitization as rowDocPath
        const sourceIdSet = new Set();
        for (const row of reconcileResult.rows) {
          const rawId = row[connector.idColumn];
          const sanitized = String(rawId).replace(/[^A-Za-z0-9_-]/g, "_");
          sourceIdSet.add(sanitized);
        }

        // Fetch all synced docs for this connector
        const prefix = `db-connectors/${connector.id}/row-`;
        const syncedDocs = await prisma.workspace_documents.findMany({
          where: {
            workspaceId: connector.workspaceId,
            docpath: { startsWith: prefix },
          },
        });

        // Diff: docs whose sanitized row-id is NOT in the source set
        const candidates = [];
        for (const doc of syncedDocs) {
          const sanitizedId = doc.docpath.slice(prefix.length).replace(/\.json$/, "");
          if (!sourceIdSet.has(sanitizedId)) {
            candidates.push(doc);
          }
        }

        // Safety threshold: max(10, ceil(20% of total docs))
        const totalDocs = syncedDocs.length;
        const maxAllowed = Math.max(10, Math.ceil(totalDocs * 0.2));

        if (candidates.length > maxAllowed) {
          // ABORT — too many deletions, likely a query problem
          reconcileWarning = `reconciliation aborted: would delete ${candidates.length} of ${totalDocs} docs — exceeds safety threshold`;
          await prisma.database_connectors.update({
            where: { id },
            data: { runsSinceReconcile: nextCounter },
          });
        } else {
          // Delete each candidate
          for (const doc of candidates) {
            try {
              const delResult = await removeRowDocument({
                workspace,
                docPath: doc.docpath,
              });
              if (delResult.success) {
                counts.rowsDeleted++;
              } else {
                console.error(
                  `syncEngine: reconcile delete failed for ${doc.docpath}: ${delResult.error}`
                );
              }
            } catch (delError) {
              console.error(
                `syncEngine: reconcile delete error for ${doc.docpath}: ${delError.message}`
              );
            }
          }

          // Reset counter after successful reconciliation
          await prisma.database_connectors.update({
            where: { id },
            data: { runsSinceReconcile: 0 },
          });
        }
      } catch (reconcileError) {
        // Query error or other failure → skip deletion phase entirely
        reconcileWarning = `reconciliation skipped: ${reconcileError.message}`;
        await prisma.database_connectors.update({
          where: { id },
          data: { runsSinceReconcile: nextCounter },
        });
      }
    } else {
      // No reconciliation this run — persist incremented counter
      await prisma.database_connectors.update({
        where: { id },
        data: { runsSinceReconcile: nextCounter },
      });
    }

    // ── Success ─────────────────────────────────────────────────────
    await DatabaseConnector.releaseLock(id, {
      status: "success",
      cursor: finalCursor,
    });

    if (log) {
      await DatabaseConnectorSyncLog.finish(log.id, {
        status: "success",
        counts,
        cursorAfter: finalCursor ? JSON.stringify(finalCursor) : null,
        error: reconcileWarning || null,
      });
    }

    return { success: true, counts, cursor: finalCursor };
  } catch (error) {
    // ── Failure — lock MUST always be released ───────────────────
    await DatabaseConnector.releaseLock(id, {
      status: "failed",
      error: error.message,
    });

    if (log) {
      await DatabaseConnectorSyncLog.finish(log.id, {
        status: "failed",
        counts,
        error: error.message,
      });
    }

    return { success: false, error: error.message, counts };
  }
}

/**
 * Find all connectors due for sync and run them sequentially.
 * Sequential to bound resource usage (one DB connection at a time).
 *
 * @returns {Promise<object[]>} per-connector results
 */
async function syncAllDue() {
  const dueConnectors = await DatabaseConnector.dueForSync();
  const results = [];
  for (const connector of dueConnectors) {
    const result = await syncConnector(connector.id);
    results.push({ connectorId: connector.id, ...result });
  }
  return results;
}

module.exports = {
  syncConnector,
  syncAllDue,
  // Exported for testability
  translatePlaceholders,
  buildConnectionString,
  MAX_ROWS_PER_RUN,
};
