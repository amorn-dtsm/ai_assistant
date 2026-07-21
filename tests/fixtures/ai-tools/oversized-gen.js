#!/usr/bin/env node
/**
 * Oversized file generator for QA edge-case testing
 * Generates a >100MB file to test upload size limits
 * Run: node tests/fixtures/ai-tools/oversized-gen.js
 * Output: OS temp directory (not committed to git)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const SIZE_BYTES = 120 * 1024 * 1024; // 120MB
const TEMP_DIR = os.tmpdir();
const OUTPUT_PATH = path.join(TEMP_DIR, 'oversized.bin');

async function generateOversizedFile() {
  try {
    console.log(`Generating ${SIZE_BYTES / (1024 * 1024)}MB file at ${OUTPUT_PATH}...`);
    
    const stream = fs.createWriteStream(OUTPUT_PATH);
    const chunkSize = 1024 * 1024; // 1MB chunks
    let written = 0;

    return new Promise((resolve, reject) => {
      const writeChunk = () => {
        if (written >= SIZE_BYTES) {
          stream.end();
          return;
        }

        const remaining = SIZE_BYTES - written;
        const toWrite = Math.min(chunkSize, remaining);
        const chunk = Buffer.alloc(toWrite, 0);

        if (!stream.write(chunk)) {
          stream.once('drain', writeChunk);
        } else {
          written += toWrite;
          setImmediate(writeChunk);
        }
      };

      stream.on('finish', () => {
        const stats = fs.statSync(OUTPUT_PATH);
        console.log(`✓ Generated ${stats.size} bytes at ${OUTPUT_PATH}`);
        resolve();
      });

      stream.on('error', reject);
      writeChunk();
    });
  } catch (err) {
    console.error('Error generating oversized file:', err);
    process.exit(1);
  }
}

generateOversizedFile();
