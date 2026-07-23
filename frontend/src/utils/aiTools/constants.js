/**
 * AI Tool constants for the frontend.
 * Mirrors the contract limits defined by the server-side AI tool adapters.
 */

export const AI_TOOL_IDS = {
  OCR: "ocr",
  XRAY: "xray",
  SEARCHABLE_PDF: "searchable_pdf",
};

/**
 * Per-tool file constraints: accepted MIME types, extensions, and max upload size.
 */
export const AI_TOOL_CONFIG = {
  [AI_TOOL_IDS.OCR]: {
    accept: ".pdf,.png,.jpg,.jpeg,.tiff",
    mimeTypes: [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/tiff",
    ],
    maxSizeBytes: 50 * 1024 * 1024, // 50 MB
    maxSizeLabel: "50 MB",
  },
  [AI_TOOL_IDS.XRAY]: {
    accept: ".png,.jpg,.jpeg",
    mimeTypes: ["image/png", "image/jpeg"],
    maxSizeBytes: 25 * 1024 * 1024, // 25 MB
    maxSizeLabel: "25 MB",
  },
  [AI_TOOL_IDS.SEARCHABLE_PDF]: {
    accept: ".pdf",
    mimeTypes: ["application/pdf"],
    maxSizeBytes: 100 * 1024 * 1024, // 100 MB
    maxSizeLabel: "100 MB",
  },
};
