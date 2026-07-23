/**
 * AI Tools External API Contract
 *
 * Shared constants and type definitions for:
 * - External API client adapter (server/utils/aiTools/client.js)
 * - Mock external API server (server/scripts/mock-ai-tools-api.js)
 * - Service modules (server/utils/aiTools/ocr.js, etc.)
 *
 * This is the single source of truth for tool IDs, endpoints, limits, and error codes.
 * See docs/tool-api-contract.md for the full API specification.
 */

/**
 * Tool identifiers
 * @type {Object<string, string>}
 */
const TOOLS = {
  OCR: "ocr",
  SEARCHABLE_PDF: "searchablePdf",
  XRAY: "xray",
};

/**
 * API endpoint paths (relative to base URL)
 * @type {Object<string, string>}
 */
const ENDPOINTS = {
  [TOOLS.OCR]: "/ocr",
  [TOOLS.SEARCHABLE_PDF]: "/searchable-pdf",
  [TOOLS.XRAY]: "/analyze",
};

/**
 * Error codes for typed error handling
 * @type {Object<string, string>}
 */
const ERROR_CODES = {
  TIMEOUT: "TIMEOUT",
  UPSTREAM_5XX: "UPSTREAM_5XX",
  UPSTREAM_4XX: "UPSTREAM_4XX",
  INVALID_FILE: "INVALID_FILE",
  NOT_CONFIGURED: "NOT_CONFIGURED",
};

/**
 * Per-tool file size limits and allowed MIME types
 * @type {Object<string, {maxSizeBytes: number, mimeTypes: string[], extensions: string[]}>}
 */
const LIMITS = {
  [TOOLS.OCR]: {
    maxSizeBytes: 50 * 1024 * 1024, // 50 MB
    mimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/tiff"],
    extensions: ["pdf", "png", "jpg", "jpeg", "tiff"],
  },
  [TOOLS.SEARCHABLE_PDF]: {
    maxSizeBytes: 100 * 1024 * 1024, // 100 MB
    mimeTypes: ["application/pdf"],
    extensions: ["pdf"],
  },
  [TOOLS.XRAY]: {
    maxSizeBytes: 25 * 1024 * 1024, // 25 MB
    mimeTypes: ["image/png", "image/jpeg"],
    extensions: ["png", "jpg", "jpeg"],
  },
};

/**
 * Tool result schema version
 * Incremented when the persisted toolResult JSON shape changes
 * @type {number}
 */
const TOOL_RESULT_SCHEMA_VERSION = 1;

/**
 * Character limit for LLM-visible content in tool results
 * Content exceeding this is truncated with "[truncated]" marker
 * @type {number}
 */
const FOR_LLM_CHAR_CAP = 8000;

/**
 * External API call timeout (milliseconds)
 * @type {number}
 */
const EXTERNAL_CALL_TIMEOUT_MS = 120 * 1000; // 120 seconds

/**
 * Tool Result JSON Type Definition (JSDoc for reference)
 *
 * @typedef {Object} ToolResult
 * @property {number} schemaVersion - Always 1 for this version
 * @property {string} type - Always "toolResult"
 * @property {string} tool - Tool ID: "ocr" | "searchablePdf" | "xray"
 * @property {string} status - "success" | "error"
 * @property {string} sourceId - UUID v4 identifier for this execution
 * @property {string} filename - Original filename (sanitized)
 * @property {string} _forLLM - Text visible to LLM (capped at FOR_LLM_CHAR_CAP)
 * @property {Object} payload - Tool-specific result data
 * @property {Object} [error] - Present only when status === "error"
 * @property {string} error.code - Error code from ERROR_CODES
 * @property {string} error.message - Safe error message
 */

/**
 * OCR Result Payload Type Definition
 *
 * @typedef {Object} OcrPayload
 * @property {string} text - Full extracted text
 * @property {number} pages - Number of pages processed
 * @property {string} [language] - Detected language(s), e.g., "tha+eng"
 * @property {Array} [boxes] - Optional bounding box coordinates
 */

/**
 * X-ray Result Payload Type Definition
 *
 * @typedef {Object} XrayPayload
 * @property {string} findings - Detailed analysis findings
 * @property {Array<{name: string, confidence: number}>} [labels] - Detected objects/anomalies
 */

/**
 * Searchable PDF Result Payload Type Definition
 *
 * @typedef {Object} SearchablePdfPayload
 * Empty object; binary PDF is stored separately
 */

module.exports = {
  TOOLS,
  ENDPOINTS,
  ERROR_CODES,
  LIMITS,
  TOOL_RESULT_SCHEMA_VERSION,
  FOR_LLM_CHAR_CAP,
  EXTERNAL_CALL_TIMEOUT_MS,
};
