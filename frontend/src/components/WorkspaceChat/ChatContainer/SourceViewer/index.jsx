import React, { Suspense, useState, useEffect, useCallback } from "react";
import { X } from "@phosphor-icons/react";

const PdfView = React.lazy(() => import("./PdfView"));
const ImageView = React.lazy(() => import("./ImageView"));
const ReflowView = React.lazy(() => import("./ReflowView"));

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-full w-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white light:border-slate-900 green:border-[#171717]" />
    </div>
  );
}

/**
 * Manual error boundary for catching lazy-load failures and 404s.
 * Renders a user-friendly error state with the required data-testid.
 */
class SourceViewerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("SourceViewer child error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          data-testid="source-viewer-error"
          className="flex items-center justify-center h-full w-full p-8"
        >
          <p className="text-white/60 light:text-slate-500 green:text-[#71717A] text-sm text-center">
            Source file no longer available
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Resolves the lazy child component for a given contentType.
 * @param {string} contentType
 * @returns {React.LazyExoticComponent|null}
 */
function getChildView(contentType) {
  switch (contentType) {
    case "pdf":
    case "scanned-pdf":
      return PdfView;
    case "image":
      return ImageView;
    case "md":
    case "txt":
    case "docx":
      return ReflowView;
    default:
      return null;
  }
}

/**
 * SourceViewer shell — fixed overlay panel that renders the appropriate
 * child view (PdfView, ImageView, or ReflowView) based on contentType.
 *
 * Desktop ≥768px: right-side dark panel ~65vw full height.
 * Mobile <768px: full-screen sheet.
 *
 * @param {object} props
 * @param {string} props.workspaceSlug
 * @param {{ title?: string, sourceId: string, contentType: string, hasSourceViewer?: boolean }} props.source
 * @param {{ text?: string }} [props.chunk]
 * @param {() => void} props.onClose
 */
export default function SourceViewer({
  workspaceSlug,
  source,
  chunk,
  onClose,
}) {
  const [matchQuality, setMatchQuality] = useState(null);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const ChildView = getChildView(source?.contentType);

  // Unknown content type — render error state
  if (!ChildView) {
    return (
      <>
        <div
          className="fixed inset-0 bg-black/50 z-[900]"
          onClick={onClose}
        />
        <div
          data-testid="source-viewer"
          className="fixed top-0 right-0 z-[901] bg-zinc-900 light:bg-white green:bg-white border-l border-zinc-700 light:border-slate-300 green:border-[#DEDEE0] flex flex-col w-full h-full md:w-[65vw]"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 light:border-slate-300 green:border-[#DEDEE0] flex-shrink-0">
            <h3 className="text-sm font-semibold text-white light:text-slate-900 green:text-[#171717] truncate">
              {source?.title || "Source"}
            </h3>
            <button
              onClick={onClose}
              type="button"
              className="text-white/60 light:text-slate-400 green:text-[#71717A] hover:text-white light:hover:text-slate-900 green:hover:text-[#171717] transition-colors"
            >
              <X size={20} weight="bold" />
            </button>
          </div>
          <div
            data-testid="source-viewer-error"
            className="flex items-center justify-center flex-1 p-8"
          >
            <p className="text-white/60 light:text-slate-500 text-sm text-center">
              Source file no longer available
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Backdrop — click to close */}
      <div
        className="fixed inset-0 bg-black/50 z-[900]"
        onClick={onClose}
      />

      {/* Panel — mobile: full-screen, desktop: right-side 65vw */}
      <div
        data-testid="source-viewer"
        className="fixed top-0 right-0 z-[901] bg-zinc-900 light:bg-white green:bg-white border-l border-zinc-700 light:border-slate-300 green:border-[#DEDEE0] flex flex-col w-full h-full md:w-[65vw]"
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 light:border-slate-300 green:border-[#DEDEE0] flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
            <h3 className="text-sm font-semibold text-white light:text-slate-900 green:text-[#171717] truncate">
              {source?.title || "Source"}
            </h3>
            {(matchQuality === "approximate" || matchQuality === "none") && (
              <span
                data-testid="match-approximate"
                className="flex-shrink-0 px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 light:bg-yellow-100 light:text-yellow-700 green:bg-yellow-100 green:text-yellow-700 text-xs whitespace-nowrap"
              >
                approximate location
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            type="button"
            className="flex-shrink-0 text-white/60 light:text-slate-400 green:text-[#71717A] hover:text-white light:hover:text-slate-900 green:hover:text-[#171717] transition-colors"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        {/* Child view */}
        <div className="flex-1 overflow-hidden">
          <SourceViewerErrorBoundary>
            <Suspense fallback={<LoadingSpinner />}>
              <ChildView
                workspaceSlug={workspaceSlug}
                sourceId={source?.sourceId}
                contentType={source?.contentType}
                chunkText={chunk?.text}
                onMatchQuality={setMatchQuality}
              />
            </Suspense>
          </SourceViewerErrorBoundary>
        </div>
      </div>
    </>
  );
}
