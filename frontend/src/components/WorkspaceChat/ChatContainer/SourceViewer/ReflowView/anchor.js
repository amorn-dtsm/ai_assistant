/**
 * anchor.js – Pure (no DOM) haystack construction and hit-to-node resolution
 * for ReflowView text highlighting.
 *
 * All functions operate on plain arrays/strings so they can be tested in Node
 * without jsdom.
 */

/**
 * Build a flat haystack string from an array of text-node-like objects,
 * tracking each node's [start, end) span within the joined string.
 *
 * Nodes are concatenated WITHOUT separators — flexFind's optional-space
 * tokens tolerate missing block gaps between DOM text nodes, so inserting
 * artificial separators would skew offset mapping.
 *
 * @param {Array<{text: string}>} nodes
 * @returns {{ haystack: string, spans: Array<{start: number, end: number}> }}
 */
export function buildHaystack(nodes) {
  let haystack = "";
  const spans = [];
  for (const node of nodes) {
    const start = haystack.length;
    haystack += node.text;
    spans.push({ start, end: haystack.length });
  }
  return { haystack, spans };
}

/**
 * Binary-search spans to find the node containing a raw-haystack offset.
 *
 * @param {Array<{start: number, end: number}>} spans
 * @param {number} rawOffset – character offset in the raw (un-normalized) haystack
 * @returns {{ nodeIdx: number, offset: number }}
 */
export function resolveOffset(spans, rawOffset) {
  let lo = 0;
  let hi = spans.length - 1;

  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (spans[mid].end <= rawOffset) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  // Clamp offset within the node's bounds
  const localOffset = Math.max(0, rawOffset - spans[lo].start);
  return { nodeIdx: lo, offset: Math.min(localOffset, spans[lo].end - spans[lo].start) };
}

/**
 * Map a normalized-space hit range back to raw-haystack offsets,
 * then resolve both endpoints to {nodeIdx, offset} within the span list.
 *
 * @param {Array<{start: number, end: number}>} spans – from buildHaystack
 * @param {number[]} map – index map from normalizeForMatch (map[normIdx] → rawIdx)
 * @param {number} normStart – start index in the normalized string (inclusive)
 * @param {number} normEnd   – end index in the normalized string (exclusive)
 * @param {number} haystackLen – length of the raw haystack string
 * @returns {{ start: {nodeIdx: number, offset: number}, end: {nodeIdx: number, offset: number} }}
 */
export function resolveNormHit(spans, map, normStart, normEnd, haystackLen) {
  const rawStart = map[normStart];
  const rawEnd = normEnd < map.length ? map[normEnd] : haystackLen;

  return {
    start: resolveOffset(spans, rawStart),
    end: resolveOffset(spans, Math.max(rawEnd, rawStart + 1)),
  };
}

/**
 * Convenience: resolve a raw-haystack hit (already in raw offsets) to nodes.
 *
 * @param {Array<{start: number, end: number}>} spans
 * @param {number} rawStart
 * @param {number} rawEnd
 * @returns {{ start: {nodeIdx: number, offset: number}, end: {nodeIdx: number, offset: number} }}
 */
export function resolveHitToNodes(spans, rawStart, rawEnd) {
  return {
    start: resolveOffset(spans, rawStart),
    end: resolveOffset(spans, rawEnd),
  };
}
