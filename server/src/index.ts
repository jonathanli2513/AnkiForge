import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

import uploadRouter from './routes/upload';
import jobsRouter from './routes/jobs';
import cardsRouter from './routes/cards';
import exportRouter from './routes/export';
import ankiRouter from './routes/anki';

const app = express();
const PORT = process.env.PORT || 3001;

// ── Startup cleanup ──────────────────────────────────────────────────────────
// Delete any files in uploads/ older than 24 hours (rendered PNGs, leftover
// originals from a previous session). Preserves .gitkeep.
function cleanOldUploads() {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) return;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 h ago
  let removed = 0;
  for (const file of fs.readdirSync(uploadsDir)) {
    if (file === '.gitkeep') continue;
    const filePath = path.join(uploadsDir, file);
    try {
      const { mtimeMs } = fs.statSync(filePath);
      if (mtimeMs < cutoff) { fs.unlinkSync(filePath); removed++; }
    } catch { /* ignore locked / already gone */ }
  }
  if (removed > 0) console.log(`🧹 Cleaned ${removed} stale file(s) from uploads/`);
}

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Serve uploaded files (for image preview)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/upload', uploadRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/export', exportRouter);
app.use('/api/anki', ankiRouter);

app.get('/api/health', (_req, res) => {
  const keyOk = !!process.env.GROQ_API_KEY;
  res.json({ status: 'ok', apiKeyConfigured: keyOk });
});

app.listen(PORT, () => {
  console.log(`AnkiForge server running on http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY) {
    console.warn('\n⚠️  GROQ_API_KEY is not set in server/.env');
    console.warn('   Cards cannot be generated until you add your key.');
    console.warn('   Get one free at: https://console.groq.com/keys\n');
  }
  cleanOldUploads();
});
