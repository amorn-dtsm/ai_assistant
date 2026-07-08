import { useState, useEffect, useRef, useCallback } from "react";
import { baseHeaders } from "@/utils/request";
import DocumentSource from "@/models/documentSource";
import { anchorMatch, computeRects } from "./anchor";

/**
 * ImageView – Authenticated image viewer with OCR-based text highlighting.
 *
 * Fetches the image via authed fetch (no hotlinking), overlays highlight
 * rectangles on matched OCR lines, and reports match quality to parent.
 */
export default function ImageView({
  workspaceSlug,
  sourceId,
  contentType,
  chunkText,
  onMatchQuality,
}) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [sidecar, setSidecar] = useState(null);
  const [imgDims, setImgDims] = useState(null);
  const [overlayRects, setOverlayRects] = useState([]);

  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const qualityReported = useRef(false);

  // ── Fetch authed image blob ──────────────────────────────────
  useEffect(() => {
    let revoke = null;
    let cancelled = false;

    async function load() {
      const url = DocumentSource.fileUrl(workspaceSlug, sourceId);
      const res = await fetch(url, { headers: baseHeaders() });
      if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
      const blob = await res.blob();
      if (cancelled) return;
      const objectUrl = URL.createObjectURL(blob);
      revoke = objectUrl;
      setBlobUrl(objectUrl);
    }

    load();

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [workspaceSlug, sourceId]);

  // ── Fetch OCR sidecar ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await DocumentSource.fetchOcr(workspaceSlug, sourceId);
        if (!cancelled) setSidecar(data);
      } catch {
        // No sidecar available – silently degrade
        if (!cancelled) setSidecar(null);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [workspaceSlug, sourceId]);

  // ── Measure rendered image dimensions ────────────────────────
  const measureDims = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setImgDims({ w: img.clientWidth, h: img.clientHeight });
  }, []);

  const handleImgLoad = useCallback(() => {
    measureDims();
  }, [measureDims]);

  // ── Window resize → recompute dims ──────────────────────────
  useEffect(() => {
    window.addEventListener("resize", measureDims);
    return () => window.removeEventListener("resize", measureDims);
  }, [measureDims]);

  // ── Compute overlays when sidecar + dims + chunkText ready ──
  useEffect(() => {
    if (!sidecar || !imgDims || !chunkText) {
      if (!qualityReported.current) {
        onMatchQuality?.("none");
        qualityReported.current = true;
      }
      return;
    }

    const page = sidecar.pages?.[0];
    if (!page || !page.lines || page.lines.length === 0) {
      if (!qualityReported.current) {
        onMatchQuality?.("none");
        qualityReported.current = true;
      }
      setOverlayRects([]);
      return;
    }

    const { matchedLineIdxs, quality } = anchorMatch(page.lines, chunkText);

    if (!qualityReported.current) {
      onMatchQuality?.(quality);
      qualityReported.current = true;
    }

    if (matchedLineIdxs.length === 0) {
      setOverlayRects([]);
      return;
    }

    const rects = computeRects(page.lines, matchedLineIdxs, imgDims.w, imgDims.h);
    setOverlayRects(rects);
  }, [sidecar, imgDims, chunkText, onMatchQuality]);

  // ── Scroll first overlay into view ──────────────────────────
  useEffect(() => {
    if (overlayRects.length === 0 || !containerRef.current) return;
    const firstOverlay = containerRef.current.querySelector(
      '[data-testid="highlight-overlay"]'
    );
    if (firstOverlay) {
      firstOverlay.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [overlayRects]);

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center h-64 text-white/40 light:text-slate-400">
        Loading image...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto no-scroll"
      style={{ maxHeight: "70vh" }}
    >
      <div className="relative inline-block">
        <img
          ref={imgRef}
          src={blobUrl}
          onLoad={handleImgLoad}
          data-testid="source-image"
          alt="Source document"
          className="block max-w-full rounded-md"
          style={{ display: "block" }}
        />
        {overlayRects.map((rect, i) => (
          <div
            key={i}
            data-testid="highlight-overlay"
            style={{
              position: "absolute",
              left: `${rect.left}px`,
              top: `${rect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              background: "rgba(255, 235, 59, 0.35)",
              pointerEvents: "none",
              borderRadius: "2px",
            }}
          />
        ))}
      </div>
    </div>
  );
}
