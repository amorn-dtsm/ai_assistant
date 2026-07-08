import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const DocumentSource = {
  /**
   * Returns the URL for the raw file endpoint.
   * @param {string} slug - workspace slug
   * @param {string} sourceId - document source ID
   * @returns {string}
   */
  fileUrl: function (slug, sourceId) {
    return `${API_BASE}/workspace/${slug}/document-source/${sourceId}/file`;
  },

  /**
   * Fetches parsed content for a document source.
   * @param {string} slug - workspace slug
   * @param {string} sourceId - document source ID
   * @returns {Promise<{title: string, contentType: string, pageContent: string, pageContentHtml?: string, hasSourceViewer: boolean}|null>}
   */
  fetchContent: async function (slug, sourceId) {
    return await fetch(
      `${API_BASE}/workspace/${slug}/document-source/${sourceId}/content`,
      { headers: baseHeaders() }
    )
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => data ?? null)
      .catch((e) => {
        console.error("DocumentSource.fetchContent failed:", e);
        return null;
      });
  },

  /**
   * Fetches OCR sidecar data for a scanned document.
   * @param {string} slug - workspace slug
   * @param {string} sourceId - document source ID
   * @returns {Promise<object|null>}
   */
  fetchOcr: async function (slug, sourceId) {
    return await fetch(
      `${API_BASE}/workspace/${slug}/document-source/${sourceId}/ocr`,
      { headers: baseHeaders() }
    )
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => data ?? null)
      .catch((e) => {
        console.error("DocumentSource.fetchOcr failed:", e);
        return null;
      });
  },
};

export default DocumentSource;
