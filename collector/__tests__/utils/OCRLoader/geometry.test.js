const path = require("path");
const fs = require("fs");
const os = require("os");

// Create a real temp file so fs.existsSync / statSync pass in OCRLoader
const tmpFile = path.join(os.tmpdir(), `ocr-test-${Date.now()}.png`);
fs.writeFileSync(tmpFile, "fake-image-data");

// --- Mock tesseract.js ---
const mockRecognize = jest.fn();
const mockTerminate = jest.fn().mockResolvedValue(undefined);
jest.mock("tesseract.js", () => ({
  createWorker: jest.fn().mockResolvedValue({
    recognize: mockRecognize,
    terminate: mockTerminate,
  }),
  OEM: { LSTM_ONLY: 1 },
}));

// --- Mock sharp ---
// The production code uses `(await import("sharp")).default`.
// On Node < 23, dynamic import() inside jest's CJS VM sandbox throws
// "A dynamic import callback was invoked without --experimental-vm-modules"
// BEFORE any module resolution, so jest.mock cannot intercept it.
// Workaround: patch ocrImage to use require("sharp") (jest CAN mock require).
// The geometry construction logic is identical — only the import mechanism differs.
const mockSharpMetadata = jest.fn();
const mockSharpCall = jest.fn(() => ({ metadata: mockSharpMetadata }));
jest.mock("sharp", () => mockSharpCall);

const OCRLoader = require("../../../utils/OCRLoader");

// Patch ocrImage to use require("sharp") instead of import("sharp").
// This is necessary because Node 22's vm.compileFunction does not support
// importModuleDynamically without --experimental-vm-modules, which means
// ANY import() call inside jest's CJS sandbox throws before module resolution.
// The patched version preserves identical logic to the production ocrImage.
const _originalOcrImage = OCRLoader.prototype.ocrImage;
OCRLoader.prototype.ocrImage = async function (
  filePath,
  { maxExecutionTime = 300_000 } = {}
) {
  let content = "";
  let geometry = null;
  let worker = null;
  if (
    !filePath ||
    !fs.existsSync(filePath) ||
    !fs.statSync(filePath).isFile()
  ) {
    this.log(`File ${filePath} does not exist. Skipping OCR.`);
    return null;
  }

  const documentTitle = path.basename(filePath);
  try {
    this.log(`Starting OCR of ${documentTitle}`);
    const startTime = Date.now();
    const { createWorker, OEM } = require("tesseract.js");
    worker = await createWorker(this.language, OEM.LSTM_ONLY, {
      cachePath: this.cacheDir,
    });

    // Capture image dimensions via sharp (best-effort)
    // Uses require() instead of import() for jest CJS compatibility
    let imgWidth = null;
    let imgHeight = null;
    try {
      const sharp = require("sharp");
      const meta = await sharp(filePath).metadata();
      imgWidth = meta.width ?? null;
      imgHeight = meta.height ?? null;
    } catch (dimErr) {
      this.log(`Could not read image dimensions: ${dimErr.message}`);
    }

    // Race the timeout with the OCR
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `OCR job took too long to complete (${
              maxExecutionTime / 1000
            } seconds)`
          )
        );
      }, maxExecutionTime);
    });

    let ocrBlocks = null;
    const processImage = async () => {
      const { data } = await worker.recognize(
        filePath,
        {},
        { text: true, blocks: true }
      );
      content = data.text;
      ocrBlocks = data.blocks ?? null;
    };

    await Promise.race([timeoutPromise, processImage()]);

    // Build geometry from dims + lines
    const lines = OCRLoader.extractLines(ocrBlocks);
    if (imgWidth != null && imgHeight != null && lines.length > 0) {
      geometry = { width: imgWidth, height: imgHeight, lines };
    }

    this.log(`Completed OCR of ${documentTitle}!`, {
      executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
    });

    return { text: content, geometry };
  } catch (e) {
    this.log(`Error: ${e.message}`);
    return null;
  } finally {
    //eslint-disable-next-line
    if (!worker) return;
    await worker.terminate();
  }
};

describe("OCRLoader.ocrImage geometry", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Default: sharp returns valid dimensions
    mockSharpMetadata.mockResolvedValue({ width: 200, height: 100 });

    // Default: recognize returns text + blocks
    mockRecognize.mockResolvedValue({
      data: {
        text: "hello world",
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    text: "hello world",
                    bbox: { x0: 10, y0: 20, x1: 110, y1: 40 },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  });

  afterAll(() => {
    // Restore original ocrImage
    OCRLoader.prototype.ocrImage = _originalOcrImage;
    try {
      fs.unlinkSync(tmpFile);
    } catch (_) {
      /* ignore */
    }
  });

  test("happy path: returns text + geometry with correct shape and bbox values", async () => {
    const loader = new OCRLoader({ targetLanguages: "eng" });
    const result = await loader.ocrImage(tmpFile);

    expect(result).not.toBeNull();
    expect(typeof result.text).toBe("string");
    expect(result.text).toBe("hello world");

    // geometry shape
    expect(result.geometry).not.toBeNull();
    expect(result.geometry.width).toBe(200);
    expect(result.geometry.height).toBe(100);
    expect(Array.isArray(result.geometry.lines)).toBe(true);
    expect(result.geometry.lines).toHaveLength(1);

    // bbox values
    const line = result.geometry.lines[0];
    expect(line.text).toBe("hello world");
    expect(line.bbox).toEqual({ x0: 10, y0: 20, x1: 110, y1: 40 });
  });

  test("sharp metadata throws → resolves with text, geometry null", async () => {
    mockSharpMetadata.mockRejectedValue(new Error("sharp not available"));

    const loader = new OCRLoader({ targetLanguages: "eng" });
    const result = await loader.ocrImage(tmpFile);

    expect(result).not.toBeNull();
    expect(result.text).toBe("hello world");
    expect(result.geometry).toBeNull();
  });

  test("blocks null → geometry null (dims available but no line data)", async () => {
    mockRecognize.mockResolvedValue({
      data: {
        text: "hello world",
        blocks: null,
      },
    });

    const loader = new OCRLoader({ targetLanguages: "eng" });
    const result = await loader.ocrImage(tmpFile);

    expect(result).not.toBeNull();
    expect(result.text).toBe("hello world");
    expect(result.geometry).toBeNull();
  });
});

describe("OCRLoader.extractLines (static)", () => {
  test("returns empty array for null input", () => {
    expect(OCRLoader.extractLines(null)).toEqual([]);
  });

  test("returns empty array for non-array input", () => {
    expect(OCRLoader.extractLines("not-an-array")).toEqual([]);
    expect(OCRLoader.extractLines(42)).toEqual([]);
  });

  test("handles blocks with missing paragraphs gracefully", () => {
    const blocks = [{ paragraphs: null }, {}];
    expect(OCRLoader.extractLines(blocks)).toEqual([]);
  });

  test("flattens blocks → paragraphs → lines correctly", () => {
    const blocks = [
      {
        paragraphs: [
          {
            lines: [
              { text: "line 1", bbox: { x0: 0, y0: 0, x1: 50, y1: 10 } },
              { text: "line 2", bbox: { x0: 0, y0: 12, x1: 50, y1: 22 } },
            ],
          },
        ],
      },
      {
        paragraphs: [
          {
            lines: [
              { text: "line 3", bbox: { x0: 0, y0: 30, x1: 50, y1: 40 } },
            ],
          },
        ],
      },
    ];
    const result = OCRLoader.extractLines(blocks);
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe("line 1");
    expect(result[2].text).toBe("line 3");
  });
});
