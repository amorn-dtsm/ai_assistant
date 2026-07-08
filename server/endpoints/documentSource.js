const fs = require("fs");
const path = require("path");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");
const { Document } = require("../models/documents");
const { isWithin, fileData } = require("../utils/files");

const documentsPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, "../storage/documents")
    : path.resolve(process.env.STORAGE_DIR, "documents");

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/plain",
  ".txt": "text/plain",
};

/**
 * Finds the full document JSON data for a given sourceId within a workspace.
 * Returns the parsed JSON data object or null if not found.
 * @param {number} workspaceId
 * @param {string} sourceId - UUID v4 sourceId
 * @returns {Promise<object|null>}
 */
async function findDocDataBySourceId(workspaceId, sourceId) {
  const workspaceDocs = await Document.forWorkspace(workspaceId);
  for (const doc of workspaceDocs) {
    try {
      const data = await fileData(doc.docpath);
      if (data && data.sourceId === sourceId) {
        return data;
      }
    } catch {
      // Skip unreadable doc JSONs
    }
  }
  return null;
}

function documentSourceEndpoints(app) {
  if (!app) return;

  const middlewareChain = [
    validatedRequest,
    flexUserRoleValid([ROLES.all]),
    validWorkspaceSlug,
  ];

  app.get(
    "/workspace/:slug/document-source/:sourceId/file",
    middlewareChain,
    async (request, response) => {
      try {
        const { sourceId } = request.params;

        // Validate sourceId is a UUID v4 before any filesystem interaction
        if (!UUID_V4_REGEX.test(sourceId)) {
          return response
            .status(400)
            .json({ error: "Invalid source identifier." });
        }

        const workspace = response.locals.workspace;

        // Verify sourceId belongs to a document in this workspace
        const docData = await findDocDataBySourceId(workspace.id, sourceId);
        if (!docData) {
          return response
            .status(404)
            .json({ error: "Source document not found in this workspace." });
        }

        // Locate original file in originals directory
        const originalsDir = path.join(documentsPath, "originals");
        if (!fs.existsSync(originalsDir)) {
          return response
            .status(404)
            .json({ error: "Original not retained." });
        }

        const entries = fs.readdirSync(originalsDir);
        const match = entries.find((name) => {
          const withoutExt = path.parse(name).name;
          return withoutExt === sourceId;
        });

        if (!match) {
          return response
            .status(404)
            .json({ error: "Original not retained." });
        }

        const filePath = path.resolve(originalsDir, match);
        if (!isWithin(documentsPath, filePath)) {
          return response
            .status(400)
            .json({ error: "Invalid file location." });
        }

        if (!fs.existsSync(filePath)) {
          return response
            .status(404)
            .json({ error: "Original not retained." });
        }

        const ext = path.extname(match).toLowerCase();
        const contentType = MIME_BY_EXT[ext] || "application/octet-stream";

        return response.sendFile(filePath, {
          acceptRanges: true,
          headers: { "Content-Type": contentType },
        });
      } catch (e) {
        console.error(e.message, e);
        return response.sendStatus(500).end();
      }
    }
  );

  // GET /workspace/:slug/document-source/:sourceId/content
  // Returns the document metadata + page content for viewer rendering.
  app.get(
    "/workspace/:slug/document-source/:sourceId/content",
    middlewareChain,
    async (request, response) => {
      try {
        const { sourceId } = request.params;

        if (!UUID_V4_REGEX.test(sourceId)) {
          return response
            .status(400)
            .json({ error: "Invalid source identifier." });
        }

        const workspace = response.locals.workspace;
        const docData = await findDocDataBySourceId(workspace.id, sourceId);
        if (!docData) {
          return response
            .status(404)
            .json({ error: "Source document not found in this workspace." });
        }

        const result = {
          title: docData.title || null,
          contentType: docData.contentType || null,
          pageContent: docData.pageContent || null,
          hasSourceViewer: docData.hasSourceViewer || false,
        };

        // Only include pageContentHtml if it exists on the document
        if (docData.pageContentHtml) {
          result.pageContentHtml = docData.pageContentHtml;
        }

        return response.status(200).json(result);
      } catch (e) {
        console.error(e.message, e);
        return response.sendStatus(500).end();
      }
    }
  );

  // GET /workspace/:slug/document-source/:sourceId/ocr
  // Returns the OCR geometry sidecar JSON for image/scanned-PDF documents.
  app.get(
    "/workspace/:slug/document-source/:sourceId/ocr",
    middlewareChain,
    async (request, response) => {
      try {
        const { sourceId } = request.params;

        if (!UUID_V4_REGEX.test(sourceId)) {
          return response
            .status(400)
            .json({ error: "Invalid source identifier." });
        }

        const workspace = response.locals.workspace;

        // Verify sourceId belongs to a document in this workspace
        const docData = await findDocDataBySourceId(workspace.id, sourceId);
        if (!docData) {
          return response
            .status(404)
            .json({ error: "Source document not found in this workspace." });
        }

        // Check for OCR sidecar file
        const ocrPath = path.resolve(
          documentsPath,
          "ocr",
          `${sourceId}.json`
        );

        if (!isWithin(documentsPath, ocrPath)) {
          return response
            .status(400)
            .json({ error: "Invalid file location." });
        }

        if (!fs.existsSync(ocrPath)) {
          return response
            .status(404)
            .json({ error: "No OCR data available for this document." });
        }

        return response.sendFile(ocrPath, {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        console.error(e.message, e);
        return response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { documentSourceEndpoints };
