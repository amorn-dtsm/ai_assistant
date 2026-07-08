#!/usr/bin/env node
/**
 * Verify Thai PDF text extraction using collector's pdf.js
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require2 = createRequire(new URL('../../collector/package.json', import.meta.url));
const pdfParse = require2('pdf-parse');

const ANCHOR_THAI = 'การทดสอบระบบค้นหาข้อความภาษาไทย';
const ANCHOR_LATIN = 'The quick brown fox anchors here.';

async function verifyThaiPdf() {
  const filename = join(__dirname, 'digital-thai.pdf');
  
  try {
    const data = readFileSync(filename);
    const result = await pdfParse(data);
    
    const text = result.text;
    const hasThai = /[\u0E00-\u0E7F]/.test(text); // Thai Unicode range
    const hasThaiAnchor = text.includes(ANCHOR_THAI);
    const hasLatinAnchor = text.includes(ANCHOR_LATIN);
    
    console.log('Thai PDF Verification Results:');
    console.log('==============================');
    console.log(`File: digital-thai.pdf`);
    console.log(`Size: ${data.length} bytes`);
    console.log(`Pages: ${result.numpages}`);
    console.log(`Text length: ${text.length} characters`);
    console.log(`Has Thai codepoints: ${hasThai ? '✓ YES' : '✗ NO'}`);
    console.log(`Has Thai anchor: ${hasThaiAnchor ? '✓ YES' : '✗ NO'}`);
    console.log(`Has Latin anchor: ${hasLatinAnchor ? '✓ YES' : '✗ NO'}`);
    console.log(`\nExtracted text preview:`);
    console.log(text.substring(0, 200));
    
    // Return verification object
    const verification = {
      anyThai: hasThai,
      hasThaiAnchor: hasThaiAnchor,
      hasLatinAnchor: hasLatinAnchor,
      textLength: text.length,
      pages: result.numpages,
      fileSize: data.length,
      success: hasThai && hasThaiAnchor
    };
    
    console.log(`\nVerification JSON:`);
    console.log(JSON.stringify(verification, null, 2));
    
    process.exit(verification.success ? 0 : 1);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

verifyThaiPdf();
