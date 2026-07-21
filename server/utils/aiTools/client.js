const fs = require("fs");
const { TOOLS, ENDPOINTS, ERROR_CODES, LIMITS, EXTERNAL_CALL_TIMEOUT_MS } = require("./contract");

/**
 * Custom error class for tool API errors
 * Includes typed error codes for proper handling
 */
class ToolApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ToolApiError";
    this.code = code;
  }
}

/**
 * Get the environment variable key for a tool's base URL
 * @param {string} tool - Tool ID (ocr, searchablePdf, xray)
 * @returns {string} Environment variable name
 */
function getBaseUrlEnvKey(tool) {
  const envMap = {
    [TOOLS.OCR]: "OCR_API_BASE_URL",
    [TOOLS.SEARCHABLE_PDF]: "SEARCHABLE_PDF_API_BASE_URL",
    [TOOLS.XRAY]: "XRAY_API_BASE_URL",
  };
  return envMap[tool];
}

/**
 * Get the environment variable key for a tool's API key
 * @param {string} tool - Tool ID (ocr, searchablePdf, xray)
 * @returns {string} Environment variable name
 */
function getApiKeyEnvKey(tool) {
  const envMap = {
    [TOOLS.OCR]: "OCR_API_KEY",
    [TOOLS.SEARCHABLE_PDF]: "SEARCHABLE_PDF_API_KEY",
    [TOOLS.XRAY]: "XRAY_API_KEY",
  };
  return envMap[tool];
}

/**
 * Check if a tool is configured (base URL is set)
 * @param {string} tool - Tool ID
 * @returns {boolean} True if the tool's base URL is configured
 */
function isToolConfigured(tool) {
  const baseUrlKey = getBaseUrlEnvKey(tool);
  return !!process.env[baseUrlKey];
}

/**
 * Call an external AI tool API
 * 
 * @param {string} tool - Tool ID: "ocr" | "searchablePdf" | "xray"
 * @param {Object} options - Call options
 * @param {string} options.filePath - Absolute path to the file to upload
 * @param {string} options.filename - Original filename (for multipart field)
 * @param {string} options.mimeType - MIME type of the file
 * @returns {Promise<Object>} Tool-specific result object
 * @throws {ToolApiError} Typed error with code from ERROR_CODES
 */
async function callToolApi(tool, { filePath, filename, mimeType }) {
  // Validate tool
  if (!Object.values(TOOLS).includes(tool)) {
    throw new ToolApiError(ERROR_CODES.INVALID_FILE, `Unknown tool: ${tool}`);
  }

  // Check configuration
  const baseUrlKey = getBaseUrlEnvKey(tool);
  const apiKeyKey = getApiKeyEnvKey(tool);
  const baseUrl = process.env[baseUrlKey];
  const apiKey = process.env[apiKeyKey];

  if (!baseUrl) {
    throw new ToolApiError(ERROR_CODES.NOT_CONFIGURED, `Tool ${tool} is not configured (missing ${baseUrlKey})`);
  }

  // Validate file exists
  if (!fs.existsSync(filePath)) {
    throw new ToolApiError(ERROR_CODES.INVALID_FILE, `File not found: ${filePath}`);
  }

  // Build multipart request using native FormData (Node 18+)
  const form = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: mimeType });
  form.append("file", blob, filename);

  // Build URL
  const endpoint = ENDPOINTS[tool];
  const url = `${baseUrl}${endpoint}`;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_CALL_TIMEOUT_MS);

  try {
    // Make request
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle HTTP errors
    if (!response.ok) {
      const statusCode = response.status;
      let errorCode;

      if (statusCode >= 500) {
        errorCode = ERROR_CODES.UPSTREAM_5XX;
      } else if (statusCode >= 400) {
        errorCode = ERROR_CODES.UPSTREAM_4XX;
      } else {
        errorCode = ERROR_CODES.UPSTREAM_5XX; // Fallback
      }

      // Log only status code and error code, never response body
      console.error(`[ToolApiError] ${tool} returned ${statusCode}`, { code: errorCode });

      throw new ToolApiError(errorCode, `Upstream API returned ${statusCode}`);
    }

    // Parse response based on tool type
    if (tool === TOOLS.SEARCHABLE_PDF) {
      // Searchable PDF returns binary PDF
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/pdf")) {
        throw new ToolApiError(ERROR_CODES.UPSTREAM_5XX, "Expected application/pdf response");
      }
      const buffer = await response.buffer();
      return buffer;
    } else {
      // OCR and X-ray return JSON
      const data = await response.json();

      if (!data.ok) {
        throw new ToolApiError(ERROR_CODES.UPSTREAM_5XX, `API returned ok:false`);
      }

      return data;
    }
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle abort (timeout)
    if (error.name === "AbortError") {
      throw new ToolApiError(ERROR_CODES.TIMEOUT, `Request timeout after ${EXTERNAL_CALL_TIMEOUT_MS}ms`);
    }

    // Re-throw ToolApiError
    if (error instanceof ToolApiError) {
      throw error;
    }

    // Wrap other errors
    console.error(`[ToolApiError] Unexpected error calling ${tool}:`, error.message);
    throw new ToolApiError(ERROR_CODES.UPSTREAM_5XX, `Request failed: ${error.message}`);
  }
}

module.exports = {
  callToolApi,
  isToolConfigured,
  ToolApiError,
};
