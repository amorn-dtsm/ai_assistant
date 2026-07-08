/**
 * anchor.js – Pure matching logic for ImageView OCR overlays.
 * No React, no DOM. Node-runnable.
 *
 * Given sidecar OCR lines + chunk text, determines which lines match
 * and computes pixel rectangles for highlight overlays.
 */

import {
  normalizeForMatch,
  flexFind,
  fuzzyFind,
  prepareSearchKey,
  THAI_RANGE,
} from "@/utils/sourceViewer/normalize";

/**
 * Build a haystack string from sidecar lines, tracking each line's
 * character span [start, end) in the joined string.
 *
 * Lines are joined with "\n".
 *
 * @param {{ text: string }[]} lines
 * @returns {{ haystack: string, lineSpans: { start: number, end: number }[] }}
 */
function buildHaystack(lines) {
  const parts = [];
  const lineSpans = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      parts.push("\n");
      offset += 1;
    }
    const text = lines[i].text;
    parts.push(text);
    lineSpans.push({ start: offset, end: offset + text.length });
    offset += text.length;
  }

  return { haystack: parts.join(""), lineSpans };
}

/**
 * Map a character range [start, end) in the normalized haystack back
 * to line indices using the original-char mapping and line spans.
 *
 * @param {number} normStart - start offset in normalized string
 * @param {number} normEnd   - end offset in normalized string
 * @param {number[]} map     - normalizeForMatch map (norm index → original index)
 * @param {{ start: number, end: number }[]} lineSpans
 * @returns {number[]} sorted, deduplicated line indices
 */
function mapToLines(normStart, normEnd, map, lineSpans) {
  const origStart = map[normStart] ?? 0;
  const origEnd = map[Math.min(normEnd - 1, map.length - 1)] ?? 0;

  const matched = new Set();
  for (let li = 0; li < lineSpans.length; li++) {
    const span = lineSpans[li];
    // Overlap check: line span intersects [origStart, origEnd]
    if (span.end > origStart && span.start <= origEnd) {
      matched.add(li);
    }
  }

  return Array.from(matched).sort((a, b) => a - b);
}

/**
 * Determine which OCR lines match the chunk text.
 *
 * @param {{ text: string, bbox: number[] }[]} lines - sidecar page lines
 * @param {string} chunkText - source chunk text
 * @returns {{ matchedLineIdxs: number[], quality: "exact"|"approximate"|"none" }}
 */
export function anchorMatch(lines, chunkText) {
  if (!lines || lines.length === 0 || !chunkText) {
    return { matchedLineIdxs: [], quality: "none" };
  }

  const { haystack, lineSpans } = buildHaystack(lines);
  const { norm: haystackNorm, map: haystackMap } = normalizeForMatch(haystack);
  const { norm: needleNorm } = prepareSearchKey(chunkText);

  if (!needleNorm || !needleNorm.trim()) {
    return { matchedLineIdxs: [], quality: "none" };
  }

  // Try exact-ish match first
  const exact = flexFind(haystackNorm, needleNorm);
  if (exact) {
    const idxs = mapToLines(exact.start, exact.end, haystackMap, lineSpans);
    return { matchedLineIdxs: idxs, quality: "exact" };
  }

  // Fallback to fuzzy
  const isThai = THAI_RANGE.test(needleNorm);
  const fuzzy = fuzzyFind(haystackNorm, needleNorm, { thai: isThai });
  if (fuzzy) {
    const idxs = mapToLines(fuzzy.start, fuzzy.end, haystackMap, lineSpans);
    return { matchedLineIdxs: idxs, quality: "approximate" };
  }

  return { matchedLineIdxs: [], quality: "none" };
}

/**
 * Compute pixel rectangles for matched lines given rendered image dimensions.
 *
 * Each line's bbox is [x0, y0, x1, y1] normalized 0..1, top-left origin.
 *
 * @param {{ bbox: number[] }[]} lines - all sidecar lines
 * @param {number[]} matchedLineIdxs - indices into lines array
 * @param {number} renderedWidth - image clientWidth in px
 * @param {number} renderedHeight - image clientHeight in px
 * @returns {{ left: number, top: number, width: number, height: number }[]}
 */
export function computeRects(lines, matchedLineIdxs, renderedWidth, renderedHeight) {
  return matchedLineIdxs.map((idx) => {
    const [x0, y0, x1, y1] = lines[idx].bbox;
    return {
      left: x0 * renderedWidth,
      top: y0 * renderedHeight,
      width: (x1 - x0) * renderedWidth,
      height: (y1 - y0) * renderedHeight,
    };
  });
}
