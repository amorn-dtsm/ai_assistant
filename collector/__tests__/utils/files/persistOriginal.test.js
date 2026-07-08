const os = require("os");
const fs = require("fs");
const path = require("path");

// Mock the mime dependency so tests don't require full node_modules install.
jest.mock("mime", () => ({}), { virtual: true });

// Isolated temp dir for all tests — set BEFORE requiring the module
// so documentsFolder resolves to our temp dir via STORAGE_DIR.
const tmpRoot = path.join(os.tmpdir(), `allm-test-${Date.now()}`);
fs.mkdirSync(tmpRoot, { recursive: true });

// Save original env so we can restore per-test
const origEnv = { ...process.env };

// Point STORAGE_DIR at our temp root. The module resolves
// documentsFolder = path.resolve(process.env.STORAGE_DIR, "documents")
// when NODE_ENV !== "development".
process.env.NODE_ENV = "production";
process.env.STORAGE_DIR = tmpRoot;

const {
  persistOriginalFile,
  writeOcrSidecar,
} = require("../../../utils/files/index");

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

// Helper: create a small temp source file and return its path
function makeTempSource(content = "hello world") {
  const p = path.join(tmpRoot, `src-${Date.now()}.txt`);
  fs.writeFileSync(p, content);
  return p;
}

afterEach(() => {
  // Restore env vars touched by individual tests
  process.env.PERSIST_SOURCE_DOCUMENTS = origEnv.PERSIST_SOURCE_DOCUMENTS;
  process.env.MAX_SOURCE_DOCUMENT_SIZE_MB = origEnv.MAX_SOURCE_DOCUMENT_SIZE_MB;
  delete process.env.PERSIST_SOURCE_DOCUMENTS;
  delete process.env.MAX_SOURCE_DOCUMENT_SIZE_MB;
});

afterAll(() => {
  // Clean up entire temp tree
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("persistOriginalFile", () => {
  it("persists a file in the happy path", () => {
    const src = makeTempSource("PDF-like content");
    const result = persistOriginalFile({
      fullFilePath: src,
      sourceId: VALID_UUID,
      extension: ".pdf",
    });

    expect(result).toEqual({ persisted: true });

    const dest = path.join(tmpRoot, "documents", "originals", `${VALID_UUID}.pdf`);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.statSync(dest).size).toBe(fs.statSync(src).size);
  });

  it("skips when PERSIST_SOURCE_DOCUMENTS=false", () => {
    process.env.PERSIST_SOURCE_DOCUMENTS = "false";
    const src = makeTempSource();
    const result = persistOriginalFile({
      fullFilePath: src,
      sourceId: VALID_UUID,
      extension: ".pdf",
    });

    expect(result.persisted).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("skips with cap/size reason when MAX_SOURCE_DOCUMENT_SIZE_MB=0", () => {
    process.env.MAX_SOURCE_DOCUMENT_SIZE_MB = "0";
    const src = makeTempSource("some data");
    const result = persistOriginalFile({
      fullFilePath: src,
      sourceId: VALID_UUID,
      extension: ".pdf",
    });

    expect(result.persisted).toBe(false);
    expect(result.reason).toMatch(/cap|size/i);
  });

  it("returns persisted:false without throwing when source file is missing", () => {
    const result = persistOriginalFile({
      fullFilePath: path.join(tmpRoot, "nonexistent-file.pdf"),
      sourceId: VALID_UUID,
      extension: ".pdf",
    });

    expect(result.persisted).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it("rejects invalid sourceId", () => {
    const src = makeTempSource();
    const result = persistOriginalFile({
      fullFilePath: src,
      sourceId: "not-a-uuid",
      extension: ".pdf",
    });

    expect(result.persisted).toBe(false);
    expect(result.reason).toMatch(/sourceId/i);
  });

  it("rejects invalid extension", () => {
    const src = makeTempSource();
    const result = persistOriginalFile({
      fullFilePath: src,
      sourceId: VALID_UUID,
      extension: "pdf", // missing leading dot
    });

    expect(result.persisted).toBe(false);
    expect(result.reason).toMatch(/extension/i);
  });
});

describe("writeOcrSidecar", () => {
  it("writes valid JSON sidecar", () => {
    const payload = { text: "OCR output", confidence: 0.95, pages: [1, 2] };
    const result = writeOcrSidecar({ sourceId: VALID_UUID, payload });

    expect(result).toEqual({ written: true });

    const dest = path.join(tmpRoot, "documents", "ocr", `${VALID_UUID}.json`);
    expect(fs.existsSync(dest)).toBe(true);

    const content = JSON.parse(fs.readFileSync(dest, "utf-8"));
    expect(content).toEqual(payload);
  });

  it("rejects invalid sourceId", () => {
    const result = writeOcrSidecar({ sourceId: "bad", payload: {} });
    expect(result.written).toBe(false);
    expect(result.reason).toMatch(/sourceId/i);
  });
});
