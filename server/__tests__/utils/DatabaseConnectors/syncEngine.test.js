process.env.NODE_ENV = "development";

// ── Mock: prisma ────────────────────────────────────────────────────
const mockPrismaUpdate = jest.fn().mockResolvedValue({});
const mockPrismaFindUnique = jest
  .fn()
  .mockResolvedValue({ id: 1, slug: "test-ws" });
const mockPrismaWsDocsFindMany = jest.fn().mockResolvedValue([]);

jest.mock("../../../utils/prisma", () => ({
  database_connectors: {
    update: (...args) => mockPrismaUpdate(...args),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  workspaces: {
    findUnique: (...args) => mockPrismaFindUnique(...args),
  },
  workspace_documents: {
    findMany: (...args) => mockPrismaWsDocsFindMany(...args),
  },
  database_connector_sync_logs: {
    create: jest.fn().mockResolvedValue({ id: 100 }),
    update: jest.fn().mockResolvedValue({}),
  },
}));

// ── Mock: EncryptionManager ─────────────────────────────────────────
jest.mock("../../../utils/EncryptionManager", () => ({
  EncryptionManager: class {
    decrypt(text) {
      return text; // In tests, connectionConfig is already plain JSON
    }
    encrypt(text) {
      return text;
    }
  },
}));

// ── Mock: getDBClient (SQL connectors) ──────────────────────────────
const mockRunQuery = jest.fn();
jest.mock(
  "../../../utils/agents/aibitat/plugins/sql-agent/SQLConnectors",
  () => ({
    getDBClient: jest.fn(() => ({ runQuery: mockRunQuery })),
  })
);

// ── Mock: upsertRowDocument / removeRowDocument ─────────────────────
const mockUpsertRowDocument = jest.fn();
const mockRemoveRowDocument = jest.fn();
jest.mock("../../../utils/DatabaseConnectors/ingestion", () => ({
  upsertRowDocument: (...args) => mockUpsertRowDocument(...args),
  removeRowDocument: (...args) => mockRemoveRowDocument(...args),
}));

// ── Mock: Document model (transitive dep of ingestion) ──────────────
jest.mock("../../../models/documents", () => ({
  Document: { get: jest.fn(), addDocuments: jest.fn(), removeDocuments: jest.fn() },
}));

// ── Mock: files util (transitive dep of ingestion) ──────────────────
jest.mock("../../../utils/files", () => ({
  documentsPath: "/tmp/documents",
  isWithin: () => true,
  normalizePath: (p) => p,
}));

// ── Mock: fs (transitive dep) ───────────────────────────────────────
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn().mockReturnValue(false),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// ── Now require modules under test ──────────────────────────────────
const {
  syncConnector,
  syncAllDue,
  translatePlaceholders,
  buildConnectionString,
  MAX_ROWS_PER_RUN,
} = require("../../../utils/DatabaseConnectors/syncEngine");

const { DatabaseConnector } = require("../../../models/databaseConnector");
const {
  DatabaseConnectorSyncLog,
} = require("../../../models/databaseConnectorSyncLog");
const {
  getDBClient,
} = require("../../../utils/agents/aibitat/plugins/sql-agent/SQLConnectors");

// ── Helpers ─────────────────────────────────────────────────────────
function makeConnector(overrides = {}) {
  return {
    id: 1,
    engine: "mysql",
    connectionConfig: JSON.stringify({
      host: "localhost",
      port: 3306,
      database: "testdb",
      username: "user",
      password: "pass",
    }),
    query: "SELECT * FROM orders",
    contentColumns: JSON.stringify(["description"]),
    metadataColumns: JSON.stringify(["category"]),
    idColumn: "id",
    timestampColumn: "updated_at",
    batchSize: 3,
    workspaceId: 1,
    lastSyncCursorTs: null,
    lastSyncCursorId: null,
    active: true,
    syncInProgress: false,
    refreshFreqMinutes: 60,
    ...overrides,
  };
}

function makeRows(startId, count, tsBase = "2025-01-01T00:00:00Z") {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    updated_at: new Date(
      new Date(tsBase).getTime() + (startId + i) * 1000
    ).toISOString(),
    description: `Item ${startId + i}`,
    category: "A",
  }));
}

// ── Setup / Teardown ────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();

  // Default mock implementations
  jest.spyOn(DatabaseConnector, "get").mockResolvedValue(makeConnector());
  jest.spyOn(DatabaseConnector, "acquireLock").mockResolvedValue(true);
  jest.spyOn(DatabaseConnector, "releaseLock").mockResolvedValue(true);
  jest
    .spyOn(DatabaseConnector, "decryptedConfig")
    .mockReturnValue({
      host: "localhost",
      port: 3306,
      database: "testdb",
      username: "user",
      password: "pass",
    });

  jest
    .spyOn(DatabaseConnectorSyncLog, "start")
    .mockResolvedValue({ id: 100 });
  jest
    .spyOn(DatabaseConnectorSyncLog, "finish")
    .mockResolvedValue({ id: 100 });

  mockUpsertRowDocument.mockResolvedValue({ status: "added" });
  mockRemoveRowDocument.mockResolvedValue({ success: true, removed: true });
  mockPrismaFindUnique.mockResolvedValue({ id: 1, slug: "test-ws" });
  mockPrismaUpdate.mockResolvedValue({});
  mockPrismaWsDocsFindMany.mockResolvedValue([]);
});

// ═════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════

describe("syncEngine", () => {
  // ── Unit: translatePlaceholders ──────────────────────────────────
  describe("translatePlaceholders", () => {
    it("leaves MySQL SQL unchanged (? is native)", () => {
      const sql = "SELECT * FROM t WHERE a > ? OR (a = ? AND b > ?)";
      expect(translatePlaceholders(sql, "mysql")).toBe(sql);
    });

    it("replaces ? with $1,$2,$3 for PostgreSQL", () => {
      const sql = "WHERE a > ? OR (a = ? AND b > ?)";
      expect(translatePlaceholders(sql, "postgresql")).toBe(
        "WHERE a > $1 OR (a = $2 AND b > $3)"
      );
    });

    it("replaces ? with @p0,@p1,@p2 for SQL Server", () => {
      const sql = "WHERE a > ? OR (a = ? AND b > ?)";
      expect(translatePlaceholders(sql, "sql-server")).toBe(
        "WHERE a > @p0 OR (a = @p1 AND b > @p2)"
      );
    });
  });

  // ── Unit: buildConnectionString ─────────────────────────────────
  describe("buildConnectionString", () => {
    const cfg = {
      host: "db.example.com",
      port: 5432,
      database: "mydb",
      username: "admin",
      password: "p@ss!",
    };

    it("builds mysql:// URI", () => {
      const s = buildConnectionString("mysql", cfg);
      expect(s).toMatch(/^mysql:\/\/admin:p%40ss!/);
      expect(s).toContain("db.example.com:5432/mydb");
    });

    it("builds postgresql:// URI", () => {
      const s = buildConnectionString("postgresql", cfg);
      expect(s).toMatch(/^postgresql:\/\//);
    });

    it("builds mssql:// URI for sql-server", () => {
      const s = buildConnectionString("sql-server", cfg);
      expect(s).toMatch(/^mssql:\/\//);
    });

    it("throws on unknown engine", () => {
      expect(() => buildConnectionString("oracle", cfg)).toThrow(
        /Unsupported engine/
      );
    });
  });

  // ── Integration: syncConnector ──────────────────────────────────
  describe("syncConnector", () => {
    // TEST 1: Multi-batch loop — processes 2 full batches + 1 partial
    it("processes multiple batches until rows < batchSize", async () => {
      const batch1 = makeRows(1, 3);   // full batch (batchSize=3)
      const batch2 = makeRows(4, 3);   // full batch
      const batch3 = makeRows(7, 2);   // partial → stop

      mockRunQuery
        .mockResolvedValueOnce({ rows: batch1, count: 3, error: null })
        .mockResolvedValueOnce({ rows: batch2, count: 3, error: null })
        .mockResolvedValueOnce({ rows: batch3, count: 2, error: null });

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      expect(result.counts.rowsRead).toBe(8);
      expect(result.counts.rowsAdded).toBe(8);
      expect(mockRunQuery).toHaveBeenCalledTimes(3);
      expect(getDBClient).toHaveBeenCalledTimes(3);
    });

    // TEST 2: Cursor advances after each batch via prisma.update
    it("persists cursor after each fully-processed batch", async () => {
      const batch1 = makeRows(1, 3);
      const batch2 = makeRows(4, 1); // partial → stop

      mockRunQuery
        .mockResolvedValueOnce({ rows: batch1, count: 3, error: null })
        .mockResolvedValueOnce({ rows: batch2, count: 1, error: null });

      await syncConnector(1);

      // 2 batches → 2 cursor updates + 1 runsSinceReconcile update = 3
      expect(mockPrismaUpdate).toHaveBeenCalledTimes(3);

      // First cursor update should use batch1's last row
      const firstCall = mockPrismaUpdate.mock.calls[0][0];
      expect(firstCall.data.lastSyncCursorId).toBe(String(batch1[2].id));

      // Second cursor update should use batch2's last row
      const secondCall = mockPrismaUpdate.mock.calls[1][0];
      expect(secondCall.data.lastSyncCursorId).toBe(String(batch2[0].id));
    });

    // TEST 3: Stop condition — empty result stops loop
    it("stops when query returns zero rows", async () => {
      mockRunQuery.mockResolvedValueOnce({
        rows: [],
        count: 0,
        error: null,
      });

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      expect(result.counts.rowsRead).toBe(0);
      expect(mockRunQuery).toHaveBeenCalledTimes(1);
    });

    // TEST 4: Failed batch → cursor NOT advanced beyond last good batch
    it("does not advance cursor when a batch query throws", async () => {
      const batch1 = makeRows(1, 3);

      mockRunQuery
        .mockResolvedValueOnce({ rows: batch1, count: 3, error: null })
        .mockResolvedValueOnce({ rows: null, count: 0, error: "Connection lost" });

      const result = await syncConnector(1);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Connection lost");

      // Only 1 cursor update (from batch1), NOT from the failed batch2
      expect(mockPrismaUpdate).toHaveBeenCalledTimes(1);
      const cursorUpdate = mockPrismaUpdate.mock.calls[0][0];
      expect(cursorUpdate.data.lastSyncCursorId).toBe(String(batch1[2].id));

      // Lock MUST be released with status "failed"
      expect(DatabaseConnector.releaseLock).toHaveBeenCalledWith(1, {
        status: "failed",
        error: expect.stringContaining("Connection lost"),
      });
    });

    // TEST 5: Lock-lost skip — acquireLock false → skipped result
    it("returns skipped when lock is already held", async () => {
      DatabaseConnector.acquireLock.mockResolvedValue(false);

      const result = await syncConnector(1);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("already running");
      expect(mockRunQuery).not.toHaveBeenCalled();
    });

    // TEST 6: All-null rows are skipped
    it("skips rows where all content columns are null", async () => {
      const rows = [
        { id: 1, updated_at: "2025-01-01T00:00:01Z", description: null, category: "A" },
        { id: 2, updated_at: "2025-01-01T00:00:02Z", description: "Valid", category: "B" },
      ];

      mockRunQuery.mockResolvedValueOnce({
        rows,
        count: 2,
        error: null,
      });

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      expect(result.counts.rowsRead).toBe(2);
      expect(result.counts.rowsSkipped).toBe(1); // null row
      expect(result.counts.rowsAdded).toBe(1);   // valid row
      // upsertRowDocument called only for the valid row
      expect(mockUpsertRowDocument).toHaveBeenCalledTimes(1);
    });

    // TEST 7: Per-run cap stops the loop at MAX_ROWS_PER_RUN
    it("stops at MAX_ROWS_PER_RUN and finishes as success", async () => {
      // Use a small batch size to demonstrate the cap triggers correctly.
      // We'll set batchSize = 5000 so 2 full batches = 10000 = cap.
      const connector = makeConnector({ batchSize: 5000 });
      DatabaseConnector.get.mockResolvedValue(connector);

      const largeBatch1 = makeRows(1, 5000);
      const largeBatch2 = makeRows(5001, 5000);

      mockRunQuery
        .mockResolvedValueOnce({ rows: largeBatch1, count: 5000, error: null })
        .mockResolvedValueOnce({ rows: largeBatch2, count: 5000, error: null });

      mockUpsertRowDocument.mockResolvedValue({ status: "added" });

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      // After 2 full batches: rowsRead=10000 → cap hit, loop stops
      // (the second batch was the last one processed; the cap check
      // fires at the TOP of the next iteration, so 10000 rows were read)
      expect(result.counts.rowsRead).toBe(10000);
      // Should NOT attempt a 3rd query
      expect(mockRunQuery).toHaveBeenCalledTimes(2);
    });

    // TEST 8: Error path writes failed log
    it("writes failed sync log when an error occurs", async () => {
      mockRunQuery.mockResolvedValueOnce({
        rows: null,
        count: 0,
        error: "ECONNREFUSED",
      });

      const result = await syncConnector(1);

      expect(result.success).toBe(false);
      expect(DatabaseConnectorSyncLog.finish).toHaveBeenCalledWith(100, {
        status: "failed",
        counts: expect.objectContaining({ rowsRead: 0 }),
        error: expect.stringContaining("ECONNREFUSED"),
      });
    });

    // TEST 9: Lock always released on error (try/finally semantic)
    it("releases lock even when decryptedConfig returns null", async () => {
      DatabaseConnector.decryptedConfig.mockReturnValue(null);

      const result = await syncConnector(1);

      expect(result.success).toBe(false);
      expect(result.error).toContain("decrypt");
      expect(DatabaseConnector.releaseLock).toHaveBeenCalledWith(1, {
        status: "failed",
        error: expect.stringContaining("decrypt"),
      });
    });

    // TEST 10: Per-row upsert failure → rowsSkipped++, continues
    it("counts per-row upsert failures as skipped and continues", async () => {
      const rows = makeRows(1, 3);
      mockRunQuery
        .mockResolvedValueOnce({ rows, count: 3, error: null })
        // Full batch (3=batchSize) → loop continues; return empty to stop
        .mockResolvedValueOnce({ rows: [], count: 0, error: null });

      mockUpsertRowDocument
        .mockResolvedValueOnce({ status: "added" })
        .mockResolvedValueOnce({ status: "failed", error: "embed failed" })
        .mockResolvedValueOnce({ status: "updated" });

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      expect(result.counts.rowsAdded).toBe(1);
      expect(result.counts.rowsUpdated).toBe(1);
      expect(result.counts.rowsSkipped).toBe(1);
      // All 3 rows attempted — no abort on row failure
      expect(mockUpsertRowDocument).toHaveBeenCalledTimes(3);
    });

    // TEST 11: Per-row thrown exception → skipped, not abort
    it("catches thrown row exceptions as skipped, does not abort batch", async () => {
      const rows = makeRows(1, 2);
      mockRunQuery.mockResolvedValueOnce({
        rows,
        count: 2,
        error: null,
      });

      mockUpsertRowDocument
        .mockRejectedValueOnce(new Error("disk full"))
        .mockResolvedValueOnce({ status: "added" });

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      expect(result.counts.rowsSkipped).toBe(1);
      expect(result.counts.rowsAdded).toBe(1);
    });

    // TEST 12: Connector not found
    it("returns error when connector does not exist", async () => {
      DatabaseConnector.get.mockResolvedValue(null);

      const result = await syncConnector(999);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    // TEST 13: Success path calls releaseLock with final cursor
    it("releases lock with status success and final cursor on completion", async () => {
      const batch = makeRows(1, 2);
      mockRunQuery.mockResolvedValueOnce({
        rows: batch,
        count: 2,
        error: null,
      });

      await syncConnector(1);

      expect(DatabaseConnector.releaseLock).toHaveBeenCalledWith(1, {
        status: "success",
        cursor: {
          ts: String(batch[1].updated_at),
          id: String(batch[1].id),
        },
      });
    });
  });

  // ── Soft-delete tests ────────────────────────────────────────────
  describe("soft-delete", () => {
    // TEST SD-1: truthy deleted_at → removeRowDocument, NOT upsert
    it("calls removeRowDocument for rows with truthy softDeleteColumn", async () => {
      const connector = makeConnector({ softDeleteColumn: "deleted_at" });
      DatabaseConnector.get.mockResolvedValue(connector);

      const rows = [
        { id: 1, updated_at: "2025-01-01T00:00:01Z", description: "Item 1", category: "A", deleted_at: "2025-06-01" },
      ];
      mockRunQuery
        .mockResolvedValueOnce({ rows, count: 1, error: null });

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      expect(result.counts.rowsDeleted).toBe(1);
      expect(result.counts.rowsAdded).toBe(0);
      expect(mockRemoveRowDocument).toHaveBeenCalledTimes(1);
      expect(mockRemoveRowDocument).toHaveBeenCalledWith({
        workspace: { id: 1, slug: "test-ws" },
        docPath: "db-connectors/1/row-1.json",
      });
      expect(mockUpsertRowDocument).not.toHaveBeenCalled();
      // Cursor still advances past the soft-deleted row
      expect(mockPrismaUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastSyncCursorId: "1",
          }),
        })
      );
    });

    // TEST SD-2: softDeleteColumn unset → all rows upserted
    it("upserts all rows when softDeleteColumn is not set", async () => {
      const connector = makeConnector({ softDeleteColumn: null });
      DatabaseConnector.get.mockResolvedValue(connector);

      const rows = [
        { id: 1, updated_at: "2025-01-01T00:00:01Z", description: "Item 1", category: "A", deleted_at: "2025-06-01" },
      ];
      mockRunQuery.mockResolvedValueOnce({ rows, count: 1, error: null });

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      expect(result.counts.rowsAdded).toBe(1);
      expect(mockUpsertRowDocument).toHaveBeenCalledTimes(1);
      expect(mockRemoveRowDocument).not.toHaveBeenCalled();
    });

    // TEST SD-3: row[col] === undefined → treated as not-deleted, upserted
    it("upserts row when softDeleteColumn value is undefined (column not selected)", async () => {
      const connector = makeConnector({ softDeleteColumn: "deleted_at" });
      DatabaseConnector.get.mockResolvedValue(connector);

      // Row does NOT have deleted_at key at all
      const rows = [
        { id: 1, updated_at: "2025-01-01T00:00:01Z", description: "Item 1", category: "A" },
      ];
      mockRunQuery.mockResolvedValueOnce({ rows, count: 1, error: null });

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      expect(result.counts.rowsAdded).toBe(1);
      expect(mockUpsertRowDocument).toHaveBeenCalledTimes(1);
      expect(mockRemoveRowDocument).not.toHaveBeenCalled();
    });
  });

  // ── Reconciliation tests ──────────────────────────────────────────
  describe("reconciliation", () => {
    // TEST R-1: Reconciliation runs only when counter threshold reached; counter resets
    it("runs reconciliation when counter reaches threshold and resets counter", async () => {
      const connector = makeConnector({
        trackDeletions: true,
        reconcileEveryNRuns: 3,
        runsSinceReconcile: 2,
        softDeleteColumn: null,
      });
      DatabaseConnector.get.mockResolvedValue(connector);

      // Batch loop: 1 row → done
      const rows = makeRows(1, 1);
      mockRunQuery
        .mockResolvedValueOnce({ rows, count: 1, error: null })
        // Reconciliation IDs query: source has id 1
        .mockResolvedValueOnce({ rows: [{ id: 1 }], error: null });

      // Synced docs: only row-1 → no candidates
      mockPrismaWsDocsFindMany.mockResolvedValue([
        { docpath: "db-connectors/1/row-1.json" },
      ]);

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      // getDBClient called 2x: 1 for batch + 1 for reconciliation
      expect(getDBClient).toHaveBeenCalledTimes(2);
      // Counter reset to 0 (the LAST prisma update for runsSinceReconcile)
      const counterUpdates = mockPrismaUpdate.mock.calls.filter(
        (call) => call[0]?.data?.runsSinceReconcile !== undefined
      );
      expect(counterUpdates.length).toBeGreaterThan(0);
      const lastCounterUpdate = counterUpdates[counterUpdates.length - 1];
      expect(lastCounterUpdate[0].data.runsSinceReconcile).toBe(0);
    });

    // TEST R-2: Reconciliation diff — source [1,2], docs [1,2,3] → doc 3 removed
    it("removes docs not present in source IDs", async () => {
      const connector = makeConnector({
        trackDeletions: true,
        reconcileEveryNRuns: 1,
        runsSinceReconcile: 0,
        softDeleteColumn: null,
      });
      DatabaseConnector.get.mockResolvedValue(connector);

      // Batch loop: 1 row
      mockRunQuery
        .mockResolvedValueOnce({ rows: makeRows(1, 1), count: 1, error: null })
        // Reconciliation IDs query: source has ids 1 and 2
        .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], error: null });

      // Synced docs: row-1, row-2, row-3 → row-3 is orphaned
      mockPrismaWsDocsFindMany.mockResolvedValue([
        { docpath: "db-connectors/1/row-1.json" },
        { docpath: "db-connectors/1/row-2.json" },
        { docpath: "db-connectors/1/row-3.json" },
      ]);

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      // removeRowDocument called once for reconciliation (row-3)
      expect(mockRemoveRowDocument).toHaveBeenCalledWith({
        workspace: { id: 1, slug: "test-ws" },
        docPath: "db-connectors/1/row-3.json",
      });
      expect(result.counts.rowsDeleted).toBe(1);
    });

    // TEST R-3: IDs-query error → deletion phase skipped, warning, counter NOT reset
    it("skips reconciliation on query error, records warning, keeps counter", async () => {
      const connector = makeConnector({
        trackDeletions: true,
        reconcileEveryNRuns: 1,
        runsSinceReconcile: 0,
        softDeleteColumn: null,
      });
      DatabaseConnector.get.mockResolvedValue(connector);

      // Batch loop: 1 row
      mockRunQuery
        .mockResolvedValueOnce({ rows: makeRows(1, 1), count: 1, error: null })
        // Reconciliation IDs query FAILS
        .mockResolvedValueOnce({ rows: null, error: "connection timeout" });

      const result = await syncConnector(1);

      // Run is still success (incremental results stand)
      expect(result.success).toBe(true);
      // removeRowDocument NOT called for reconciliation
      expect(mockRemoveRowDocument).not.toHaveBeenCalled();
      // Sync log has warning in error field
      expect(DatabaseConnectorSyncLog.finish).toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          status: "success",
          error: expect.stringContaining("reconciliation skipped"),
        })
      );
      // Counter NOT reset — persisted as nextCounter (1)
      const counterUpdates = mockPrismaUpdate.mock.calls.filter(
        (call) => call[0]?.data?.runsSinceReconcile !== undefined
      );
      const lastCounterUpdate = counterUpdates[counterUpdates.length - 1];
      expect(lastCounterUpdate[0].data.runsSinceReconcile).toBe(1);
    });

    // TEST R-4: Threshold abort — candidates > max(10, 20%)
    it("aborts reconciliation when candidates exceed safety threshold", async () => {
      const connector = makeConnector({
        trackDeletions: true,
        reconcileEveryNRuns: 1,
        runsSinceReconcile: 0,
        softDeleteColumn: null,
      });
      DatabaseConnector.get.mockResolvedValue(connector);

      // Batch loop: 1 row
      mockRunQuery
        .mockResolvedValueOnce({ rows: makeRows(1, 1), count: 1, error: null })
        // Reconciliation IDs query: source has 45 ids (1..45)
        .mockResolvedValueOnce({
          rows: Array.from({ length: 45 }, (_, i) => ({ id: i + 1 })),
          error: null,
        });

      // Synced docs: 60 docs (ids 1..60)
      // threshold = max(10, ceil(60 * 0.2)) = max(10, 12) = 12
      // candidates = 15 (ids 46..60 not in source) > 12 → ABORT
      mockPrismaWsDocsFindMany.mockResolvedValue(
        Array.from({ length: 60 }, (_, i) => ({
          docpath: `db-connectors/1/row-${i + 1}.json`,
        }))
      );

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      // removeRowDocument NOT called — threshold abort
      expect(mockRemoveRowDocument).not.toHaveBeenCalled();
      // Warning recorded in sync log
      expect(DatabaseConnectorSyncLog.finish).toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          status: "success",
          error: expect.stringContaining("reconciliation aborted"),
          error: expect.stringContaining("exceeds safety threshold"),
        })
      );
      // Counter NOT reset
      const counterUpdates = mockPrismaUpdate.mock.calls.filter(
        (call) => call[0]?.data?.runsSinceReconcile !== undefined
      );
      const lastCounterUpdate = counterUpdates[counterUpdates.length - 1];
      expect(lastCounterUpdate[0].data.runsSinceReconcile).toBe(1);
    });

    // TEST R-5: Sanitization alignment — source id "a b" matches doc row-a_b.json
    it("aligns sanitization so source id 'a b' matches doc row-a_b.json", async () => {
      const connector = makeConnector({
        trackDeletions: true,
        reconcileEveryNRuns: 1,
        runsSinceReconcile: 0,
        softDeleteColumn: null,
      });
      DatabaseConnector.get.mockResolvedValue(connector);

      // Batch loop: 1 row
      mockRunQuery
        .mockResolvedValueOnce({ rows: makeRows(1, 1), count: 1, error: null })
        // Reconciliation: source has id "a b" (with space)
        .mockResolvedValueOnce({ rows: [{ id: "a b" }], error: null });

      // Synced docs: row-a_b.json (space → underscore by rowDocPath sanitization)
      mockPrismaWsDocsFindMany.mockResolvedValue([
        { docpath: "db-connectors/1/row-a_b.json" },
      ]);

      const result = await syncConnector(1);

      expect(result.success).toBe(true);
      // No false-positive delete — "a b" sanitizes to "a_b" matching the doc
      expect(mockRemoveRowDocument).not.toHaveBeenCalled();
      expect(result.counts.rowsDeleted).toBe(0);
    });
  });

  // ── Integration: syncAllDue ─────────────────────────────────────
  describe("syncAllDue", () => {
    it("runs dueForSync connectors sequentially", async () => {
      const c1 = makeConnector({ id: 10 });
      const c2 = makeConnector({ id: 20 });

      jest.spyOn(DatabaseConnector, "dueForSync").mockResolvedValue([c1, c2]);
      DatabaseConnector.get
        .mockResolvedValueOnce(c1)
        .mockResolvedValueOnce(c2);

      // Each connector gets 1 partial batch → done
      mockRunQuery
        .mockResolvedValueOnce({ rows: makeRows(1, 1), count: 1, error: null })
        .mockResolvedValueOnce({ rows: makeRows(1, 1), count: 1, error: null });

      const results = await syncAllDue();

      expect(results).toHaveLength(2);
      expect(results[0].connectorId).toBe(10);
      expect(results[1].connectorId).toBe(20);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});
