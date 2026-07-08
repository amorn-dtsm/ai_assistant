import { useState, useEffect, useRef, useMemo } from "react";
import DocumentSource from "@/models/documentSource";
import renderMarkdown from "@/utils/chat/markdown";
import DOMPurify from "@/utils/chat/purify";
import { sanitizeDocxHtml } from "@/utils/sourceViewer/purifyDocx";
import {
  normalizeForMatch,
  flexFind,
  fuzzyFind,
  prepareSearchKey,
  THAI_RANGE,
} from "@/utils/sourceViewer/normalize";
import { buildHaystack, resolveNormHit } from "./anchor";

// ── Scoped docx typography ──────────────────────────────────────────
const DOCX_STYLE = `
.reflow-docx h1, .reflow-docx h2, .reflow-docx h3,
.reflow-docx h4, .reflow-docx h5, .reflow-docx h6 {
  color: #e2e8f0; font-weight: 600; margin: 1em 0 0.4em;
}
.reflow-docx h1 { font-size: 1.6em; }
.reflow-docx h2 { font-size: 1.35em; }
.reflow-docx h3 { font-size: 1.15em; }
.reflow-docx p  { margin: 0.6em 0; line-height: 1.7; }
.reflow-docx ul, .reflow-docx ol { padding-left: 1.5em; margin: 0.5em 0; }
.reflow-docx li { margin: 0.25em 0; }
.reflow-docx blockquote {
  border-left: 3px solid rgba(255,255,255,0.25);
  padding: 0.4em 1em; margin: 0.6em 0;
  color: #cbd5e1;
}
.reflow-docx table {
  border-collapse: collapse; width: 100%; margin: 0.8em 0;
}
.reflow-docx td, .reflow-docx th {
  border: 1px solid rgba(255,255,255,0.18);
  padding: 0.45em 0.65em; text-align: left;
}
.reflow-docx th { background: rgba(255,255,255,0.06); font-weight: 600; }
.reflow-docx a { color: #60a5fa; text-decoration: underline; }
.reflow-docx img { max-width: 100%; height: auto; border-radius: 4px; }
.reflow-docx code { background: rgba(255,255,255,0.08); padding: 0.15em 0.35em; border-radius: 3px; font-size: 0.9em; }
.reflow-docx pre { background: rgba(0,0,0,0.3); padding: 1em; border-radius: 6px; overflow-x: auto; }
`;

// ── Highlight helpers ───────────────────────────────────────────────

/**
 * Feature-detect the CSS Custom Highlight API.
 * Guard both the constructor and the registry.
 */
function hasCustomHighlight() {
  return typeof globalThis.Highlight !== "undefined" && !!CSS?.highlights;
}

/**
 * Apply <mark> fallback for browsers without Custom Highlight API.
 * Wraps per-text-node segments of the given range in
 * `<mark data-testid="text-highlight">`.
 *
 * Processes nodes in REVERSE order so DOM mutations don't invalidate
 * earlier node references.
 *
 * @param {Text[]} textNodes
 * @param {{ start: {nodeIdx:number, offset:number}, end: {nodeIdx:number, offset:number} }} resolved
 * @returns {HTMLElement[]} created <mark> elements (for cleanup)
 */
function applyMarkFallback(textNodes, resolved) {
  const { start, end } = resolved;
  const marks = [];

  for (let i = end.nodeIdx; i >= start.nodeIdx; i--) {
    const node = textNodes[i];
    if (!node.parentNode) continue;

    const segStart = i === start.nodeIdx ? start.offset : 0;
    const segEnd = i === end.nodeIdx ? end.offset : node.data.length;
    if (segStart >= segEnd || segStart >= node.data.length) continue;

    const clampedEnd = Math.min(segEnd, node.data.length);
    const r = document.createRange();
    r.setStart(node, segStart);
    r.setEnd(node, clampedEnd);

    const mark = document.createElement("mark");
    mark.setAttribute("data-testid", "text-highlight");
    r.surroundContents(mark);
    marks.unshift(mark);
  }

  return marks;
}

/**
 * Remove <mark> wrappers, restoring original text nodes.
 */
function cleanupMarks(marks) {
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

// ── Component ───────────────────────────────────────────────────────

export default function ReflowView({
  workspaceSlug,
  sourceId,
  contentType,
  chunkText,
  onMatchQuality,
}) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const containerRef = useRef(null);
  const cleanupRef = useRef(null);

  // ── Fetch content ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await DocumentSource.fetchContent(
          workspaceSlug,
          sourceId
        );
        if (!data) throw new Error("Source content not found");

        // Strip leading BOM (U+FEFF) from pageContent
        if (data.pageContent) {
          data.pageContent = data.pageContent.replace(/^\uFEFF/, "");
        }

        if (!cancelled) {
          setContent(data);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, sourceId]);

  // ── Highlight after render ───────────────────────────────────────
  useEffect(() => {
    if (!content || !containerRef.current) return;

    // Tear down any previous highlight
    cleanupRef.current?.();
    cleanupRef.current = null;

    if (!chunkText) {
      onMatchQuality?.("none");
      return;
    }

    const container = containerRef.current;
    const isMd = contentType === "md";

    // Collect text nodes via TreeWalker.
    // For markdown, REJECT nodes inside .katex or pre>code to avoid
    // highlighting rendered math / syntax-highlighted code blocks.
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      isMd
        ? {
            acceptNode(node) {
              if (node.parentElement?.closest(".katex, pre code"))
                return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            },
          }
        : null
    );

    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    if (textNodes.length === 0) {
      onMatchQuality?.("none");
      return;
    }

    // Build haystack from text node data, joined WITHOUT separators.
    // flexFind's optional-space tokens tolerate missing block gaps
    // between adjacent DOM text nodes.
    const nodeData = textNodes.map((n) => ({ text: n.data }));
    const { haystack, spans } = buildHaystack(nodeData);

    const { norm, map } = normalizeForMatch(haystack);

    // Derive needle: for markdown, strip syntax so needle lives in the same
    // rendered-text space as the haystack (which comes from DOM text nodes
    // that already had markdown syntax removed by the renderer).
    const cleaned = prepareSearchKey(chunkText);
    let needle;
    if (isMd) {
      const rendered = DOMPurify.sanitize(renderMarkdown(cleaned.raw));
      const scratch = document.createElement("div");
      scratch.innerHTML = rendered;
      scratch
        .querySelectorAll("pre code, .katex")
        .forEach((el) => el.remove());
      // Walk text nodes (same method as haystack) — innerText on a
      // detached element omits block-boundary whitespace.
      const tw = document.createTreeWalker(
        scratch,
        NodeFilter.SHOW_TEXT,
        null
      );
      let stripped = "";
      while (tw.nextNode()) stripped += tw.currentNode.data;
      // Clean up unrendered markdown artifacts left by truncated
      // chunk text (e.g. incomplete [link](url syntax).
      stripped = stripped.replace(/!?\[([^\]]*)\]\([^)]*\)?/g, "$1");
      needle = normalizeForMatch(stripped).norm;
    } else {
      needle = cleaned.norm;
    }

    // --- Match: exact first, then fuzzy ---
    let hit = flexFind(norm, needle);
    let quality = "exact";

    if (!hit) {
      const thai = THAI_RANGE.test(chunkText);
      hit = fuzzyFind(norm, needle, { thai });
      quality = hit ? "approximate" : "none";
    }

    if (!hit) {
      onMatchQuality?.("none");
      // Render from top, no highlight — no console.error
      return;
    }

    onMatchQuality?.(quality);

    // --- Map norm offsets → raw → node positions ---
    const resolved = resolveNormHit(
      spans,
      map,
      hit.start,
      hit.end,
      haystack.length
    );

    // Clamp to valid text node bounds
    const startNode = textNodes[resolved.start.nodeIdx];
    const endNode = textNodes[resolved.end.nodeIdx];
    const clampedStartOffset = Math.min(
      resolved.start.offset,
      startNode.data.length
    );
    const clampedEndOffset = Math.min(
      resolved.end.offset,
      endNode.data.length
    );

    // Create DOM Range
    const range = document.createRange();
    range.setStart(startNode, clampedStartOffset);
    range.setEnd(endNode, clampedEndOffset);

    // --- Apply highlight ---
    if (hasCustomHighlight()) {
      // CSS Custom Highlight API — no DOM mutation
      const hl = new Highlight(range); // eslint-disable-line no-undef
      CSS.highlights.set("anythingllm-citation", hl);

      const style = document.createElement("style");
      style.setAttribute("data-citation-highlight", "");
      style.textContent =
        "::highlight(anythingllm-citation){background-color:rgba(255,235,59,.45)}";
      document.head.appendChild(style);

      cleanupRef.current = () => {
        CSS.highlights.delete("anythingllm-citation");
        style.remove();
      };
    } else {
      // Fallback: wrap segments in <mark>
      const marks = applyMarkFallback(textNodes, {
        start: {
          nodeIdx: resolved.start.nodeIdx,
          offset: clampedStartOffset,
        },
        end: { nodeIdx: resolved.end.nodeIdx, offset: clampedEndOffset },
      });

      cleanupRef.current = () => cleanupMarks(marks);
    }

    // Scroll highlighted region into view
    const scrollTarget = startNode.parentElement || startNode;
    scrollTarget.scrollIntoView({ block: "center", behavior: "smooth" });

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
   }, [content, chunkText, contentType, onMatchQuality]);

  // Memoize rendered markdown so React preserves DOM nodes across
  // re-renders triggered by the match-quality state update.
  const pageContent = content?.pageContent;
  const pageContentHtml = content?.pageContentHtml;
  const mdDIH = useMemo(
    () =>
      contentType === "md" && pageContent
        ? { __html: DOMPurify.sanitize(renderMarkdown(pageContent)) }
        : null,
    [contentType, pageContent]
  );

  // ── Error → throw to nearest ErrorBoundary ───────────────────────
  if (error) throw error;

  // ── Loading state ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="animate-pulse text-sm text-white/40 select-none">
          Loading source&hellip;
        </p>
      </div>
    );
  }

  // ── Render by contentType ────────────────────────────────────────
  if (contentType === "md") {
    return (
      <div
        ref={containerRef}
        className="reflow-md prose prose-invert prose-sm max-w-none px-4 py-3 text-white/90 leading-relaxed overflow-y-auto"
        dangerouslySetInnerHTML={mdDIH}
      />
    );
  }

  if (contentType === "txt") {
    return (
      <pre
        ref={containerRef}
        className="whitespace-pre-wrap px-4 py-3 text-sm text-white/85 leading-relaxed font-mono overflow-y-auto"
      >
        {pageContent}
      </pre>
    );
  }

  if (contentType === "docx") {
    const html = sanitizeDocxHtml(pageContentHtml);
    return (
      <>
        <style>{DOCX_STYLE}</style>
        <div
          ref={containerRef}
          className="reflow-docx px-4 py-3 text-sm text-white/85 leading-relaxed overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </>
    );
  }

  // Unknown contentType — render raw text as fallback
  return (
    <pre
      ref={containerRef}
      className="whitespace-pre-wrap px-4 py-3 text-sm text-white/85 leading-relaxed font-mono overflow-y-auto"
    >
      {pageContent}
    </pre>
  );
}
