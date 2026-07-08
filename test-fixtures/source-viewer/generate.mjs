#!/usr/bin/env node
/**
 * Fixture generator for source-viewer tests
 * Idempotent: safe to run multiple times
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load dependencies from collector's node_modules
const require2 = createRequire(new URL('../../collector/package.json', import.meta.url));
const sharp = require2('sharp');
const AdmZip = require2('adm-zip');
const mammoth = require2('mammoth');
const puppeteer = require2('puppeteer');

const ANCHOR_LATIN = 'The quick brown fox anchors here.';
const ANCHOR_THAI = 'การทดสอบระบบค้นหาข้อความภาษาไทย';

console.log('🔧 Generating test fixtures...\n');

// ============================================================================
// 1. digital-latin.pdf - 2 pages, born-digital, contains anchor in text layer
// ============================================================================
async function generateDigitalLatinPdf() {
  const filename = join(__dirname, 'digital-latin.pdf');
  if (existsSync(filename)) {
    console.log('✓ digital-latin.pdf exists');
    return;
  }

  // Build PDF with proper offsets
  const parts = [];
  const offsets = {};

  // Header
  parts.push('%PDF-1.4\n');
  
  // Object 1: Catalog
  offsets[1] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
  parts.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  
  // Object 2: Pages
  offsets[2] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
  parts.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n');
  
  // Object 3: Page 1
  offsets[3] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
  parts.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>\nendobj\n');
  
  // Object 4: Page 2
  offsets[4] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
  parts.push('4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 6 0 R >> >> >>\nendobj\n');
  
  // Object 5: Content stream 1
  const stream1 = `BT\n/F1 12 Tf\n50 700 Td\n(${ANCHOR_LATIN}) Tj\nET\n`;
  offsets[5] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
  parts.push(`5 0 obj\n<< /Length ${stream1.length} >>\nstream\n${stream1}endstream\nendobj\n`);
  
  // Object 6: Font
  offsets[6] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
  parts.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
  
  // Object 7: Content stream 2
  const stream2 = 'BT\n/F1 12 Tf\n50 700 Td\n(Page 2 content) Tj\nET\n';
  offsets[7] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
  parts.push(`7 0 obj\n<< /Length ${stream2.length} >>\nstream\n${stream2}endstream\nendobj\n`);
  
  // xref
  const xrefOffset = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
  parts.push('xref\n0 8\n');
  parts.push('0000000000 65535 f \n');
  for (let i = 1; i <= 7; i++) {
    parts.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  
  // Trailer
  parts.push('trailer\n<< /Size 8 /Root 1 0 R >>\n');
  parts.push('startxref\n');
  parts.push(`${xrefOffset}\n`);
  parts.push('%%EOF');

  const pdf = Buffer.from(parts.join(''), 'utf8');
  writeFileSync(filename, pdf);
  console.log('✓ digital-latin.pdf created (2 pages, text layer)');
}

// ============================================================================
// 2. digital-thai.pdf - born-digital with Thai text (using puppeteer)
// ============================================================================
async function generateDigitalThaiPdf() {
  const filename = join(__dirname, 'digital-thai.pdf');
  if (existsSync(filename)) {
    console.log('✓ digital-thai.pdf exists');
    return;
  }

  try {
    const browser = await puppeteer.launch({ 
      headless: 'new',
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    });
    const page = await browser.newPage();
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Tahoma, 'Leelawadee UI', sans-serif; margin: 40px; }
          h1 { font-size: 20px; color: #000; }
          p { font-size: 14px; line-height: 1.6; }
        </style>
      </head>
      <body>
        <h1>${ANCHOR_THAI}</h1>
        <p>เอกสารนี้ใช้สำหรับทดสอบการค้นหาและไฮไลต์ข้อความภาษาไทยในระบบ</p>
        <p>${ANCHOR_LATIN}</p>
      </body>
      </html>
    `;
    
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    await page.pdf({ path: filename, format: 'A4' });
    await browser.close();
    
    console.log('✓ digital-thai.pdf created (Thai text via puppeteer)');
  } catch (error) {
    console.error('✗ Puppeteer error for Thai PDF:', error.message);
    console.log('  Falling back to hex-encoded PDF...');
    
    // Fallback: hand-rolled PDF with hex encoding
    const thaiHex = Buffer.from(ANCHOR_THAI, 'utf8').toString('hex');
    const parts = [];
    const offsets = {};

    parts.push('%PDF-1.4\n');
    offsets[1] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
    parts.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    
    offsets[2] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
    parts.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    
    offsets[3] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
    parts.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n');
    
    const stream = `BT\n/F1 12 Tf\n50 700 Td\n<${thaiHex}> Tj\nET\n`;
    offsets[4] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
    parts.push(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);
    
    offsets[5] = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
    parts.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
    
    const xrefOffset = parts.reduce((sum, p) => sum + Buffer.byteLength(p, 'utf8'), 0);
    parts.push('xref\n0 6\n0000000000 65535 f \n');
    for (let i = 1; i <= 5; i++) {
      parts.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    }
    parts.push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n');
    parts.push(`${xrefOffset}\n%%EOF`);

    const pdf = Buffer.from(parts.join(''), 'utf8');
    writeFileSync(filename, pdf);
    console.log('✓ digital-thai.pdf created (fallback: hex-encoded)');
  }
}

// ============================================================================
// 3. scanned.pdf - 2 pages, image-only (no text layer)
// ============================================================================
async function generateScannedPdf() {
  const filename = join(__dirname, 'scanned.pdf');
  if (existsSync(filename)) {
    console.log('✓ scanned.pdf exists');
    return;
  }

  // Create 2 PNG images with text rendered at 14pt
  const page1Svg = `<svg width="612" height="792" xmlns="http://www.w3.org/2000/svg">
    <rect width="612" height="792" fill="white"/>
    <text x="50" y="100" font-family="Arial" font-size="14" fill="black">
      ${ANCHOR_LATIN}
    </text>
    <text x="50" y="150" font-family="Arial" font-size="14" fill="black">
      This is page 1 of a scanned document.
    </text>
  </svg>`;

  const page2Svg = `<svg width="612" height="792" xmlns="http://www.w3.org/2000/svg">
    <rect width="612" height="792" fill="white"/>
    <text x="50" y="100" font-family="Arial" font-size="14" fill="black">
      This is page 2 of the scanned document.
    </text>
    <text x="50" y="150" font-family="Arial" font-size="14" fill="black">
      No text layer present in this PDF.
    </text>
  </svg>`;

  // Convert SVGs to PNGs
  const page1Png = await sharp(Buffer.from(page1Svg)).png().toBuffer();
  const page2Png = await sharp(Buffer.from(page2Svg)).png().toBuffer();

  // Create PDF with embedded images
  const pdf = Buffer.from(
    `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /XObject << /Im1 6 0 R >> >> >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /XObject << /Im2 8 0 R >> >> >>
endobj
5 0 obj
<< /Length 44 >>
stream
q
612 0 0 792 0 0 cm
/Im1 Do
Q
endstream
endobj
6 0 obj
<< /Type /XObject /Subtype /Image /Width 612 /Height 792 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${page1Png.length} >>
stream
${page1Png.toString('binary')}
endstream
endobj
7 0 obj
<< /Length 44 >>
stream
q
612 0 0 792 0 0 cm
/Im2 Do
Q
endstream
endobj
8 0 obj
<< /Type /XObject /Subtype /Image /Width 612 /Height 792 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${page2Png.length} >>
stream
${page2Png.toString('binary')}
endstream
endobj
xref
0 9
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000229 00000 n 
0000000343 00000 n 
0000000437 00000 n 
trailer
<< /Size 9 /Root 1 0 R >>
startxref
999999
%%EOF`,
    'latin1'
  );

  writeFileSync(filename, pdf);
  console.log('✓ scanned.pdf created (2 pages, image-only, no text layer)');
}

// ============================================================================
// 4. simple.docx - h1, paragraphs, 2x2 table with anchor sentence
// ============================================================================
async function generateSimpleDocx() {
  const filename = join(__dirname, 'simple.docx');
  if (existsSync(filename)) {
    console.log('✓ simple.docx exists');
    return;
  }

  const zip = new AdmZip();

  // [Content_Types].xml
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  // _rels/.rels
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  // word/document.xml with h1, paragraphs, and 2x2 table
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Heading1"/>
      </w:pPr>
      <w:r>
        <w:t>Test Document</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:t>${ANCHOR_LATIN}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:t>This is a test paragraph.</w:t>
      </w:r>
    </w:p>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="5000" w:type="auto"/>
      </w:tblPr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Cell 1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Cell 2</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Cell 3</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Cell 4</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

  // word/_rels/document.xml.rels
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rels, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(document, 'utf8'));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels, 'utf8'));

  zip.writeZip(filename);
  console.log('✓ simple.docx created (h1, paragraphs, 2x2 table)');
}

// ============================================================================
// 5. sample.md - GFM with h1, h2, table, code fence, bold, link
// ============================================================================
async function generateSampleMd() {
  const filename = join(__dirname, 'sample.md');
  if (existsSync(filename)) {
    console.log('✓ sample.md exists');
    return;
  }

  const content = `# Main Heading

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
`;

  writeFileSync(filename, content, 'utf8');
  console.log('✓ sample.md created (GFM with h1, h2, table, code, bold, link)');
}

// ============================================================================
// 6. sample-bom.txt - UTF-8 BOM + CRLF + anchor sentence
// ============================================================================
async function generateSampleBomTxt() {
  const filename = join(__dirname, 'sample-bom.txt');
  if (existsSync(filename)) {
    console.log('✓ sample-bom.txt exists');
    return;
  }

  const bom = Buffer.from([0xef, 0xbb, 0xbf]); // UTF-8 BOM
  const content = Buffer.from(`${ANCHOR_LATIN}\r\nSecond line with CRLF.\r\n`, 'utf8');
  const buffer = Buffer.concat([bom, content]);

  writeFileSync(filename, buffer);
  console.log('✓ sample-bom.txt created (UTF-8 BOM + CRLF)');
}

// ============================================================================
// 7. thai-ocr.png - ≥600px wide image of Thai text
// ============================================================================
async function generateThaiOcrPng() {
  const filename = join(__dirname, 'thai-ocr.png');
  if (existsSync(filename)) {
    console.log('✓ thai-ocr.png exists');
    return;
  }

  const svg = `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="400" fill="white"/>
    <text x="50" y="100" font-family="Tahoma, Leelawadee UI" font-size="24" fill="black">
      ${ANCHOR_THAI}
    </text>
    <text x="50" y="150" font-family="Tahoma, Leelawadee UI" font-size="18" fill="black">
      Line 2: ทดสอบระบบ
    </text>
    <text x="50" y="200" font-family="Tahoma, Leelawadee UI" font-size="18" fill="black">
      Line 3: ค้นหาข้อความ
    </text>
  </svg>`;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(filename, png);
  console.log('✓ thai-ocr.png created (≥600px wide, Thai text)');
}

// ============================================================================
// 8. latin-ocr.jpg - image of 3+ English text lines with anchor sentence
// ============================================================================
async function generateLatinOcrJpg() {
  const filename = join(__dirname, 'latin-ocr.jpg');
  if (existsSync(filename)) {
    console.log('✓ latin-ocr.jpg exists');
    return;
  }

  const svg = `<svg width="800" height="300" xmlns="http://www.w3.org/2000/svg">
    <rect width="800" height="300" fill="white"/>
    <text x="50" y="80" font-family="Arial" font-size="18" fill="black">
      ${ANCHOR_LATIN}
    </text>
    <text x="50" y="140" font-family="Arial" font-size="16" fill="black">
      This is the second line of text in the image.
    </text>
    <text x="50" y="200" font-family="Arial" font-size="16" fill="black">
      And here is the third line for OCR testing.
    </text>
  </svg>`;

  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
  writeFileSync(filename, jpg);
  console.log('✓ latin-ocr.jpg created (3+ English text lines)');
}

// ============================================================================
// 9. corrupt.pdf - %PDF-1.4 header + truncated garbage
// ============================================================================
async function generateCorruptPdf() {
  const filename = join(__dirname, 'corrupt.pdf');
  if (existsSync(filename)) {
    console.log('✓ corrupt.pdf exists');
    return;
  }

  const corrupt = Buffer.from('%PDF-1.4\n%corrupted data\ntruncated\n', 'utf8');
  writeFileSync(filename, corrupt);
  console.log('✓ corrupt.pdf created (truncated, invalid)');
}

// ============================================================================
// 10. oversized-marker.txt - small text file
// ============================================================================
async function generateOversizedMarkerTxt() {
  const filename = join(__dirname, 'oversized-marker.txt');
  if (existsSync(filename)) {
    console.log('✓ oversized-marker.txt exists');
    return;
  }

  const content = 'This is a marker file for oversized content testing.\n';
  writeFileSync(filename, content, 'utf8');
  console.log('✓ oversized-marker.txt created');
}

// ============================================================================
// Main execution
// ============================================================================
async function main() {
  try {
    await generateDigitalLatinPdf();
    await generateDigitalThaiPdf();
    await generateScannedPdf();
    await generateSimpleDocx();
    await generateSampleMd();
    await generateSampleBomTxt();
    await generateThaiOcrPng();
    await generateLatinOcrJpg();
    await generateCorruptPdf();
    await generateOversizedMarkerTxt();

    console.log('\n✅ All fixtures generated successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error generating fixtures:', error.message);
    process.exit(1);
  }
}

main();
