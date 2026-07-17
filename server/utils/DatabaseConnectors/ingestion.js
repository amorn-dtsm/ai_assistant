const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { Document } = require("../../models/documents");
const {
  documentsPath,
  isWithin,
  normalizePath,
  purgeVectorCache,
} = require("../files");

/**
 * Estimate token count for a string using the same rough heuristic
 * the collector uses (≈ words × 1.33).
 * @param {string} text
 * @returns {number}
 */
function estimateTokenCount(text) {
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.33);
}

/**
 * Build a document JSON object that mirrors the exact shape the
 * collector's `processRawText` produces, so the server's `fileData()`
 * and `addDocuments()` pipeline can consume it as-is.
 *
 * Required fields (from `REQUIRED_FILE_OBJECT_FIELDS` in server/utils/files):
 *   url, title, docAuthor, description, docSource, chunkSource,
 *   published, wordCount, token_count_estimate
 * Plus: id, pageContent
 */
function buildDocumentJson({ title, content, metadata = {}, connectorId }) {
  const now = new Date().toLocaleString();
  return {
    id: uuidv4(),
    url: metadata.url || `db-connector://${connectorId}`,
    title: title || "Untitled",
    docAuthor: metadata.docAuthor || "Database Connector",
    description: metadata.description || "Imported from database connector",
    docSource: metadata.docSource || `db-connector://${connectorId}`,
    chunkSource: metadata.chunkSource || `db-connector://${connectorId}`,
    published: metadata.published || now,
    wordCount: content ? content.split(/\s+/).filter(Boolean).length : 0,
    pageContent: content || "",
    token_count_estimate: estimateTokenCount(content),
  };
}

/**
 * Upsert a single row document into a workspace.
 *
 * 1. Check if a `workspace_documents` row exists for that docpath.
 * 2. If it exists → remove first (vectors + DB row) → marker "updated".
 * 3. Write the document JSON to `server/storage/documents/{docPath}`.
 * 4. Call `Document.addDocuments(workspace, [docPath])` to embed.
 * 5. Return `{status: "added"|"updated"|"failed", error?}`.
 *
 * @param {Object} params
 * @param {Object} params.workspace - Workspace record (must have id, slug).
 * @param {Object} params.connector - Connector record (must have id).
 * @param {string} params.docPath - Relative doc path, e.g. "db-connectors/123/row-1.json".
 * @param {string} params.title - Document title.
 * @param {string} params.content - Full text content.
 * @param {Object} [params.metadata] - Extra metadata fields to merge.
 * @returns {Promise<{status: string, error?: string}>}
 */
async function upsertRowDocument({
  workspace,
  connector,
  docPath,
  title,
  content,
  metadata = {},
}) {
  try {
    if (!workspace?.id || !workspace?.slug) {
      return { status: "failed", error: "Invalid workspace" };
    }
    if (!connector?.id) {
      return { status: "failed", error: "Invalid connector" };
    }
    if (!docPath) {
      return { status: "failed", error: "No docPath provided" };
    }

    // Validate path safety using normalizePath for traversal checks,
    // but preserve forward slashes in the docpath for DB consistency
    // (the rest of the codebase stores docpaths with forward slashes).
    const normalizedForValidation = normalizePath(docPath);
    const fullFilePath = path.resolve(documentsPath, normalizedForValidation);
    if (!isWithin(documentsPath, fullFilePath)) {
      return { status: "failed", error: "Invalid document path" };
    }
    // Use forward-slash docpath for all DB operations
    const dbDocPath = docPath.replace(/\\/g, "/");

    // Step 1: Check if document already exists in this workspace
    const existing = await Document.get({
      docpath: dbDocPath,
      workspaceId: workspace.id,
    });

    let marker = "added";

    // Step 2: If exists, remove old document (vectors + DB row + embedding cache)
    if (existing) {
      await Document.removeDocuments(workspace, [dbDocPath]);
      // Purge the vector-cache entry so the new content gets re-embedded
      // instead of reusing stale cached vectors from the previous version.
      await purgeVectorCache(dbDocPath);
      marker = "updated";
    }

    // Step 3: Write document JSON to storage
    const docJson = buildDocumentJson({
      title,
      content,
      metadata,
      connectorId: connector.id,
    });

    const dirPath = path.dirname(fullFilePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(fullFilePath, JSON.stringify(docJson, null, 4), {
      encoding: "utf-8",
    });

    // Step 4: Embed via Document.addDocuments
    const { failedToEmbed = [], errors = [] } = await Document.addDocuments(
      workspace,
      [dbDocPath],
      null
    );

    if (failedToEmbed.length > 0) {
      return {
        status: "failed",
        error: errors.join("; ") || "Embedding failed",
      };
    }

    return { status: marker };
  } catch (error) {
    return { status: "failed", error: error.message };
  }
}

/**
 * Remove all documents belonging to a specific connector from a workspace.
 * Finds all `workspace_documents` whose docpath starts with
 * `db-connectors/{connectorId}/` and removes them (vectors + DB rows + JSON files).
 *
 * @param {Object} params
 * @param {Object} params.workspace - Workspace record (must have id, slug).
 * @param {number|string} params.connectorId - The connector ID to purge.
 * @returns {Promise<{success: boolean, removedCount: number, error?: string}>}
 */
async function removeConnectorDocuments({ workspace, connectorId }) {
  try {
    if (!workspace?.id || !workspace?.slug) {
      return { success: false, removedCount: 0, error: "Invalid workspace" };
    }
    if (!connectorId) {
      return { success: false, removedCount: 0, error: "No connectorId" };
    }

    const prefix = `db-connectors/${connectorId}/`;

    // Find all workspace_documents with matching prefix
    const documents = await Document.where({
      workspaceId: workspace.id,
      docpath: { startsWith: prefix },
    });

    if (documents.length === 0) {
      return { success: true, removedCount: 0 };
    }

    const docPaths = documents.map((doc) => doc.docpath);

    // Remove from vector DB + database
    await Document.removeDocuments(workspace, docPaths);

    // Delete JSON files from storage
    for (const dp of docPaths) {
      try {
        const safePath = normalizePath(dp);
        const fullPath = path.resolve(documentsPath, safePath);
        if (isWithin(documentsPath, fullPath) && fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // Best-effort file deletion — continue on error
      }
    }

    return { success: true, removedCount: docPaths.length };
  } catch (error) {
    return { success: false, removedCount: 0, error: error.message };
  }
}

module.exports = {
  upsertRowDocument,
  removeConnectorDocuments,
  buildDocumentJson,
  estimateTokenCount,
};
