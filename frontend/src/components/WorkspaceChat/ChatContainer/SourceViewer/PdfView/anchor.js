/**
 * anchor.js – Pure helpers for PDF text anchoring.
 * No React, no DOM, no pdfjs imports. Node-testable.
 *
 * Responsibilities:
 *   1. Build a raw page string from pdfjs text items.
 *   2. Search across pages for a chunk-text needle (exact → fuzzy).
 *   3. Map a normalized-space hit back to raw offsets → item-level spans.
 */

import {
  normalizeForMatch,
  flexFind,
  fuzzyFind,
  prepareSearchKey,
  THAI_RANGE,
} from "@/utils/sourceViewer/normalize.js";

// ── 1. Build raw page text from pdfjs text items ───────────────────

/**
 * @typedef {{ str: string, hasEOL?: boolean }} TextItem
 *   Minimal shape matching pdfjs TextItem (only fields we use).
 */

/**
 * Build a single raw string from an array of pdfjs text items,
 * plus per-item offset tracking for later span mapping.
 *
 * @param {TextItem[]} items
 * @returns {{ raw: string, itemSpans: { start: number, end: number }[] }}
 *   raw: concatenated text (with '\n' where hasEOL).
 *   itemSpans[i]: { start, end } byte offsets in `raw` for items[i].
 */
export function buildPageText(items) {
  let raw = "";
  const itemSpans = [];

  for (const item of items) {
    const start = raw.length;
    raw += item.str;
    if (item.hasEOL) raw += "\n";
    itemSpans.push({ start, end: raw.length });
  }

  return { raw, itemSpans };
}

// ── 2. Search pages for needle ──────────────────────────────────────

/**
 * @typedef {{ pageIndex: number, normStart: number, normEnd: number, quality: "exact"|"approximate" }} PageHit
 */

/**
 * Search an array of per-page raw strings for the best match to chunkText.
 *
 * Algorithm:
 *   1. prepareSearchKey(chunkText) → needle.
 *   2. For each page: normalizeForMatch(raw) → flexFind (exact).
 *      First hit → quality "exact", done.
 *   3. If no exact: fuzzyFind per page (thai flag auto-detected).
 *      Best-scoring page ≥ MIN_MATCH_SCORE → "approximate".
 *   4. None → null (caller should default to page 0 + "none").
 *
 * @param {string[]} pageRaws  – raw text per page (from buildPageText).
 * @param {string} chunkText   – the source citation text.
 * @returns {PageHit | null}
 */
export function findChunkPage(pageRaws, chunkText) {
  const needle = prepareSearchKey(chunkText);
  if (!needle.norm.trim()) return null;

  const isThai = THAI_RANGE.test(needle.norm);

  // Pass 1: exact (flexFind)
  for (let i = 0; i < pageRaws.length; i++) {
    const { norm } = normalizeForMatch(pageRaws[i]);
    const hit = flexFind(norm, needle.norm);
    if (hit) {
      return {
        pageIndex: i,
        normStart: hit.start,
        normEnd: hit.end,
        quality: "exact",
      };
    }
  }

  // Pass 2: fuzzy
  let best = null;
  for (let i = 0; i < pageRaws.length; i++) {
    const { norm } = normalizeForMatch(pageRaws[i]);
    const hit = fuzzyFind(norm, needle.norm, { thai: isThai });
    if (hit && (best === null || hit.score > best.score)) {
      best = {
        pageIndex: i,
        normStart: hit.start,
        normEnd: hit.end,
        score: hit.score,
        quality: "approximate",
      };
    }
  }

  if (best) {
    return {
      pageIndex: best.pageIndex,
      normStart: best.normStart,
      normEnd: best.normEnd,
      quality: best.quality,
    };
  }

  return null;
}

// ── 3. Map normalized hit → item-level span ranges ──────────────────

/**
 * @typedef {{ spanIdx: number, charOffset: number }} SpanPos
 * @typedef {{ start: SpanPos, end: SpanPos }} SpanRange
 */

/**
 * Given a normalized-space hit (start/end in normalized string of a page),
 * map back to raw-string offsets via the normalization map, then resolve
 * which text-layer spans (1:1 with items) and character offsets are covered.
 *
 * @param {string} pageRaw         – raw page text.
 * @param {{ start: number, end: number }[]} itemSpans – from buildPageText.
 * @param {number} normStart       – start offset in normalized string.
 * @param {number} normEnd         – end offset in normalized string.
 * @returns {SpanRange | null}
 */
export function mapNormToSpans(pageRaw, itemSpans, normStart, normEnd) {
  const { map } = normalizeForMatch(pageRaw);

  if (normStart >= map.length || normEnd <= 0) return null;

  // Clamp
  const clampedStart = Math.max(0, normStart);
  const clampedEnd = Math.min(map.length, normEnd);

  // Map normalized offsets → raw offsets
  const rawStart = map[clampedStart];
  // normEnd is exclusive; map the last included normalized char
  const rawEnd =
    clampedEnd > 0 && clampedEnd <= map.length
      ? map[clampedEnd - 1] + 1
      : map[map.length - 1] + 1;

  // Find which items (spans) are covered
  const startSpan = findSpanAt(itemSpans, rawStart);
  const endSpan = findSpanAt(itemSpans, rawEnd - 1);

  if (startSpan === null || endSpan === null) return null;

  return {
    start: {
      spanIdx: startSpan.idx,
      charOffset: rawStart - itemSpans[startSpan.idx].start,
    },
    end: {
      spanIdx: endSpan.idx,
      charOffset: rawEnd - itemSpans[endSpan.idx].start,
    },
  };
}

/**
 * Binary-search for the item span containing rawOffset.
 * @param {{ start: number, end: number }[]} itemSpans
 * @param {number} rawOffset
 * @returns {{ idx: number } | null}
 */
function findSpanAt(itemSpans, rawOffset) {
  let lo = 0;
  let hi = itemSpans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (rawOffset < itemSpans[mid].start) {
      hi = mid - 1;
    } else if (rawOffset >= itemSpans[mid].end) {
      lo = mid + 1;
    } else {
      return { idx: mid };
    }
  }
  // rawOffset may land in a '\n' gap between items; snap to nearest
  if (lo < itemSpans.length) return { idx: lo };
  if (hi >= 0) return { idx: hi };
  return null;
}

// ── 4. Document-level matching (cross-page) ─────────────────────────

/**
 * @typedef {{ pageNumber: number, rawText: string }} PageInput
 * @typedef {{ pageNumber: number, rawStart: number, rawEnd: number }} Segment
 * @typedef {{ quality: "exact"|"fuzzy", score?: number, segments: Segment[] }} DocHit
 */

/**
 * Find a chunk needle across the entire document, returning per-page segments.
 *
 * HYBRID strategy:
 *   - If Σ rawText.length < streamThreshold → whole-doc path
 *     (concatenate all pages, single normalizeForMatch + search).
 *   - Else → streaming path (sliding window across pages with tail carry).
 *
 * @param {PageInput[]} pages
 * @param {string} needleNorm  – already normalized (from prepareSearchKey).
 * @param {{ thai?: boolean, streamThreshold?: number }} [opts]
 * @returns {DocHit | null}
 */
export function findChunkInDocument(
  pages,
  needleNorm,
  { thai = false, streamThreshold = 300000 } = {}
) {
  if (!needleNorm || !needleNorm.trim() || pages.length === 0) return null;

  const totalLen = pages.reduce((sum, p) => sum + p.rawText.length, 0);

  return totalLen < streamThreshold
    ? wholeDocPath(pages, needleNorm, thai)
    : streamingPath(pages, needleNorm, thai);
}

// ── Whole-doc path ──────────────────────────────────────────────────

function wholeDocPath(pages, needleNorm, thai) {
  // Concatenate all pages with "" (no separator), recording page boundaries
  let docRaw = "";
  const pageRanges = [];
  for (const p of pages) {
    const start = docRaw.length;
    docRaw += p.rawText;
    pageRanges.push({ pageNumber: p.pageNumber, start, end: docRaw.length });
  }

  const { norm, map } = normalizeForMatch(docRaw);

  // Exact via flexFind
  const exact = flexFind(norm, needleNorm);
  if (exact) {
    const segments = normHitToSegments(exact, map, pageRanges);
    if (segments.length > 0) return { quality: "exact", segments };
  }

  // Fuzzy fallback
  const fuzzy = fuzzyFind(norm, needleNorm, { thai });
  if (fuzzy) {
    const segments = normHitToSegments(fuzzy, map, pageRanges);
    if (segments.length > 0)
      return { quality: "fuzzy", score: fuzzy.score, segments };
  }

  return null;
}

/**
 * Map a normalized-space hit in the concatenated doc to per-page
 * raw-offset segments.
 *
 * Multi-char NFKC expansions map several norm chars to one raw offset;
 * we clamp rawEnd = map[hitEnd-1]+1 as elsewhere in the codebase.
 */
function normHitToSegments(hit, map, pageRanges) {
  const rawStart = map[hit.start];
  const rawEnd =
    hit.end > 0 && hit.end <= map.length
      ? map[hit.end - 1] + 1
      : map[map.length - 1] + 1;

  const segments = [];
  for (const pr of pageRanges) {
    if (rawEnd <= pr.start || rawStart >= pr.end) continue;
    segments.push({
      pageNumber: pr.pageNumber,
      rawStart: Math.max(rawStart, pr.start) - pr.start,
      rawEnd: Math.min(rawEnd, pr.end) - pr.start,
    });
  }
  return segments;
}

// ── Streaming path ──────────────────────────────────────────────────

/**
 * Process pages sequentially with a sliding tail window so cross-page
 * seam matches are caught without building a huge concatenated string.
 *
 * Per page: normalize page text, prepend carried tail from previous
 * page(s), search the combined window, apply dedup rule, carry forward
 * last (L-1) normalized chars for the next iteration.
 *
 * NOTE seam nuance: per-page normalization may produce a boundary space
 * differing from whole-doc normalization — flexFind's optional-space
 * `[ ]?` tokens absorb this difference.
 */
function streamingPath(pages, needleNorm, thai) {
  const L = needleNorm.length;
  if (L === 0) return null;

  let tailNorm = "";
  let tailAttrs = []; // [{pageNumber, rawOffset}]
  let bestFuzzy = null;

  for (const page of pages) {
    const { norm: normP, map: mapP } = normalizeForMatch(page.rawText);

    // Attribution: each norm char → {pageNumber, rawOffset in page's rawText}
    const pageAttrs = mapP.map((rawIdx) => ({
      pageNumber: page.pageNumber,
      rawOffset: rawIdx,
    }));

    // Window = carried tail + current page's normalized text
    const win = tailNorm + normP;
    const winAttrs = tailAttrs.concat(pageAttrs);
    const tailLen = tailNorm.length;

    // ── Exact ──
    const exact = flexFind(win, needleNorm);
    if (exact && exact.end > tailLen) {
      // DEDUP: accept only if match END is in NEW text (not carried tail)
      const segments = windowHitToSegments(exact, winAttrs);
      if (segments.length > 0) return { quality: "exact", segments };
    }

    // ── Fuzzy ──
    const fuzzy = fuzzyFind(win, needleNorm, { thai });
    if (fuzzy && fuzzy.end > tailLen) {
      if (!bestFuzzy || fuzzy.score > bestFuzzy.score) {
        const segments = windowHitToSegments(fuzzy, winAttrs);
        if (segments.length > 0) {
          bestFuzzy = { score: fuzzy.score, segments };
        }
      }
    }

    // Carry forward last (L-1) chars for next page's overlap window
    if (L > 1 && win.length >= L - 1) {
      const carryStart = win.length - (L - 1);
      tailNorm = win.slice(carryStart);
      tailAttrs = winAttrs.slice(carryStart);
    } else {
      tailNorm = win;
      tailAttrs = winAttrs.slice();
    }
  }

  if (bestFuzzy) {
    return {
      quality: "fuzzy",
      score: bestFuzzy.score,
      segments: bestFuzzy.segments,
    };
  }
  return null;
}

/**
 * Convert a window-space hit to per-page segments using the attribution
 * array. Groups contiguous ranges by page number.
 */
function windowHitToSegments(hit, winAttrs) {
  const byPage = new Map();
  const end = Math.min(hit.end, winAttrs.length);

  for (let i = hit.start; i < end; i++) {
    const attr = winAttrs[i];
    const existing = byPage.get(attr.pageNumber);
    if (!existing) {
      byPage.set(attr.pageNumber, {
        rawStart: attr.rawOffset,
        rawEnd: attr.rawOffset + 1,
      });
    } else {
      existing.rawStart = Math.min(existing.rawStart, attr.rawOffset);
      existing.rawEnd = Math.max(existing.rawEnd, attr.rawOffset + 1);
    }
  }

  const segments = [];
  for (const [pageNumber, range] of byPage) {
    segments.push({
      pageNumber,
      rawStart: range.rawStart,
      rawEnd: range.rawEnd,
    });
  }
  segments.sort((a, b) => a.pageNumber - b.pageNumber);
  return segments;
}

// ── 5. Map raw offsets → item-level span ranges ─────────────────────

/**
 * Given raw-string start/end offsets, resolve which text-layer spans
 * (1:1 with pdfjs items) and character offsets are covered.
 *
 * Unlike mapNormToSpans this takes raw offsets directly — no
 * normalization round-trip needed (useful when segments already carry
 * page-local raw offsets from findChunkInDocument).
 *
 * @param {{ start: number, end: number }[]} itemSpans – from buildPageText.
 * @param {number} rawStart
 * @param {number} rawEnd
 * @returns {SpanRange | null}
 */
export function mapRawToSpans(itemSpans, rawStart, rawEnd) {
  if (rawStart >= rawEnd) return null;

  const startSpan = findSpanAt(itemSpans, rawStart);
  const endSpan = findSpanAt(itemSpans, rawEnd - 1);

  if (startSpan === null || endSpan === null) return null;

  return {
    start: {
      spanIdx: startSpan.idx,
      charOffset: rawStart - itemSpans[startSpan.idx].start,
    },
    end: {
      spanIdx: endSpan.idx,
      charOffset: rawEnd - itemSpans[endSpan.idx].start,
    },
  };
}

// ── 6. OCR sidecar anchoring ────────────────────────────────────────

/**
 * @typedef {{ pageNumber: number, width: number, height: number, lines: { text: string, bbox: [number,number,number,number] }[] }} OcrPage
 */

/**
 * Search OCR sidecar pages for chunkText. Returns matched page + line bboxes.
 *
 * @param {OcrPage[]} ocrPages
 * @param {string} chunkText
 * @returns {{ pageIndex: number, bboxes: [number,number,number,number][], quality: "exact"|"approximate" } | null}
 */
export function findChunkInOcr(ocrPages, chunkText) {
  const needle = prepareSearchKey(chunkText);
  if (!needle.norm.trim()) return null;

  const isThai = THAI_RANGE.test(needle.norm);

  // Build per-page raw text + line spans
  const pageData = ocrPages.map((page) => {
    let raw = "";
    const lineSpans = [];
    for (const line of page.lines) {
      const start = raw.length;
      raw += line.text + "\n";
      lineSpans.push({ start, end: raw.length, bbox: line.bbox });
    }
    return { raw, lineSpans };
  });

  // Pass 1: exact
  for (let i = 0; i < pageData.length; i++) {
    const { norm, map } = normalizeForMatch(pageData[i].raw);
    const hit = flexFind(norm, needle.norm);
    if (hit) {
      const rawStart = map[hit.start];
      const rawEnd =
        hit.end > 0 && hit.end <= map.length
          ? map[hit.end - 1] + 1
          : map[map.length - 1] + 1;
      const bboxes = coveredLineBboxes(pageData[i].lineSpans, rawStart, rawEnd);
      return { pageIndex: i, bboxes, quality: "exact" };
    }
  }

  // Pass 2: fuzzy
  let best = null;
  for (let i = 0; i < pageData.length; i++) {
    const { norm, map } = normalizeForMatch(pageData[i].raw);
    const hit = fuzzyFind(norm, needle.norm, { thai: isThai });
    if (hit && (best === null || hit.score > best.score)) {
      const rawStart = map[hit.start];
      const rawEnd =
        hit.end > 0 && hit.end <= map.length
          ? map[hit.end - 1] + 1
          : map[map.length - 1] + 1;
      const bboxes = coveredLineBboxes(pageData[i].lineSpans, rawStart, rawEnd);
      best = { pageIndex: i, bboxes, quality: "approximate", score: hit.score };
    }
  }

  if (best) {
    return {
      pageIndex: best.pageIndex,
      bboxes: best.bboxes,
      quality: best.quality,
    };
  }

  return null;
}

/**
 * Collect bboxes of OCR lines that overlap [rawStart, rawEnd).
 */
function coveredLineBboxes(lineSpans, rawStart, rawEnd) {
  const bboxes = [];
  for (const ls of lineSpans) {
    if (ls.end > rawStart && ls.start < rawEnd) {
      bboxes.push(ls.bbox);
    }
  }
  return bboxes;
}
