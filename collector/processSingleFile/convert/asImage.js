const { v4 } = require("uuid");
const path = require("path");
const { tokenizeString } = require("../../utils/tokenizer");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
  persistOriginalFile,
  writeOcrSidecar,
} = require("../../utils/files");
const OCRLoader = require("../../utils/OCRLoader");
const { default: slugify } = require("slugify");

/**
 * Link prefixes indicating sync-sourced docs that should not get a viewer.
 */
const LINK_PREFIXES = [
  "link://",
  "youtube://",
  "confluence://",
  "github://",
  "gitlab://",
];

/** Clamp a number to [0, 1]. */
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** Round to 4 decimal places. */
function round4(v) {
  return Math.round(v * 10000) / 10000;
}

async function asImage({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  const ocrResult = await new OCRLoader({
    targetLanguages: options?.ocr?.langList,
  }).ocrImage(fullFilePath);
  let content = ocrResult?.text ?? null;

  if (!content?.length) {
    console.error(`Resulting text content was empty for ${filename}.`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
    };
  }

  console.log(`-- Working ${filename} --`);
  const extension = path.extname(filename).toLowerCase();
  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor: metadata.docAuthor || "Unknown",
    description: metadata.description || "Unknown",
    docSource: metadata.docSource || "image file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
    sourceId: null,
    contentType: "image",
    hasSourceViewer: false,
  };
  data.sourceId = data.id;

  // Wire retention + OCR sidecar (skip for link-sourced docs)
  const isLinkSource = LINK_PREFIXES.some((p) =>
    (metadata.chunkSource || "").startsWith(p)
  );

  if (!isLinkSource) {
    const { persisted } = persistOriginalFile({
      fullFilePath,
      sourceId: data.id,
      extension,
    });

    let sidecarWritten = false;
    const geometry = ocrResult?.geometry;
    if (geometry) {
      try {
        const { width, height, lines } = geometry;
        if (width > 0 && height > 0 && Array.isArray(lines) && lines.length > 0) {
          const payload = {
            version: 1,
            sourceId: data.id,
            contentType: "image",
            pages: [
              {
                pageNumber: 1,
                width,
                height,
                lines: lines.map((l) => ({
                  text: l.text,
                  bbox: [
                    round4(clamp01(l.bbox.x0 / width)),
                    round4(clamp01(l.bbox.y0 / height)),
                    round4(clamp01(l.bbox.x1 / width)),
                    round4(clamp01(l.bbox.y1 / height)),
                  ],
                })),
              },
            ],
          };
          const { written } = writeOcrSidecar({
            sourceId: data.id,
            payload,
          });
          sidecarWritten = written === true;
        }
      } catch (err) {
        console.error(`[asImage] Sidecar build error: ${err.message}`);
      }
    }

    data.hasSourceViewer = persisted && sidecarWritten;
  }

  const document = writeToServerDocuments({
    data,
    filename: `${slugify(filename)}-${data.id}`,
    options: { parseOnly: options.parseOnly },
  });
  if (!options.absolutePath) trashFile(fullFilePath);
  console.log(`[SUCCESS]: ${filename} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = asImage;
