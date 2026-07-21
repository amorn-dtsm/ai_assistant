#!/usr/bin/env node

/**
 * Mock External AI Tools API Server
 * 
 * Standalone Express server for development/QA that mimics the external API contract.
 * Imports contract.js to ensure responses match the spec by construction.
 * 
 * Usage: node server/scripts/mock-ai-tools-api.js
 * Port: 3123 (env MOCK_AI_TOOLS_PORT override)
 * 
 * Modes:
 * - ?mode=error OR MOCK_MODE=error → HTTP 500 on tool endpoints
 * - ?mode=slow OR MOCK_MODE=slow → 5s delay then normal response
 * 
 * LLM Recorder:
 * - POST /v1/chat/completions → appends request body to server/storage/mock-llm-requests.jsonl
 * - DELETE /v1/records → truncates the jsonl file
 */

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { ENDPOINTS, TOOLS } = require('../utils/aiTools/contract.js');

const app = express();
const port = parseInt(process.env.MOCK_AI_TOOLS_PORT || '3123', 10);
const mockMode = process.env.MOCK_MODE || null;

// Middleware
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// Paths
const storageDir = path.join(__dirname, '..', 'storage');
const recordsFile = path.join(storageDir, 'mock-llm-requests.jsonl');

// Ensure storage directory exists
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

/**
 * Auth middleware: reject requests without Authorization: Bearer header
 */
function requireAuth(req, res, next) {
  const authHeader = req.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Missing or invalid Authorization header' });
  }
  next();
}

/**
 * Mode check: return error or delay based on query param or env
 */
function checkMode(req) {
  const queryMode = req.query.mode;
  const mode = queryMode || mockMode;
  return mode;
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

/**
 * POST /ocr
 * Returns deterministic OCR response with fixture marker
 */
app.post('/ocr', requireAuth, upload.single('file'), async (req, res) => {
  const mode = checkMode(req);
  
  if (mode === 'error') {
    return res.status(500).json({ ok: false, error: 'mock upstream failure' });
  }
  
  if (mode === 'slow') {
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  res.json({
    ok: true,
    text: 'ใบกำกับสินค้า เลขที่ INV-2026-0421\nXIID-FIXTURE-MARKER-7742\nพิกัดศุลกากร: 8471.30.90',
    pages: 1,
    language: 'tha+eng'
  });
});

/**
 * POST /searchable-pdf
 * Returns a valid PDF binary (read from fixture)
 */
app.post('/searchable-pdf', requireAuth, upload.single('file'), async (req, res) => {
  const mode = checkMode(req);
  
  if (mode === 'error') {
    return res.status(500).json({ ok: false, error: 'mock upstream failure' });
  }
  
  if (mode === 'slow') {
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  try {
    const pdfPath = path.join(__dirname, '..', '..', 'tests', 'fixtures', 'ai-tools', 'sample-scanned.pdf');
    const pdfBuffer = fs.readFileSync(pdfPath);
    res.set('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error reading PDF fixture:', err);
    res.status(500).json({ ok: false, error: 'Failed to read PDF fixture' });
  }
});

/**
 * POST /analyze
 * Returns deterministic X-ray analysis response
 */
app.post('/analyze', requireAuth, upload.single('file'), async (req, res) => {
  const mode = checkMode(req);
  
  if (mode === 'error') {
    return res.status(500).json({ ok: false, error: 'mock upstream failure' });
  }
  
  if (mode === 'slow') {
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  res.json({
    ok: true,
    findings: 'พบวัตถุต้องสงสัยลักษณะทึบรังสีบริเวณมุมล่างซ้าย (mock)',
    labels: [
      { name: 'suspicious-object', confidence: 0.87 }
    ]
  });
});

/**
 * POST /v1/chat/completions
 * OpenAI-compatible endpoint that records requests and returns a mock completion
 * Supports both streaming and non-streaming modes
 */
app.post('/v1/chat/completions', express.json(), (req, res) => {
  try {
    // Append full request body to jsonl file
    const requestLine = JSON.stringify(req.body) + '\n';
    fs.appendFileSync(recordsFile, requestLine, 'utf8');
    
    // Check if streaming is requested
    const isStreaming = req.body.stream === true;
    
    if (isStreaming) {
      // Return minimal valid SSE response
      res.set('Content-Type', 'text/event-stream');
      res.set('Cache-Control', 'no-cache');
      res.set('Connection', 'keep-alive');
      
      // Send a single choice with mock reply
      res.write('data: ' + JSON.stringify({
        id: 'mock-' + Date.now(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: req.body.model || 'mock',
        choices: [
          {
            index: 0,
            delta: { content: 'mock reply' },
            finish_reason: null
          }
        ]
      }) + '\n\n');
      
      // Send finish marker
      res.write('data: ' + JSON.stringify({
        id: 'mock-' + Date.now(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: req.body.model || 'mock',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }
        ]
      }) + '\n\n');
      
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // Return non-streaming completion
      res.json({
        id: 'mock-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: req.body.model || 'mock',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'mock reply'
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12
        }
      });
    }
  } catch (err) {
    console.error('Error in /v1/chat/completions:', err);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

/**
 * DELETE /v1/records
 * Truncate the LLM requests log file
 */
app.delete('/v1/records', (req, res) => {
  try {
    fs.writeFileSync(recordsFile, '', 'utf8');
    res.json({ ok: true, message: 'Records truncated' });
  } catch (err) {
    console.error('Error truncating records:', err);
    res.status(500).json({ ok: false, error: 'Failed to truncate records' });
  }
});

/**
 * Start server
 */
app.listen(port, () => {
  console.log(`Mock AI Tools API server running on port ${port}`);
  console.log(`Mode: ${mockMode || 'normal'}`);
  console.log(`Health: http://localhost:${port}/health`);
  console.log(`OCR: POST http://localhost:${port}${ENDPOINTS[TOOLS.OCR]}`);
  console.log(`Searchable PDF: POST http://localhost:${port}${ENDPOINTS[TOOLS.SEARCHABLE_PDF]}`);
  console.log(`X-ray: POST http://localhost:${port}${ENDPOINTS[TOOLS.XRAY]}`);
  console.log(`LLM Recorder: POST http://localhost:${port}/v1/chat/completions`);
  console.log(`Records file: ${recordsFile}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down mock server...');
  process.exit(0);
});
