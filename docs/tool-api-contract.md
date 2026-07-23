# AI Tools External API Contract

This document specifies the assumed contract for external AI tool APIs (OCR, Searchable PDF, X-ray Analysis). This is the source of truth until real API specifications arrive.

## Overview

Three external APIs are called via a configurable adapter:
- **OCR**: Extract text from documents
- **Searchable PDF**: Convert scanned PDFs to searchable PDFs
- **X-ray Analysis**: Analyze X-ray images

All APIs use Bearer token authentication and follow consistent error handling patterns.

---

## Authentication

All endpoints require the following header:

```
Authorization: Bearer {API_KEY}
```

Where `{API_KEY}` is configured via environment variables:
- `OCR_API_KEY` for OCR endpoint
- `SEARCHABLE_PDF_API_KEY` for Searchable PDF endpoint
- `XRAY_API_KEY` for X-ray Analysis endpoint

Requests without this header receive HTTP 401 Unauthorized.

---

## Endpoints

### 1. OCR: `POST {OCR_API_BASE_URL}/ocr`

Extract text from documents (PDF, PNG, JPG, JPEG, TIFF).

**Request:**
- Content-Type: `multipart/form-data`
- Field: `file` (binary file upload)

**Success Response (HTTP 200):**
```json
{
  "ok": true,
  "text": "extracted text content",
  "pages": 1,
  "language": "tha+eng",
  "boxes": [
    {
      "page": 0,
      "x0": 10,
      "y0": 20,
      "x1": 100,
      "y1": 50,
      "text": "word"
    }
  ]
}
```

**Fields:**
- `ok` (boolean, required): Always `true` on success
- `text` (string, required): Full extracted text
- `pages` (number, required): Number of pages processed
- `language` (string, optional): Detected language(s), e.g., "tha+eng"
- `boxes` (array, optional): Bounding box coordinates for each word (capability unknown; may be omitted)

**Error Response (HTTP 4xx/5xx):**
```json
{
  "ok": false,
  "error": "error message"
}
```

---

### 2. Searchable PDF: `POST {SEARCHABLE_PDF_API_BASE_URL}/searchable-pdf`

Convert a scanned PDF to a searchable PDF with embedded text layer.

**Request:**
- Content-Type: `multipart/form-data`
- Field: `file` (binary PDF file)

**Success Response (HTTP 200):**
- Content-Type: `application/pdf`
- Body: Binary PDF file (searchable PDF)

**Error Response (HTTP 4xx/5xx):**
```json
{
  "ok": false,
  "error": "error message"
}
```

---

### 3. X-ray Analysis: `POST {XRAY_API_BASE_URL}/analyze`

Analyze X-ray images and return Thai customs tariff code predictions with confidence scores.

**Request:**
- Content-Type: `multipart/form-data`
- Field: `file` (binary image file: PNG, JPG, JPEG)

**Success Response (HTTP 200):**
```json
{
  "ok": true,
  "tariffCodes": [
    {
      "code": "8471.30.90",
      "description": "เครื่องประมวลผลข้อมูลอัตโนมัติแบบพกพา",
      "confidence": 0.87
    },
    {
      "code": "8517.13.00",
      "description": "โทรศัพท์สำหรับเครือข่ายเซลลูลาร์",
      "confidence": 0.10
    }
  ],
  "findings": "(optional prose description)"
}
```

**Fields:**
- `ok` (boolean, required): Always `true` on success
- `tariffCodes` (array, required): Predicted Thai customs tariff codes (HS codes) sorted by confidence descending
  - `code` (string): HS tariff code (e.g., "8471.30.90")
  - `description` (string, optional): Thai description of the tariff code
  - `confidence` (number): Confidence score (0.0 to 1.0)
- `findings` (string, optional): Additional prose findings or analysis notes

**Error Response (HTTP 4xx/5xx):**
```json
{
  "ok": false,
  "error": "error message"
}
```

---

## Error Handling

### HTTP Status Codes

- **200**: Success (JSON or binary response per endpoint)
- **400**: Bad Request (invalid file, unsupported format, etc.)
- **401**: Unauthorized (missing or invalid Bearer token)
- **404**: Not Found
- **500**: Internal Server Error
- **503**: Service Unavailable
- **504**: Gateway Timeout

### Error Response Shape (JSON endpoints)

All JSON error responses follow this shape:

```json
{
  "ok": false,
  "error": "human-readable error message"
}
```

### Timeout Behavior

External API calls have a 120-second timeout. If the upstream API does not respond within this window, the call is aborted and a `TIMEOUT` error is returned to the client.

---

## File Size Limits

Per-tool file size limits are enforced by the client adapter:

| Tool | Max Size | Allowed MIME Types |
|------|----------|-------------------|
| OCR | 50 MB | `application/pdf`, `image/png`, `image/jpeg`, `image/tiff` |
| Searchable PDF | 100 MB | `application/pdf` |
| X-ray Analysis | 25 MB | `image/png`, `image/jpeg` |

Files exceeding these limits are rejected with HTTP 413 Payload Too Large before reaching the external API.

---

## Persisted Tool Result Schema

When a tool is executed, the result is persisted to chat history as a `toolResult` JSON object. This schema is stored in the `workspace_chats.response` field.

### Tool Result Shape

```json
{
  "schemaVersion": 1,
  "type": "toolResult",
  "tool": "ocr|searchablePdf|xray",
  "status": "success|error",
  "sourceId": "uuid-v4-string",
  "filename": "original-filename.pdf",
  "_forLLM": "text visible to LLM (capped at 8000 chars)",
  "payload": {
    "text": "full extracted text (OCR only)",
    "pages": 1,
    "language": "tha+eng",
    "findings": "detailed findings (X-ray only)",
    "labels": [
      {
        "name": "label-name",
        "confidence": 0.87
      }
    ]
  },
  "error": {
    "code": "TIMEOUT|UPSTREAM_5XX|UPSTREAM_4XX|INVALID_FILE|NOT_CONFIGURED",
    "message": "error message"
  }
}
```

### Field Descriptions

- **schemaVersion** (number): Always `1` for this version; used for forward compatibility
- **type** (string): Always `"toolResult"` to distinguish from other message types
- **tool** (string): Tool identifier: `"ocr"`, `"searchablePdf"`, or `"xray"`
- **status** (string): `"success"` if the tool executed successfully; `"error"` if it failed
- **sourceId** (string): UUID v4 identifier for this tool execution; used to link downloads and track the original file
- **filename** (string): Original filename of the uploaded file (sanitized)
- **_forLLM** (string): Text content visible to the LLM when replaying history
  - For OCR: Full extracted text, capped at 8000 characters with `\n[truncated]` suffix if capped
  - For Searchable PDF: `"[สร้าง Searchable PDF จาก {filename} สำเร็จ]"` (Thai: "Created Searchable PDF from {filename} successfully")
  - For X-ray: Full findings text
  - For errors: `"[{tool} ของไฟล์ {filename} ล้มเหลว]"` (Thai: "{tool} of file {filename} failed")
- **payload** (object): Tool-specific result data
  - **OCR payload**: `{ text, pages, language }`
  - **Searchable PDF payload**: `{}` (empty; binary is stored separately)
  - **X-ray payload**: `{ tariffCodes, findings }`
- **error** (object, optional): Present only when `status === "error"`
  - **code** (string): Error code from `ERROR_CODES` enum
  - **message** (string): Safe error message (no sensitive data)

### LLM Safety Boundary

The `_forLLM` field is the ONLY content visible to the LLM when chat history is replayed. All other fields (`sourceId`, `schemaVersion`, `payload`, `error`) are stripped before any LLM request. This ensures:
- No accidental exposure of internal IDs or schema details
- Consistent behavior across all LLM providers
- Clear audit trail of what the LLM sees

---

## Configuration

### Environment Variables

```bash
# OCR
OCR_API_BASE_URL=https://api.example.com/v1
OCR_API_KEY=sk-ocr-key-here

# Searchable PDF
SEARCHABLE_PDF_API_BASE_URL=https://api.example.com/v1
SEARCHABLE_PDF_API_KEY=sk-pdf-key-here

# X-ray Analysis
XRAY_API_BASE_URL=https://api.example.com/v1
XRAY_API_KEY=sk-xray-key-here
```

If a base URL is not set, the tool is disabled and hidden from the UI. This acts as a kill switch for tools that are not yet configured.

---

## Version History

- **v2** (current): X-ray response updated to tariff codes
  - X-ray /analyze now returns `tariffCodes[]` (code, description?, confidence) instead of `labels[]`
  - Tariff codes are Thai customs HS codes (พิกัดศุลกากร)
  - Codes sorted by confidence descending
  - Optional `findings` field for additional prose
  - Note: This is the assumed contract until real API spec arrives
- **v1**: Initial contract specification
  - 3 tools: OCR, Searchable PDF, X-ray Analysis
  - Bearer token authentication
  - Consistent error shape
  - Persisted toolResult schema with LLM safety boundary
