const { v4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const { tokenizeString } = require("../../utils/tokenizer");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
  persistOriginalFile,
} = require("../../utils/files");
const { default: slugify } = require("slugify");

async function asTxt({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  let content = "";
  try {
    content = fs.readFileSync(fullFilePath, "utf8");
  } catch (err) {
    console.error("Could not read file!", err);
  }

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
  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor: metadata.docAuthor || "Unknown",
    description: metadata.description || "Unknown",
    docSource: metadata.docSource || "a text file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
  };

  // Determine real extension and map to contentType
  const realExtension = path.extname(filename).toLowerCase();
  let contentType = "txt"; // default
  if (realExtension === ".md") {
    contentType = "md";
  } else if (realExtension === ".txt") {
    contentType = "txt";
  } else {
    // .html, .csv, .json, .org, .adoc, .rst, etc. → "txt"
    contentType = "txt";
  }

  // Persist original file
  const { persisted } = persistOriginalFile({
    fullFilePath,
    sourceId: data.id,
    extension: realExtension,
  });

  // Check if chunkSource is a sync-source (link-prefixed)
  const linkPrefixes = ["link://", "youtube://", "confluence://", "github://", "gitlab://"];
  const isLinkPrefixed = typeof metadata.chunkSource === "string" && 
    linkPrefixes.some(prefix => metadata.chunkSource.startsWith(prefix));

  data.sourceId = data.id;
  data.contentType = contentType;
  data.hasSourceViewer = persisted && ["md", "txt"].includes(contentType) && !isLinkPrefixed;

  const document = writeToServerDocuments({
    data,
    filename: `${slugify(filename)}-${data.id}`,
    options: { parseOnly: options.parseOnly },
  });
  if (!options.absolutePath) trashFile(fullFilePath);
  console.log(`[SUCCESS]: ${filename} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = asTxt;
