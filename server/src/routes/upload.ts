import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { upload } from '../middleware/upload';
import { jobStore } from '../utils/jobStore';
import { extractFile } from '../services/extraction';
import { generateCardsForPage, generateCardsFromImage, detectOcclusionRegions } from '../services/aiGenerator';
import { renderPdfPage, extractPageLabels, getImageDimensions } from '../services/pdfRenderer';
import type { Flashcard, OcclusionMask } from '../types/index';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

const router = Router();

// Pages with fewer characters than this get vision-based processing (diagrams, tables, slides).
// Set high enough to cover label-dense anatomy slides (~700 chars) and structured tables (~1200 chars).
const LOW_TEXT_THRESHOLD = 1400;

// POST /api/upload/image — store one image, return its server URL (for occlusion editor)
router.post('/image', upload.single('image'), (req: Request, res: Response) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: 'No image uploaded' }); return; }
  res.json({ url: `/uploads/${file.filename}`, fileName: file.filename });
});

// POST /api/upload/auto-occlude — detect occlusion regions for an existing image
// Accepts either: { imagePath: '/absolute/path' } or { imageUrl: '/uploads/foo.png' }
router.post('/auto-occlude', async (req: Request, res: Response) => {
  let { imagePath, imageUrl } = req.body as { imagePath?: string; imageUrl?: string };

  if (!imagePath && imageUrl) {
    // Map /uploads/foo.png → absolute filesystem path
    const filename = path.basename(imageUrl);
    imagePath = path.join(UPLOADS_DIR, filename);
  }

  if (!imagePath) { res.status(400).json({ error: 'imagePath or imageUrl required' }); return; }

  try {
    const dims = await getImageDimensions(imagePath);
    const regions = await detectOcclusionRegions(imagePath);
    const masks: OcclusionMask[] = regions.map(r => ({
      id: uuidv4(),
      x: Math.round((r.x / 100) * dims.width),
      y: Math.round((r.y / 100) * dims.height),
      width: Math.max(10, Math.round((r.width / 100) * dims.width)),
      height: Math.max(10, Math.round((r.height / 100) * dims.height)),
      answer: r.label,
    }));
    res.json({ masks, imageWidth: dims.width, imageHeight: dims.height });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload — accepts files, starts background job
router.post('/', upload.array('files', 20), (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const jobId = uuidv4();
  const fileNames = files.map(f => f.originalname);
  jobStore.create(jobId, fileNames);

  // Run processing in background (no await)
  processFiles(jobId, files).catch(err => {
    jobStore.update(jobId, { status: 'error', error: err.message });
  });

  res.json({ jobId, files: fileNames });
});

async function buildOcclusionCard(
  imagePath: string,
  imageUrl: string,
  source: { fileName: string; pageNumber?: number },
  baseTags: string[]
): Promise<Flashcard | null> {
  try {
    const dims = await getImageDimensions(imagePath);
    const regions = await detectOcclusionRegions(imagePath);
    if (regions.length === 0) return null;

    const masks: OcclusionMask[] = regions.map(r => ({
      id: uuidv4(),
      x: Math.round((r.x / 100) * dims.width),
      y: Math.round((r.y / 100) * dims.height),
      width: Math.max(10, Math.round((r.width / 100) * dims.width)),
      height: Math.max(10, Math.round((r.height / 100) * dims.height)),
      answer: r.label,
    }));

    const now = new Date().toISOString();
    const labels = masks.map(m => m.answer).join(', ');
    return {
      id: uuidv4(),
      cardType: 'image_occlusion',
      front: `Identify the labeled parts: ${labels}`,
      back: labels,
      image: imageUrl,
      occlusionMasks: masks,
      tags: [...new Set(baseTags)],
      source,
      confidenceScore: 0.85,
      approvedForExport: true,
      createdAt: now,
      updatedAt: now,
    };
  } catch {
    return null;
  }
}

async function processFiles(jobId: string, files: Express.Multer.File[]) {
  const allCards: Flashcard[] = [];
  const generationErrors: string[] = [];
  const totalFiles = files.length;

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const ext = path.extname(file.originalname).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
    const isPdf = ext === '.pdf';
    const baseProgress = Math.round((fi / totalFiles) * 80);
    const baseName = path.basename(file.originalname, path.extname(file.originalname));
    const extraTags = [baseName.replace(/[^a-zA-Z0-9]/g, '_')];
    const baseTags = [baseName.replace(/[^a-zA-Z0-9]/g, '_')];

    jobStore.update(jobId, {
      status: 'extracting',
      progress: baseProgress,
      message: `Extracting text from ${file.originalname}…`,
    });

    let processed;
    try {
      processed = await extractFile(file.path);
    } catch (err: any) {
      jobStore.update(jobId, {
        status: 'error',
        error: `Failed to extract ${file.originalname}: ${err.message}`,
      });
      return;
    }

    const totalPages = processed.pages.length;

    // For image files: run occlusion detection on the uploaded image directly
    if (isImage) {
      jobStore.update(jobId, {
        status: 'detecting',
        progress: baseProgress + 5,
        message: `Auto-detecting diagram regions in ${file.originalname}…`,
      });
      const imageUrl = `/uploads/${path.basename(file.path)}`;
      const occCard = await buildOcclusionCard(file.path, imageUrl, { fileName: file.originalname, pageNumber: 1 }, baseTags);
      if (occCard) allCards.push(occCard);
    }

    jobStore.update(jobId, {
      status: 'generating',
      progress: baseProgress + 10,
      message: `Generating flashcards from ${file.originalname}…`,
    });

    for (let pi = 0; pi < totalPages; pi++) {
      const page = processed.pages[pi];
      const pageProgress = baseProgress + 10 + Math.round((pi / totalPages) * (65 / totalFiles));

      jobStore.update(jobId, {
        progress: pageProgress,
        message: `Generating cards: ${file.originalname} page ${pi + 1}/${totalPages}`,
      });

      const textLen = page.text.trim().length;
      const isImageHeavyPage = isPdf && textLen < LOW_TEXT_THRESHOLD;

      // Strategy per page:
      // 1. Image-heavy pages → try occlusion first (labeled diagrams).
      //    If occlusion succeeds, skip vision cards (same content).
      //    If occlusion finds nothing, fall back to vision cards (tables, unlabeled images).
      // 2. Text cards are generated when the page has substantive prose (≥ 500 chars) AND
      //    is not already fully covered by an occlusion card with only sparse label text.
      let pageHasOcclusionCard = false;
      if (isImageHeavyPage) {
        try {
          jobStore.update(jobId, {
            progress: pageProgress,
            message: `Processing diagram/table on page ${pi + 1}…`,
          });

          // Step 1: try to extract text label positions directly from PDF (exact, no vision needed)
          const pdfLabels = await extractPageLabels(file.path, pi);

          if (pdfLabels.length > 0) {
            // Use PyMuPDF's exact label coordinates — covers the actual text on the diagram
            const rendered = await renderPdfPage(file.path, pi);
            const dims = await getImageDimensions(rendered.imagePath);
            const masks: OcclusionMask[] = pdfLabels.map(r => ({
              id: uuidv4(),
              x: Math.round((r.x / 100) * dims.width),
              y: Math.round((r.y / 100) * dims.height),
              width: Math.max(10, Math.round((r.width / 100) * dims.width)),
              height: Math.max(10, Math.round((r.height / 100) * dims.height)),
              answer: r.label,
            }));
            const now = new Date().toISOString();
            const labels = masks.map(m => m.answer).join(', ');
            const occCard: Flashcard = {
              id: uuidv4(),
              cardType: 'image_occlusion',
              front: `Identify the labeled parts: ${labels}`,
              back: labels,
              image: rendered.imageUrl,
              occlusionMasks: masks,
              tags: [...new Set(baseTags)],
              source: { fileName: file.originalname, pageNumber: page.pageNumber },
              confidenceScore: 0.95,
              approvedForExport: true,
              createdAt: now,
              updatedAt: now,
            };
            allCards.push(occCard);
            pageHasOcclusionCard = true;
          } else {
            // Step 2: no embedded text — render and try vision-based occlusion (unlabeled diagrams)
            const rendered = await renderPdfPage(file.path, pi);
            const occCard = await buildOcclusionCard(
              rendered.imagePath,
              rendered.imageUrl,
              { fileName: file.originalname, pageNumber: page.pageNumber },
              baseTags
            );
            if (occCard) {
              allCards.push(occCard);
              pageHasOcclusionCard = true;
            } else {
              // Step 3: no diagram at all — use vision to read tables, charts, text-heavy slides
              const visionCards = await generateCardsFromImage(
                rendered.imagePath,
                { fileName: file.originalname, pageNumber: page.pageNumber },
                baseTags
              );
              allCards.push(...visionCards);
            }
          }
        } catch {
          // Non-fatal
        }
      }

      // Text cards: generate when the page has substantive prose content.
      // Skip when: (a) an occlusion card already covers the diagram labels and text is sparse
      // (just those labels, < 500 chars), or (b) vision cards just handled the content.
      const hasSubstantiveText = textLen >= 500;
      const shouldGenerateTextCards = !isImageHeavyPage || (pageHasOcclusionCard && hasSubstantiveText);
      if (shouldGenerateTextCards) {
        try {
          const cards = await generateCardsForPage(
            page,
            { fileName: file.originalname, pageNumber: page.pageNumber, sectionTitle: page.sectionTitle },
            extraTags
          );
          allCards.push(...cards);
        } catch (err: any) {
          generationErrors.push(err.message ?? 'Unknown error');
        }
      }
    }
  }

  if (allCards.length === 0 && generationErrors.length > 0) {
    const firstError = generationErrors[0];
    const isAuthError = firstError.includes('API key') || firstError.includes('401') || firstError.includes('auth');
    jobStore.update(jobId, {
      status: 'error',
      error: isAuthError
        ? 'AI generation failed: invalid or missing GROQ_API_KEY in server/.env. Add your key and restart the server.'
        : `AI generation failed: ${firstError}`,
    });
    return;
  }

  jobStore.update(jobId, {
    status: 'complete',
    progress: 100,
    message: `Generated ${allCards.length} flashcard${allCards.length !== 1 ? 's' : ''}`,
    cards: allCards,
  });
}

export default router;
