import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { regenerateCard } from '../services/aiGenerator';
import { Flashcard } from '../types';

const router = Router();

// POST /api/cards/regenerate — regenerate a single card
router.post('/regenerate', async (req: Request, res: Response) => {
  const { front, back, context } = req.body;
  if (!front || !back) {
    res.status(400).json({ error: 'front and back are required' });
    return;
  }
  try {
    const improved = await regenerateCard(front, back, context || '');
    res.json(improved);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cards/new — create a blank card
router.post('/new', (req: Request, res: Response) => {
  const now = new Date().toISOString();
  const card: Flashcard = {
    id: uuidv4(),
    cardType: req.body.cardType || 'basic',
    front: req.body.front || '',
    back: req.body.back || '',
    clozeText: req.body.clozeText,
    tags: req.body.tags || [],
    source: req.body.source || { fileName: 'manual' },
    confidenceScore: 1.0,
    approvedForExport: true,
    createdAt: now,
    updatedAt: now,
  };
  res.json(card);
});

export default router;
