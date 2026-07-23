const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { userFromSession, multiUserMode } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  ROLES,
  flexUserRoleValid,
} = require("../utils/middleware/multiUserProtected");
const { validWorkspaceSlug } = require("../utils/middleware/validWorkspace");
const { isToolConfigured, ToolApiError } = require("../utils/aiTools/client");
const { TOOLS, LIMITS, ERROR_CODES } = require("../utils/aiTools/contract");
const { WorkspaceChats } = require("../models/workspaceChats");
const { WorkspaceThread } = require("../models/workspaceThread");

const documentsPath =
  process.env.NODE_ENV === "development"
    ? path.resolve(__dirname, "../storage/documents")
    : path.resolve(process.env.STORAGE_DIR || "./storage", "documents");

const originalsPath = path.join(documentsPath, "originals");

// Ensure originals directory exists
if (!fs.existsSync(originalsPath)) {
  fs.mkdirSync(originalsPath, { recursive: true });
}

/**
 * Sanitize filename: remove path separators and dangerous characters
 * Keep extension, return basename only
 */
function sanitizeFilename(filename) {
  if (!filename) return "file";
  // Remove path separators
  let safe = path.basename(filename);
  // Remove any remaining dangerous characters but keep extension
  // eslint-disable-next-line no-control-regex
  safe = safe.replace(/[<>:"|?*\x00-\x1f]/g, "_");
  return safe || "file";
}

/**
 * Validate UUID v4 format
 */
function isValidUUIDv4(str) {
  const uuidv4Regex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidv4Regex.test(str);
}

/**
 * Create multer storage for a specific tool
 */
function createToolStorage(_tool) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const sourceId = req.sourceId;
      const toolDir = path.join(originalsPath, sourceId);
      fs.mkdirSync(toolDir, { recursive: true });
      cb(null, toolDir);
    },
    filename: (req, file, cb) => {
      const safe = sanitizeFilename(file.originalname);
      cb(null, safe);
    },
  });
}

/**
 * Create multer file filter for a specific tool
 */
function createToolFileFilter(tool) {
  const limits = LIMITS[tool];
  return (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    const mime = file.mimetype;

    const allowedExts = limits.extensions.map((e) => e.toLowerCase());
    const allowedMimes = limits.mimeTypes;

    if (!allowedExts.includes(ext) || !allowedMimes.includes(mime)) {
      return cb(
        new Error(
          `Invalid file type. Allowed: ${allowedExts.join(", ")} (${allowedMimes.join(", ")})`
        )
      );
    }

    cb(null, true);
  };
}

/**
 * Create multer middleware for a specific tool
 */
function createToolUploadMiddleware(tool) {
  const limits = LIMITS[tool];
  const storage = createToolStorage(tool);
  const fileFilter = createToolFileFilter(tool);

  return multer({
    storage,
    fileFilter,
    limits: {
      fileSize: limits.maxSizeBytes,
    },
  }).single("file");
}

/**
 * Attach sourceId to request before multer processes it
 */
function attachSourceId(req, res, next) {
  req.sourceId = crypto.randomUUID();
  next();
}

/**
 * Handle multer errors and convert to proper HTTP responses
 */
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        ok: false,
        error: "FILE_TOO_LARGE",
      });
    }
    return res.status(400).json({
      ok: false,
      error: "INVALID_FILE",
    });
  }

  if (err) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_FILE",
    });
  }

  next();
}

/**
 * Resolve thread from optional threadSlug form field
 */
async function resolveThread(workspace, threadSlug) {
  if (!threadSlug) return null;

  try {
    const thread = await WorkspaceThread.get({
      slug: String(threadSlug),
      workspace_id: workspace.id,
    });
    return thread?.id || null;
  } catch {
    return null;
  }
}

/**
 * Map ToolApiError codes to HTTP status codes
 */
function mapErrorToStatus(errorCode) {
  const mapping = {
    [ERROR_CODES.INVALID_FILE]: 400,
    [ERROR_CODES.NOT_CONFIGURED]: 503,
    [ERROR_CODES.TIMEOUT]: 504,
    [ERROR_CODES.UPSTREAM_5XX]: 502,
    [ERROR_CODES.UPSTREAM_4XX]: 502,
  };
  return mapping[errorCode] || 500;
}

/**
 * Find workspace_chats row containing a sourceId in its response JSON
 */
async function findChatBySourceId(workspaceId, sourceId) {
  try {
    const chats = await WorkspaceChats.where({ workspaceId }, 1000, {
      id: "desc",
    });
    for (const chat of chats) {
      try {
        const response = JSON.parse(chat.response);
        if (response?.toolResult?.sourceId === sourceId) {
          return chat;
        }
      } catch {
        // Skip unparseable responses
      }
    }
  } catch {
    // Skip query errors
  }
  return null;
}

function aiToolsEndpoints(app) {
  if (!app) return;

  const middlewareChain = [
    validatedRequest,
    flexUserRoleValid([ROLES.all]),
    validWorkspaceSlug,
  ];

  // ============================================================================
  // POST /workspace/:slug/ai-tools/ocr
  // POST /workspace/:slug/ai-tools/searchable-pdf
  // POST /workspace/:slug/ai-tools/xray
  // ============================================================================

  const toolRoutes = [
    { path: "/ocr", tool: TOOLS.OCR },
    { path: "/searchable-pdf", tool: TOOLS.SEARCHABLE_PDF },
    { path: "/xray", tool: TOOLS.XRAY },
  ];

  for (const { path: routePath, tool } of toolRoutes) {
    app.post(
      `/workspace/:slug/ai-tools${routePath}`,
      middlewareChain,
      attachSourceId,
      createToolUploadMiddleware(tool),
      handleMulterError,
      async (request, response) => {
        try {
          const user = await userFromSession(request, response);
          const workspace = response.locals.workspace;
          const { threadSlug } = request.body;

          // Validate file was uploaded
          if (!request.file) {
            return response.status(400).json({
              ok: false,
              error: "INVALID_FILE",
            });
          }

          // Resolve thread if provided
          const threadId = await resolveThread(workspace, threadSlug);

          // Lazy-load service module (may not exist yet in parallel execution)
          let serviceModule;
          try {
            const serviceMap = {
              [TOOLS.OCR]: "../utils/aiTools/ocr",
              [TOOLS.SEARCHABLE_PDF]: "../utils/aiTools/searchablePdf",
              [TOOLS.XRAY]: "../utils/aiTools/xray",
            };
            serviceModule = require(serviceMap[tool]);
          } catch {
            return response.status(501).json({
              ok: false,
              error: "NOT_IMPLEMENTED",
            });
          }

          // Call service
          const serviceFunc = {
            [TOOLS.OCR]: serviceModule.runOcr,
            [TOOLS.SEARCHABLE_PDF]: serviceModule.runSearchablePdf,
            [TOOLS.XRAY]: serviceModule.runXray,
          }[tool];

          const result = await serviceFunc({
            workspace,
            user,
            threadId,
            file: request.file,
            sourceId: request.sourceId,
            clientRequestId: request.body.clientRequestId,
          });

          response.status(200).json(result);
        } catch (error) {
          console.error(`[aiTools] ${tool} error:`, error.message);

          // Handle ToolApiError
          if (error instanceof ToolApiError) {
            const statusCode = mapErrorToStatus(error.code);
            return response.status(statusCode).json({
              ok: false,
              error: error.code,
            });
          }

          // Generic error
          response.status(500).json({
            ok: false,
            error: "INTERNAL_ERROR",
          });
        }
      }
    );
  }

  // ============================================================================
  // GET /workspace/:slug/ai-tools/status
  // ============================================================================

  app.get(
    "/workspace/:slug/ai-tools/status",
    middlewareChain,
    async (request, response) => {
      try {
        response.status(200).json({
          ocr: isToolConfigured(TOOLS.OCR),
          searchablePdf: isToolConfigured(TOOLS.SEARCHABLE_PDF),
          xray: isToolConfigured(TOOLS.XRAY),
        });
      } catch (error) {
        console.error("[aiTools] status error:", error.message);
        response.status(500).json({
          ok: false,
          error: "INTERNAL_ERROR",
        });
      }
    }
  );

  // ============================================================================
  // GET /workspace/:slug/ai-tools/:sourceId/download/:kind
  // kind âˆˆ {original, txt, pdf}
  // ============================================================================

  app.get(
    "/workspace/:slug/ai-tools/:sourceId/download/:kind",
    middlewareChain,
    async (request, response) => {
      try {
        const { sourceId, kind } = request.params;
        const workspace = response.locals.workspace;
        const user = await userFromSession(request, response);

        // Validate sourceId is UUID v4
        if (!isValidUUIDv4(sourceId)) {
          return response.status(400).json({
            error: "Invalid source identifier.",
          });
        }

        // Validate kind
        if (!["original", "txt", "pdf"].includes(kind)) {
          return response.status(400).json({
            error: "Invalid download kind.",
          });
        }

        // Find the chat row containing this sourceId
        const chat = await findChatBySourceId(workspace.id, sourceId);
        if (!chat) {
          return response.status(404).json({
            error: "Source not found.",
          });
        }

        // Verify ownership in multi-user mode
        if (multiUserMode(response)) {
          const isOwner = chat.user_id === user.id;
          const isAdmin = user.role === ROLES.admin;
          const isManager = user.role === ROLES.manager;

          if (!isOwner && !isAdmin && !isManager) {
            return response.status(403).json({
              error: "Access denied.",
            });
          }
        }

        // Parse response to get filename
        let filename = "file";
        try {
          const chatResponse = JSON.parse(chat.response);
          filename = chatResponse?.toolResult?.filename || "file";
        } catch {
          // Use default
        }

        // Map kind to file path
        const sourceDir = path.join(originalsPath, sourceId);
        let filePath;
        let contentType = "application/octet-stream";

        if (kind === "original") {
          // Find the original file in the sourceId directory
          if (!fs.existsSync(sourceDir)) {
            return response.status(404).json({
              error: "File not found.",
            });
          }

          const files = fs.readdirSync(sourceDir);
          const originalFile = files.find(
            (f) => f !== "result.txt" && f !== "searchable.pdf"
          );

          if (!originalFile) {
            return response.status(404).json({
              error: "File not found.",
            });
          }

          filePath = path.join(sourceDir, originalFile);
          const ext = path.extname(originalFile).toLowerCase();
          const mimeMap = {
            ".pdf": "application/pdf",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".tiff": "image/tiff",
            ".tif": "image/tiff",
          };
          contentType = mimeMap[ext] || "application/octet-stream";
        } else if (kind === "txt") {
          filePath = path.join(sourceDir, "result.txt");
          contentType = "text/plain; charset=utf-8";
        } else if (kind === "pdf") {
          filePath = path.join(sourceDir, "searchable.pdf");
          contentType = "application/pdf";
        }

        // Verify file exists and is within sourceDir (prevent traversal)
        if (!fs.existsSync(filePath)) {
          return response.status(404).json({
            error: "File not found.",
          });
        }

        const realPath = fs.realpathSync(filePath);
        const realSourceDir = fs.realpathSync(sourceDir);
        if (!realPath.startsWith(realSourceDir)) {
          return response.status(403).json({
            error: "Access denied.",
          });
        }

        // Stream file
        response.setHeader("Content-Type", contentType);
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${sanitizeFilename(filename)}"`
        );

        const stream = fs.createReadStream(filePath);
        stream.pipe(response);

        stream.on("error", (err) => {
          console.error("[aiTools] download stream error:", err.message);
          if (!response.headersSent) {
            response.status(500).json({
              error: "Download failed.",
            });
          }
        });
      } catch (error) {
        console.error("[aiTools] download error:", error.message);
        if (!response.headersSent) {
          response.status(500).json({
            error: "Internal error.",
          });
        }
      }
    }
  );

  // ============================================================================
  // POST /workspace/:slug/ai-tools/:sourceId/import
  // Import searchable PDF into workspace documents
  // ============================================================================

  app.post(
    "/workspace/:slug/ai-tools/:sourceId/import",
    middlewareChain,
    async (request, response) => {
      try {
        const { sourceId } = request.params;
        const workspace = response.locals.workspace;
        const user = await userFromSession(request, response);

        // Validate sourceId is UUID v4
        if (!isValidUUIDv4(sourceId)) {
          return response.status(400).json({
            ok: false,
            error: "Invalid source identifier.",
          });
        }

        // Find the chat row containing this sourceId (ownership check)
        const chat = await findChatBySourceId(workspace.id, sourceId);
        if (!chat) {
          return response.status(404).json({
            ok: false,
            error: "Source not found.",
          });
        }

        // Verify ownership in multi-user mode
        if (multiUserMode(response)) {
          const isOwner = chat.user_id === user.id;
          const isAdmin = user.role === ROLES.admin;
          const isManager = user.role === ROLES.manager;

          if (!isOwner && !isAdmin && !isManager) {
            return response.status(403).json({
              ok: false,
              error: "Access denied.",
            });
          }
        }

        // Lazy-load service module
        let serviceModule;
        try {
          serviceModule = require("../utils/aiTools/searchablePdf");
        } catch {
          return response.status(501).json({
            ok: false,
            error: "NOT_IMPLEMENTED",
          });
        }

        // Call import function
        const result = await serviceModule.importSearchablePdf({
          workspace,
          user,
          sourceId,
        });

        response.status(200).json(result);
      } catch (error) {
        console.error("[aiTools] import error:", error.message);

        // Generic error
        response.status(500).json({
          ok: false,
          error: "INTERNAL_ERROR",
        });
      }
    }
  );
}

module.exports = { aiToolsEndpoints };
