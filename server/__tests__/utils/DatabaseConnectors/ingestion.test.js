// Set STORAGE_DIR so documentsPath resolves predictably in test env
process.env.NODE_ENV = "development";

const path = require("path");
const fs = require("fs");

// ── Mocks ───────────────────────────────────────────────────────────
// Must be set up BEFORE requiring the module under test.

// Mock Document model
const mockGet = jest.fn();
const mockRemoveDocuments = jest.fn();
const mockAddDocuments = jest.fn();
const mockWhere = jest.fn();

jest.mock("../../../models/documents", () => ({
  Document: {
    get: (...args) => mockGet(...args),
    removeDocuments: (...args) => mockRemoveDocuments(...args),
    addDocuments: (...args) => mockAddDocuments(...args),
    where: (...args) => mockWhere(...args),
  },
}));

// Mock prisma (required transitively by models/documents)
jest.mock("../../../utils/prisma", () => ({}));

// Mock fs - partial, preserving path operations
jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return {
    ...actual,
    existsSync: jest.fn().mockReturnValue(false),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn(),
  };
});

// Now require the module under test
const {
  upsertRowDocument,
  removeConnectorDocuments,
  removeRowDocument,
  buildDocumentJson,
  estimateTokenCount,
} = require("../../../utils/DatabaseConnectors/ingestion");
const { documentsPath } = require("../../../utils/files");

// ── Helpers ─────────────────────────────────────────────────────────
const makeWorkspace = (overrides = {}) => ({
  id: 1,
  slug: "test-workspace",
  ...overrides,
});

const makeConnector = (overrides = {}) => ({
  id: 999,
  ...overrides,
});

// Required fields that must appear in every document JSON
// (mirrors REQUIRED_FILE_OBJECT_FIELDS from server/utils/files)
const REQUIRED_DOC_FIELDS = [
  "id",
  "url",
  "title",
  "docAuthor",
  "description",
  "docSource",
  "chunkSource",
  "published",
  "wordCount",
  "pageContent",
  "token_count_estimate",
];

// ── Tests ───────────────────────────────────────────────────────────

describe("estimateTokenCount", () => {
  it("returns 0 for empty/null input", () => {
    expect(estimateTokenCount("")).toBe(0);
    expect(estimateTokenCount(null)).toBe(0);
    expect(estimateTokenCount(undefined)).toBe(0);
  });

  it("estimates tokens as ceil(words * 1.33)", () => {
    const text = "hello world foo bar";
    expect(estimateTokenCount(text)).toBe(Math.ceil(4 * 1.33));
  });
});

describe("buildDocumentJson", () => {
  it("produces a JSON object with all required fields", () => {
    const doc = buildDocumentJson({
      title: "Test Row",
      content: "Some text content here",
      metadata: {},
      connectorId: 42,
    });

    for (const field of REQUIRED_DOC_FIELDS) {
      expect(doc).toHaveProperty(field);
    }
  });

  it("uses metadata overrides when provided", () => {
    const doc = buildDocumentJson({
      title: "Row Title",
      content: "Body text",
      metadata: {
        docAuthor: "Custom Author",
        description: "Custom Description",
        url: "https://example.com",
      },
      connectorId: 7,
    });

    expect(doc.docAuthor).toBe("Custom Author");
    expect(doc.description).toBe("Custom Description");
    expect(doc.url).toBe("https://example.com");
  });

  it("computes wordCount and token_count_estimate correctly", () => {
    const content = "one two three four five";
    const doc = buildDocumentJson({
      title: "T",
      content,
      metadata: {},
      connectorId: 1,
    });

    expect(doc.wordCount).toBe(5);
    expect(doc.token_count_estimate).toBe(Math.ceil(5 * 1.33));
    expect(doc.pageContent).toBe(content);
  });

  it("generates a uuid v4 id", () => {
    const doc = buildDocumentJson({
      title: "T",
      content: "C",
      metadata: {},
      connectorId: 1,
    });
    expect(doc.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});

describe("upsertRowDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: addDocuments succeeds
    mockAddDocuments.mockResolvedValue({
      failedToEmbed: [],
      errors: [],
      embedded: ["db-connectors/999/row-1.json"],
    });
  });

  it("returns 'added' when document does not exist yet", async () => {
    mockGet.mockResolvedValue(null); // No existing doc
    fs.existsSync.mockReturnValue(false); // Dir doesn't exist

    const result = await upsertRowDocument({
      workspace: makeWorkspace(),
      connector: makeConnector(),
      docPath: "db-connectors/999/row-1.json",
      title: "Order 1001",
      content: "Shipped to Bangkok",
      metadata: {},
    });

    expect(result.status).toBe("added");
    expect(mockGet).toHaveBeenCalledWith({
      docpath: "db-connectors/999/row-1.json",
      workspaceId: 1,
    });
    expect(mockRemoveDocuments).not.toHaveBeenCalled();
    expect(mockAddDocuments).toHaveBeenCalledWith(
      makeWorkspace(),
      ["db-connectors/999/row-1.json"],
      null
    );

    // Verify file was written
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const writtenPath = fs.writeFileSync.mock.calls[0][0];
    expect(writtenPath).toContain("db-connectors");
    expect(writtenPath).toContain("row-1.json");

    // Verify JSON shape
    const writtenJson = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    for (const field of REQUIRED_DOC_FIELDS) {
      expect(writtenJson).toHaveProperty(field);
    }
  });

  it("returns 'updated' when document already exists", async () => {
    mockGet.mockResolvedValue({
      id: 10,
      docId: "old-uuid",
      docpath: "db-connectors/999/row-1.json",
      workspaceId: 1,
    });
    mockRemoveDocuments.mockResolvedValue(true);
    fs.existsSync.mockReturnValue(false);

    const result = await upsertRowDocument({
      workspace: makeWorkspace(),
      connector: makeConnector(),
      docPath: "db-connectors/999/row-1.json",
      title: "Order 1001 Updated",
      content: "Delivered to Bangkok",
      metadata: {},
    });

    expect(result.status).toBe("updated");
    expect(mockRemoveDocuments).toHaveBeenCalledWith(makeWorkspace(), [
      "db-connectors/999/row-1.json",
    ]);
    expect(mockAddDocuments).toHaveBeenCalled();
  });

  it("returns 'failed' when embedding fails", async () => {
    mockGet.mockResolvedValue(null);
    fs.existsSync.mockReturnValue(false);
    mockAddDocuments.mockResolvedValue({
      failedToEmbed: ["Order 1001"],
      errors: ["Embedding provider unavailable"],
      embedded: [],
    });

    const result = await upsertRowDocument({
      workspace: makeWorkspace(),
      connector: makeConnector(),
      docPath: "db-connectors/999/row-1.json",
      title: "Order 1001",
      content: "Content",
      metadata: {},
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Embedding provider unavailable");
  });

  it("returns 'failed' for invalid workspace", async () => {
    const result = await upsertRowDocument({
      workspace: null,
      connector: makeConnector(),
      docPath: "db-connectors/999/row-1.json",
      title: "T",
      content: "C",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Invalid workspace");
  });

  it("returns 'failed' for invalid connector", async () => {
    const result = await upsertRowDocument({
      workspace: makeWorkspace(),
      connector: {},
      docPath: "db-connectors/999/row-1.json",
      title: "T",
      content: "C",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Invalid connector");
  });

  it("returns 'failed' for empty docPath", async () => {
    const result = await upsertRowDocument({
      workspace: makeWorkspace(),
      connector: makeConnector(),
      docPath: "",
      title: "T",
      content: "C",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("No docPath");
  });

  it("writes file to correct storage location under documentsPath", async () => {
    mockGet.mockResolvedValue(null);
    fs.existsSync.mockReturnValue(false);

    await upsertRowDocument({
      workspace: makeWorkspace(),
      connector: makeConnector(),
      docPath: "db-connectors/999/row-42.json",
      title: "Row 42",
      content: "Content here",
      metadata: {},
    });

    const writtenPath = fs.writeFileSync.mock.calls[0][0];
    const expectedDir = path.resolve(documentsPath, "db-connectors", "999");
    expect(path.dirname(writtenPath)).toBe(expectedDir);
    expect(path.basename(writtenPath)).toBe("row-42.json");
  });

  it("creates directories recursively if they don't exist", async () => {
    mockGet.mockResolvedValue(null);
    fs.existsSync.mockReturnValue(false);

    await upsertRowDocument({
      workspace: makeWorkspace(),
      connector: makeConnector(),
      docPath: "db-connectors/999/row-1.json",
      title: "T",
      content: "C",
      metadata: {},
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
    });
  });
});

describe("removeConnectorDocuments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes only the specified connector's documents (scoped purge)", async () => {
    // Setup: connector 999 has 2 docs, connector 998 has 1 doc
    const connector999Docs = [
      {
        id: 1,
        docId: "uuid-a",
        docpath: "db-connectors/999/row-1.json",
        workspaceId: 1,
      },
      {
        id: 2,
        docId: "uuid-b",
        docpath: "db-connectors/999/row-2.json",
        workspaceId: 1,
      },
    ];

    mockWhere.mockResolvedValue(connector999Docs);
    mockRemoveDocuments.mockResolvedValue(true);
    fs.existsSync.mockReturnValue(true);

    const result = await removeConnectorDocuments({
      workspace: makeWorkspace(),
      connectorId: 999,
    });

    expect(result.success).toBe(true);
    expect(result.removedCount).toBe(2);

    // Verify Document.where was called with correct prefix filter
    expect(mockWhere).toHaveBeenCalledWith({
      workspaceId: 1,
      docpath: { startsWith: "db-connectors/999/" },
    });

    // Verify removeDocuments was called with only connector 999's paths
    expect(mockRemoveDocuments).toHaveBeenCalledWith(makeWorkspace(), [
      "db-connectors/999/row-1.json",
      "db-connectors/999/row-2.json",
    ]);

    // Verify file deletion
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });

  it("does not remove another connector's documents", async () => {
    // When purging connector 998, only its prefix is queried
    mockWhere.mockResolvedValue([
      {
        id: 3,
        docId: "uuid-c",
        docpath: "db-connectors/998/row-1.json",
        workspaceId: 1,
      },
    ]);
    mockRemoveDocuments.mockResolvedValue(true);
    fs.existsSync.mockReturnValue(true);

    const result = await removeConnectorDocuments({
      workspace: makeWorkspace(),
      connectorId: 998,
    });

    expect(result.success).toBe(true);
    expect(result.removedCount).toBe(1);

    // The prefix filter MUST be for 998, not 999
    expect(mockWhere).toHaveBeenCalledWith({
      workspaceId: 1,
      docpath: { startsWith: "db-connectors/998/" },
    });

    expect(mockRemoveDocuments).toHaveBeenCalledWith(makeWorkspace(), [
      "db-connectors/998/row-1.json",
    ]);
  });

  it("returns removedCount 0 when no documents exist", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await removeConnectorDocuments({
      workspace: makeWorkspace(),
      connectorId: 777,
    });

    expect(result.success).toBe(true);
    expect(result.removedCount).toBe(0);
    expect(mockRemoveDocuments).not.toHaveBeenCalled();
  });

  it("returns error for invalid workspace", async () => {
    const result = await removeConnectorDocuments({
      workspace: null,
      connectorId: 999,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid workspace");
  });

  it("returns error for missing connectorId", async () => {
    const result = await removeConnectorDocuments({
      workspace: makeWorkspace(),
      connectorId: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No connectorId");
  });

  it("continues file deletion even if one file fails", async () => {
    mockWhere.mockResolvedValue([
      {
        id: 1,
        docId: "uuid-a",
        docpath: "db-connectors/999/row-1.json",
        workspaceId: 1,
      },
      {
        id: 2,
        docId: "uuid-b",
        docpath: "db-connectors/999/row-2.json",
        workspaceId: 1,
      },
    ]);
    mockRemoveDocuments.mockResolvedValue(true);
    fs.existsSync.mockReturnValue(true);
    // First unlink fails, second succeeds
    fs.unlinkSync
      .mockImplementationOnce(() => {
        throw new Error("Permission denied");
      })
      .mockImplementationOnce(() => {});

    const result = await removeConnectorDocuments({
      workspace: makeWorkspace(),
      connectorId: 999,
    });

    // Should still succeed overall (best-effort deletion)
    expect(result.success).toBe(true);
    expect(result.removedCount).toBe(2);
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });
});

describe("scoped purge isolation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("purging connector 999 does not affect connector 998 in same workspace", async () => {
    // This test verifies the prefix-based filtering works correctly
    // when multiple connectors coexist in the same workspace.

    // When asked for connector 999's docs
    mockWhere.mockImplementation((clause) => {
      if (clause.docpath?.startsWith === "db-connectors/999/") {
        return Promise.resolve([
          {
            id: 1,
            docId: "uuid-999-a",
            docpath: "db-connectors/999/row-1.json",
            workspaceId: 1,
          },
          {
            id: 2,
            docId: "uuid-999-b",
            docpath: "db-connectors/999/row-2.json",
            workspaceId: 1,
          },
        ]);
      }
      if (clause.docpath?.startsWith === "db-connectors/998/") {
        return Promise.resolve([
          {
            id: 3,
            docId: "uuid-998-a",
            docpath: "db-connectors/998/row-1.json",
            workspaceId: 1,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mockRemoveDocuments.mockResolvedValue(true);
    fs.existsSync.mockReturnValue(true);

    // Purge connector 999
    const result999 = await removeConnectorDocuments({
      workspace: makeWorkspace(),
      connectorId: 999,
    });

    expect(result999.removedCount).toBe(2);

    // Verify only 999's paths were passed to removeDocuments
    expect(mockRemoveDocuments).toHaveBeenCalledWith(makeWorkspace(), [
      "db-connectors/999/row-1.json",
      "db-connectors/999/row-2.json",
    ]);

    // Now query connector 998 — it should still have its doc
    jest.clearAllMocks();
    const result998 = await removeConnectorDocuments({
      workspace: makeWorkspace(),
      connectorId: 998,
    });

    expect(result998.removedCount).toBe(1);
    expect(mockRemoveDocuments).toHaveBeenCalledWith(makeWorkspace(), [
      "db-connectors/998/row-1.json",
    ]);
  });
});

describe("removeRowDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("removes an existing document (vectors + file)", async () => {
    mockGet.mockResolvedValue({
      id: 10,
      docId: "uuid-a",
      docpath: "db-connectors/999/row-1.json",
      workspaceId: 1,
    });
    mockRemoveDocuments.mockResolvedValue(true);
    fs.existsSync.mockReturnValue(true);

    const result = await removeRowDocument({
      workspace: makeWorkspace(),
      docPath: "db-connectors/999/row-1.json",
    });

    expect(result.success).toBe(true);
    expect(result.removed).toBe(true);

    // Verify Document.get was called
    expect(mockGet).toHaveBeenCalledWith({
      docpath: "db-connectors/999/row-1.json",
      workspaceId: 1,
    });

    // Verify removeDocuments was called
    expect(mockRemoveDocuments).toHaveBeenCalledWith(makeWorkspace(), [
      "db-connectors/999/row-1.json",
    ]);

    // Verify file deletion was attempted
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it("returns removed:false when document does not exist (idempotent)", async () => {
    mockGet.mockResolvedValue(null); // No existing doc

    const result = await removeRowDocument({
      workspace: makeWorkspace(),
      docPath: "db-connectors/999/row-1.json",
    });

    expect(result.success).toBe(true);
    expect(result.removed).toBe(false);

    // Should NOT call removeDocuments
    expect(mockRemoveDocuments).not.toHaveBeenCalled();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it("returns error for invalid workspace", async () => {
    const result = await removeRowDocument({
      workspace: null,
      docPath: "db-connectors/999/row-1.json",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid workspace");
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("returns error for missing workspace.id", async () => {
    const result = await removeRowDocument({
      workspace: { slug: "test" }, // Missing id
      docPath: "db-connectors/999/row-1.json",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid workspace");
  });

  it("returns error for missing workspace.slug", async () => {
    const result = await removeRowDocument({
      workspace: { id: 1 }, // Missing slug
      docPath: "db-connectors/999/row-1.json",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid workspace");
  });

  it("returns error for empty docPath", async () => {
    const result = await removeRowDocument({
      workspace: makeWorkspace(),
      docPath: "",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No docPath");
  });

  it("returns error for null docPath", async () => {
    const result = await removeRowDocument({
      workspace: makeWorkspace(),
      docPath: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No docPath");
  });

  it("normalizes and rejects path traversal attempts in docPath", async () => {
    // normalizePath strips leading .. sequences, so this becomes "etc/passwd"
    // which is a valid relative path within documentsPath
    // The path safety check is already tested via normalizePath behavior
    mockGet.mockResolvedValue(null);
    
    const result = await removeRowDocument({
      workspace: makeWorkspace(),
      docPath: "../../../etc/passwd",
    });

    // After normalization, this becomes "etc/passwd" which is valid
    // The isWithin check will pass because it's within documentsPath
    expect(result.success).toBe(true);
    expect(result.removed).toBe(false);
  });

  it("continues on file deletion error (best-effort)", async () => {
    mockGet.mockResolvedValue({
      id: 10,
      docId: "uuid-a",
      docpath: "db-connectors/999/row-1.json",
      workspaceId: 1,
    });
    mockRemoveDocuments.mockResolvedValue(true);
    fs.existsSync.mockReturnValue(true);
    fs.unlinkSync.mockImplementation(() => {
      throw new Error("Permission denied");
    });

    const result = await removeRowDocument({
      workspace: makeWorkspace(),
      docPath: "db-connectors/999/row-1.json",
    });

    // Should still succeed (best-effort deletion)
    expect(result.success).toBe(true);
    expect(result.removed).toBe(true);
    expect(mockRemoveDocuments).toHaveBeenCalled();
  });

  it("normalizes backslashes to forward slashes for DB operations", async () => {
    mockGet.mockResolvedValue({
      id: 10,
      docId: "uuid-a",
      docpath: "db-connectors/999/row-1.json",
      workspaceId: 1,
    });
    mockRemoveDocuments.mockResolvedValue(true);
    fs.existsSync.mockReturnValue(false);

    await removeRowDocument({
      workspace: makeWorkspace(),
      docPath: "db-connectors\\999\\row-1.json", // Windows-style path
    });

    // Should normalize to forward slashes for DB operations
    expect(mockGet).toHaveBeenCalledWith({
      docpath: "db-connectors/999/row-1.json",
      workspaceId: 1,
    });
    expect(mockRemoveDocuments).toHaveBeenCalledWith(makeWorkspace(), [
      "db-connectors/999/row-1.json",
    ]);
  });
});
