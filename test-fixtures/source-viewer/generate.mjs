#!/usr/bin/env node
/**
 * Fixture generator for source-viewer tests (v2)
 * Idempotent: always regenerates all fixtures (overwrite).
 * All PDFs generated via Puppeteer/Chromium for spec-compliant output.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require2 = createRequire(new URL('../../collector/package.json', import.meta.url));
const sharp = require2('sharp');
const AdmZip = require2('adm-zip');
const puppeteer = require2('puppeteer');

const ANCHOR_LATIN = 'The quick brown fox anchors here.';
const ANCHOR_THAI = '\u0e01\u0e32\u0e23\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e23\u0e30\u0e1a\u0e1a\u0e04\u0e49\u0e19\u0e2b\u0e32\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22';
const CHROME_PATH =
  'C:/Users/amorn.t/.cache/puppeteer/chrome/win64-131.0.6778.204/chrome-win64/chrome.exe';
const FONT_CSS = "'TH SarabunNew','TH Sarabun New',Tahoma";
const FONT_SVG = 'TH SarabunNew, Tahoma';

console.log('Generating test fixtures (v2)...\n');

/* ---------- shared browser ---------- */
let _browser = null;
async function getBrowser() {
  if (!_browser) {
    _browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROME_PATH,
    });
  }
  return _browser;
}

/* ---------- DOCX helpers ---------- */
const RFONT = '<w:rFonts w:ascii="TH SarabunNew" w:hAnsi="TH SarabunNew" w:cs="TH SarabunNew"/>';
const SZCS  = '<w:szCs w:val="32"/>';
const RPR   = `<w:rPr>${RFONT}${SZCS}</w:rPr>`;

function run(text) {
  return `<w:r>${RPR}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}
function para(text, style) {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}${run(text)}</w:p>`;
}
function cell(text) {
  return `<w:tc>${para(text)}</w:tc>`;
}

const DOCX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const DOCX_ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        ${RFONT}
        <w:sz w:val="28"/>
        ${SZCS}
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
</w:styles>`;

const DOCX_DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

function buildDocx(filename, documentXml) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(DOCX_CONTENT_TYPES, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(DOCX_ROOT_RELS, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  zip.addFile('word/styles.xml', Buffer.from(DOCX_STYLES, 'utf8'));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(DOCX_DOC_RELS, 'utf8'));
  zip.writeZip(filename);
}

// ============================================================================
// 1. digital-latin.pdf — 2 pages, born-digital, Latin + Thai
// ============================================================================
async function generateDigitalLatinPdf() {
  const file = join(__dirname, 'digital-latin.pdf');
  const b = await getBrowser();
  const page = await b.newPage();

  await page.setContent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  body { font-family: ${FONT_CSS}; margin: 40px; }
  .break { page-break-after: always; }
  .thai  { font-size: 18pt; }
  p { font-size: 14px; line-height: 1.6; }
</style></head><body>
<div class="break">
  <h1>Test Document — Page 1</h1>
  <p>${ANCHOR_LATIN}</p>
  <p class="thai">${ANCHOR_THAI}</p>
</div>
<div>
  <h1>Test Document — Page 2</h1>
  <p>Additional content on the second page.</p>
  <p class="thai">${ANCHOR_THAI}</p>
</div>
</body></html>`, { waitUntil: 'networkidle0' });

  await page.pdf({ path: file, format: 'A4' });
  await page.close();
  console.log('  digital-latin.pdf  (2pp, Latin+Thai, Chromium)');
}

// ============================================================================
// 2. digital-thai.pdf — born-digital, Thai-primary + Latin anchor
// ============================================================================
async function generateDigitalThaiPdf() {
  const file = join(__dirname, 'digital-thai.pdf');
  const b = await getBrowser();
  const page = await b.newPage();

  await page.setContent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  body { font-family: ${FONT_CSS}; margin: 40px; font-size: 18pt; }
  h1 { font-size: 24pt; }
  p { line-height: 1.6; }
</style></head><body>
  <h1>${ANCHOR_THAI}</h1>
  <p>\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23\u0e19\u0e35\u0e49\u0e43\u0e0a\u0e49\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e01\u0e32\u0e23\u0e04\u0e49\u0e19\u0e2b\u0e32\u0e41\u0e25\u0e30\u0e44\u0e2e\u0e44\u0e25\u0e17\u0e4c\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22\u0e43\u0e19\u0e23\u0e30\u0e1a\u0e1a</p>
  <p>${ANCHOR_LATIN}</p>
</body></html>`, { waitUntil: 'networkidle0' });

  await page.pdf({ path: file, format: 'A4' });
  await page.close();
  console.log('  digital-thai.pdf   (Thai+Latin, Chromium)');
}

// ============================================================================
// 3. scanned.pdf — 2 pages, image-only, ZERO text layer
// ============================================================================
async function generateScannedPdf() {
  const file = join(__dirname, 'scanned.pdf');

  // Render text as images via sharp SVG→PNG
  const p1Svg = `<svg width="1240" height="1754" xmlns="http://www.w3.org/2000/svg">
    <rect width="1240" height="1754" fill="white"/>
    <text x="80" y="200" font-family="${FONT_SVG}" font-size="32" fill="black">${ANCHOR_LATIN}</text>
    <text x="80" y="280" font-family="${FONT_SVG}" font-size="28" fill="black">This is page 1 of a scanned document.</text>
    <text x="80" y="360" font-family="${FONT_SVG}" font-size="28" fill="black">No text layer present in this PDF.</text>
  </svg>`;

  const p2Svg = `<svg width="1240" height="1754" xmlns="http://www.w3.org/2000/svg">
    <rect width="1240" height="1754" fill="white"/>
    <text x="80" y="200" font-family="${FONT_SVG}" font-size="32" fill="black">${ANCHOR_THAI}</text>
    <text x="80" y="280" font-family="${FONT_SVG}" font-size="28" fill="black">\u0e2b\u0e19\u0e49\u0e32\u0e17\u0e35\u0e48 2 \u0e02\u0e2d\u0e07\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23\u0e17\u0e35\u0e48\u0e2a\u0e41\u0e01\u0e19</text>
    <text x="80" y="360" font-family="${FONT_SVG}" font-size="28" fill="black">\u0e44\u0e21\u0e48\u0e21\u0e35\u0e40\u0e25\u0e40\u0e22\u0e2d\u0e23\u0e4c\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e43\u0e19\u0e44\u0e1f\u0e25\u0e4c PDF \u0e19\u0e35\u0e49</text>
  </svg>`;

  const p1Png = await sharp(Buffer.from(p1Svg)).png().toBuffer();
  const p2Png = await sharp(Buffer.from(p2Svg)).png().toBuffer();

  const p1Url = `data:image/png;base64,${p1Png.toString('base64')}`;
  const p2Url = `data:image/png;base64,${p2Png.toString('base64')}`;

  const b = await getBrowser();
  const page = await b.newPage();

  await page.setContent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  @page { margin: 0; }
  * { margin:0; padding:0; }
  img { display:block; width:210mm; height:297mm; object-fit:contain; }
  img+img { page-break-before:always; }
</style></head><body>
<img src="${p1Url}" alt=""/>
<img src="${p2Url}" alt=""/>
</body></html>`, { waitUntil: 'networkidle0' });

  await page.pdf({ path: file, format: 'A4', printBackground: true, margin: {top:0,right:0,bottom:0,left:0} });
  await page.close();
  console.log('  scanned.pdf        (2pp, image-only, Chromium)');
}

// ============================================================================
// 4. simple.docx — h1, paragraphs, table, Latin + Thai anchors
// ============================================================================
async function generateSimpleDocx() {
  const file = join(__dirname, 'simple.docx');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${para('Test Document', 'Heading1')}
    ${para(ANCHOR_LATIN)}
    ${para('This is a test paragraph.')}
    ${para(ANCHOR_THAI)}
    <w:tbl>
      <w:tblPr><w:tblW w:w="5000" w:type="auto"/></w:tblPr>
      <w:tr>${cell('Cell 1')}${cell('Cell 2')}</w:tr>
      <w:tr>${cell('Cell 3')}${cell('Cell 4')}</w:tr>
    </w:tbl>
  </w:body>
</w:document>`;
  buildDocx(file, doc);
  console.log('  simple.docx        (h1, table, Latin+Thai)');
}

// ============================================================================
// 5. thai-sarabun.docx — Thai-primary, TH SarabunNew font
// ============================================================================
async function generateThaiSarabunDocx() {
  const file = join(__dirname, 'thai-sarabun.docx');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${para('\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22', 'Heading1')}
    ${para(ANCHOR_THAI)}
    ${para('\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23\u0e19\u0e35\u0e49\u0e43\u0e0a\u0e49\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e01\u0e32\u0e23\u0e41\u0e2a\u0e14\u0e07\u0e1c\u0e25\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22\u0e14\u0e49\u0e27\u0e22\u0e1f\u0e2d\u0e19\u0e15\u0e4c TH SarabunNew')}
    <w:tbl>
      <w:tblPr><w:tblW w:w="5000" w:type="auto"/></w:tblPr>
      <w:tr>${cell('\u0e2b\u0e31\u0e27\u0e02\u0e49\u0e2d')}${cell('\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14')}</w:tr>
      <w:tr>${cell('\u0e0a\u0e37\u0e48\u0e2d')}${cell('\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e23\u0e30\u0e1a\u0e1a')}</w:tr>
    </w:tbl>
    ${para(ANCHOR_LATIN)}
  </w:body>
</w:document>`;
  buildDocx(file, doc);
  console.log('  thai-sarabun.docx  (Thai-primary, TH SarabunNew)');
}

// ============================================================================
// 6. sample.md — GFM with h1, h2, table, code, bold, link + Thai
// ============================================================================
async function generateSampleMd() {
  const file = join(__dirname, 'sample.md');
  writeFileSync(file, `# Main Heading

## Subheading

${ANCHOR_LATIN}

This is a **bold** text and a [link](https://example.com).

\`\`\`javascript
const greeting = "Hello, World!";
console.log(greeting);
\`\`\`

| Column 1 | Column 2 |
|----------|----------|
| Value 1  | Value 2  |
| Value 3  | Value 4  |

## \u0e2b\u0e31\u0e27\u0e02\u0e49\u0e2d\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22

${ANCHOR_THAI}
`, 'utf8');
  console.log('  sample.md          (GFM + Thai section)');
}

// ============================================================================
// 7. sample-bom.txt — UTF-8 BOM + CRLF + Latin + Thai anchors
// ============================================================================
async function generateSampleBomTxt() {
  const file = join(__dirname, 'sample-bom.txt');
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const content = Buffer.from(
    `${ANCHOR_LATIN}\r\nSecond line with CRLF.\r\n${ANCHOR_THAI}\r\n`,
    'utf8'
  );
  writeFileSync(file, Buffer.concat([bom, content]));
  console.log('  sample-bom.txt     (BOM+CRLF, Latin+Thai)');
}

// ============================================================================
// 8. thai-ocr.png — Thai text image, TH SarabunNew
// ============================================================================
async function generateThaiOcrPng() {
  const file = join(__dirname, 'thai-ocr.png');
  const svg = `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="400" fill="white"/>
    <text x="50" y="100" font-family="${FONT_SVG}" font-size="24" fill="black">${ANCHOR_THAI}</text>
    <text x="50" y="160" font-family="${FONT_SVG}" font-size="20" fill="black">\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e23\u0e30\u0e1a\u0e1a</text>
    <text x="50" y="220" font-family="${FONT_SVG}" font-size="20" fill="black">\u0e04\u0e49\u0e19\u0e2b\u0e32\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(file, png);
  console.log('  thai-ocr.png       (TH SarabunNew, 800px)');
}

// ============================================================================
// 9. latin-ocr.jpg — English + Thai text lines
// ============================================================================
async function generateLatinOcrJpg() {
  const file = join(__dirname, 'latin-ocr.jpg');
  const svg = `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="400" fill="white"/>
    <text x="50" y="80"  font-family="${FONT_SVG}" font-size="18" fill="black">${ANCHOR_LATIN}</text>
    <text x="50" y="140" font-family="${FONT_SVG}" font-size="16" fill="black">This is the second line of text in the image.</text>
    <text x="50" y="200" font-family="${FONT_SVG}" font-size="16" fill="black">And here is the third line for OCR testing.</text>
    <text x="50" y="280" font-family="${FONT_SVG}" font-size="20" fill="black">${ANCHOR_THAI}</text>
  </svg>`;
  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
  writeFileSync(file, jpg);
  console.log('  latin-ocr.jpg      (Latin+Thai, 800px)');
}

// ============================================================================
// 10. corrupt.pdf — truncated/invalid (unchanged)
// ============================================================================
function generateCorruptPdf() {
  const file = join(__dirname, 'corrupt.pdf');
  writeFileSync(file, Buffer.from('%PDF-1.4\n%corrupted data\ntruncated\n', 'utf8'));
  console.log('  corrupt.pdf        (truncated, invalid)');
}

// ============================================================================
// 11. oversized-marker.txt (unchanged)
// ============================================================================
function generateOversizedMarkerTxt() {
  const file = join(__dirname, 'oversized-marker.txt');
  writeFileSync(file, 'This is a marker file for oversized content testing.\n', 'utf8');
  console.log('  oversized-marker.txt');
}

// ============================================================================
// Main
// ============================================================================
async function main() {
  try {
    // PDFs (need browser)
    await generateDigitalLatinPdf();
    await generateDigitalThaiPdf();
    await generateScannedPdf();

    // Close browser after PDFs
    if (_browser) { await _browser.close(); _browser = null; }

    // DOCX
    await generateSimpleDocx();
    await generateThaiSarabunDocx();

    // Text & Markdown
    await generateSampleMd();
    await generateSampleBomTxt();

    // Images
    await generateThaiOcrPng();
    await generateLatinOcrJpg();

    // Unchanged
    generateCorruptPdf();
    generateOversizedMarkerTxt();

    console.log('\nAll fixtures generated.');
    process.exit(0);
  } catch (error) {
    if (_browser) { await _browser.close().catch(() => {}); }
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

main();
