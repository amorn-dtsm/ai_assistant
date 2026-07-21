import { X, Scan, Sparkle, FileText } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { AI_TOOL_IDS } from "@/utils/aiTools/constants";

const TOOL_ICON = {
  [AI_TOOL_IDS.OCR]: Scan,
  [AI_TOOL_IDS.XRAY]: Sparkle,
  [AI_TOOL_IDS.SEARCHABLE_PDF]: FileText,
};

/**
 * Compact chip displayed above the textarea showing the selected AI tool + filename.
 * Click ✕ to clear the pending tool intent.
 */
export default function ToolIntentChip({ pendingTool, onClear }) {
  const { t } = useTranslation();
  if (!pendingTool) return null;

  const { tool, file } = pendingTool;
  const Icon = TOOL_ICON[tool] || Scan;
  const label = t(
    `chat_window.aiTools.chip.${tool}`,
    tool === AI_TOOL_IDS.OCR
      ? "OCR"
      : tool === AI_TOOL_IDS.XRAY
        ? "X-ray"
        : "Searchable PDF"
  );

  return (
    <div
      data-testid="tool-intent-chip"
      className="flex items-center gap-1.5 mt-3 mb-1 px-2.5 py-1.5 rounded-lg bg-zinc-700/60 light:bg-slate-100 green:bg-[#C8E0CE] text-xs text-zinc-200 light:text-slate-700 green:text-[#171717] w-fit max-w-full"
    >
      <Icon size={14} weight="bold" className="shrink-0 opacity-70" />
      <span className="font-medium shrink-0">{label}</span>
      <span className="opacity-50 shrink-0">&middot;</span>
      <span className="truncate opacity-80" title={file.name}>
        {file.name}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 ml-1 border-none bg-transparent cursor-pointer rounded-full p-0.5 text-zinc-400 hover:text-white light:text-slate-400 light:hover:text-slate-800 green:text-[#71717A] green:hover:text-[#171717] transition-colors"
        aria-label="Clear tool selection"
      >
        <X size={12} weight="bold" />
      </button>
    </div>
  );
}
