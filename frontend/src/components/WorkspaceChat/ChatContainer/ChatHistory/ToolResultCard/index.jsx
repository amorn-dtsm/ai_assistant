import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { saveAs } from "file-saver";
import {
  Copy,
  CheckCircle,
  Download,
  Upload,
  CircleNotch,
  Warning,
} from "@phosphor-icons/react";
import renderMarkdown from "@/utils/chat/markdown";
import DOMPurify from "dompurify";
import AiTools from "@/models/aiTools";
import showToast from "@/utils/toast";

/**
 * ToolResultCard - Renders AI tool results (OCR, Searchable PDF, X-ray)
 * @param {{
 *   toolResult: {tool: string, status: string, sourceId: string, filename: string, pages?: number, language?: string, payload?: {findings: string, labels?: Array}, downloads?: {txt?: boolean, pdf?: boolean, original?: boolean}, error?: {code: string, message: string}},
 *   content: string,
 *   pending: boolean,
 *   workspaceSlug: string
 * }} props
 */
function ToolResultCard({ toolResult, content, pending, workspaceSlug }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!toolResult) return null;

  const { tool, status, sourceId, filename, pages, language, payload, downloads, error } = toolResult;

  // Pending state
  if (pending) {
    return (
      <div
        className="flex justify-center w-full my-2"
        data-testid="tool-result-card-pending"
      >
        <div className="w-full max-w-[750px] mr-4">
          <div className="flex items-center gap-x-3 bg-zinc-800 light:bg-slate-100 light:border light:border-slate-200/50 rounded-xl px-4 py-3">
            <CircleNotch
              size={20}
              weight="bold"
              className="animate-spin text-blue-400"
            />
            <span className="text-white light:text-slate-900 text-sm font-medium">
              {t("chat_window.aiTools.card.processing")}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <div
        className="flex justify-center w-full my-2"
        data-testid="tool-result-card-error"
      >
        <div className="w-full max-w-[750px] mr-4">
          <div className="flex items-start gap-x-3 bg-red-900/20 light:bg-red-50 border border-red-700/30 light:border-red-200 rounded-xl px-4 py-3">
            <Warning
              size={20}
              weight="bold"
              className="text-red-500 flex-shrink-0 mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <p className="text-red-400 light:text-red-700 text-sm font-medium">
                {t("chat_window.aiTools.card.errorTitle")}
              </p>
              <p className="text-red-300 light:text-red-600 text-xs mt-1">
                {error?.message || t("chat_window.aiTools.errors.upstream")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success states
  return (
    <div className="flex justify-center w-full my-2" data-testid={`tool-result-card-${tool}`}>
      <div className="w-full max-w-[750px] mr-4">
        {tool === "ocr" && (
          <OcrCard
            filename={filename}
            pages={pages}
            language={language}
            content={content}
            sourceId={sourceId}
            workspaceSlug={workspaceSlug}
            expanded={expanded}
            setExpanded={setExpanded}
            copied={copied}
            setCopied={setCopied}
            downloading={downloading}
            setDownloading={setDownloading}
          />
        )}
        {tool === "searchablePdf" && (
          <SearchablePdfCard
            filename={filename}
            sourceId={sourceId}
            workspaceSlug={workspaceSlug}
            downloading={downloading}
            setDownloading={setDownloading}
            importing={importing}
            setImporting={setImporting}
          />
        )}
        {tool === "xray" && (
          <XrayCard
            filename={filename}
            findings={payload?.findings || content}
            labels={payload?.labels || []}
            sourceId={sourceId}
            workspaceSlug={workspaceSlug}
          />
        )}
      </div>
    </div>
  );
}

/**
 * OCR Card - Displays extracted text with copy and download buttons
 */
function OcrCard({
  filename,
  pages,
  language,
  content,
  sourceId,
  workspaceSlug,
  expanded,
  setExpanded,
  copied,
  setCopied,
  downloading,
  setDownloading,
}) {
  const { t } = useTranslation();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleDownloadTxt = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const url = AiTools.downloadUrl(workspaceSlug, sourceId, "txt");
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (!response.ok) {
        const errorMsg = response.status === 403 
          ? t("chat_window.aiTools.errors.upstream")
          : response.status === 404
          ? t("chat_window.aiTools.errors.upstream")
          : t("chat_window.aiTools.errors.upstream");
        showToast(errorMsg, "error");
        return;
      }
      const blob = await response.blob();
      saveAs(blob, `${filename.replace(/\.[^/.]+$/, "")}.txt`);
    } catch (err) {
      console.error("Failed to download:", err);
      showToast(t("chat_window.aiTools.errors.upstream"), "error");
    } finally {
      setDownloading(false);
    }
  };

  const lines = content.split("\n");
  const isLong = lines.length > 10;
  const displayLines = expanded ? lines : lines.slice(0, 10);
  const displayText = displayLines.join("\n");

  return (
    <div className="bg-zinc-800 light:bg-slate-100 light:border light:border-slate-200/50 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-white light:text-slate-900 text-sm font-semibold">
            {t("chat_window.aiTools.card.ocrTitle")}
          </h3>
          <div className="flex gap-x-3 mt-1 text-xs text-zinc-400 light:text-slate-500">
            {pages && (
              <span>
                {t("chat_window.aiTools.card.pages")}: {pages}
              </span>
            )}
            {language && <span>{language}</span>}
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 light:bg-slate-50 rounded-lg p-3 max-h-[300px] overflow-y-auto">
        <p className="text-zinc-300 light:text-slate-700 text-xs leading-relaxed whitespace-pre-wrap break-words">
          {displayText}
        </p>
        {isLong && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="text-blue-400 hover:text-blue-300 text-xs font-medium mt-2"
          >
            {t("chat_window.aiTools.card.showMore")}
          </button>
        )}
        {isLong && expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="text-blue-400 hover:text-blue-300 text-xs font-medium mt-2"
          >
            {t("chat_window.aiTools.card.showLess")}
          </button>
        )}
      </div>

      <div className="flex gap-x-2">
        <button
          onClick={handleCopy}
          data-testid="tool-result-copy-btn"
          className="flex items-center gap-x-2 px-3 py-2 rounded-lg border border-zinc-600 light:border-slate-300 hover:bg-zinc-700 light:hover:bg-slate-200 transition-colors text-white light:text-slate-900 text-xs font-medium flex-shrink-0"
        >
          {copied ? (
            <>
              <CheckCircle size={14} weight="bold" />
              <span>{t("chat_window.aiTools.card.copied")}</span>
            </>
          ) : (
            <>
              <Copy size={14} weight="bold" />
              <span>{t("chat_window.aiTools.card.copy")}</span>
            </>
          )}
        </button>

        <button
          onClick={handleDownloadTxt}
          disabled={downloading}
          data-testid="tool-result-download-txt-btn"
          className="flex items-center gap-x-2 px-3 py-2 rounded-lg border border-zinc-600 light:border-slate-300 hover:bg-zinc-700 light:hover:bg-slate-200 transition-colors text-white light:text-slate-900 text-xs font-medium flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? (
            <CircleNotch size={14} weight="bold" className="animate-spin" />
          ) : (
            <Download size={14} weight="bold" />
          )}
          <span>{t("chat_window.aiTools.card.downloadTxt")}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Searchable PDF Card - Displays PDF with download and import buttons
 */
function SearchablePdfCard({
  filename,
  sourceId,
  workspaceSlug,
  downloading,
  setDownloading,
  importing,
  setImporting,
}) {
  const { t } = useTranslation();
  const [imported, setImported] = useState(false);

  const handleDownloadPdf = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const url = AiTools.downloadUrl(workspaceSlug, sourceId, "pdf");
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      if (!response.ok) {
        const errorMsg = response.status === 403 
          ? t("chat_window.aiTools.errors.upstream")
          : response.status === 404
          ? t("chat_window.aiTools.errors.upstream")
          : t("chat_window.aiTools.errors.upstream");
        showToast(errorMsg, "error");
        return;
      }
      const blob = await response.blob();
      saveAs(blob, `${filename.replace(/\.[^/.]+$/, "")}-searchable.pdf`);
    } catch (err) {
      console.error("Failed to download:", err);
      showToast(t("chat_window.aiTools.errors.upstream"), "error");
    } finally {
      setDownloading(false);
    }
  };

  const handleImport = async () => {
    if (importing || imported) return;
    setImporting(true);
    try {
      await AiTools.importPdf(workspaceSlug, sourceId);
      setImported(true);
      showToast(t("chat_window.aiTools.card.importSuccess"), "success");
    } catch (err) {
      console.error("Failed to import:", err);
      const errorMsg = err.message || t("chat_window.aiTools.errors.upstream");
      showToast(errorMsg, "error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="bg-zinc-800 light:bg-slate-100 light:border light:border-slate-200/50 rounded-xl p-4 space-y-3">
      <div>
        <h3 className="text-white light:text-slate-900 text-sm font-semibold">
          {t("chat_window.aiTools.card.pdfTitle")}
        </h3>
        <p className="text-zinc-400 light:text-slate-500 text-xs mt-1">
          {filename}
        </p>
      </div>

      <div className="flex gap-x-2">
        <button
          onClick={handleDownloadPdf}
          disabled={downloading}
          data-testid="tool-result-download-pdf-btn"
          className="flex items-center gap-x-2 px-3 py-2 rounded-lg border border-zinc-600 light:border-slate-300 hover:bg-zinc-700 light:hover:bg-slate-200 transition-colors text-white light:text-slate-900 text-xs font-medium flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {downloading ? (
            <CircleNotch size={14} weight="bold" className="animate-spin" />
          ) : (
            <Download size={14} weight="bold" />
          )}
          <span>{t("chat_window.aiTools.card.downloadPdf")}</span>
        </button>

       <button
           onClick={handleImport}
           disabled={importing || imported}
           data-testid="tool-result-import-btn"
           className="flex items-center gap-x-2 px-3 py-2 rounded-lg border border-zinc-600 light:border-slate-300 hover:bg-zinc-700 light:hover:bg-slate-200 transition-colors text-white light:text-slate-900 text-xs font-medium flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
         >
           {importing ? (
             <CircleNotch size={14} weight="bold" className="animate-spin" />
           ) : imported ? (
             <CheckCircle size={14} weight="bold" />
           ) : (
             <Upload size={14} weight="bold" />
           )}
           <span>{imported ? t("chat_window.aiTools.card.imported") : t("chat_window.aiTools.card.importToWorkspace")}</span>
         </button>
      </div>
    </div>
  );
}

/**
 * X-ray Card - Displays findings as markdown with confidence labels
 */
function XrayCard({ filename, findings, labels, sourceId, workspaceSlug }) {
  const { t } = useTranslation();

  return (
    <div className="bg-zinc-800 light:bg-slate-100 light:border light:border-slate-200/50 rounded-xl p-4 space-y-3">
      <div>
        <h3 className="text-white light:text-slate-900 text-sm font-semibold">
          {t("chat_window.aiTools.card.xrayTitle")}
        </h3>
        <p className="text-zinc-400 light:text-slate-500 text-xs mt-1">
          {filename}
        </p>
      </div>

      <div className="bg-zinc-900 light:bg-slate-50 rounded-lg p-3 max-h-[400px] overflow-y-auto">
        <div
          className="text-zinc-300 light:text-slate-700 text-xs leading-relaxed prose prose-invert light:prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(renderMarkdown(findings)),
          }}
        />
      </div>

      {labels && labels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {labels.map((label, idx) => (
            <div
              key={idx}
              className="inline-flex items-center gap-x-1 px-2 py-1 rounded-full bg-blue-900/30 light:bg-blue-100 border border-blue-700/30 light:border-blue-200"
            >
              <span className="text-blue-300 light:text-blue-700 text-xs font-medium">
                {label.name}
              </span>
              <span className="text-blue-400 light:text-blue-600 text-xs">
                {Math.round(label.confidence * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(ToolResultCard);
