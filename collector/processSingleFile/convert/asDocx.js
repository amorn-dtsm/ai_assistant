const fs = require("fs");
const { v4 } = require("uuid");
const mammoth = require("mammoth");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
  persistOriginalFile,
} = require("../../utils/files");
const { tokenizeString } = require("../../utils/tokenizer");
const { default: slugify } = require("slugify");

/**
 * Link-prefix patterns for sync-sourced documents that should NOT get a viewer.
 */
const LINK_PREFIXES = [
  "link://",
  "youtube://",
  "confluence://",
  "github://",
  "gitlab://",
];

async function asDocX({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  console.log(`-- Working ${filename} --`);

  let pageContent = "";
  let pageContentHtml = null;

  try {
    const buffer = fs.readFileSync(fullFilePath);

    // Extract raw text (same call LangChain DocxLoader used internally)
    const raw = await mammoth.extractRawText({ buffer });
    pageContent = raw.value;

    // Attempt HTML conversion (non-fatal)
    try {
      const html = await mammoth.convertToHtml({ buffer });
      pageContentHtml = html.value;
    } catch (htmlErr) {
      console.warn(
        `[asDocx] HTML conversion failed for ${filename}: ${htmlErr.message}`
      );
      // pageContentHtml stays null — non-fatal
    }
  } catch (err) {
    console.error(`[asDocx] Failed to parse ${filename}: ${err.message}`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `Failed to parse ${filename}: ${err.message}`,
      documents: [],
    };
  }

  if (!pageContent.length) {
    console.error(`Resulting text content was empty for ${filename}.`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
    };
  }

  const content = pageContent;
  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor: metadata.docAuthor || "no author found",
    description: metadata.description || "No description found.",
    docSource: metadata.docSource || "docx file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
  };

  // Source-viewer: HTML representation
  if (pageContentHtml) {
    data.pageContentHtml = pageContentHtml;
  }

  // Source-viewer: persist original + metadata fields
  data.sourceId = data.id;
  data.contentType = "docx";

  const linkPrefixedChunkSource =
    data.chunkSource &&
    LINK_PREFIXES.some((prefix) => data.chunkSource.startsWith(prefix));

  const { persisted } = persistOriginalFile({
    fullFilePath,
    sourceId: data.id,
    extension: ".docx",
  });

  data.hasSourceViewer =
    persisted && !!data.pageContentHtml && !linkPrefixedChunkSource;

  const document = writeToServerDocuments({
    data,
    filename: `${slugify(filename)}-${data.id}`,
    options: { parseOnly: options.parseOnly },
  });
  if (!options.absolutePath) trashFile(fullFilePath);
  console.log(`[SUCCESS]: ${filename} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = asDocX;
