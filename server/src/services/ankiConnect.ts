import http from 'http';
import fs from 'fs';
import path from 'path';
import { Flashcard } from '../types';

const ANKI_HOST = '127.0.0.1';
const ANKI_PORT = 6;

async function invoke(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action, version: 6, params });
    const req = http.request(
      { hostname: ANKI_HOST, port: ANKI_PORT, path: '/', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) reject(new Error(json.error));
            else resolve(json.result);
          } catch {
            reject(new Error('Invalid AnkiConnect response'));
          }
        });
      }
    );
    req.on('error', err => reject(new Error(`AnkiConnect unavailable: ${err.message}`)));
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('AnkiConnect timed out')); });
    req.write(body);
    req.end();
  });
}

export async function checkStatus(): Promise<{ available: boolean; version?: number }> {
  try {
    const version = await invoke('version') as number;
    return { available: true, version };
  } catch {
    return { available: false };
  }
}

export async function getDecks(): Promise<string[]> {
  return (await invoke('deckNames')) as string[];
}

export async function createDeck(deckName: string): Promise<void> {
  await invoke('createDeck', { deck: deckName });
}

// Store an image file in Anki's media collection. Returns the stored filename.
async function storeImage(imagePath: string): Promise<string> {
  const abs = path.resolve(imagePath);
  const data = fs.readFileSync(abs).toString('base64');
  const filename = `ankiforge_${path.basename(abs)}`;
  await invoke('storeMediaFile', { filename, data });
  return filename;
}

function buildBasicNote(card: Flashcard, deckName: string) {
  return {
    deckName,
    modelName: 'Basic',
    fields: { Front: card.front, Back: card.back },
    tags: card.tags,
    options: { allowDuplicate: false, duplicateScope: 'deck' },
  };
}

function buildClozeNote(card: Flashcard, deckName: string) {
  const text = card.clozeText || card.front;
  return {
    deckName,
    modelName: 'Cloze',
    fields: { Text: text, 'Back Extra': card.back },
    tags: card.tags,
    options: { allowDuplicate: false, duplicateScope: 'deck' },
  };
}

async function buildOcclusionNotes(card: Flashcard, deckName: string, uploadsDir: string) {
  if (!card.image || !card.occlusionMasks?.length) return [];

  // Store the image in Anki's media
  const imgPath = path.join(uploadsDir, path.basename(card.image));
  let ankiFilename: string;
  try {
    ankiFilename = await storeImage(imgPath);
  } catch {
    // Fall back to basic card if image can't be stored
    return [buildBasicNote(card, deckName)];
  }

  // One note per mask: front shows image with all masks as grey boxes except the tested one
  // Uses HTML + inline SVG to render the masked image
  return (card.occlusionMasks ?? []).map((mask, i) => {
    const allMasks = card.occlusionMasks ?? [];
    // Build SVG overlay — all masks shown as grey boxes; tested one is blue
    const rects = allMasks.map((m, mi) => {
      const isTarget = mi === i;
      const fill = isTarget ? 'rgb(100,150,255)' : 'rgb(180,180,180)';
      return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${fill}" rx="4"/>`;
    }).join('');

    const front = `<div style="position:relative;display:inline-block">
  <img src="${ankiFilename}" style="max-width:600px;display:block">
  <svg style="position:absolute;top:0;left:0;width:100%;height:100%" viewBox="0 0 ${card.occlusionMasks?.[0]?.x ?? 600} ${card.occlusionMasks?.[0]?.y ?? 400}" preserveAspectRatio="none">
    ${rects}
  </svg>
</div>
<p style="text-align:center;color:#888;font-size:12px">What is hidden by the blue box?</p>`;

    return {
      deckName,
      modelName: 'Basic',
      fields: { Front: front, Back: mask.answer },
      tags: [...card.tags, 'Image_Occlusion'],
      options: { allowDuplicate: false, duplicateScope: 'deck' },
    };
  });
}

export async function pushCards(
  cards: Flashcard[],
  deckName: string,
  uploadsDir: string
): Promise<{ added: number; skipped: number; errors: string[] }> {
  await createDeck(deckName);

  const notes: unknown[] = [];
  const errors: string[] = [];

  for (const card of cards) {
    try {
      if (card.cardType === 'basic') {
        notes.push(buildBasicNote(card, deckName));
      } else if (card.cardType === 'cloze') {
        notes.push(buildClozeNote(card, deckName));
      } else if (card.cardType === 'image_occlusion') {
        const ioNotes = await buildOcclusionNotes(card, deckName, uploadsDir);
        notes.push(...ioNotes);
      }
    } catch (err: any) {
      errors.push(`${card.front.slice(0, 40)}: ${err.message}`);
    }
  }

  if (notes.length === 0) return { added: 0, skipped: 0, errors };

  // canAddNotes to detect duplicates
  const canAdd = await invoke('canAddNotes', { notes }) as boolean[];
  const toAdd = notes.filter((_, i) => canAdd[i]);
  const skipped = notes.length - toAdd.length;

  if (toAdd.length > 0) {
    await invoke('addNotes', { notes: toAdd });
  }

  return { added: toAdd.length, skipped, errors };
}
