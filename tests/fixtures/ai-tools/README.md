# AI Tools QA Fixtures

This directory contains test fixtures for AI Tools (OCR, Searchable PDF, X-ray Analysis) QA scenarios.

## Fixtures

### sample-ocr.pdf
- **Purpose**: OCR tool upload test
- **Size**: ~2KB
- **Content**: Valid PDF with extractable text
- **Marker**: `XIID-FIXTURE-MARKER-7742` (mandatory, used to verify extraction)
- **Note**: ASCII text only (pdf-lib StandardFonts do not support Thai glyphs)

### sample-scanned.pdf
- **Purpose**: Searchable PDF tool upload test
- **Size**: ~1KB
- **Content**: Valid PDF (content irrelevant for this tool)

### sample-xray.jpg
- **Purpose**: X-ray analysis tool upload test
- **Size**: ~200 bytes
- **Content**: Minimal valid JPEG (1x1 pixel)
- **Magic bytes**: `FFD8` (JPEG SOI marker)

### bad-type.exe
- **Purpose**: Invalid file type rejection test
- **Size**: 64 bytes
- **Content**: PE executable header (MZ magic bytes)
- **Expected behavior**: Rejected by all tools (invalid MIME type)

### oversized-gen.js
- **Purpose**: File size limit testing
- **Generates**: `oversized.bin` (120MB) in OS temp directory
- **Run**: `node tests/fixtures/ai-tools/oversized-gen.js`
- **Note**: Output file is NOT committed; see `.gitignore`

### generate.js
- **Purpose**: Fixture generation script (for reference/regeneration)
- **Run**: `cd server && node ../tests/fixtures/ai-tools/generate.js`
- **Note**: Fixtures are already committed; this script is for documentation

## Marker String

The mandatory marker string for OCR verification:
```
XIID-FIXTURE-MARKER-7742
```

This string must be extractable from `sample-ocr.pdf` via pdf-parse or similar tools.

## QA Scenarios

### Scenario 1: Format Validation
```bash
# Check PDF magic bytes
head -c 4 tests/fixtures/ai-tools/sample-ocr.pdf  # Should output: %PDF

# Check JPEG magic bytes
node -e "const fs=require('fs');const b=fs.readFileSync('tests/fixtures/ai-tools/sample-xray.jpg');process.exit(b[0]===0xFF&&b[1]===0xD8?0:1)"

# Verify marker extraction
cd server && node -e "const pdf=require('pdf-parse');const fs=require('fs');pdf(fs.readFileSync('../tests/fixtures/ai-tools/sample-ocr.pdf')).then(d=>process.exit(d.text.includes('XIID-FIXTURE-MARKER-7742')?0:1))"
```

### Scenario 2: Oversized File Generation
```bash
node tests/fixtures/ai-tools/oversized-gen.js
# Verify size > 100MB
ls -lh /tmp/oversized.bin  # or %TEMP%\oversized.bin on Windows
# Verify not tracked by git
git status --porcelain tests/fixtures/ai-tools
```
