/* eslint-env jest */

// ─── Prisma Mock ────────────────────────────────────────────────────
// jest.mock is hoisted above all variable declarations, so we define
// the mock object inline inside the factory to avoid TDZ errors.
// We grab a reference via require so tests can set mock return values.
jest.mock("../../utils/prisma", () => ({
  database_connectors: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  database_connector_sync_logs: {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  workspaces: {
    findUnique: jest.fn(),
  },
  $queryRawUnsafe: jest.fn(),
}));

const mockPrisma = require("../../utils/prisma");
const { EncryptionManager } = require("../../utils/EncryptionManager");
const { DatabaseConnector } = require("../../models/databaseConnector");
const {
  DatabaseConnectorSyncLog,
} = require("../../models/databaseConnectorSyncLog");

// ─── Helpers ────────────────────────────────────────────────────────
const validCreateData = () => ({
  name: "test-connector",
  engine: "postgresql",
  connectionConfig: {
    host: "localhost",
    port: 5432,
    database: "testdb",
    username: "user",
    password: "hunter2",
  },
  query: "SELECT * FROM articles",
  contentColumns: ["title", "body"],
  metadataColumns: ["author"],
  idColumn: "id",
  timestampColumn: "updated_at",
  refreshFreqMinutes: 30,
  batchSize: 100,
  workspaceId: 1,
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════
// DatabaseConnector Tests
// ═════════════════════════════════════════════════════════════════════

describe("DatabaseConnector", () => {
  // ─── Encryption ─────────────────────────────────────────────────
  describe("encryption round-trip", () => {
    test("encrypt produces ciphertext different from plaintext", () => {
      const enc = new EncryptionManager();
      const plaintext = JSON.stringify({ password: "hunter2" });
      const ciphertext = enc.encrypt(plaintext);
      expect(ciphertext).not.toBeNull();
      expect(ciphertext).not.toBe(plaintext);
      expect(ciphertext).not.toContain("hunter2");
    });

    test("decrypt returns original plaintext", () => {
      const enc = new EncryptionManager();
      const original = JSON.stringify({
        host: "localhost",
        port: 5432,
        database: "testdb",
        username: "user",
        password: "hunter2",
      });
      const ciphertext = enc.encrypt(original);
      const decrypted = enc.decrypt(ciphertext);
      expect(decrypted).toBe(original);
      expect(JSON.parse(decrypted).password).toBe("hunter2");
    });

    test("ciphertext stored in DB does NOT contain plaintext password", async () => {
      let capturedData = null;
      mockPrisma.workspaces.findUnique.mockResolvedValue({ id: 1 });
      mockPrisma.database_connectors.findUnique.mockResolvedValue(null);
      mockPrisma.database_connectors.create.mockImplementation(({ data }) => {
        capturedData = data;
        return Promise.resolve({ id: 1, ...data });
      });

      await DatabaseConnector.create(validCreateData());

      expect(capturedData).not.toBeNull();
      expect(capturedData.connectionConfig).not.toContain("hunter2");
      expect(capturedData.connectionConfig).not.toContain("localhost");

      // Verify the encrypted value can be decrypted back
      const enc = new EncryptionManager();
      const decrypted = JSON.parse(enc.decrypt(capturedData.connectionConfig));
      expect(decrypted.password).toBe("hunter2");
      expect(decrypted.host).toBe("localhost");
    });
  });

  // ─── decryptedConfig ────────────────────────────────────────────
  describe("decryptedConfig", () => {
    test("decrypts and parses connectionConfig JSON", () => {
      const enc = new EncryptionManager();
      const config = {
        host: "db.example.com",
        port: 3306,
        database: "prod",
        username: "admin",
        password: "s3cret",
      };
      const encrypted = enc.encrypt(JSON.stringify(config));
      const connector = { connectionConfig: encrypted };

      const result = DatabaseConnector.decryptedConfig(connector);
      expect(result).toEqual(config);
    });

    test("returns null on invalid encrypted data", () => {
      const result = DatabaseConnector.decryptedConfig({
        connectionConfig: "garbage-data",
      });
      expect(result).toBeNull();
    });
  });

  // ─── redact ─────────────────────────────────────────────────────
  describe("redact", () => {
    test("removes password from connectionConfig", () => {
      const enc = new EncryptionManager();
      const config = {
        host: "db.example.com",
        port: 3306,
        database: "prod",
        username: "admin",
        password: "s3cret",
      };
      const encrypted = enc.encrypt(JSON.stringify(config));
      const connector = {
        id: 1,
        name: "test",
        engine: "mysql",
        connectionConfig: encrypted,
        query: "SELECT 1",
      };

      const redacted = DatabaseConnector.redact(connector);

      expect(redacted.connectionConfig).toEqual({
        host: "db.example.com",
        port: 3306,
        database: "prod",
        username: "admin",
      });
      expect(redacted.connectionConfig.password).toBeUndefined();
      expect(redacted.id).toBe(1);
      expect(redacted.name).toBe("test");
    });
  });

  // ─── create validation ──────────────────────────────────────────
  describe("create validation", () => {
    test("rejects unknown engine", async () => {
      const data = { ...validCreateData(), engine: "oracle" };
      const { connector, error } = await DatabaseConnector.create(data);
      expect(connector).toBeNull();
      expect(error).toMatch(/Unsupported engine/);
    });

    test("rejects non-SELECT query", async () => {
      const data = { ...validCreateData(), query: "DELETE FROM users" };
      const { connector, error } = await DatabaseConnector.create(data);
      expect(connector).toBeNull();
      expect(error).toMatch(/SELECT/);
    });

    test("rejects invalid idColumn identifier", async () => {
      const data = { ...validCreateData(), idColumn: "id; DROP TABLE" };
      const { connector, error } = await DatabaseConnector.create(data);
      expect(connector).toBeNull();
      expect(error).toMatch(/idColumn/);
    });

    test("rejects invalid timestampColumn identifier", async () => {
      const data = {
        ...validCreateData(),
        timestampColumn: "col with spaces",
      };
      const { connector, error } = await DatabaseConnector.create(data);
      expect(connector).toBeNull();
      expect(error).toMatch(/timestampColumn/);
    });

    test("rejects invalid contentColumns identifier", async () => {
      const data = {
        ...validCreateData(),
        contentColumns: ["valid", "not valid!"],
      };
      const { connector, error } = await DatabaseConnector.create(data);
      expect(connector).toBeNull();
      expect(error).toMatch(/contentColumns/);
    });

    test("rejects invalid metadataColumns identifier", async () => {
      const data = {
        ...validCreateData(),
        metadataColumns: ["bad col"],
      };
      const { connector, error } = await DatabaseConnector.create(data);
      expect(connector).toBeNull();
      expect(error).toMatch(/metadataColumns/);
    });

    test("rejects refreshFreqMinutes = 0", async () => {
      const data = { ...validCreateData(), refreshFreqMinutes: 0 };
      const { connector, error } = await DatabaseConnector.create(data);
      expect(connector).toBeNull();
      expect(error).toMatch(/refreshFreqMinutes/);
    });

    test("rejects negative refreshFreqMinutes", async () => {
      const data = { ...validCreateData(), refreshFreqMinutes: -5 };
      const { connector, error } = await DatabaseConnector.create(data);
      expect(connector).toBeNull();
      expect(error).toMatch(/refreshFreqMinutes/);
    });

    test("rejects missing workspace", async () => {
      mockPrisma.workspaces.findUnique.mockResolvedValue(null);
      const { connector, error } = await DatabaseConnector.create(
        validCreateData()
      );
      expect(connector).toBeNull();
      expect(error).toMatch(/Workspace.*does not exist/);
    });

    test("rejects duplicate name", async () => {
      mockPrisma.workspaces.findUnique.mockResolvedValue({ id: 1 });
      mockPrisma.database_connectors.findUnique.mockResolvedValue({
        id: 99,
        name: "test-connector",
      });
      const { connector, error } = await DatabaseConnector.create(
        validCreateData()
      );
      expect(connector).toBeNull();
      expect(error).toMatch(/already exists/);
    });

    test("successful create encrypts config and inserts", async () => {
      mockPrisma.workspaces.findUnique.mockResolvedValue({ id: 1 });
      mockPrisma.database_connectors.findUnique.mockResolvedValue(null);
      mockPrisma.database_connectors.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 1, ...data })
      );

      const { connector, error } = await DatabaseConnector.create(
        validCreateData()
      );
      expect(error).toBeNull();
      expect(connector).not.toBeNull();
      expect(connector.engine).toBe("postgresql");
      // connectionConfig should be encrypted (not raw JSON)
      expect(connector.connectionConfig).not.toContain("hunter2");
    });
  });

  // ─── CRUD operations ───────────────────────────────────────────
  describe("get", () => {
    test("returns connector by clause", async () => {
      const expected = { id: 1, name: "test" };
      mockPrisma.database_connectors.findFirst.mockResolvedValue(expected);
      const result = await DatabaseConnector.get({ id: 1 });
      expect(result).toEqual(expected);
    });

    test("returns null when not found", async () => {
      mockPrisma.database_connectors.findFirst.mockResolvedValue(null);
      const result = await DatabaseConnector.get({ id: 999 });
      expect(result).toBeNull();
    });
  });

  describe("where", () => {
    test("returns matching connectors", async () => {
      const expected = [{ id: 1 }, { id: 2 }];
      mockPrisma.database_connectors.findMany.mockResolvedValue(expected);
      const result = await DatabaseConnector.where({ active: true });
      expect(result).toEqual(expected);
    });

    test("passes limit as take", async () => {
      mockPrisma.database_connectors.findMany.mockResolvedValue([]);
      await DatabaseConnector.where({ active: true }, 5);
      expect(mockPrisma.database_connectors.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });
  });

  describe("update", () => {
    test("updates connector and sets lastUpdatedAt", async () => {
      const updated = { id: 1, name: "renamed" };
      mockPrisma.database_connectors.update.mockResolvedValue(updated);
      const { connector, error } = await DatabaseConnector.update(1, {
        name: "renamed",
      });
      expect(error).toBeNull();
      expect(connector).toEqual(updated);
      const callData =
        mockPrisma.database_connectors.update.mock.calls[0][0].data;
      expect(callData.lastUpdatedAt).toBeInstanceOf(Date);
    });
  });

  describe("delete", () => {
    test("deletes and returns true", async () => {
      mockPrisma.database_connectors.delete.mockResolvedValue({});
      const result = await DatabaseConnector.delete(1);
      expect(result).toBe(true);
    });

    test("returns false on error", async () => {
      mockPrisma.database_connectors.delete.mockRejectedValue(
        new Error("not found")
      );
      const result = await DatabaseConnector.delete(999);
      expect(result).toBe(false);
    });
  });

  // ─── dueForSync ─────────────────────────────────────────────────
  describe("dueForSync", () => {
    test("returns connectors with null lastSyncAt", async () => {
      const connector = {
        id: 1,
        active: true,
        syncInProgress: false,
        lastSyncAt: null,
        refreshFreqMinutes: 60,
      };
      // Step 1: no stale-locked connectors
      mockPrisma.database_connectors.findMany
        .mockResolvedValueOnce([]) // active + syncInProgress=true (stale check)
        .mockResolvedValueOnce([connector]); // active + syncInProgress=false

      const result = await DatabaseConnector.dueForSync();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    test("returns connectors past their refresh threshold", async () => {
      const pastDue = {
        id: 2,
        active: true,
        syncInProgress: false,
        lastSyncAt: new Date(Date.now() - 120 * 60 * 1000), // 2 hours ago
        refreshFreqMinutes: 60,
      };
      const notDue = {
        id: 3,
        active: true,
        syncInProgress: false,
        lastSyncAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
        refreshFreqMinutes: 60,
      };
      mockPrisma.database_connectors.findMany
        .mockResolvedValueOnce([]) // stale lock check
        .mockResolvedValueOnce([pastDue, notDue]);

      const result = await DatabaseConnector.dueForSync();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });

    test("recovers stale locks (syncStartedAt > 2x refreshFreqMinutes)", async () => {
      const staleLocked = {
        id: 4,
        active: true,
        syncInProgress: true,
        syncStartedAt: new Date(Date.now() - 200 * 60 * 1000), // 200 min ago
        refreshFreqMinutes: 60, // stale threshold = 120 min
        lastSyncAt: null,
      };
      mockPrisma.database_connectors.findMany
        .mockResolvedValueOnce([staleLocked]) // stale lock check
        .mockResolvedValueOnce([{ ...staleLocked, syncInProgress: false }]); // after recovery
      mockPrisma.database_connectors.update.mockResolvedValue({});

      const result = await DatabaseConnector.dueForSync();

      // Verify the stale lock was cleared
      expect(mockPrisma.database_connectors.update).toHaveBeenCalledWith({
        where: { id: 4 },
        data: { syncInProgress: false },
      });
      expect(result).toHaveLength(1);
    });

    test("does NOT clear locks within threshold", async () => {
      const recentLocked = {
        id: 5,
        active: true,
        syncInProgress: true,
        syncStartedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 min ago
        refreshFreqMinutes: 60, // stale threshold = 120 min
      };
      mockPrisma.database_connectors.findMany
        .mockResolvedValueOnce([recentLocked]) // stale lock check
        .mockResolvedValueOnce([]); // no unlocked connectors

      await DatabaseConnector.dueForSync();

      // Should NOT have cleared the lock
      expect(mockPrisma.database_connectors.update).not.toHaveBeenCalled();
    });
  });

  // ─── acquireLock / releaseLock ──────────────────────────────────
  describe("acquireLock", () => {
    test("returns true when lock is acquired (count > 0)", async () => {
      mockPrisma.database_connectors.updateMany.mockResolvedValue({
        count: 1,
      });
      const result = await DatabaseConnector.acquireLock(1);
      expect(result).toBe(true);
    });

    test("returns false when lock is already held (count = 0)", async () => {
      mockPrisma.database_connectors.updateMany.mockResolvedValue({
        count: 0,
      });
      const result = await DatabaseConnector.acquireLock(1);
      expect(result).toBe(false);
    });

    test("mutual exclusion: concurrent acquireLock calls — exactly one wins", async () => {
      // Simulate the atomic behavior: first call succeeds, second fails
      let lockHeld = false;
      mockPrisma.database_connectors.updateMany.mockImplementation(
        async ({ where }) => {
          // Simulate atomicity: if lock not held, acquire it
          if (!lockHeld && where.syncInProgress === false) {
            lockHeld = true;
            return { count: 1 };
          }
          return { count: 0 };
        }
      );

      const results = await Promise.all([
        DatabaseConnector.acquireLock(1),
        DatabaseConnector.acquireLock(1),
      ]);

      const wins = results.filter((r) => r === true).length;
      const losses = results.filter((r) => r === false).length;
      expect(wins).toBe(1);
      expect(losses).toBe(1);
    });
  });

  describe("releaseLock", () => {
    test("releases lock and records status", async () => {
      mockPrisma.database_connectors.update.mockResolvedValue({});
      const result = await DatabaseConnector.releaseLock(1, {
        status: "success",
        error: null,
        cursor: { ts: "2026-01-01T00:00:00Z", id: "100" },
      });
      expect(result).toBe(true);

      const callData =
        mockPrisma.database_connectors.update.mock.calls[0][0].data;
      expect(callData.syncInProgress).toBe(false);
      expect(callData.lastSyncStatus).toBe("success");
      expect(callData.lastSyncCursorTs).toBe("2026-01-01T00:00:00Z");
      expect(callData.lastSyncCursorId).toBe("100");
      expect(callData.lastSyncAt).toBeInstanceOf(Date);
    });

    test("releases lock with error and no cursor", async () => {
      mockPrisma.database_connectors.update.mockResolvedValue({});
      const result = await DatabaseConnector.releaseLock(1, {
        status: "failed",
        error: "Connection refused",
      });
      expect(result).toBe(true);

      const callData =
        mockPrisma.database_connectors.update.mock.calls[0][0].data;
      expect(callData.lastSyncStatus).toBe("failed");
      expect(callData.lastSyncError).toBe("Connection refused");
      expect(callData.lastSyncCursorTs).toBeUndefined();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════
// DatabaseConnectorSyncLog Tests
// ═════════════════════════════════════════════════════════════════════

describe("DatabaseConnectorSyncLog", () => {
  describe("start", () => {
    test("creates a running log entry", async () => {
      const created = {
        id: 1,
        connectorId: 10,
        status: "running",
        startedAt: new Date(),
        cursorBefore: null,
      };
      mockPrisma.database_connector_sync_logs.create.mockResolvedValue(
        created
      );

      const log = await DatabaseConnectorSyncLog.start(10);
      expect(log).toEqual(created);
      expect(
        mockPrisma.database_connector_sync_logs.create
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connectorId: 10,
            status: "running",
          }),
        })
      );
    });

    test("passes cursorBefore as string", async () => {
      mockPrisma.database_connector_sync_logs.create.mockResolvedValue({
        id: 2,
      });
      await DatabaseConnectorSyncLog.start(10, "2026-01-01");
      const callData =
        mockPrisma.database_connector_sync_logs.create.mock.calls[0][0].data;
      expect(callData.cursorBefore).toBe("2026-01-01");
    });
  });

  describe("finish", () => {
    test("updates log with success status and counts", async () => {
      const updated = { id: 1, status: "success" };
      mockPrisma.database_connector_sync_logs.update.mockResolvedValue(
        updated
      );

      const log = await DatabaseConnectorSyncLog.finish(1, {
        status: "success",
        counts: {
          rowsRead: 100,
          rowsAdded: 80,
          rowsUpdated: 15,
          rowsSkipped: 5,
        },
        cursorAfter: "2026-01-01T12:00:00Z",
      });

      expect(log).toEqual(updated);
      const callData =
        mockPrisma.database_connector_sync_logs.update.mock.calls[0][0].data;
      expect(callData.status).toBe("success");
      expect(callData.rowsRead).toBe(100);
      expect(callData.rowsAdded).toBe(80);
      expect(callData.rowsUpdated).toBe(15);
      expect(callData.rowsSkipped).toBe(5);
      expect(callData.cursorAfter).toBe("2026-01-01T12:00:00Z");
      expect(callData.error).toBeNull();
    });

    test("updates log with failure and error message", async () => {
      mockPrisma.database_connector_sync_logs.update.mockResolvedValue({
        id: 1,
      });

      await DatabaseConnectorSyncLog.finish(1, {
        status: "failed",
        error: "Connection timeout",
      });

      const callData =
        mockPrisma.database_connector_sync_logs.update.mock.calls[0][0].data;
      expect(callData.status).toBe("failed");
      expect(callData.error).toBe("Connection timeout");
      expect(callData.finishedAt).toBeInstanceOf(Date);
    });
  });

  describe("forConnector", () => {
    test("returns logs ordered by startedAt desc with default limit", async () => {
      mockPrisma.database_connector_sync_logs.findMany.mockResolvedValue([]);
      await DatabaseConnectorSyncLog.forConnector(10);
      expect(
        mockPrisma.database_connector_sync_logs.findMany
      ).toHaveBeenCalledWith({
        where: { connectorId: 10 },
        orderBy: { startedAt: "desc" },
        take: 20,
      });
    });

    test("respects custom limit", async () => {
      mockPrisma.database_connector_sync_logs.findMany.mockResolvedValue([]);
      await DatabaseConnectorSyncLog.forConnector(10, 5);
      expect(
        mockPrisma.database_connector_sync_logs.findMany
      ).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 })
      );
    });
  });

  describe("failOrphanedRuns", () => {
    test("updates all running logs to failed with restart message", async () => {
      mockPrisma.database_connector_sync_logs.updateMany.mockResolvedValue({
        count: 3,
      });

      const count = await DatabaseConnectorSyncLog.failOrphanedRuns();
      expect(count).toBe(3);
      expect(
        mockPrisma.database_connector_sync_logs.updateMany
      ).toHaveBeenCalledWith({
        where: { status: "running" },
        data: expect.objectContaining({
          status: "failed",
          error: "Orphaned by server restart",
        }),
      });
    });

    test("returns 0 when no orphaned runs exist", async () => {
      mockPrisma.database_connector_sync_logs.updateMany.mockResolvedValue({
        count: 0,
      });
      const count = await DatabaseConnectorSyncLog.failOrphanedRuns();
      expect(count).toBe(0);
    });
  });

  // ─── Deletion Tracking Tests ────────────────────────────────────
  describe("deletion tracking fields", () => {
    test("create with new deletion tracking fields persists all values", async () => {
      mockPrisma.workspaces.findUnique.mockResolvedValue({ id: 1 });
      mockPrisma.database_connectors.findUnique.mockResolvedValue(null);
      let capturedData = null;
      mockPrisma.database_connectors.create.mockImplementation(({ data }) => {
        capturedData = data;
        return Promise.resolve({ id: 1, ...data });
      });

      const data = {
        ...validCreateData(),
        trackDeletions: true,
        reconcileEveryNRuns: 5,
        softDeleteColumn: "is_deleted",
      };
      const { connector, error } = await DatabaseConnector.create(data);
      expect(error).toBeNull();
      expect(connector).not.toBeNull();
      expect(capturedData.trackDeletions).toBe(true);
      expect(capturedData.reconcileEveryNRuns).toBe(5);
      expect(capturedData.softDeleteColumn).toBe("is_deleted");
    });

    test("rejects invalid softDeleteColumn identifier", async () => {
      const data = {
        ...validCreateData(),
        softDeleteColumn: "x; --",
      };
      const { connector, error } = await DatabaseConnector.create(data);
      expect(connector).toBeNull();
      expect(error).toMatch(/softDeleteColumn/);
    });

    test("rejects reconcileEveryNRuns = 0", async () => {
      mockPrisma.workspaces.findUnique.mockResolvedValue({ id: 1 });
      mockPrisma.database_connectors.findUnique.mockResolvedValue(null);
      const data = {
        ...validCreateData(),
        reconcileEveryNRuns: 0,
      };
      const { connector, error } = await DatabaseConnector.create(data);
      expect(connector).toBeNull();
      expect(error).toMatch(/reconcileEveryNRuns/);
    });

    test("redact includes new deletion tracking fields", async () => {
      const connector = {
        id: 1,
        name: "test",
        connectionConfig: new EncryptionManager().encrypt(
          JSON.stringify({
            host: "localhost",
            port: 5432,
            database: "testdb",
            username: "user",
            password: "hunter2",
          })
        ),
        trackDeletions: true,
        reconcileEveryNRuns: 5,
        softDeleteColumn: "is_deleted",
        runsSinceReconcile: 2,
      };
      const redacted = DatabaseConnector.redact(connector);
      expect(redacted.trackDeletions).toBe(true);
      expect(redacted.reconcileEveryNRuns).toBe(5);
      expect(redacted.softDeleteColumn).toBe("is_deleted");
      expect(redacted.runsSinceReconcile).toBe(2);
      expect(redacted.connectionConfig.password).toBeUndefined();
    });

    test("syncLog finish persists rowsDeleted from counts", async () => {
      let capturedData = null;
      mockPrisma.database_connector_sync_logs.update.mockImplementation(
        ({ data }) => {
          capturedData = data;
          return Promise.resolve({ id: 1, ...data });
        }
      );

      const log = await DatabaseConnectorSyncLog.finish(1, {
        status: "success",
        counts: {
          rowsRead: 100,
          rowsAdded: 10,
          rowsUpdated: 5,
          rowsSkipped: 2,
          rowsDeleted: 3,
        },
      });
      expect(log).not.toBeNull();
      expect(capturedData.rowsDeleted).toBe(3);
    });
  });
});
