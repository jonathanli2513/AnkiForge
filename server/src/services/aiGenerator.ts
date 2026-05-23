import Groq from 'groq-sdk';
import fs from 'fs';
import type { Flashcard, ProcessedPage, CardSource } from '../types/index';
import { v4 as uuidv4 } from 'uuid';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

const CHUNK_SIZE = 2200;
const CHUNK_OVERLAP = 300;

const SYSTEM_PROMPT = `You are an expert Anki flashcard creator for university students. Your goal is EFFICIENT, NON-REDUNDANT COVERAGE — every important concept must be tested, but not more than once.

CARDINAL RULES:
1. NO REDUNDANCY — if a fact is already implied by another card in your output, do not make a separate card for it. Never generate cards that re-test the same structure, name, or fact in a slightly different way.
2. INFORMATION DENSITY — each card must test a non-obvious, meaningful piece of knowledge. Skip cards where the answer is trivially named or already universally known from context (e.g. do not ask "What bone is at the top of the knee?" if the answer is obvious from surrounding cards).
3. SYNTHESISE SMALL FACTS — when 2–4 closely related small facts exist (e.g. a structure's attachment points, a ligament's attachments and function), combine them into ONE card rather than making separate cards for each tiny detail.
4. MULTI-BLANK CLOZE — use cloze cards with multiple blanks ({{c1::...}}, {{c2::...}}, {{c3::...}}) to test several related facts in one card. Example: "The {{c1::ACL}} prevents {{c2::anterior translation}} of the tibia and limits {{c3::external rotation}} of the knee."
5. PREFER MECHANISM AND RELATIONSHIP CARDS over simple naming cards. Ask WHY, HOW, WHAT HAPPENS WHEN, WHAT IS THE DIFFERENCE BETWEEN.
6. For tables (origin/insertion/action): one card per row that tests all columns together, e.g. "Sartorius: origin = {{c1::ASIS}}, insertion = {{c2::medial tibia}}, actions = {{c3::knee flexion, hip flexion, abduction, lateral rotation}}."

Card types:
- "basic": Q&A (front = question, back = concise answer)
- "cloze": sentence with {{c1::hidden}}, {{c2::hidden}}, etc. in clozeText; front = same sentence with blanks shown as [...]; back = filled sentence

Respond ONLY with a valid JSON array. No markdown fences, no prose.

Each object:
{
  "cardType": "basic" or "cloze",
  "front": "question or cloze sentence with [...] placeholders",
  "back": "answer or complete filled sentence",
  "clozeText": "sentence with {{c1::hidden}} ... (cloze only — omit for basic)",
  "tags": ["Topic", "SubTopic"],
  "confidenceScore": 0.0 to 1.0
}`;

function buildChunkPrompt(chunk: string, chunkIndex: number, totalChunks: number, fileName: string, pageNum: number | undefined, sectionTitle: string | undefined): string {
  const ctx = sectionTitle ? `Section: ${sectionTitle}\n` : '';
  const part = totalChunks > 1 ? ` (part ${chunkIndex + 1}/${totalChunks})` : '';
  return `${ctx}Source: ${fileName}${pageNum !== undefined ? `, Page ${pageNum}` : ''}${part}

Generate 4-10 non-redundant flashcards. Synthesise small related facts into multi-blank cloze cards. Cover every important concept once — do not test the same fact twice in different wordings. Return a JSON array only:

${chunk}`;
}

function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

function deduplicateCards(cards: Flashcard[]): Flashcard[] {
  const seen = new Set<string>();
  return cards.filter(card => {
    const key = card.front.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sanitizeTag(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').slice(0, 40);
}

async function generateCardsForChunk(
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  source: CardSource,
  baseTags: string[]
): Promise<Flashcard[]> {
  const completion = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    max_tokens: 3000,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildChunkPrompt(chunk, chunkIndex, totalChunks, source.fileName, source.pageNumber, source.sectionTitle) },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '';
  let parsed: any[] = [];
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    parsed = match ? JSON.parse(match[0]) : [];
    if (!Array.isArray(parsed)) parsed = [];
  } catch {
    return [];
  }

  const now = new Date().toISOString();
  return parsed
    .filter((c: any) => c && (c.cardType === 'basic' || c.cardType === 'cloze') && c.front && c.back)
    .map((c: any): Flashcard => {
      const cardTags = [
        ...baseTags,
        ...(Array.isArray(c.tags) ? c.tags.map(sanitizeTag) : []),
      ];
      return {
        id: uuidv4(),
        cardType: c.cardType,
        front: c.front,
        back: c.back,
        clozeText: c.cardType === 'cloze' ? c.clozeText : undefined,
        tags: [...new Set(cardTags)],
        source,
        confidenceScore: typeof c.confidenceScore === 'number'
          ? Math.max(0, Math.min(1, c.confidenceScore))
          : 0.8,
        approvedForExport: true,
        createdAt: now,
        updatedAt: now,
      };
    });
}

export async function generateCardsForPage(
  page: ProcessedPage,
  source: CardSource,
  extraTags: string[] = []
): Promise<Flashcard[]> {
  const text = page.text.trim();
  if (text.length < 50) return [];

  const baseTags = [
    sanitizeTag(source.fileName.replace(/\.[^.]+$/, '')),
    ...extraTags.map(sanitizeTag),
  ];

  const chunks = splitIntoChunks(text);
  const allCards: Flashcard[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const cards = await generateCardsForChunk(chunks[i], i, chunks.length, source, baseTags);
    allCards.push(...cards);
  }

  return deduplicateCards(allCards);
}

function toDataUrl(imagePath: string): string {
  const ext = imagePath.split('.').pop()?.toLowerCase() ?? 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  const data = fs.readFileSync(imagePath).toString('base64');
  return `data:${mime};base64,${data}`;
}

export async function generateCardsFromImage(
  imagePath: string,
  source: CardSource,
  extraTags: string[] = []
): Promise<Flashcard[]> {
  const imageSystemPrompt = `You are an expert Anki flashcard creator for medical and university students. Analyze this image and generate NON-REDUNDANT flashcards with high information density. Rules: (1) For tables (origin/insertion/action): one multi-blank cloze card per row testing all columns together. (2) For diagrams: one card per labeled structure covering its role/attachments/function — not just its name. (3) Never make two cards that test the same fact. (4) Use cloze with multiple blanks ({{c1::...}}, {{c2::...}}) to pack related facts into one card. Return ONLY a valid JSON array.`;

  const imageUserPrompt = `Generate efficient, non-redundant Anki flashcards from this image. For anatomy tables: one cloze card per row with all columns as separate blanks. For diagrams: cards that test function and relationships, not just naming. Return a JSON array only:
[{ "cardType": "basic", "front": "question or cloze with [...] blanks", "back": "answer", "clozeText": "sentence with {{c1::hidden}} blanks (cloze only)", "tags": ["Tag"], "confidenceScore": 0.9 }]`;

  const dataUrl = toDataUrl(imagePath);
  const completion = await groq.chat.completions.create({
    model: VISION_MODEL,
    temperature: 0.3,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: imageSystemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: imageUserPrompt },
        ],
      },
    ],
  } as any);

  const raw = completion.choices[0]?.message?.content ?? '';
  let parsed: any[] = [];
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    parsed = match ? JSON.parse(match[0]) : [];
    if (!Array.isArray(parsed)) parsed = [];
  } catch {
    return [];
  }

  const baseTags = [
    sanitizeTag(source.fileName.replace(/\.[^.]+$/, '')),
    ...extraTags.map(sanitizeTag),
  ];
  const now = new Date().toISOString();

  return parsed
    .filter((c: any) => c && c.front && c.back)
    .map((c: any): Flashcard => ({
      id: uuidv4(),
      cardType: 'basic',
      front: c.front,
      back: c.back,
      tags: [...new Set([...baseTags, ...(Array.isArray(c.tags) ? c.tags.map(sanitizeTag) : [])])],
      source,
      confidenceScore: typeof c.confidenceScore === 'number' ? Math.max(0, Math.min(1, c.confidenceScore)) : 0.8,
      approvedForExport: true,
      createdAt: now,
      updatedAt: now,
    }));
}

export async function detectOcclusionRegions(imagePath: string): Promise<Array<{
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}>> {
  const prompt = `Analyze this anatomy diagram and create image occlusion masks for flashcard study.

Step 1 — decide which case applies:
  LABELED: the diagram already has text annotations naming structures (e.g. arrows or lines pointing to words like "Femur", "ACL", "Sartorius").
  UNLABELED: no text labels are visible; the image shows structures without written names.

Step 2 — place masks:
  If LABELED: place each mask to cover the text label word/phrase only (not the structure). Tight boxes, typically width 3–15%, height 1–5%.
  If UNLABELED: place masks over the anatomical structures themselves. Larger boxes are fine (width up to 35%, height up to 25%).

Return ONLY a valid JSON array, no prose, no markdown fences. Each element:
{"label": "name of what is hidden", "x": 12, "y": 45, "width": 10, "height": 3}

All numbers are percentages of image dimensions (0–100). Cover every label (LABELED) or every key structure (UNLABELED).`;

  const dataUrl = toDataUrl(imagePath);
  const completion = await groq.chat.completions.create({
    model: VISION_MODEL,
    temperature: 0.2,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: prompt },
      ],
    }],
  } as any);

  const raw = completion.choices[0]?.message?.content ?? '';
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    const parsed = match ? JSON.parse(match[0]) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r: any) =>
      r && typeof r.label === 'string' &&
      typeof r.x === 'number' && typeof r.y === 'number' &&
      typeof r.width === 'number' && typeof r.height === 'number'
    );
  } catch {
    return [];
  }
}

export async function regenerateCard(
  front: string,
  back: string,
  context: string
): Promise<{ front: string; back: string }> {
  const completion = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0.5,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Improve this Anki flashcard. Keep it concise, test one idea only.

Context: ${context}

Current card:
Front: ${front}
Back: ${back}

Return a JSON object only (no markdown): { "front": "...", "back": "..." }`,
    }],
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : {};
    return { front: result.front || front, back: result.back || back };
  } catch {
    return { front, back };
  }
}
