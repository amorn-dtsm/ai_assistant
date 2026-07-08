const fs = require("fs");
const path = require("path");
const { MimeDetector } = require("./mime");

/**
 * The folder where documents are stored to be stored when
 * processed by the collector.
 */
const documentsFolder =
  process.env.NODE_ENV === "development" || !process.env.STORAGE_DIR
    ? path.resolve(__dirname, `../../../server/storage/documents`)
    : path.resolve(process.env.STORAGE_DIR, `documents`);

/**
 * The folder where direct uploads are stored to be stored when
 * processed by the collector. These are files that were DnD'd into UI
 * and are not to be embedded or selectable from the file picker.
 */
const directUploadsFolder =
  process.env.NODE_ENV === "development" || !process.env.STORAGE_DIR
    ? path.resolve(__dirname, `../../../server/storage/direct-uploads`)
    : path.resolve(process.env.STORAGE_DIR, `direct-uploads`);

/**
 * Checks if a file is text by checking the mime type and then falling back to buffer inspection.
 * This way we can capture all the cases where the mime type is not known but still parseable as text
 * without having to constantly add new mime type overrides.
 * @param {string} filepath - The path to the file.
 * @returns {boolean} - Returns true if the file is text, false otherwise.
 */
function isTextType(filepath) {
  if (!fs.existsSync(filepath)) return false;
  const result = isKnownTextMime(filepath);
  if (result.valid) return true; // Known text type - return true.
  if (result.reason !== "generic") return false; // If any other reason than generic - return false.
  return parseableAsText(filepath); // Fallback to parsing as text via buffer inspection.
}

/**
 * Checks if a file is known to be text by checking the mime type.
 * @param {string} filepath - The path to the file.
 * @returns {boolean} - Returns true if the file is known to be text, false otherwise.
 */
function isKnownTextMime(filepath) {
  try {
    const mimeLib = new MimeDetector();
    const mime = mimeLib.getType(filepath);
    if (mimeLib.badMimes.includes(mime))
      return { valid: false, reason: "bad_mime" };

    const type = mime.split("/")[0];
    if (mimeLib.nonTextTypes.includes(type))
      return { valid: false, reason: "non_text_mime" };
    return { valid: true, reason: "valid_mime" };
  } catch {
    return { valid: false, reason: "generic" };
  }
}

/**
 * Checks if a file is parseable as text by forcing it to be read as text in utf8 encoding.
 * If the file looks too much like a binary file, it will return false.
 * @param {string} filepath - The path to the file.
 * @returns {boolean} - Returns true if the file is parseable as text, false otherwise.
 */
function parseableAsText(filepath) {
  try {
    const fd = fs.openSync(filepath, "r");
    const buffer = Buffer.alloc(1024); // Read first 1KB of the file synchronously
    const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
    fs.closeSync(fd);

    const content = buffer.subarray(0, bytesRead).toString("utf8");
    const nullCount = (content.match(/\0/g) || []).length;
    //eslint-disable-next-line
    const controlCount = (content.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || [])
      .length;

    const threshold = bytesRead * 0.1;
    return nullCount + controlCount < threshold;
  } catch {
    return false;
  }
}

function trashFile(filepath) {
  if (!fs.existsSync(filepath)) return;

  try {
    const isDir = fs.lstatSync(filepath).isDirectory();
    if (isDir) return;
  } catch {
    return;
  }

  fs.rmSync(filepath);
  return;
}

function createdDate(filepath) {
  try {
    const { birthtimeMs, birthtime } = fs.statSync(filepath);
    if (birthtimeMs === 0) throw new Error("Invalid stat for file!");
    return birthtime.toLocaleString();
  } catch {
    return "unknown";
  }
}

/**
 * Writes a document to the server documents folder.
 * @param {Object} params - The parameters for the function.
 * @param {Object} params.data - The data to write to the file. Must look like a document object.
 * @param {string} params.filename - The name of the file to write to.
 * @param {string|null} params.destinationOverride - A forced destination to write to - will be honored if provided.
 * @param {Object} params.options - The options for the function.
 * @param {boolean} params.options.parseOnly - If true, the file will be written to the direct uploads folder instead of the documents folder. Will be ignored if destinationOverride is provided.
 * @returns {Object} - The data with the location added.
 */
function writeToServerDocuments({
  data = {},
  filename,
  destinationOverride = null,
  options = {},
}) {
  if (!filename) throw new Error("Filename is required!");

  let destination = null;
  if (destinationOverride) destination = path.resolve(destinationOverride);
  else if (options.parseOnly) destination = path.resolve(directUploadsFolder);
  else destination = path.resolve(documentsFolder, "custom-documents");

  if (!fs.existsSync(destination))
    fs.mkdirSync(destination, { recursive: true });
  const safeFilename = sanitizeFileName(filename);
  const destinationFilePath = normalizePath(
    path.resolve(destination, safeFilename) + ".json"
  );

  fs.writeFileSync(destinationFilePath, JSON.stringify(data, null, 4), {
    encoding: "utf-8",
  });

  return {
    ...data,
    // relative location string that can be passed into the /update-embeddings api
    // that will work since we know the location exists and since we only allow
    // 1-level deep folders this will always work. This still works for integrations like GitHub and YouTube.
    location: destinationFilePath.split("/").slice(-2).join("/"),
    isDirectUpload: options.parseOnly || false,
  };
}

// When required we can wipe the entire collector hotdir and tmp storage in case
// there were some large file failures that we unable to be removed a reboot will
// force remove them.
async function wipeCollectorStorage() {
  const cleanHotDir = new Promise((resolve) => {
    const directory = path.resolve(__dirname, "../../hotdir");

    if (!fs.existsSync(directory)) resolve();
    fs.readdir(directory, (err, files) => {
      if (err) resolve();

      for (const file of files) {
        if (file === "__HOTDIR__.md") continue;
        try {
          fs.rmSync(path.join(directory, file));
        } catch {}
      }
      resolve();
    });
  });

  const cleanTmpDir = new Promise((resolve) => {
    const directory = path.resolve(__dirname, "../../storage/tmp");
    fs.readdir(directory, (err, files) => {
      if (err) resolve();

      for (const file of files) {
        if (file === ".placeholder") continue;
        try {
          fs.rmSync(path.join(directory, file));
        } catch {}
      }
      resolve();
    });
  });

  await Promise.all([cleanHotDir, cleanTmpDir]);
  console.log(`Collector hot directory and tmp storage wiped!`);
  return;
}

/**
 * Checks if a given path is strictly within another path. Used to prevent
 * path-traversal attacks (CWE-22). Both arguments are resolved to absolute
 * paths internally so callers do not need to pre-resolve.
 *
 * NOTE: This function does NOT follow or detect symlinks. A symlink inside
 * `outer` that points outside it will not be caught here — validate symlinks
 * separately at read/write time if your threat model requires it (wontfix).
 *
 * @param {string} outer - The containing directory path.
 * @param {string} inner - The path to test.
 * @returns {boolean} True if `inner` is strictly inside `outer`, false otherwise.
 */
function isWithin(outer, inner) {
  const resolvedOuter = path.resolve(outer);
  const resolvedInner = path.resolve(inner);
  const rel = path.relative(resolvedOuter, resolvedInner);

  if (rel === "") return false;
  return (
    !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel)
  );
}

function normalizePath(filepath = "") {
  const result = path
    .normalize(filepath.trim())
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .trim();
  if (["..", ".", "/"].includes(result)) throw new Error("Invalid path.");
  return result;
}

/**
 * Strips characters that are illegal in Windows filenames, including Unicode
 * quotation marks (U+201C, U+201D, etc.) that can get corrupted into ASCII
 * double-quotes during charset conversion in the upload pipeline.
 * @param {string} fileName - The filename to sanitize.
 * @returns {string} - The sanitized filename.
 */
function sanitizeFileName(fileName) {
  if (!fileName) return fileName;
  return fileName.replace(
    /[<>:"/\\|?*\u201C\u201D\u201E\u201F\u2018\u2019\u201A\u201B]/g,
    ""
  );
}

/**
 * Regex for UUID v4-shaped strings (8-4-4-4-12 hex).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Copy a source document's original file into `<documentsFolder>/originals/<sourceId><extension>`.
 * Controlled by env flags PERSIST_SOURCE_DOCUMENTS (default "true") and MAX_SOURCE_DOCUMENT_SIZE_MB (default 100).
 * @param {Object} params
 * @param {string} params.fullFilePath - Absolute path to the source file.
 * @param {string} params.sourceId - UUID-shaped identifier.
 * @param {string} params.extension - File extension including leading dot (e.g. ".pdf").
 * @returns {{ persisted: boolean, reason?: string }}
 */
function persistOriginalFile({ fullFilePath, sourceId, extension }) {
  try {
    // Check env flag — default ON when unset
    if (process.env.PERSIST_SOURCE_DOCUMENTS === "false") {
      return { persisted: false, reason: "persistence disabled by flag" };
    }

    // Validate sourceId
    if (!sourceId || !UUID_RE.test(sourceId)) {
      return { persisted: false, reason: "invalid sourceId" };
    }

    // Validate extension
    if (!extension || typeof extension !== "string" || !extension.startsWith(".")) {
      return { persisted: false, reason: "invalid extension" };
    }

    // Check source file exists
    if (!fs.existsSync(fullFilePath)) {
      return { persisted: false, reason: "source file missing" };
    }

    // Check file size cap
    const maxBytes =
      Number(process.env.MAX_SOURCE_DOCUMENT_SIZE_MB || 100) * 1024 * 1024;
    const stats = fs.statSync(fullFilePath);
    if (stats.size > maxBytes) {
      return { persisted: false, reason: "file exceeds size cap" };
    }

    // Lazy resolution — never depends on module-scope constant that may
    // have fallen back when STORAGE_DIR was absent at load time.
    const docsFolder = process.env.STORAGE_DIR
      ? path.resolve(process.env.STORAGE_DIR, "documents")
      : path.resolve(__dirname, "../../../server/storage/documents");
    const destDir = path.resolve(docsFolder, "originals");
    fs.mkdirSync(destDir, { recursive: true });

    const destPath = path.resolve(destDir, `${sourceId}${extension}`);
    fs.copyFileSync(fullFilePath, destPath);
    return { persisted: true };
  } catch (err) {
    console.error(`persistOriginalFile error: ${err.message}`);
    return { persisted: false, reason: err.message };
  }
}

/**
 * Write an OCR sidecar JSON file to `<documentsFolder>/ocr/<sourceId>.json`.
 * @param {Object} params
 * @param {string} params.sourceId - UUID-shaped identifier.
 * @param {*} params.payload - Serializable payload.
 * @returns {{ written: boolean, reason?: string }}
 */
function writeOcrSidecar({ sourceId, payload }) {
  try {
    if (!sourceId || !UUID_RE.test(sourceId)) {
      return { written: false, reason: "invalid sourceId" };
    }

    const docsFolder = process.env.STORAGE_DIR
      ? path.resolve(process.env.STORAGE_DIR, "documents")
      : path.resolve(__dirname, "../../../server/storage/documents");
    const destDir = path.resolve(docsFolder, "ocr");
    fs.mkdirSync(destDir, { recursive: true });

    const destPath = path.resolve(destDir, `${sourceId}.json`);
    fs.writeFileSync(destPath, JSON.stringify(payload), { encoding: "utf-8" });
    return { written: true };
  } catch (err) {
    console.error(`writeOcrSidecar error: ${err.message}`);
    return { written: false, reason: err.message };
  }
}

module.exports = {
  trashFile,
  isTextType,
  createdDate,
  writeToServerDocuments,
  wipeCollectorStorage,
  normalizePath,
  isWithin,
  sanitizeFileName,
  documentsFolder,
  directUploadsFolder,
  persistOriginalFile,
  writeOcrSidecar,
};
