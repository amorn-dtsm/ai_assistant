import createDOMPurify from "dompurify";

/**
 * DOMPurify configuration for DOCX HTML sanitization.
 * Exported separately for static verification in test harnesses.
 */
export const DOCX_PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "ul", "ol", "li",
    "table", "thead", "tbody", "tr", "td", "th",
    "strong", "em", "u", "s",
    "a", "img",
    "blockquote", "code", "pre",
    "br", "sup", "sub",
  ],
  ALLOWED_ATTR: ["href", "src", "alt", "colspan", "rowspan"],
  FORBID_ATTR: ["style", "class", "id"],
  ALLOWED_URI_REGEXP: /^(?:https?:|data:image\/)/i,
};

/**
 * Sanitize DOCX-converted HTML with a dedicated DOMPurify instance.
 * Creates a fresh DOMPurify + fresh config spread per call so the chat
 * purify profile is never mutated.
 *
 * @param {string} html - Raw HTML from DOCX conversion
 * @returns {string} Sanitized HTML safe for dangerouslySetInnerHTML
 */
export function sanitizeDocxHtml(html) {
  const purify = createDOMPurify(window);
  return purify.sanitize(html, { ...DOCX_PURIFY_CONFIG });
}
