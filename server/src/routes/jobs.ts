import { Router, Request, Response } from 'express';
import { jobStore } from '../utils/jobStore';

const router = Router();

// GET /api/jobs/:jobId — poll job status
router.get('/:jobId', (req: Request, res: Response) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

export default router;
