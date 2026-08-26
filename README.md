# AnkiForge

> AI-powered flashcard generator — upload study materials and get export-ready Anki decks in seconds.

AnkiForge processes PDFs, images, Word documents, and text files, then uses large language models to produce high-quality, non-redundant flashcards (basic Q&A, multi-blank cloze, and image-occlusion).

---

## Features

- **Smart card generation** — GPT-OSS 120B synthesises facts into dense, multi-blank cloze cards; no trivial or duplicate cards
- **Image occlusion** — anatomy diagrams are automatically detected; text labels are extracted with pixel-perfect bounding boxes (PyMuPDF) and turned into occlusion masks
- **Vision fallback** — pages without embedded text (tables, charts, slides) are read by a multimodal LLM (Qwen 3.6 27B)
- **Per-page extraction** — PyMuPDF extracts text page-by-page, preserving reading order
- **Preview & Edit** — review every card before export; edit, regenerate, duplicate, or delete
- **Anki export** — downloads a `.apkg` deck ready to import into Anki

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 · Vite 8 · Tailwind CSS 4 · TypeScript |
| Backend | Node.js · Express · TypeScript · ts-node |
| AI | Groq SDK — `openai/gpt-oss-120b` (text) · `qwen/qwen3.6-27b` (vision) |
| PDF processing | PyMuPDF (`fitz`) via Python subprocess |
| Anki export | `anki-apkg-export` |

---

## Prerequisites

- **Node.js** ≥ 18
- **Python 3** with PyMuPDF installed:
  ```bash
  pip3 install pymupdf
  ```
- A **Groq API key** (free tier available at [console.groq.com](https://console.groq.com))

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/<your-username>/AnkiForge.git
cd AnkiForge
```

### 2. Install dependencies

```bash
npm install          # root workspace deps
cd client && npm install
cd ../server && npm install
```

### 3. Configure environment variables

```bash
cp server/.env.example server/.env
```

Open `server/.env` and fill in:

```
GROQ_API_KEY=gsk_...   # your Groq API key
GROQ_TEXT_MODEL=openai/gpt-oss-120b
GROQ_VISION_MODEL=qwen/qwen3.6-27b
PORT=3001
```

### 4. Run the app

```bash
# From the project root — starts both servers concurrently
npm run dev
```

Or use the helper script:

```bash
./start.sh
```

The app will be available at **http://localhost:5173**

---

## Project Structure

```
AnkiForge/
├── client/                  # React + Vite frontend
│   ├── src/
│   │   ├── components/      # Reusable UI components
│   │   ├── pages/           # Route-level pages (Upload, Preview, Export)
│   │   ├── store/           # Zustand global state
│   │   ├── api.ts           # API client
│   │   └── types/           # Shared TypeScript types
│   └── vite.config.ts
│
├── server/                  # Express backend
│   ├── src/
│   │   ├── routes/          # API route handlers
│   │   ├── services/        # Core logic
│   │   │   ├── aiGenerator.ts   # Groq card generation & occlusion detection
│   │   │   ├── extraction.ts    # PDF/image/docx text extraction
│   │   │   └── pdfRenderer.ts   # PyMuPDF page rendering & label extraction
│   │   ├── middleware/      # Multer file upload middleware
│   │   ├── utils/           # Job store, helpers
│   │   └── types/           # Server-side types
│   ├── uploads/             # Runtime upload directory (git-ignored)
│   └── .env.example
│
├── package.json             # Root scripts
└── start.sh                 # Dev launcher
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | ✅ | Groq API key for LLM inference |
| `GROQ_TEXT_MODEL` | ❌ | Text-generation model (default: `openai/gpt-oss-120b`) |
| `GROQ_VISION_MODEL` | ❌ | Image-understanding model (default: `qwen/qwen3.6-27b`) |
| `PORT` | ❌ | Server port (default: `3001`) |

---

## Version History

### v1.0.1 — Groq model migration
- Replaced retired Llama text and vision models with supported Groq models
- Added optional environment overrides for future model changes

### v1.0.0 — Initial release
- PDF, image, DOCX, and text file support
- Basic, cloze, and image-occlusion card types
- PyMuPDF per-page extraction with exact label bounding boxes
- Vision-based fallback for diagram-heavy pages
- Preview & Edit interface with Anki export

---

## License

Private — all rights reserved.
