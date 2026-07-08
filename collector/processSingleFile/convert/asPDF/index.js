const { v4 } = require("uuid");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
  persistOriginalFile,
  writeOcrSidecar,
} = require("../../../utils/files");
const { tokenizeString } = require("../../../utils/tokenizer");
const { default: slugify } = require("slugify");
const PDFLoader = require("./PDFLoader");
const OCRLoader = require("../../../utils/OCRLoader");

/** Clamp a number to [0, 1]. */
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** Round to 4 decimal places. */
function round4(v) {
  return Math.round(v * 10000) / 10000;
}

async function asPdf({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  const pdfLoader = new PDFLoader(fullFilePath, {
    splitPages: true,
  });

  console.log(`-- Working ${filename} --`);
  const pageContent = [];
  let docs = await pdfLoader.load();
  let usedOCR = false;

  if (docs.length === 0) {
    console.log(
      `[asPDF] No text content found for ${filename}. Will attempt OCR parse.`
    );
    docs = await new OCRLoader({
      targetLanguages: options?.ocr?.langList,
    }).ocrPDF(fullFilePath);
    usedOCR = true;
  }

  for (const doc of docs) {
    console.log(
      `-- Parsing content from pg ${
        doc.metadata?.loc?.pageNumber || "unknown"
      } --`
    );
    if (!doc.pageContent || !doc.pageContent.length) continue;
    pageContent.push(doc.pageContent);
  }

  if (!pageContent.length) {
    console.error(`[asPDF] Resulting text content was empty for ${filename}.`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
    };
  }

  const content = pageContent.join("");
  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor:
      metadata.docAuthor ||
      docs[0]?.metadata?.pdf?.info?.Creator ||
      "no author found",
    description:
      metadata.description ||
      docs[0]?.metadata?.pdf?.info?.Title ||
      "No description found.",
    docSource: metadata.docSource || "pdf file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
  };

  // Persist original file and add retention metadata
  const { persisted } = persistOriginalFile({
    fullFilePath,
    sourceId: data.id,
    extension: ".pdf",
  });

  // Check if chunkSource is a sync-source (link-prefixed)
  const linkPrefixes = ["link://", "youtube://", "confluence://", "github://", "gitlab://"];
  const isLinkPrefixed = typeof metadata.chunkSource === "string" && 
    linkPrefixes.some(prefix => metadata.chunkSource.startsWith(prefix));

  data.sourceId = data.id;
  data.contentType = usedOCR ? "scanned-pdf" : "pdf";

  // Build + write OCR geometry sidecar for scanned PDFs only
  let sidecarWritten = false;
  if (usedOCR && persisted && !isLinkPrefixed) {
    try {
      const pages = [];
      for (const doc of docs) {
        const ocr = doc.metadata?.ocr;
        if (!ocr) continue;
        const pgNum = doc.metadata?.loc?.pageNumber;
        if (!pgNum) continue;
        const { width, height, lines } = ocr;
        if (!width || !height || !Array.isArray(lines) || lines.length === 0)
          continue;
        pages.push({
          pageNumber: pgNum,
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
        });
      }
      if (pages.length > 0) {
        const payload = {
          version: 1,
          sourceId: data.id,
          contentType: "scanned-pdf",
          pages,
        };
        const { written } = writeOcrSidecar({ sourceId: data.id, payload });
        sidecarWritten = written === true;
      }
    } catch (err) {
      console.error(`[asPDF] Sidecar build error: ${err.message}`);
    }
  }

  // Born-digital: hasSourceViewer = persisted (no sidecar needed)
  // Scanned: hasSourceViewer = persisted AND sidecar written
  if (usedOCR) {
    data.hasSourceViewer = persisted === true && sidecarWritten && !isLinkPrefixed;
  } else {
    data.hasSourceViewer = persisted === true && !isLinkPrefixed;
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

module.exports = asPdf;
