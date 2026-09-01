# AnkiForge — Project Context for AI Assistants

This file gives an AI assistant full context to continue development on AnkiForge without needing prior conversation history.

---

## What this app does

AnkiForge is a full-stack web app that lets a user upload study materials (PDFs, images, DOCX, TXT) and automatically generates Anki flashcards using LLMs. Cards can be previewed, edited, and exported as a `.apkg` file ready to import into Anki.

Three card types are supported:
- **Basic** — Q&A front/back
- **Cloze** — sentence with `{{c1::hidden}}` blanks (multi-blank supported)
- **Image Occlusion** — a diagram image with rectangular masks hiding labels

---

## How to run locally

```bash
# Install all dependencies
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..

# Add your Groq API key
cp server/.env.example server/.env
# edit server/.env and set GROQ_API_KEY=gsk_...

# Start both servers (frontend :5173, backend :3001)
npm run dev
# or: ./start.sh
```

Requires:
- Node.js ≥ 18
- Optional Python 3 with PyMuPDF for faster PDF processing: `pip3 install pymupdf`
- Without PyMuPDF, the bundled PDF.js engine preserves per-page extraction, label coordinates, and rendering
- A Groq API key (free at console.groq.com)

---

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 8 (Rolldown), Tailwind CSS 4, TypeScript |
| Backend | Node.js, Express, TypeScript, ts-node |
| State | Zustand |
| Routing | React Router v7 |
| AI — text cards | Free-plan Groq fallback pool: `openai/gpt-oss-20b`, `qwen/qwen3.6-27b`, `qwen/qwen3.8-27b`, `openai/gpt-oss-120b` |
| AI — vision/occlusion | Free-plan Groq fallback pool: `qwen/qwen3.6-27b`, `qwen/qwen3.8-27b` |
| PDF processing | PyMuPDF (`fitz`) when available; bundled PDF.js fallback |
| Anki export | `anki-apkg-export` npm package |
| File uploads | Multer |

---

## Project structure

```
AnkiForge/
├── client/src/
│   ├── api/index.ts              # All fetch calls to the backend
│   ├── store/useStore.ts         # Zustand store — holds all cards in memory
│   ├── types/index.ts            # Shared frontend types (Flashcard, OcclusionMask, etc.)
│   ├── pages/
│   │   ├── UploadPage.tsx        # File upload UI, job progress polling
│   │   ├── PreviewPage.tsx       # Card list + detail/edit panel (two-column layout)
│   │   └── ExportPage.tsx        # Approve cards, download .apkg
│   └── components/
│       ├── Layout.tsx            # App shell: header + nav + <main>
│       ├── CardBadge.tsx         # Coloured pill: Basic / Cloze / Image Occlusion
│       └── OcclusionEditorModal.tsx  # Drag-to-draw mask editor over a diagram image
│
├── server/src/
│   ├── index.ts                  # Express app entry; startup upload cleanup (24h TTL)
│   ├── routes/
│   │   ├── upload.ts             # POST /api/upload — file intake + background processing pipeline
│   │   ├── jobs.ts               # GET /api/jobs/:id — poll job status
│   │   ├── cards.ts              # CRUD for individual cards
│   │   ├── export.ts             # POST /api/export — builds .apkg
│   │   └── anki.ts               # AnkiConnect integration (optional desktop sync)
│   ├── services/
│   │   ├── aiGenerator.ts        # Groq card generation (text + vision) and occlusion detection
│   │   ├── extraction.ts         # PDF/image/DOCX/TXT text extraction
│   │   ├── pdfRenderer.ts        # PyMuPDF page rendering + word bounding box extraction
│   │   └── pdfJsFallback.ts      # Bundled per-page extraction, labels, and rendering
│   ├── middleware/upload.ts       # Multer config
│   ├── utils/jobStore.ts          # In-memory job status store
│   └── types/index.ts             # Server-side types
│
├── server/uploads/               # Runtime only — git-ignored. Holds uploaded files and rendered PNGs.
├── server/.env                   # Git-ignored. Must contain GROQ_API_KEY.
├── server/.env.example           # Committed template showing required vars.
├── .gitignore                    # Ignores node_modules, uploads/*, .env, dist/, .claude/
└── CLAUDE.md                     # This file
```

---

## Processing pipeline (the core logic)

When a file is uploaded, a background job runs through these steps per page:

```
extractFile()  →  per-page text via PyMuPDF (falls back to bundled PDF.js)
    │
    ├─ page text ≥ 1400 chars (text-heavy)?
    │     └─ generateCardsForPage()  →  chunked text → Groq → basic/cloze cards
    │
    └─ page text < 1400 chars (image-heavy / diagram / slide)?
          │
          ├─ Step 1: extractPageLabels()  →  PyMuPDF or PDF.js text bounding boxes
          │     found labels → renderPdfPage() → OcclusionMask[] → image_occlusion card
          │
          ├─ Step 2 (no labels): renderPdfPage() → detectOcclusionRegions() via vision LLM
          │     found regions → image_occlusion card
          │
          └─ Step 3 (no diagram): renderPdfPage() → generateCardsFromImage() via vision LLM
                → basic/cloze cards from visual read of table/chart/slide
```

After each file is fully processed, the original uploaded file is deleted. Rendered PNGs are kept for the current session (needed to display occlusion card images) and deleted on the next server startup.

---

## Key design decisions

**Embedded PDF text for label extraction (not vision)**
Vision models consistently placed masks over anatomical structures rather than their text labels. PyMuPDF is preferred when installed. If Python is missing, bundled PDF.js preserves page boundaries and produces text-label bounding boxes instead of collapsing the document through `pdf-parse`. Groups wider than 50% of the page or longer than 55 chars are filtered out (they're sentences, not labels).

**Free-model fallback and rate-limit waits**
The fallback pool advances on 429, transient model errors, and malformed/truncated JSON output. If every free model reports a short `retry-after`, the background job waits for the shortest reset and retries. Long resets are not waited out; completed cards remain saved. Do not add a paid-provider fallback.

**LOW_TEXT_THRESHOLD = 1400**
Pages below this character count get image-based processing. This covers anatomy slides (~700 chars of label text) and muscle origin/insertion tables (~1200 chars). Pages above get text-based card generation.

**No redundancy in card generation**
The system prompt enforces: no two cards may test the same fact. Small related facts (e.g. muscle origin + insertion + action) must be merged into one multi-blank cloze card rather than separate cards. The prompt targets 4–10 cards per 2200-char text chunk.

**In-memory card store**
Cards live in Zustand (browser memory) and are lost on page refresh. This is intentional for a local tool — no database needed. Export to .apkg is the persistence mechanism.

**Uploads cleanup**
- Original files deleted immediately after `extractFile()` completes
- All uploads older than 24h deleted on server startup (`cleanOldUploads()` in `index.ts`)

---

## Known limitations / things to improve

- Cards are lost on page refresh (no persistence layer). A future version could save to localStorage or IndexedDB.
- The occlusion mask preview in `PreviewPage.tsx` uses hardcoded 600×400 dimensions for the SVG overlay — it should use the actual image dimensions.
- `generateCardsFromImage` always sets `cardType: 'basic'` even when the response contains cloze format — this could be improved to detect and honour cloze cards from vision responses.
- No authentication — anyone who can reach the server can use it.
- AnkiConnect integration (direct push to Anki desktop) exists but is not prominently surfaced in the UI.

---

## GitHub

Repository: **https://github.com/jonathanli2513/AnkiForge** (private)

Standard commit workflow:
```bash
git add .
git commit -m "type: description"
git push
```

Commit types: `feat` (new feature), `fix` (bug), `refactor`, `chore` (deps/config/cleanup)

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | ✅ | Groq API key — get free at console.groq.com |
| `PORT` | ❌ | Backend port, defaults to 3001 |
