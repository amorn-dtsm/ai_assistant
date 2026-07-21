import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

/**
 * Maps frontend tool IDs (from AI_TOOL_IDS) to server endpoint path segments.
 * Frontend uses underscores; server uses hyphens.
 */
const TOOL_ENDPOINT = {
  ocr: "ocr",
  xray: "xray",
  searchable_pdf: "searchable-pdf",
};

/**
 * Maps HTTP status codes to i18n error keys for AI tool operations.
 * Used to provide user-friendly error messages via toast notifications.
 */
const HTTP_ERROR_MAP = {
  400: "chat_window.aiTools.errors.invalidType",
  413: "chat_window.aiTools.errors.fileTooLarge",
  503: "chat_window.aiTools.errors.notConfigured",
  504: "chat_window.aiTools.errors.timeout",
  502: "chat_window.aiTools.errors.upstream",
};

/**
 * Get the i18n error key for a given HTTP status code.
 * @param {number} status - HTTP status code
 * @returns {string} i18n key, or generic "upstream" if unmapped
 */
export function getErrorKeyForStatus(status) {
  return HTTP_ERROR_MAP[status] || "chat_window.aiTools.errors.upstream";
}

const AiTools = {
  /**
   * Fetch which AI tools are enabled/configured for this workspace.
   * @param {string} slug - workspace slug
   * @returns {Promise<{ocr: boolean, searchablePdf: boolean, xray: boolean}>}
   */
  status: async function (slug) {
    return fetch(`${API_BASE}/workspace/${slug}/ai-tools/status`, {
      headers: baseHeaders(),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch AI tools status");
        return res.json();
      })
      .catch((e) => {
        console.error("AiTools.status error:", e.message);
        return { ocr: false, searchablePdf: false, xray: false };
      });
  },

  /**
   * Run an AI tool on a file.
   * @param {string} tool - tool ID from AI_TOOL_IDS (e.g. "ocr", "xray", "searchable_pdf")
   * @param {string} slug - workspace slug
   * @param {string|null} threadSlug - thread slug (optional)
   * @param {File} file - file to process
   * @param {Object} opts
   * @param {AbortSignal} [opts.signal] - AbortController signal
   * @param {string} [opts.clientRequestId] - client-generated request ID for optimistic UI
   * @returns {Promise<Object>} - server response with toolResult
   */
  run: async function (tool, slug, threadSlug, file, { signal, clientRequestId } = {}) {
    const endpoint = TOOL_ENDPOINT[tool];
    if (!endpoint) throw new Error(`Unknown tool: ${tool}`);

    const formData = new FormData();
    formData.append("file", file);
    if (threadSlug) formData.append("threadSlug", threadSlug);
    if (clientRequestId) formData.append("clientRequestId", clientRequestId);

    // Use baseHeaders() for auth but strip Content-Type so the browser
    // sets the multipart boundary automatically.
    const headers = { ...baseHeaders() };
    delete headers["Content-Type"];

    const res = await fetch(
      `${API_BASE}/workspace/${slug}/ai-tools/${endpoint}`,
      {
        method: "POST",
        body: formData,
        headers,
        signal,
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const error = new Error(body.error || body.message || `Tool request failed (${res.status})`);
      // Attach HTTP status code for error mapping in the caller
      error.httpStatus = res.status;
      throw error;
    }

    return res.json();
  },

  /**
   * Build an authenticated download URL for a tool result artifact.
   * @param {string} slug - workspace slug
   * @param {string|number} sourceId - the tool result source ID
   * @param {"txt"|"pdf"} kind - download format
   * @returns {string}
   */
  downloadUrl: function (slug, sourceId, kind) {
    return `${API_BASE}/workspace/${slug}/ai-tools/${sourceId}/download/${kind}`;
  },

  /**
   * Import a searchable PDF result into the workspace as an embedded document.
   * @param {string} slug - workspace slug
   * @param {string|number} sourceId - the tool result source ID
   * @returns {Promise<Object>}
   */
  importPdf: async function (slug, sourceId) {
    return fetch(
      `${API_BASE}/workspace/${slug}/ai-tools/${sourceId}/import`,
      {
        method: "POST",
        headers: baseHeaders(),
      }
    )
      .then((res) => {
        if (!res.ok) throw new Error("Import failed");
        return res.json();
      })
      .catch((e) => {
        console.error("AiTools.importPdf error:", e.message);
        throw e;
      });
  },
};

export default AiTools;
