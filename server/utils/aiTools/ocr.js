const fs = require("fs");
const path = require("path");
const { callToolApi, ToolApiError } = require("./client");
const { TOOL_RESULT_SCHEMA_VERSION, FOR_LLM_CHAR_CAP } = require("./contract");
const { WorkspaceChats } = require("../../models/workspaceChats");

/**
 * Run OCR on an uploaded file
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
async function runOcr({ workspace, user, threadId, file, sourceId }) {
  const { path: filePath, originalname, mimetype } = file;

  try {
    // 1. Call external OCR API
    const apiResult = await callToolApi("ocr", {
      filePath,
      filename: originalname,
      mimeType: mimetype,
    });

    // Extract result fields
    const { text: extractedText, pages, language } = apiResult;

    // 2. Write result.txt to storage
    const storageDir = path.join(
      __dirname,
      "../../storage/documents/originals",
      sourceId
    );
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    // Write UTF-8 with BOM for Thai-safe opening in Windows editors
    const resultPath = path.join(storageDir, "result.txt");
    const bom = Buffer.from([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const content = Buffer.from(extractedText, "utf8");
    fs.writeFileSync(resultPath, Buffer.concat([bom, content]));

    // 3. Cap text for LLM visibility
    let forLlmText = extractedText;
    if (forLlmText.length > FOR_LLM_CHAR_CAP) {
      forLlmText = forLlmText.substring(0, FOR_LLM_CHAR_CAP) + "\n[truncated]";
    }

    // 4. Build toolResult object (canonical shape for all tools)
    const toolResult = {
      schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
      type: "toolResult",
      tool: "ocr",
      status: "success",
      sourceId,
      filename: originalname,
      pages,
      ...(language && { language }),
      downloads: { txt: true },
    };

    // 5. Persist to history via WorkspaceChats.new()
    const response = {
      text: extractedText,
      sources: [],
      type: "toolResult",
      toolResult,
      _forLLM: forLlmText,
      attachments: [],
      metrics: {},
    };

    const { chat, message: dbError } = await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: `[OCR] ${originalname}`,
      response,
      user,
      threadId: threadId || null,
    });

    if (dbError) {
      throw new Error(`Failed to persist OCR result: ${dbError}`);
    }

    // 6. Return success response
    return {
      chatId: chat.id,
      sourceId,
      toolResult,
      text: extractedText,
    };
  } catch (error) {
    // Handle external API errors
    if (error instanceof ToolApiError) {
      // Persist error row
      const toolResult = {
        schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
        type: "toolResult",
        tool: "ocr",
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
        _forLLM: `[OCR ของไฟล์ ${originalname} ล้มเหลว]`,
        attachments: [],
        metrics: {},
      };

      await WorkspaceChats.new({
        workspaceId: workspace.id,
        prompt: `[OCR] ${originalname}`,
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

module.exports = {
  runOcr,
};
