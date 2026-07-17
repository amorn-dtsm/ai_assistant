/* eslint-env jest */
const {
  validateAdminQuery,
  validateIdentifier,
  buildSyncQuery,
  assembleRowContent,
  extractRowMetadata,
  computeNextCursor,
  rowDocPath,
} = require("../../../utils/DatabaseConnectors");

describe("DatabaseConnectors utilities", () => {
  // ─── validateAdminQuery ───────────────────────────────────────────

  describe("validateAdminQuery", () => {
    test("should accept a simple SELECT", () => {
      const result = validateAdminQuery("SELECT id, name FROM users");
      expect(result).toEqual({ valid: true });
    });

    test("should accept a CTE (WITH ... SELECT)", () => {
      const result = validateAdminQuery(
        "WITH active AS (SELECT * FROM users WHERE active = 1) SELECT * FROM active"
      );
      expect(result).toEqual({ valid: true });
    });

    test("should accept SELECT with leading comments", () => {
      const result = validateAdminQuery(
        "/* admin query */ -- line comment\nSELECT id FROM t"
      );
      expect(result).toEqual({ valid: true });
    });

    test("should accept SELECT with trailing semicolon and whitespace only", () => {
      const result = validateAdminQuery("SELECT 1;  \n");
      expect(result).toEqual({ valid: true });
    });

    test("should reject DELETE statement", () => {
      const result = validateAdminQuery("DELETE FROM users");
      expect(result).toEqual({
        valid: false,
        error: "Query must be a SELECT statement (or WITH ... SELECT CTE).",
      });
    });

    test("should reject UPDATE statement", () => {
      const result = validateAdminQuery("UPDATE users SET name = 'x'");
      expect(result).toEqual({
        valid: false,
        error: "Query must be a SELECT statement (or WITH ... SELECT CTE).",
      });
    });

    test("should reject multi-statement (SELECT ; DROP TABLE)", () => {
      const result = validateAdminQuery("SELECT 1; DROP TABLE users");
      expect(result).toEqual({
        valid: false,
        error:
          "Query must be a single statement (no semicolons followed by additional statements).",
      });
    });

    test("should reject empty string", () => {
      const result = validateAdminQuery("");
      expect(result).toEqual({
        valid: false,
        error: "Query must be a non-empty string.",
      });
    });

    test("should reject null/undefined", () => {
      expect(validateAdminQuery(null)).toEqual({
        valid: false,
        error: "Query must be a non-empty string.",
      });
      expect(validateAdminQuery(undefined)).toEqual({
        valid: false,
        error: "Query must be a non-empty string.",
      });
    });
  });

  // ─── validateIdentifier ───────────────────────────────────────────

  describe("validateIdentifier", () => {
    test("should accept valid identifiers", () => {
      expect(validateIdentifier("updated_at")).toBe(true);
      expect(validateIdentifier("id")).toBe(true);
      expect(validateIdentifier("Column1")).toBe(true);
    });

    test("should reject identifiers with special characters", () => {
      expect(validateIdentifier("updated_at; --")).toBe(false);
      expect(validateIdentifier("col name")).toBe(false);
      expect(validateIdentifier("col.name")).toBe(false);
      expect(validateIdentifier("' OR 1=1 --")).toBe(false);
    });

    test("should reject empty/null/undefined", () => {
      expect(validateIdentifier("")).toBe(false);
      expect(validateIdentifier(null)).toBe(false);
      expect(validateIdentifier(undefined)).toBe(false);
    });
  });

  // ─── buildSyncQuery ───────────────────────────────────────────────

  describe("buildSyncQuery", () => {
    const baseOpts = {
      query: "SELECT id, title, body, updated_at FROM articles",
      timestampColumn: "updated_at",
      idColumn: "id",
      batchSize: 500,
    };

    test("should build first-sync query without WHERE when cursor is null", () => {
      const { sql, params } = buildSyncQuery({ ...baseOpts, cursor: null });
      expect(sql).toContain("FROM ( SELECT id, title, body, updated_at FROM articles ) AS __src");
      expect(sql).not.toContain("WHERE");
      expect(sql).toContain("ORDER BY __src.updated_at ASC, __src.id ASC");
      expect(sql).toContain("LIMIT 500");
      expect(params).toEqual([]);
    });

    test("should build cursor query with keyset WHERE clause", () => {
      const cursor = { ts: "2026-01-01 00:00:00", id: "42" };
      const { sql, params } = buildSyncQuery({ ...baseOpts, cursor });
      expect(sql).toContain("WHERE (__src.updated_at > ?)");
      expect(sql).toContain("OR (__src.updated_at = ? AND __src.id > ?)");
      expect(sql).toContain("ORDER BY __src.updated_at ASC, __src.id ASC");
      expect(sql).toContain("LIMIT 500");
      expect(params).toEqual([
        "2026-01-01 00:00:00",
        "2026-01-01 00:00:00",
        "42",
      ]);
    });

    test("should reject invalid timestampColumn identifier", () => {
      expect(() =>
        buildSyncQuery({
          ...baseOpts,
          timestampColumn: "updated_at; --",
          cursor: null,
        })
      ).toThrow('Invalid timestampColumn identifier: "updated_at; --"');
    });

    test("should reject invalid idColumn identifier", () => {
      expect(() =>
        buildSyncQuery({
          ...baseOpts,
          idColumn: "' OR 1=1 --",
          cursor: null,
        })
      ).toThrow('Invalid idColumn identifier: "\' OR 1=1 --"');
    });

    test("should reject non-positive batchSize", () => {
      expect(() =>
        buildSyncQuery({ ...baseOpts, batchSize: 0, cursor: null })
      ).toThrow("batchSize must be a positive integer");
    });

    test("should parameterize cursor values (injection neutralization)", () => {
      const cursor = { ts: "' OR 1=1 --", id: "1; DROP TABLE users" };
      const { sql, params } = buildSyncQuery({ ...baseOpts, cursor });
      // The injection strings must be in params, NOT interpolated into SQL
      expect(sql).not.toContain("' OR 1=1 --");
      expect(sql).not.toContain("DROP TABLE");
      expect(params).toEqual(["' OR 1=1 --", "' OR 1=1 --", "1; DROP TABLE users"]);
    });
  });

  // ─── assembleRowContent ───────────────────────────────────────────

  describe("assembleRowContent", () => {
    test("should assemble content from non-null columns", () => {
      const row = { title: "Hello", body: "World", extra: "ignored" };
      const result = assembleRowContent(row, ["title", "body"]);
      expect(result).toEqual("title: Hello\n\nbody: World");
    });

    test("should skip null/undefined columns", () => {
      const row = { title: "A", body: null, summary: undefined };
      const result = assembleRowContent(row, ["title", "body", "summary"]);
      expect(result).toEqual("title: A");
    });

    test("should return null when ALL columns are null/undefined", () => {
      const row = { title: null, body: undefined };
      const result = assembleRowContent(row, ["title", "body"]);
      expect(result).toBeNull();
    });

    test("should handle numeric and boolean values", () => {
      const row = { count: 0, active: false };
      const result = assembleRowContent(row, ["count", "active"]);
      expect(result).toEqual("count: 0\n\nactive: false");
    });
  });

  // ─── extractRowMetadata ───────────────────────────────────────────

  describe("extractRowMetadata", () => {
    test("should extract non-null metadata values", () => {
      const row = { category: "tech", author: "Alice", body: "text" };
      const result = extractRowMetadata(row, ["category", "author"]);
      expect(result).toEqual({ category: "tech", author: "Alice" });
    });

    test("should skip null/undefined metadata values", () => {
      const row = { category: null, author: "Bob" };
      const result = extractRowMetadata(row, ["category", "author"]);
      expect(result).toEqual({ author: "Bob" });
    });

    test("should return empty object when all metadata is null", () => {
      const row = { category: null };
      const result = extractRowMetadata(row, ["category"]);
      expect(result).toEqual({});
    });
  });

  // ─── computeNextCursor ────────────────────────────────────────────

  describe("computeNextCursor", () => {
    test("should return cursor from last row", () => {
      const rows = [
        { id: 1, updated_at: "2026-01-01" },
        { id: 2, updated_at: "2026-01-02" },
        { id: 3, updated_at: "2026-01-03" },
      ];
      const result = computeNextCursor(rows, "updated_at", "id");
      expect(result).toEqual({ ts: "2026-01-03", id: "3" });
    });

    test("should convert Date values to ISO strings", () => {
      const rows = [{ id: 42, updated_at: new Date("2026-06-15T00:00:00Z") }];
      const result = computeNextCursor(rows, "updated_at", "id");
      expect(result.ts).toBe("2026-06-15T00:00:00.000Z");
      expect(result.id).toBe("42");
    });

    test("should convert non-Date values to strings", () => {
      const rows = [{ id: 7, updated_at: "2026-01-01T00:00:00Z" }];
      const result = computeNextCursor(rows, "updated_at", "id");
      expect(result.ts).toBe("2026-01-01T00:00:00Z");
      expect(result.id).toBe("7");
    });

    test("should throw on empty rows", () => {
      expect(() => computeNextCursor([], "updated_at", "id")).toThrow(
        "Cannot compute cursor from empty result set."
      );
    });
  });

  // ─── rowDocPath ───────────────────────────────────────────────────

  describe("rowDocPath", () => {
    test("should build correct path for simple id", () => {
      expect(rowDocPath(5, "123")).toEqual(
        "db-connectors/5/row-123.json"
      );
    });

    test("should sanitize special characters in idValue", () => {
      expect(rowDocPath(1, "abc/def.ghi")).toEqual(
        "db-connectors/1/row-abc_def_ghi.json"
      );
    });

    test("should sanitize spaces and quotes", () => {
      expect(rowDocPath(2, "hello world's")).toEqual(
        "db-connectors/2/row-hello_world_s.json"
      );
    });

    test("should handle numeric idValue", () => {
      expect(rowDocPath(3, 42)).toEqual("db-connectors/3/row-42.json");
    });

    test("should preserve hyphens and underscores", () => {
      expect(rowDocPath(1, "my-row_123")).toEqual(
        "db-connectors/1/row-my-row_123.json"
      );
    });
  });
});
