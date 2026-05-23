import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

import uploadRouter from './routes/upload';
import jobsRouter from './routes/jobs';
import cardsRouter from './routes/cards';
import exportRouter from './routes/export';
import ankiRouter from './routes/anki';

const app = express();
const PORT = process.env.PORT || 3001;

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
});
