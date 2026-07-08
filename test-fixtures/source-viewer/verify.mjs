#!/usr/bin/env node
/**
 * Verification script for test fixtures (v2)
 * Uses collector's pdf.js v1.10.100 via getDocument (matches PDFLoader).
 * Validates structure, text extraction, DOCX fonts, image metadata.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, statSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require2 = createRequire(new URL('../../collector/package.json', import.meta.url));
const sharp = require2('sharp');
const AdmZip = require2('adm-zip');
const mammoth = require2('mammoth');

const ANCHOR_LATIN = 'The quick brown fox anchors here.';
const ANCHOR_THAI  = '\u0e01\u0e32\u0e23\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e23\u0e30\u0e1a\u0e1a\u0e04\u0e49\u0e19\u0e2b\u0e32\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22';
// Thai anchor with tone marks stripped (pdf.js v1.10.100 + Chromium CMap maps them to PUA)
// Chromium maps U+0E48-0E4B → U+F70A-F70D; strip both ranges for comparison
const STRIP_THAI_RE = /[\u0E48-\u0E4B\uF700-\uF7FF]/g;
const ANCHOR_THAI_BASE = ANCHOR_THAI.replace(STRIP_THAI_RE, '');

let passed = 0;
let failed = 0;
const results = [];

function ok(label, condition, detail) {
  if (condition) {
    passed++;
    results.push({ label, status: 'PASS', detail });
    console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    failed++;
    results.push({ label, status: 'FAIL', detail });
    console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  }
}

/* ---- pdf.js getDocument (same as collector PDFLoader) ---- */
async function getPdfJS() {
  const pdfjs = require2('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
  return { getDocument: pdfjs.getDocument, version: pdfjs.version };
}

async function loadPdfText(filePath) {
  const { getDocument } = await getPdfJS();
  const buffer = readFileSync(filePath);
  const warnings = [];
  const origWarn = console.warn;
  const origErr = console.error;
  console.warn = (...a) => warnings.push(a.join(' '));
  console.error = (...a) => warnings.push(a.join(' '));

  try {
    const pdf = await getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    const pages = [];
    let totalItems = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      totalItems += content.items.length;
      const text = content.items
        .filter(it => 'str' in it)
        .map(it => it.str)
        .join('');
      pages.push(text);
    }
    return { pages, numPages: pdf.numPages, totalItems, warnings, text: pages.join('\n') };
  } finally {
    console.warn = origWarn;
    console.error = origErr;
  }
}

/* ---- PDF structural checks ---- */
function checkPdfStructure(filePath) {
  const bytes = readFileSync(filePath);
  const ascii = bytes.toString('ascii');
  return {
    hasPdfHeader: ascii.startsWith('%PDF-'),
    hasEOF: ascii.includes('%%EOF'),
    hasStartxref: ascii.includes('startxref'),
  };
}

/* ---- Main ---- */
console.log('Verifying test fixtures (v2)...\n');

async function main() {
  const dir = __dirname;

  // ── 1. digital-latin.pdf ──────────────────────────────────
  console.log('digital-latin.pdf');
  const dlFile = join(dir, 'digital-latin.pdf');
  const dlStruct = checkPdfStructure(dlFile);
  ok('structure', dlStruct.hasPdfHeader && dlStruct.hasEOF && dlStruct.hasStartxref,
    `%PDF=${dlStruct.hasPdfHeader} %%EOF=${dlStruct.hasEOF} startxref=${dlStruct.hasStartxref}`);
  const dl = await loadPdfText(dlFile);
  ok('pages=2', dl.numPages === 2, `got ${dl.numPages}`);
  ok('no xref warning', !dl.warnings.some(w => w.includes('Indexing all PDF objects')),
    dl.warnings.length ? dl.warnings[0] : 'clean');
  ok('Latin anchor', dl.text.includes(ANCHOR_LATIN));
  ok('Thai text present', /[\u0E00-\u0E7F]/.test(dl.text));
  ok('Thai anchor (base)', dl.text.replace(STRIP_THAI_RE, '').includes(ANCHOR_THAI_BASE),
    'tone marks mapped to PUA by Chromium CMap');
  const dlSize = statSync(dlFile).size;
  ok('size < 1MB', dlSize < 1048576, `${(dlSize / 1024).toFixed(1)} KB`);

  // ── 2. digital-thai.pdf ───────────────────────────────────
  console.log('\ndigital-thai.pdf');
  const dtFile = join(dir, 'digital-thai.pdf');
  const dtStruct = checkPdfStructure(dtFile);
  ok('structure', dtStruct.hasPdfHeader && dtStruct.hasEOF && dtStruct.hasStartxref);
  const dt = await loadPdfText(dtFile);
  ok('no xref warning', !dt.warnings.some(w => w.includes('Indexing all PDF objects')),
    dt.warnings.length ? dt.warnings[0] : 'clean');
  ok('Thai text present', /[\u0E00-\u0E7F]/.test(dt.text));
  ok('Thai anchor (base)', dt.text.replace(STRIP_THAI_RE, '').includes(ANCHOR_THAI_BASE),
    'tone marks mapped to PUA by Chromium CMap');
  ok('Latin anchor', dt.text.includes(ANCHOR_LATIN));
  ok('size < 1MB', statSync(dtFile).size < 1048576);

  // ── 3. scanned.pdf ────────────────────────────────────────
  console.log('\nscanned.pdf');
  const scFile = join(dir, 'scanned.pdf');
  const scStruct = checkPdfStructure(scFile);
  ok('structure', scStruct.hasPdfHeader && scStruct.hasEOF && scStruct.hasStartxref);
  const sc = await loadPdfText(scFile);
  ok('no xref warning', !sc.warnings.some(w => w.includes('Indexing all PDF objects')),
    sc.warnings.length ? sc.warnings[0] : 'clean');
  ok('pages=2', sc.numPages === 2, `got ${sc.numPages}`);
  ok('zero text items', sc.totalItems === 0, `got ${sc.totalItems} items`);
  ok('size < 1MB', statSync(scFile).size < 1048576);

  // ── 4. simple.docx ────────────────────────────────────────
  console.log('\nsimple.docx');
  const sdFile = join(dir, 'simple.docx');
  const sdResult = await mammoth.extractRawText({ path: sdFile });
  ok('Latin anchor', sdResult.value.includes(ANCHOR_LATIN));
  ok('Thai anchor', sdResult.value.includes(ANCHOR_THAI));
  const sdZip = new AdmZip(sdFile);
  const sdDocXml = sdZip.readAsText('word/document.xml');
  ok('TH SarabunNew in document.xml', sdDocXml.includes('TH SarabunNew'));
  ok('size < 1MB', statSync(sdFile).size < 1048576);

  // ── 5. thai-sarabun.docx ──────────────────────────────────
  console.log('\nthai-sarabun.docx');
  const tsFile = join(dir, 'thai-sarabun.docx');
  const tsResult = await mammoth.extractRawText({ path: tsFile });
  ok('Thai anchor', tsResult.value.includes(ANCHOR_THAI));
  ok('Latin anchor', tsResult.value.includes(ANCHOR_LATIN));
  const tsZip = new AdmZip(tsFile);
  const tsDocXml = tsZip.readAsText('word/document.xml');
  ok('TH SarabunNew in document.xml', tsDocXml.includes('TH SarabunNew'));
  const tsStylesXml = tsZip.readAsText('word/styles.xml');
  ok('TH SarabunNew in styles.xml', tsStylesXml.includes('TH SarabunNew'));
  ok('size < 1MB', statSync(tsFile).size < 1048576);

  // ── 6. sample.md ──────────────────────────────────────────
  console.log('\nsample.md');
  const mdFile = join(dir, 'sample.md');
  const mdContent = readFileSync(mdFile, 'utf8');
  ok('Latin anchor', mdContent.includes(ANCHOR_LATIN));
  ok('Thai anchor', mdContent.includes(ANCHOR_THAI));
  ok('has h1', mdContent.includes('# Main Heading'));
  ok('has table', mdContent.includes('| Column 1 |'));
  ok('has Thai h2', /## .+[\u0E00-\u0E7F]/.test(mdContent));
  ok('size < 1MB', statSync(mdFile).size < 1048576);

  // ── 7. sample-bom.txt ─────────────────────────────────────
  console.log('\nsample-bom.txt');
  const bomFile = join(dir, 'sample-bom.txt');
  const bomData = readFileSync(bomFile);
  ok('UTF-8 BOM', bomData[0] === 0xef && bomData[1] === 0xbb && bomData[2] === 0xbf);
  ok('CRLF', bomData.includes(Buffer.from('\r\n')));
  const bomText = bomData.toString('utf8');
  ok('Latin anchor', bomText.includes(ANCHOR_LATIN));
  ok('Thai anchor', bomText.includes(ANCHOR_THAI));
  ok('size < 1MB', bomData.length < 1048576);

  // ── 8. thai-ocr.png ───────────────────────────────────────
  console.log('\nthai-ocr.png');
  const toPngFile = join(dir, 'thai-ocr.png');
  const toMeta = await sharp(toPngFile).metadata();
  ok('PNG format', toMeta.format === 'png', toMeta.format);
  ok('width >= 600', toMeta.width >= 600, `${toMeta.width}px`);
  const toStats = await sharp(toPngFile).stats();
  const toStddev = toStats.channels.reduce((s, c) => s + c.stdev, 0);
  ok('not blank (stddev>0)', toStddev > 0, `stddev=${toStddev.toFixed(2)}`);
  ok('size < 1MB', statSync(toPngFile).size < 1048576);

  // ── 9. latin-ocr.jpg ──────────────────────────────────────
  console.log('\nlatin-ocr.jpg');
  const loJpgFile = join(dir, 'latin-ocr.jpg');
  const loMeta = await sharp(loJpgFile).metadata();
  ok('JPEG format', loMeta.format === 'jpeg', loMeta.format);
  ok('width >= 600', loMeta.width >= 600, `${loMeta.width}px`);
  ok('size < 1MB', statSync(loJpgFile).size < 1048576);

  // ── 10. corrupt.pdf ───────────────────────────────────────
  console.log('\ncorrupt.pdf');
  const cpFile = join(dir, 'corrupt.pdf');
  const cpData = readFileSync(cpFile, 'utf8');
  ok('has %PDF- header', cpData.startsWith('%PDF-'));
  ok('is truncated (no %%EOF)', !cpData.includes('%%EOF'));

  // ── 11. oversized-marker.txt ──────────────────────────────
  console.log('\noversized-marker.txt');
  const omFile = join(dir, 'oversized-marker.txt');
  ok('exists and readable', readFileSync(omFile, 'utf8').length > 0);

  // ── Summary ───────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} checks`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
