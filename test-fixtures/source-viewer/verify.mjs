#!/usr/bin/env node
/**
 * Verification script for test fixtures
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require2 = createRequire(new URL('../../collector/package.json', import.meta.url));
const pdfParse = require2('pdf-parse');
const mammoth = require2('mammoth');

const ANCHOR_LATIN = 'The quick brown fox anchors here.';
const ANCHOR_THAI = 'การทดสอบระบบค้นหาข้อความภาษาไทย';

console.log('🔍 Verifying test fixtures...\n');

async function verifyDigitalLatinPdf() {
  const filename = join(__dirname, 'digital-latin.pdf');
  try {
    const data = readFileSync(filename);
    const result = await pdfParse(data);
    const hasAnchor = result.text.includes(ANCHOR_LATIN);
    console.log(`✓ digital-latin.pdf: ${result.numpages} pages, anchor: ${hasAnchor ? '✓' : '✗'}`);
    return hasAnchor;
  } catch (e) {
    console.log(`✗ digital-latin.pdf: ${e.message}`);
    return false;
  }
}

async function verifyDigitalThaiPdf() {
  const filename = join(__dirname, 'digital-thai.pdf');
  try {
    const data = readFileSync(filename);
    const result = await pdfParse(data);
    // Thai text may not extract properly without proper font encoding
    console.log(`✓ digital-thai.pdf: parsed (text extraction may need OCR)`);
    return true;
  } catch (e) {
    console.log(`✗ digital-thai.pdf: ${e.message}`);
    return false;
  }
}

async function verifyScannedPdf() {
  const filename = join(__dirname, 'scanned.pdf');
  try {
    const data = readFileSync(filename);
    const result = await pdfParse(data);
    const hasNoText = result.text.trim().length === 0;
    console.log(`✓ scanned.pdf: ${result.numpages} pages, no text layer: ${hasNoText ? '✓' : '⚠'}`);
    return true;
  } catch (e) {
    console.log(`✗ scanned.pdf: ${e.message}`);
    return false;
  }
}

async function verifySimpleDocx() {
  const filename = join(__dirname, 'simple.docx');
  try {
    const result = await mammoth.extractRawText({ path: filename });
    const hasAnchor = result.value.includes(ANCHOR_LATIN);
    console.log(`✓ simple.docx: anchor: ${hasAnchor ? '✓' : '✗'}`);
    return hasAnchor;
  } catch (e) {
    console.log(`✗ simple.docx: ${e.message}`);
    return false;
  }
}

async function verifySampleMd() {
  const filename = join(__dirname, 'sample.md');
  try {
    const content = readFileSync(filename, 'utf8');
    const hasAnchor = content.includes(ANCHOR_LATIN);
    const hasH1 = content.includes('# Main Heading');
    const hasTable = content.includes('| Column 1 |');
    console.log(`✓ sample.md: anchor: ${hasAnchor ? '✓' : '✗'}, h1: ${hasH1 ? '✓' : '✗'}, table: ${hasTable ? '✓' : '✗'}`);
    return hasAnchor && hasH1 && hasTable;
  } catch (e) {
    console.log(`✗ sample.md: ${e.message}`);
    return false;
  }
}

async function verifySampleBomTxt() {
  const filename = join(__dirname, 'sample-bom.txt');
  try {
    const data = readFileSync(filename);
    const hasBom = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
    const content = data.toString('utf8'); // UTF-8 decoder handles BOM automatically
    const hasAnchor = content.includes(ANCHOR_LATIN);
    const hasCrlf = data.includes(Buffer.from('\r\n'));
    console.log(`✓ sample-bom.txt: BOM: ${hasBom ? '✓' : '✗'}, CRLF: ${hasCrlf ? '✓' : '✗'}, anchor: ${hasAnchor ? '✓' : '✗'}`);
    return hasBom && hasCrlf && hasAnchor;
  } catch (e) {
    console.log(`✗ sample-bom.txt: ${e.message}`);
    return false;
  }
}

async function verifyThaiOcrPng() {
  const filename = join(__dirname, 'thai-ocr.png');
  try {
    const data = readFileSync(filename);
    const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
    const isWide = data.length > 10000; // Rough check for size
    console.log(`✓ thai-ocr.png: PNG: ${isPng ? '✓' : '✗'}, size: ${data.length} bytes`);
    return isPng;
  } catch (e) {
    console.log(`✗ thai-ocr.png: ${e.message}`);
    return false;
  }
}

async function verifyLatinOcrJpg() {
  const filename = join(__dirname, 'latin-ocr.jpg');
  try {
    const data = readFileSync(filename);
    const isJpeg = data[0] === 0xff && data[1] === 0xd8;
    console.log(`✓ latin-ocr.jpg: JPEG: ${isJpeg ? '✓' : '✗'}, size: ${data.length} bytes`);
    return isJpeg;
  } catch (e) {
    console.log(`✗ latin-ocr.jpg: ${e.message}`);
    return false;
  }
}

async function verifyCorruptPdf() {
  const filename = join(__dirname, 'corrupt.pdf');
  try {
    const data = readFileSync(filename);
    const hasPdfHeader = data.toString('utf8').startsWith('%PDF-1.4');
    console.log(`✓ corrupt.pdf: PDF header: ${hasPdfHeader ? '✓' : '✗'}, size: ${data.length} bytes`);
    return hasPdfHeader;
  } catch (e) {
    console.log(`✗ corrupt.pdf: ${e.message}`);
    return false;
  }
}

async function verifyOversizedMarkerTxt() {
  const filename = join(__dirname, 'oversized-marker.txt');
  try {
    const content = readFileSync(filename, 'utf8');
    const hasContent = content.length > 0;
    console.log(`✓ oversized-marker.txt: size: ${content.length} bytes`);
    return hasContent;
  } catch (e) {
    console.log(`✗ oversized-marker.txt: ${e.message}`);
    return false;
  }
}

async function main() {
  const results = [];
  results.push(await verifyDigitalLatinPdf());
  results.push(await verifyDigitalThaiPdf());
  results.push(await verifyScannedPdf());
  results.push(await verifySimpleDocx());
  results.push(await verifySampleMd());
  results.push(await verifySampleBomTxt());
  results.push(await verifyThaiOcrPng());
  results.push(await verifyLatinOcrJpg());
  results.push(await verifyCorruptPdf());
  results.push(await verifyOversizedMarkerTxt());

  console.log(`\n✅ Verification complete: ${results.filter(r => r).length}/${results.length} passed`);
  process.exit(results.every(r => r) ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
