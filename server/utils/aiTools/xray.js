const { callToolApi, ToolApiError } = require("./client");
const { TOOL_RESULT_SCHEMA_VERSION, FOR_LLM_CHAR_CAP } = require("./contract");
const { WorkspaceChats } = require("../../models/workspaceChats");

/**
 * Run X-ray analysis on an uploaded image file
 *
 * @param {Object} options
 * @param {Object} options.workspace - Workspace object
 * @param {Object} options.user - User object
 * @param {number} options.threadId - Optional thread ID for history
 * @param {Object} options.file - File metadata
 * @param {string} options.file.path - Absolute path to uploaded file
 * @param {string} options.file.originalname - Original filename
 * @param {string} options.file.mimetype - MIME type
 * @param {string} options.sourceId - UUID v4 identifier for this execution
 *
 * @returns {Promise<Object>} Result object with chatId, sourceId, toolResult, text
 * @throws {ToolApiError} On external API failure (error is persisted to history)
 */
async function runXray({ workspace, user, threadId, file, sourceId }) {
  const { path: filePath, originalname, mimetype } = file;

  try {
    // Call external X-ray API
    const result = await callToolApi("xray", {
      filePath,
      filename: originalname,
      mimeType: mimetype,
    });

    const { findings, labels } = result;

    // Cap findings for LLM visibility
    let forLlmText = findings;
    if (forLlmText.length > FOR_LLM_CHAR_CAP) {
      forLlmText = forLlmText.substring(0, FOR_LLM_CHAR_CAP) + "\n[truncated]";
    }

    // Build tool result object
    const toolResult = {
      schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
      type: "toolResult",
      tool: "xray",
      status: "success",
      sourceId,
      filename: originalname,
      payload: {
        findings,
        ...(labels && { labels }),
      },
      downloads: {
        original: true,
      },
    };

    // Persist to history
    const response = {
      text: findings,
      sources: [],
      type: "toolResult",
      toolResult,
      _forLLM: forLlmText,
      attachments: [],
      metrics: {},
    };

    const { chat } = await WorkspaceChats.new({
      workspaceId: workspace.id,
      prompt: `[X-ray] ${originalname}`,
      response,
      threadId: threadId || null,
      user,
    });

    return {
      chatId: chat.id,
      sourceId,
      toolResult,
      text: findings,
    };
  } catch (error) {
    // Error path: persist error row and re-throw
    if (error instanceof ToolApiError) {
      const errorToolResult = {
        schemaVersion: TOOL_RESULT_SCHEMA_VERSION,
        type: "toolResult",
        tool: "xray",
        status: "error",
        sourceId,
        filename: originalname,
        error: {
          code: error.code,
          message: error.message,
        },
      };

      const errorResponse = {
        text: "",
        sources: [],
        type: "toolResult",
        toolResult: errorToolResult,
        _forLLM: `[วิเคราะห์ภาพเอกซเรย์ของไฟล์ ${originalname} ล้มเหลว]`,
        attachments: [],
        metrics: {},
      };

      await WorkspaceChats.new({
        workspaceId: workspace.id,
        prompt: `[X-ray] ${originalname}`,
        response: errorResponse,
        threadId: threadId || null,
        user,
      });

      throw error;
    }

    throw error;
  }
}

module.exports = {
  runXray,
};
