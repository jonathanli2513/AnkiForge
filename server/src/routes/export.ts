import { Router, Request, Response } from 'express';
import { exportToCsv, exportToApkg } from '../services/exportService';
import { Flashcard } from '../types';

const router = Router();

// POST /api/export/csv
router.post('/csv', (req: Request, res: Response) => {
  const { cards, deckName } = req.body as { cards: Flashcard[]; deckName: string };
  if (!cards || !Array.isArray(cards)) {
    res.status(400).json({ error: 'cards array required' });
    return;
  }

  const approved = cards.filter(c => c.approvedForExport !== false);
  const csv = exportToCsv(approved);
  const filename = (deckName || 'AnkiForge').replace(/[^a-zA-Z0-9_\- ]/g, '_');

  res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.tsv"`);
  res.send(csv);
});

// POST /api/export/apkg
router.post('/apkg', async (req: Request, res: Response) => {
  const { cards, deckName } = req.body as { cards: Flashcard[]; deckName: string };
  if (!cards || !Array.isArray(cards)) {
    res.status(400).json({ error: 'cards array required' });
    return;
  }

  const approved = cards.filter(c => c.approvedForExport !== false);
  const filename = (deckName || 'AnkiForge').replace(/[^a-zA-Z0-9_\- ]/g, '_');

  try {
    const buffer = await exportToApkg(approved, deckName || 'AnkiForge');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.apkg.zip"`);
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
