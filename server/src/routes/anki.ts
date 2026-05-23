import { Router, Request, Response } from 'express';
import path from 'path';
import { checkStatus, getDecks, pushCards } from '../services/ankiConnect';
import { UPLOAD_DIR } from '../middleware/upload';
import { Flashcard } from '../types';

const router = Router();

router.get('/status', async (_req: Request, res: Response) => {
  const status = await checkStatus();
  res.json(status);
});

router.get('/decks', async (_req: Request, res: Response) => {
  try {
    const decks = await getDecks();
    res.json({ decks });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/push', async (req: Request, res: Response) => {
  const { cards, deckName } = req.body as { cards: Flashcard[]; deckName: string };
  if (!cards || !Array.isArray(cards)) {
    res.status(400).json({ error: 'cards array required' });
    return;
  }
  try {
    const result = await pushCards(
      cards.filter(c => c.approvedForExport !== false),
      deckName || 'AnkiForge',
      UPLOAD_DIR
    );
    res.json(result);
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

export default router;
