import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

import { baseHeaders } from "@/utils/request";
import documentSource from "@/models/documentSource";
import {
  buildPageText,
  findChunkInDocument,
  mapRawToSpans,
  findChunkInOcr,
} from "./anchor.js";
import {
  prepareSearchKey,
  THAI_RANGE,
} from "@/utils/sourceViewer/normalize.js";

// ── Worker config (Vite-compatible, module scope) ───────────────────
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// ── Constants ───────────────────────────────────────────────────────
const PAGE_WINDOW = 2; // render targetPage ± this many pages
const SHELL_HEIGHT = 842; // A4-ish default until first page measured
const MIN_BORN_DIGITAL_CHARS = 32;
const FUZZY_PAINT_THRESHOLD = 0.85;

// ── Component ───────────────────────────────────────────────────────

/**
 * PDF viewer with text-anchored highlighting.
 *
 * @param {{ workspaceSlug: string, sourceId: string, contentType: string, chunkText: string, onMatchQuality: (q: "exact"|"approximate"|"none") => void }} props
 */
export default function PdfView({
  workspaceSlug,
  sourceId,
  contentType,
  chunkText,
  onMatchQuality,
}) {
  // ── State ──────────────────────────────────────────────────────────
  const [numPages, setNumPages] = useState(null);
  const [targetPage, setTargetPage] = useState(1); // 1-based
  const [pageDims, setPageDims] = useState(null); // { width, height }
  const [overlays, setOverlays] = useState({}); // { [pageNum]: [{ top, left, width, height }] }
  const [hitPageNums, setHitPageNums] = useState([]); // pages with match segments
  const [error, setError] = useState(null);

  const pdfDocRef = useRef(null);
  const cancelledRef = useRef(false);
  const containerRef = useRef(null);
  const pageContainerRefs = useRef({});

  // ── PDF file source ────────────────────────────────────────────────
  const fileSource = useMemo(
    () => ({
      url: documentSource.fileUrl(workspaceSlug, sourceId),
      httpHeaders: baseHeaders(),
    }),
    [workspaceSlug, sourceId]
  );

  // ── Document load ──────────────────────────────────────────────────
  const onDocumentLoadSuccess = useCallback(
    (pdf) => {
      pdfDocRef.current = pdf;
      setNumPages(pdf.numPages);
      anchorChunk(pdf);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chunkText]
  );

  const onDocumentLoadError = useCallback((err) => {
    console.error("[PdfView] load error:", err);
    setError(err?.message || "Failed to load PDF");
  }, []);

  // ── First page dims (for shell sizing) ─────────────────────────────
  const onFirstPageLoadSuccess = useCallback((page) => {
    setPageDims({ width: page.width, height: page.height });
  }, []);

  // ── Anchoring logic ────────────────────────────────────────────────
  const anchorChunk = useCallback(
    async (pdf) => {
      if (!chunkText || cancelledRef.current) {
        onMatchQuality?.("none");
        return;
      }

      try {
        // Extract text from all pages
        const pageRaws = [];
        const pageItems = [];
        let totalChars = 0;

        for (let p = 1; p <= pdf.numPages; p++) {
          if (cancelledRef.current) return;
          const page = await pdf.getPage(p);
          const content = await page.getTextContent({
            disableNormalization: true,
          });
          const { raw, itemSpans } = buildPageText(content.items);
          pageRaws.push(raw);
          pageItems.push({ items: content.items, itemSpans });
          totalChars += raw.replace(/\s/g, "").length;
        }

        if (cancelledRef.current) return;

        // Scanned fallback: if total extracted text < 32 non-ws chars
        if (totalChars < MIN_BORN_DIGITAL_CHARS) {
          await anchorViaOcr(pdf);
          return;
        }

        // Document-level matching (replaces per-page loop)
        const needle = prepareSearchKey(chunkText);
        if (!needle.norm.trim()) {
          setTargetPage(1);
          onMatchQuality?.("none");
          return;
        }

        const docPages = pageRaws.map((raw, i) => ({
          pageNumber: i + 1,
          rawText: raw,
        }));

        const docHit = findChunkInDocument(docPages, needle.norm, {
          thai: THAI_RANGE.test(needle.norm),
        });

        if (!docHit) {
          setTargetPage(1);
          setHitPageNums([]);
          onMatchQuality?.("none");
          return;
        }

        const segPages = docHit.segments.map((s) => s.pageNumber);
        setTargetPage(segPages[0]);
        setHitPageNums(segPages);

        const shouldPaint =
          docHit.quality === "exact" ||
          (docHit.quality === "fuzzy" && docHit.score >= FUZZY_PAINT_THRESHOLD);

        onMatchQuality?.(docHit.quality === "exact" ? "exact" : "approximate");

        if (shouldPaint) {
          // Defer highlight placement until text layers render
          requestAnimationFrame(() => {
            if (cancelledRef.current) return;
            placeAllHighlights(docHit.segments, pageItems);
          });
        }
      } catch (err) {
        if (!cancelledRef.current) {
          console.error("[PdfView] anchor error:", err);
          onMatchQuality?.("none");
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chunkText]
  );

  // ── OCR fallback ──────────────────────────────────────────────────
  const anchorViaOcr = useCallback(
    async (_pdf) => {
      try {
        const ocrData = await documentSource.fetchOcr(workspaceSlug, sourceId);
        if (cancelledRef.current) return;

        if (!ocrData?.pages?.length) {
          setTargetPage(1);
          onMatchQuality?.("none");
          return;
        }

        const hit = findChunkInOcr(ocrData.pages, chunkText);
        if (!hit) {
          setTargetPage(1);
          onMatchQuality?.("none");
          return;
        }

        const hitPageNum = hit.pageIndex + 1;
        setTargetPage(hitPageNum);
        onMatchQuality?.(hit.quality);

        // Wait for page to render, then place bbox overlays
        requestAnimationFrame(() => {
          if (cancelledRef.current) return;
          const ocrPage = ocrData.pages[hit.pageIndex];
          placeOcrHighlights(hitPageNum, hit.bboxes, ocrPage);
        });
      } catch (err) {
        if (!cancelledRef.current) {
          console.error("[PdfView] OCR fallback error:", err);
          setTargetPage(1);
          onMatchQuality?.("none");
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceSlug, sourceId, chunkText]
  );

  // ── Highlight placement (born-digital, multi-page) ──────────────────
  const placeAllHighlights = useCallback((segments, allPageItems) => {
    let attempts = 0;
    const maxAttempts = 20;
    const placed = {};

    const tryPlace = () => {
      if (cancelledRef.current) return;
      attempts++;
      let anyPending = false;

      for (const seg of segments) {
        if (placed[seg.pageNumber]) continue;

        const pageEl = pageContainerRefs.current[seg.pageNumber];
        if (!pageEl) {
          anyPending = true;
          continue;
        }

        const textLayer = pageEl.querySelector(".react-pdf__Page__textContent");
        if (!textLayer || !textLayer.children.length) {
          anyPending = true;
          continue;
        }

        const pageIdx = seg.pageNumber - 1;
        const spanRange = mapRawToSpans(
          allPageItems[pageIdx].itemSpans,
          seg.rawStart,
          seg.rawEnd
        );
        if (!spanRange) {
          placed[seg.pageNumber] = [];
          continue;
        }

        const spans = textLayer.children;
        const startSpan = spans[spanRange.start.spanIdx];
        const endSpan = spans[spanRange.end.spanIdx];
        if (!startSpan || !endSpan) {
          placed[seg.pageNumber] = [];
          continue;
        }

        try {
          const range = document.createRange();
          const startNode = startSpan.firstChild;
          const endNode = endSpan.firstChild;

          if (!startNode || !endNode) {
            placed[seg.pageNumber] = [];
            continue;
          }

          range.setStart(
            startNode,
            Math.min(spanRange.start.charOffset, startNode.length)
          );
          range.setEnd(
            endNode,
            Math.min(spanRange.end.charOffset, endNode.length)
          );

          const rects = range.getClientRects();
          const pageRect = pageEl.getBoundingClientRect();

          placed[seg.pageNumber] = Array.from(rects)
            .filter((r) => r.width > 0 && r.height > 0)
            .map((r) => ({
              top: r.top - pageRect.top,
              left: r.left - pageRect.left,
              width: r.width,
              height: r.height,
            }));
        } catch (err) {
          console.error("[PdfView] range error:", err);
          placed[seg.pageNumber] = [];
        }
      }

      if (anyPending && attempts < maxAttempts) {
        setTimeout(tryPlace, 100);
        return;
      }

      setOverlays({ ...placed });

      // Scroll first segment's overlay into view
      const firstPage = segments[0]?.pageNumber;
      if (firstPage && placed[firstPage]?.length > 0) {
        const firstEl = pageContainerRefs.current[firstPage]?.querySelector(
          '[data-testid="highlight-overlay"]'
        );
        if (firstEl) firstEl.scrollIntoView({ block: "center" });
      }
    };

    tryPlace();
  }, []);

  // ── Highlight placement (OCR) ──────────────────────────────────────
  const placeOcrHighlights = useCallback((pageNum, bboxes, _ocrPage) => {
    let attempts = 0;
    const maxAttempts = 20;

    const tryPlace = () => {
      if (cancelledRef.current) return;
      attempts++;

      const pageEl = pageContainerRefs.current[pageNum];
      if (!pageEl) {
        if (attempts < maxAttempts) setTimeout(tryPlace, 100);
        return;
      }

      const canvas = pageEl.querySelector("canvas");
      if (!canvas) {
        if (attempts < maxAttempts) setTimeout(tryPlace, 100);
        return;
      }

      const renderedW = canvas.clientWidth;
      const renderedH = canvas.clientHeight;

      // OCR bboxes are normalized 0..1, top-left origin: [x0, y0, x1, y1]
      const newOverlays = bboxes.map(([x0, y0, x1, y1]) => ({
        top: y0 * renderedH,
        left: x0 * renderedW,
        width: (x1 - x0) * renderedW,
        height: (y1 - y0) * renderedH,
      }));

      setOverlays({ [pageNum]: newOverlays });

      if (newOverlays.length > 0) {
        requestAnimationFrame(() => {
          const firstOverlayEl = pageEl.querySelector(
            '[data-testid="highlight-overlay"]'
          );
          if (firstOverlayEl) {
            firstOverlayEl.scrollIntoView({ block: "center" });
          }
        });
      }
    };

    tryPlace();
  }, []);

  // ── Cleanup ────────────────────────────────────────────────────────
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy?.();
        pdfDocRef.current = null;
      }
    };
  }, [workspaceSlug, sourceId]);

  // ── Scroll target page into view when it changes ───────────────────
  useEffect(() => {
    if (!targetPage) return;
    const el = pageContainerRefs.current[targetPage];
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [targetPage, numPages]);

  // ── Render helpers ─────────────────────────────────────────────────
  const shellHeight = pageDims?.height || SHELL_HEIGHT;
  const shellWidth = pageDims?.width || 595;

  const isInWindow = (pageNum) =>
    Math.abs(pageNum - targetPage) <= PAGE_WINDOW ||
    hitPageNums.includes(pageNum);

  const setPageRef = (pageNum) => (el) => {
    pageContainerRefs.current[pageNum] = el;
  };

  // ── Render ─────────────────────────────────────────────────────────
  // Throw in render phase so the ErrorBoundary catches it
  if (error) throw new Error(error);

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-auto bg-theme-bg-secondary"
    >
      <Document
        file={fileSource}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={
          <div className="flex items-center justify-center h-64 text-theme-text-secondary">
            Loading PDF...
          </div>
        }
      >
        {numPages &&
          Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1;
            const inWindow = isInWindow(pageNum);

            return (
              <div
                key={pageNum}
                ref={setPageRef(pageNum)}
                data-page-number={pageNum}
                className="relative mx-auto mb-2"
                style={{
                  width: shellWidth,
                  minHeight: inWindow ? undefined : shellHeight,
                }}
              >
                {inWindow ? (
                  <Page
                    pageNumber={pageNum}
                    renderTextLayer
                    renderAnnotationLayer={false}
                    onLoadSuccess={
                      pageNum === 1 ? onFirstPageLoadSuccess : undefined
                    }
                    width={shellWidth}
                  />
                ) : (
                  <div
                    style={{ height: shellHeight }}
                    className="bg-theme-bg-primary"
                  />
                )}

                {/* Highlight overlays – on any page with hit segments */}
                {(overlays[pageNum] || []).map((rect, idx) => (
                  <div
                    key={idx}
                    data-testid="highlight-overlay"
                    style={{
                      position: "absolute",
                      top: rect.top,
                      left: rect.left,
                      width: rect.width,
                      height: rect.height,
                      backgroundColor: "rgba(255, 235, 59, 0.35)",
                      pointerEvents: "none",
                    }}
                  />
                ))}
              </div>
            );
          })}
      </Document>
    </div>
  );
}
