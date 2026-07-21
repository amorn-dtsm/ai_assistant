import { useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  PaperclipHorizontal,
  Sparkle,
  FileText,
  Scan,
} from "@phosphor-icons/react";
import { AI_TOOL_IDS, AI_TOOL_CONFIG } from "@/utils/aiTools/constants";
import showToast from "@/utils/toast";

const MODE_OPTIONS = [
  {
    id: "attach",
    testId: "mode-option-attach",
    i18nKey: "aiTools.popup.attach",
    defaultLabel: "\u0E41\u0E19\u0E1A\u0E44\u0E1F\u0E25\u0E4C",
    Icon: PaperclipHorizontal,
    tool: null,
  },
  {
    id: "xray",
    testId: "mode-option-xray",
    i18nKey: "aiTools.popup.xray",
    defaultLabel: "\u0E27\u0E34\u0E40\u0E04\u0E23\u0E32\u0E30\u0E2B\u0E4C\u0E20\u0E32\u0E1E\u0E40\u0E2D\u0E01\u0E0B\u0E40\u0E23\u0E22\u0E4C",
    Icon: Sparkle,
    tool: AI_TOOL_IDS.XRAY,
  },
  {
    id: "searchable_pdf",
    testId: "mode-option-searchable-pdf",
    i18nKey: "aiTools.popup.searchablePdf",
    defaultLabel: "Make Searchable PDF",
    Icon: FileText,
    tool: AI_TOOL_IDS.SEARCHABLE_PDF,
  },
  {
    id: "ocr",
    testId: "mode-option-ocr",
    i18nKey: "aiTools.popup.ocr",
    defaultLabel: "OCR",
    Icon: Scan,
    tool: AI_TOOL_IDS.OCR,
  },
];

/**
 * Opens a hidden file input filtered by the tool's accepted types,
 * resolves with the selected File or null if cancelled.
 */
function openFilteredFilePicker(toolId) {
  return new Promise((resolve) => {
    const config = AI_TOOL_CONFIG[toolId];
    if (!config) return resolve(null);

    const input = document.createElement("input");
    input.type = "file";
    input.accept = config.accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      document.body.removeChild(input);
      resolve(file);
    });
    // Handle cancel — input won't fire change, but we clean up on next focus
    const cleanup = () => {
      window.removeEventListener("focus", cleanup);
      setTimeout(() => {
        if (document.body.contains(input)) {
          document.body.removeChild(input);
          resolve(null);
        }
      }, 300);
    };
    window.addEventListener("focus", cleanup);
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * AttachModePopup — click-anchored popover for the "+" attach button.
 *
 * Props:
 *  - showing       {boolean}  Whether the popup is visible.
 *  - setShowing     {function} Toggle visibility.
 *  - onSelectMode   {function} Called with (toolId, file) when a tool option is picked.
 *  - enabledTools   {string[]} Which tool IDs to show (default: all tools enabled).
 */
export default function AttachModePopup({
  showing,
  setShowing,
  onSelectMode = () => {},
  enabledTools = [AI_TOOL_IDS.OCR, AI_TOOL_IDS.XRAY, AI_TOOL_IDS.SEARCHABLE_PDF],
  hasPendingTool = false,
}) {
  const { t } = useTranslation();
  const popoverRef = useRef(null);

  const close = useCallback(() => setShowing(false), [setShowing]);

  // Escape key closes the popup
  useEffect(() => {
    if (!showing) return;
    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [showing, close]);

  if (!showing) return null;

  const visibleOptions = MODE_OPTIONS.filter(
    (opt) => opt.tool === null || enabledTools.includes(opt.tool)
  );

  function handleOptionClick(option) {
    // Block mixing: if a tool file is already pending, reject both normal
    // attach and additional tool picks with a single-file toast.
    if (hasPendingTool) {
      showToast(
        t("chat_window.aiTools.errors.singleFileOnly", "Only 1 file per tool action"),
        "error"
      );
      close();
      return;
    }

    if (option.tool === null) {
      // Normal attach — trigger the existing hidden file uploader
      close();
      document.getElementById("dnd-chat-file-uploader")?.click();
      return;
    }

    // Tool option — notify parent, then open a filtered file picker
    close();
    openFilteredFilePicker(option.tool).then((file) => {
      if (file) onSelectMode(option.tool, file);
    });
  }

  return (
    <>
      {/* Outside-click overlay */}
      <div
        className="fixed inset-0 z-40"
        onMouseDown={(e) => e.preventDefault()}
        onClick={close}
      />
      {/* Popup panel */}
      <div
        ref={popoverRef}
        data-testid="attach-mode-popup"
        className="absolute bottom-full mb-2 right-0 z-50 flex flex-col"
        style={{
          backgroundColor: "#FAFAFA",
          borderRadius: 12,
          padding: 2,
          boxShadow: "0 16px 32px rgba(0,0,0,0.05)",
          minWidth: 220,
        }}
      >
        {visibleOptions.map((option) => (
          <button
            key={option.id}
            data-testid={option.testId}
            type="button"
            onClick={() => handleOptionClick(option)}
            className="flex items-center gap-2 border-none bg-transparent cursor-pointer text-left text-sm text-zinc-800 transition-colors"
            style={{
              padding: 8,
              borderRadius: 10,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#E6F1EB";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <option.Icon size={18} weight="bold" className="shrink-0" />
            <span>{t(option.i18nKey, option.defaultLabel)}</span>
          </button>
        ))}
      </div>
    </>
  );
}
