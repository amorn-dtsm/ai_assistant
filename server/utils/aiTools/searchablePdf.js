const fs = require("fs");
const path = require("path");
const { callToolApi, ToolApiError } = require("./client");
const { TOOL_RESULT_SCHEMA_VERSION } = require("./contract");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { CollectorApi } = require("../collectorApi");

/**
 * Run Searchable PDF on an uploaded file
 *
 * @param {Object} options
 * @param {Object} options.workspace - Workspace object with id
 * @param {Object} options.user - User object with id
 * @param {number} [options.threadId] - Optional thread ID for history
 * @param {Object} options.file - File object
 * @param {string} options.file.path - Absolute path to uploaded file
 * @param {string} options.file.originalname - Original filename
 * @param {string} options.file.mimetype - MIME type
 * @param {string} options.sourceId - UUID v4 identifier for this execution
 * @returns {Promise<{chatId: number, sourceId: string, toolResult: Object, text: string}>}
 * @throws {ToolApiError} On external API failure (caller handles mapping to HTTP status)
 */
async function runSearchablePdf({ workspace, user, threadId, file, sourceId }) {
  const { path: filePath, originalname, mimetype } = file;

  try {
    // 1. Call external Searchable PDF API → returns Buffer
    const pdfBuffer = await callToolApi("searchablePdf", {
      filePath,
      filename: originalname,
      mimeType: mimetype,
    });

    // 2. Validate PDF magic bytes
    if (
      !pdfBuffer ||
      pdfBuffer.length < 4 ||
      pdfBuffer.toString("utf8", 0, 4) !== "%PDF"
    ) {
      throw new ToolApiError(
        "INVALID_FILE",
        "Response is not a valid PDF (missing %PDF magic bytes)"
      );
    }

    // 3. Write searchable.pdf to storage
    const storageDir = path.join(
      __dirname,
      "../../storage/documents/originals",
      sourceId
    );
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const searchablePdfPath = path.join(storageDir, "searchable.pdf");
    fs.writeFileSync(searchablePdfPath, pdfBuffer);

    // 4. Build toolResult object (canonical shape for all tools)
    const toolResult = {
      schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
      type: "toolResult",
      tool: "searchablePdf",
      status: "success",
      sourceId,
      filename: originalname,
      downloads: { pdf: true },
    };

    // 5. Persist to history via WorkspaceChats.new()
    const response = {
      text: `[สร้าง Searchable PDF จากไฟล์ ${originalname} สำเร็จ]`,
      sources: [],
      type: "toolResult",
      toolResult,
      _forLLM: `[สร้าง Searchable PDF จากไฟล์ ${originalname} สำเร็จ]`,
      attachments: [],
      metrics: {},
    };

    const { chat, message: dbError } = await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: `[Searchable PDF] ${originalname}`,
      response,
      user,
      threadId: threadId || null,
    });

    if (dbError) {
      throw new Error(`Failed to persist Searchable PDF result: ${dbError}`);
    }

    // 6. Return success response
    return {
      chatId: chat.id,
      sourceId,
      toolResult,
      text: response.text,
    };
  } catch (error) {
    // Handle external API errors
    if (error instanceof ToolApiError) {
      // Persist error row
      const toolResult = {
        schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
        type: "toolResult",
        tool: "searchablePdf",
        status: "error",
        sourceId,
        filename: originalname,
        error: {
          code: error.code,
          message: error.message,
        },
      };

      const response = {
        text: "",
        sources: [],
        type: "toolResult",
        toolResult,
        _forLLM: `[สร้าง Searchable PDF จากไฟล์ ${originalname} ล้มเหลว]`,
        attachments: [],
        metrics: {},
      };

      await WorkspaceChats.new({
        workspaceId: workspace.id,
        prompt: `[Searchable PDF] ${originalname}`,
        response,
        user,
        threadId: threadId || null,
      });

      // Re-throw for endpoint to map to HTTP status
      throw error;
    }

    // Unexpected error
    throw error;
  }
}

/**
 * Import a searchable PDF into the workspace document flow
 * Reuses the existing CollectorApi.processDocument entry point
 *
 * @param {Object} options
 * @param {Object} options.workspace - Workspace object with id
 * @param {Object} options.user - User object with id
 * @param {string} options.sourceId - UUID v4 identifier of the searchable PDF
 * @returns {Promise<{ok: boolean, document?: Object}>}
 * @throws {Error} On processing failure
 */
async function importSearchablePdf({ workspace, _user, sourceId }) {
  try {
    // 1. Verify searchable.pdf exists
    const storageDir = path.join(
      __dirname,
      "../../storage/documents/originals",
      sourceId
    );
    const searchablePdfPath = path.join(storageDir, "searchable.pdf");

    if (!fs.existsSync(searchablePdfPath)) {
      throw new Error("Searchable PDF file not found");
    }

    // 2. Get the original filename from the chat row
    const { WorkspaceChats } = require("../../models/workspaceChats");
    const chats = await WorkspaceChats.where(
      { workspaceId: workspace.id },
      1000,
      { id: "desc" }
    );
    let originalFilename = "searchable.pdf";
    for (const chat of chats) {
      try {
        const response = JSON.parse(chat.response);
        if (response?.toolResult?.sourceId === sourceId) {
          originalFilename = response?.toolResult?.filename || "searchable.pdf";
          break;
        }
      } catch {
        // Skip unparseable responses
      }
    }

    // 3. Copy searchable.pdf to collector hotdir with unique collision-safe name
    const hotdir =
      process.env.NODE_ENV === "development"
        ? path.resolve(__dirname, `../../../collector/hotdir`)
        : path.resolve(process.env.STORAGE_DIR, `../../collector/hotdir`);
    if (!fs.existsSync(hotdir)) {
      fs.mkdirSync(hotdir, { recursive: true });
    }

    // Generate unique filename: sourceId prefix + original name
    const sourceIdPrefix = sourceId.substring(0, 8);
    const safeOriginalName = path
      .basename(originalFilename)
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"|?*\x00-\x1f]/g, "_");
    const uniqueFilename = `${safeOriginalName.replace(/\.[^.]*$/, "")}-searchable-${sourceIdPrefix}.pdf`;
    const hotdirPath = path.join(hotdir, uniqueFilename);

    // Copy file to hotdir
    fs.copyFileSync(searchablePdfPath, hotdirPath);

    // 4. Call CollectorApi.processDocument with the unique filename
    const Collector = new CollectorApi();
    const processingOnline = await Collector.online();

    if (!processingOnline) {
      // Clean up the copied file
      try {
        fs.unlinkSync(hotdirPath);
      } catch {
        // Ignore cleanup errors
      }
      throw new Error("Document processing API is not online");
    }

    const { success, reason } = await Collector.processDocument(uniqueFilename);

    if (!success) {
      // Clean up the copied file
      try {
        fs.unlinkSync(hotdirPath);
      } catch {
        // Ignore cleanup errors
      }
      throw new Error(`Document processing failed: ${reason}`);
    }

    // 5. Return success
    return {
      ok: true,
      document: {
        name: originalFilename,
        sourceId,
      },
    };
  } catch (error) {
    console.error("[importSearchablePdf] Error:", error.message);
    throw error;
  }
}

module.exports = {
  runSearchablePdf,
  importSearchablePdf,
};
