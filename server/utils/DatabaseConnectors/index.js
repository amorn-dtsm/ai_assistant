/**
 * Pure utility functions for Database Connector feature.
 * No DB connections — only query building, validation, and content assembly.
 */

/**
 * Validate that an admin query is a single SELECT statement.
 * Rejects multi-statement queries, non-SELECT statements, and empty input.
 * CTEs (WITH ... SELECT) are allowed.
 * @param {string} query
 * @returns {{valid: boolean, error?: string}}
 */
function validateAdminQuery(query) {
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return { valid: false, error: "Query must be a non-empty string." };
  }

  const trimmed = query.trim();

  // Strip leading SQL comments (block and line) and whitespace to find the first keyword
  let stripped = trimmed;
  let changed = true;
  while (changed) {
    changed = false;
    // Block comments: /* ... */
    if (stripped.startsWith("/*")) {
      const end = stripped.indexOf("*/");
      if (end === -1) {
        return { valid: false, error: "Unterminated block comment." };
      }
      stripped = stripped.slice(end + 2).trimStart();
      changed = true;
    }
    // Line comments: -- ...
    if (stripped.startsWith("--")) {
      const newline = stripped.indexOf("\n");
      stripped = newline === -1 ? "" : stripped.slice(newline + 1).trimStart();
      changed = true;
    }
    // Leading whitespace
    const ws = stripped.trimStart();
    if (ws.length !== stripped.length) {
      stripped = ws;
      changed = true;
    }
  }

  if (stripped.length === 0) {
    return { valid: false, error: "Query must be a non-empty string." };
  }

  // Must start with SELECT or WITH (CTE)
  const firstKeyword = stripped.split(/[\s(]/)[0].toUpperCase();
  if (firstKeyword !== "SELECT" && firstKeyword !== "WITH") {
    return {
      valid: false,
      error: "Query must be a SELECT statement (or WITH ... SELECT CTE).",
    };
  }

  // Reject semicolons followed by non-whitespace (multi-statement)
  // We scan for `;` that is followed by any non-whitespace character
  if (/;[\s]*\S/.test(trimmed)) {
    return {
      valid: false,
      error:
        "Query must be a single statement (no semicolons followed by additional statements).",
    };
  }

  return { valid: true };
}

/**
 * Validate a SQL identifier (column/table name).
 * Only allows alphanumeric and underscore characters.
 * @param {string} name
 * @returns {boolean}
 */
function validateIdentifier(name) {
  if (!name || typeof name !== "string") return false;
  return /^[A-Za-z0-9_]+$/.test(name);
}

/**
 * Build a sync query with keyset pagination wrapping.
 *
 * Returns {sql, params} where sql uses `?` placeholders for cursor values.
 * The sync engine (Task 6) is responsible for translating `?` to the
 * driver-specific placeholder syntax ($1/$2/$3 for pg, @p0/@p1/@p2 for mssql).
 *
 * When cursor is null (first sync), the WHERE clause is omitted.
 *
 * @param {object} opts
 * @param {string} opts.query - The admin SELECT query
 * @param {string} opts.timestampColumn - Column name for ordering by time
 * @param {string} opts.idColumn - Column name for tie-breaking
 * @param {number} opts.batchSize - LIMIT value
 * @param {object|null} opts.cursor - {ts: string, id: string} or null
 * @returns {{sql: string, params: Array}}
 */
function buildSyncQuery({
  query,
  timestampColumn,
  idColumn,
  batchSize,
  cursor,
}) {
  // Validate identifiers before interpolation
  if (!validateIdentifier(timestampColumn)) {
    throw new Error(`Invalid timestampColumn identifier: "${timestampColumn}"`);
  }
  if (!validateIdentifier(idColumn)) {
    throw new Error(`Invalid idColumn identifier: "${idColumn}"`);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batchSize must be a positive integer, got: ${batchSize}`);
  }

  const ts = timestampColumn;
  const id = idColumn;

  let sql;
  let params;

  if (cursor === null || cursor === undefined) {
    // First sync — no WHERE clause
    sql =
      `SELECT * FROM ( ${query} ) AS __src` +
      ` ORDER BY __src.${ts} ASC, __src.${id} ASC` +
      ` LIMIT ${batchSize}`;
    params = [];
  } else {
    // Incremental sync — keyset pagination
    sql =
      `SELECT * FROM ( ${query} ) AS __src` +
      ` WHERE (__src.${ts} > ?)` +
      ` OR (__src.${ts} = ? AND __src.${id} > ?)` +
      ` ORDER BY __src.${ts} ASC, __src.${id} ASC` +
      ` LIMIT ${batchSize}`;
    params = [cursor.ts, cursor.ts, cursor.id];
  }

  return { sql, params };
}

/**
 * Assemble document content from a database row.
 * Produces "{Column}: {value}" lines joined by double newlines.
 * Skips null/undefined values. Returns null if ALL columns are null/undefined.
 *
 * @param {object} row - The database row object
 * @param {string[]} contentColumns - Column names to include
 * @returns {string|null}
 */
function assembleRowContent(row, contentColumns) {
  const parts = [];
  for (const col of contentColumns) {
    const value = row[col];
    if (value !== null && value !== undefined) {
      parts.push(`${col}: ${value}`);
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Extract metadata values from a database row.
 * Returns a plain object with only non-null, non-undefined values.
 *
 * @param {object} row - The database row object
 * @param {string[]} metadataColumns - Column names to extract
 * @returns {object}
 */
function extractRowMetadata(row, metadataColumns) {
  const metadata = {};
  for (const col of metadataColumns) {
    const value = row[col];
    if (value !== null && value !== undefined) {
      metadata[col] = value;
    }
  }
  return metadata;
}

/**
 * Compute the next cursor from the last row of an ordered result set.
 * Values are kept as strings for safe storage.
 *
 * @param {object[]} rows - Ordered result rows
 * @param {string} timestampColumn - Column name for timestamp
 * @param {string} idColumn - Column name for ID
 * @returns {{ts: string, id: string}}
 */
function computeNextCursor(rows, timestampColumn, idColumn) {
  if (!rows || rows.length === 0) {
    throw new Error("Cannot compute cursor from empty result set.");
  }
  const lastRow = rows[rows.length - 1];
  const tsValue = lastRow[timestampColumn];
  return {
    // SQL drivers return Date objects for timestamp columns —
    // toISOString() produces a format all engines understand,
    // while String(Date) produces locale-specific text that
    // PostgreSQL (and others) cannot parse back.
    ts: tsValue instanceof Date ? tsValue.toISOString() : String(tsValue),
    id: String(lastRow[idColumn]),
  };
}

/**
 * Build the document path for a database connector row.
 * Format: db-connectors/{connectorId}/row-{sanitizedIdValue}.json
 * idValue is sanitized: any character not in [A-Za-z0-9_-] is replaced with '_'.
 *
 * @param {string|number} connectorId
 * @param {string|number} idValue
 * @returns {string}
 */
function rowDocPath(connectorId, idValue) {
  const sanitized = String(idValue).replace(/[^A-Za-z0-9_-]/g, "_");
  return `db-connectors/${connectorId}/row-${sanitized}.json`;
}

module.exports = {
  validateAdminQuery,
  validateIdentifier,
  buildSyncQuery,
  assembleRowContent,
  extractRowMetadata,
  computeNextCursor,
  rowDocPath,
};
