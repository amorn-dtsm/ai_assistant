#!/usr/bin/env node
/**
 * Fixture generator for AI Tools QA
 * Generates: sample-ocr.pdf, sample-scanned.pdf, sample-xray.jpg, bad-type.exe
 * Run from server dir: node ../tests/fixtures/ai-tools/generate.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, rgb } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const FIXTURE_DIR = path.dirname(__filename);
const MARKER = 'XIID-FIXTURE-MARKER-7742';

async function generateOcrPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { height } = page.getSize();

  // Add Thai text and marker
  const fontSize = 12;
  page.drawText('ใบกำกับสินค้า', {
    x: 50,
    y: height - 50,
    size: fontSize,
    color: rgb(0, 0, 0),
  });

  page.drawText(MARKER, {
    x: 50,
    y: height - 100,
    size: fontSize,
    color: rgb(0, 0, 0),
  });

  page.drawText('พิกัดศุลกากร: 8471.30.90', {
    x: 50,
    y: height - 150,
    size: fontSize,
    color: rgb(0, 0, 0),
  });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(path.join(FIXTURE_DIR, 'sample-ocr.pdf'), pdfBytes);
  console.log(`✓ sample-ocr.pdf (${pdfBytes.length} bytes)`);
}

async function generateScannedPdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const { height } = page.getSize();

  page.drawText('Sample Scanned Document', {
    x: 50,
    y: height - 50,
    size: 12,
    color: rgb(0, 0, 0),
  });

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(path.join(FIXTURE_DIR, 'sample-scanned.pdf'), pdfBytes);
  console.log(`✓ sample-scanned.pdf (${pdfBytes.length} bytes)`);
}

async function generateXrayJpeg() {
  // Minimal valid JPEG: FFD8 (SOI) + FFD9 (EOI) with minimal structure
  const jpegBytes = Buffer.from([
    0xFF, 0xD8, // SOI
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0 (JFIF)
    0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, // DQT
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, // SOF0
    0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, // DHT
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xFF, 0xD9, // SOS + EOI
  ]);

  fs.writeFileSync(path.join(FIXTURE_DIR, 'sample-xray.jpg'), jpegBytes);
  console.log(`✓ sample-xray.jpg (${jpegBytes.length} bytes)`);
}

function generateBadTypeExe() {
  // 64 bytes starting with MZ (PE executable header)
  const exeBytes = Buffer.alloc(64);
  exeBytes[0] = 0x4D; // 'M'
  exeBytes[1] = 0x5A; // 'Z'
  fs.writeFileSync(path.join(FIXTURE_DIR, 'bad-type.exe'), exeBytes);
  console.log(`✓ bad-type.exe (${exeBytes.length} bytes)`);
}

async function main() {
  try {
    console.log('Generating AI Tools fixtures...');
    await generateOcrPdf();
    await generateScannedPdf();
    await generateXrayJpeg();
    generateBadTypeExe();
    console.log('\n✓ All fixtures generated successfully');
  } catch (err) {
    console.error('Error generating fixtures:', err);
    process.exit(1);
  }
}

main();
