# Source Viewer Test Fixtures (v2)

Test fixtures for source-viewer. Every fixture contains **both** Latin and Thai anchors (except `corrupt.pdf` and `oversized-marker.txt`). All PDFs are Chromium-generated (standards-compliant).

## Fixture Table

| File | Latin Anchor | Thai Anchor | Font Notes |
|------|:---:|:---:|------------|
| `digital-latin.pdf` | Y (text layer) | Y (text layer, base*) | TH SarabunNew via Chromium |
| `digital-thai.pdf` | Y (text layer) | Y (text layer, base*) | TH SarabunNew via Chromium |
| `scanned.pdf` | N (image-only) | N (image-only) | Text rendered to PNG, zero text layer |
| `simple.docx` | Y | Y | TH SarabunNew in w:rFonts |
| `thai-sarabun.docx` | Y | Y | TH SarabunNew in w:rFonts + docDefaults |
| `sample.md` | Y | Y | N/A (plain text) |
| `sample-bom.txt` | Y | Y | N/A (plain text, UTF-8 BOM + CRLF) |
| `latin-ocr.jpg` | Y (rendered) | Y (rendered) | TH SarabunNew/Tahoma in SVG |
| `thai-ocr.png` | N | Y (rendered) | TH SarabunNew/Tahoma in SVG |
| `corrupt.pdf` | N | N | Truncated/invalid |
| `oversized-marker.txt` | N | N | Marker file |

\* **base**: Chromium PDF CMap maps Thai tone marks (U+0E48-0E4B) to PUA (U+F70A-F70D). pdf.js v1.10.100 extracts the base consonants and vowels correctly; tone marks appear as PUA codepoints. Verification strips both ranges for comparison.

## Anchors

```
Latin: The quick brown fox anchors here.
Thai:  การทดสอบระบบค้นหาข้อความภาษาไทย
```

## Generation

```bash
node generate.mjs          # always regenerates all fixtures (idempotent)
node verify.mjs             # 48 checks, exit 0 = all pass
```

### Dependencies (from collector/node_modules)

| Package | Used For |
|---------|----------|
| `puppeteer` | PDF generation via Chromium |
| `sharp` | SVG-to-PNG/JPEG for images and scanned PDF |
| `adm-zip` | DOCX creation (ZIP format) |
| `mammoth` | DOCX text extraction (verify only) |

### Chrome Path

```
C:/Users/amorn.t/.cache/puppeteer/chrome/win64-131.0.6778.204/chrome-win64/chrome.exe
```

### Font Requirements

- **TH SarabunNew** (THSarabunNew.ttf) in `%LOCALAPPDATA%\Microsoft\Windows\Fonts`
- Fallback: Tahoma (system font, supports Thai)
- CSS stack: `'TH SarabunNew','TH Sarabun New',Tahoma`

## Verification Details

`verify.mjs` validates using the same pdf.js v1.10.100 that the collector's `PDFLoader` uses:

1. **PDF structure**: `%PDF-` header, `%%EOF`, `startxref` present
2. **No xref warnings**: getDocument must not emit "Indexing all PDF objects"
3. **Text extraction**: Latin anchors exact-match; Thai anchors base-match (strip PUA)
4. **Scanned PDF**: 2 pages, zero text items across all pages
5. **DOCX**: mammoth extractRawText contains anchors; unzip confirms `TH SarabunNew` in `document.xml`
6. **Images**: sharp metadata valid, `thai-ocr.png` stddev > 0 (not blank)
7. **All files**: under 1 MB
