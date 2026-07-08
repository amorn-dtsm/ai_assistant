# Source Viewer E2E Test Runbook

## Prerequisites
- Node.js 18+
- Google Chrome installed at `C:\Program Files\Google\Chrome\Application\chrome.exe`
- AnythingLLM repo at `F:\Repository\anything-llm`

## 1. Start Servers

```powershell
# Terminal 1: API server
cd F:\Repository\anything-llm\server
node index.js

# Terminal 2: Vite dev server  
cd F:\Repository\anything-llm\frontend
npx vite --port 3000
```

Ensure `frontend/.env` has:
```
VITE_API_BASE='http://localhost:3001/api'
```

## 2. Seed Test Data

### Create workspace
Create workspace `qa-viewer` (id=4) via UI or API.

### Ingest documents
Place test documents (pdf, docx, md, txt, images) into collector hotdir and embed into workspace.

### Fix seed bug (chunk -> text mapping)
The vector DB returns `chunk` field but the frontend Citation component destructures `text`.

```powershell
cd F:\Repository\anything-llm\server
node -e "const { PrismaClient } = require('./node_modules/@prisma/client'); const p = new PrismaClient(); (async () => { const rows = await p.workspace_chats.findMany({ where: { workspaceId: 4 } }); let fixed = 0; for (const row of rows) { const resp = JSON.parse(row.response); if (!resp.sources || !resp.sources.length) continue; let changed = false; for (const src of resp.sources) { if ('chunk' in src && !('text' in src)) { src.text = src.chunk; delete src.chunk; changed = true; } } if (changed) { await p.workspace_chats.update({ where: { id: row.id }, data: { response: JSON.stringify(resp) } }); fixed++; } } console.log('Fixed:', fixed); await p['\u0024disconnect'](); })()"
```

## 3. Run E2E Tests

### Scenarios s01-s02 (per-format + cross-format)
```powershell
node .sisyphus/evidence/task-15/scripts/e2e-source-viewer.cjs
```

### Scenarios s03-s06 (thai, legacy, delete, leak)
```powershell
node .sisyphus/evidence/task-15/scripts/e2e-s03-s06.cjs
```

## 4. Expected Results

| Scenario | Expected |
|----------|----------|
| s01-pdf | PASS: highlight-overlay OR approximate match badge |
| s01-docx | PASS: CSS Custom Highlight API or mark fallback |
| s01-md | PASS: CSS Custom Highlight API or mark fallback |
| s01-txt | PASS: CSS Custom Highlight API or mark fallback |
| s01-image | PASS: source-image naturalWidth>0, overlay rects |
| s01-scanned-pdf | PASS: OCR overlays |
| s01-thai-pdf | PASS: highlight overlays |
| s01-thai-png | PASS: overlays or approximate match |
| s02-cross-format | PASS: exactly 1 source-viewer after each format |
| s03-thai-passrate | PASS: rate >= 90% |
| s04-legacy | PASS: view-source-btn count === 0 |
| s05-delete-while-open | PASS: source-viewer-error after deletion |
| s06-leak-smoke | PASS: memory delta < 50% (SKIP if no perf.memory) |

## 5. Artifacts

Screenshots saved to `.sisyphus/evidence/task-15/`:
- `{format}.png` for each format test
- `legacy.png`
- `delete-while-open.png`
- `thai-passrate.json`
- `e2e-report.json`

## 6. Cleanup

```powershell
# Kill servers
Get-NetTCPConnection -LocalPort 3000,3001 -State Listen | 
  Select-Object -ExpandProperty OwningProcess -Unique | 
  ForEach-Object { Stop-Process -Id $_ -Force }
```

## Notes

- The `chunk` vs `text` field mismatch is a known data seeding issue where the vector DB response uses `chunk` but the frontend `combineLikeSources()` (Citation/index.jsx line 119) destructures `text`.
- PDF viewer may show "approximate match" instead of highlight overlays when the PDF text extraction doesn't produce enough matching characters.
- Thai text matching uses flexFind + fuzzyFind cascade with NFKC normalization and Thai mark preservation.
- The delete-while-open test (s05) may show WARN if the ErrorBoundary doesn't trigger on fetch failure — the image viewer catches the error gracefully but doesn't always surface the error testid.
