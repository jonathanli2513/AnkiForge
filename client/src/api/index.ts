import type { Flashcard, GenerationJob } from '../types';

const BASE = '/api';

export async function uploadFiles(files: File[]): Promise<{ jobId: string; files: string[] }> {
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function pollJob(jobId: string): Promise<GenerationJob> {
  const res = await fetch(`${BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function regenerateCard(front: string, back: string, context: string): Promise<{ front: string; back: string }> {
  const res = await fetch(`${BASE}/cards/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ front, back, context }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function exportCsv(cards: Flashcard[], deckName: string): Promise<void> {
  const res = await fetch(`${BASE}/export/csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cards, deckName }),
  });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  triggerDownload(blob, `${deckName || 'AnkiForge'}.tsv`);
}

export async function exportApkg(cards: Flashcard[], deckName: string): Promise<void> {
  const res = await fetch(`${BASE}/export/apkg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cards, deckName }),
  });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  triggerDownload(blob, `${deckName || 'AnkiForge'}.apkg.zip`);
}

// Upload a single image for occlusion editing — stores server-side, returns served URL
export async function uploadOcclusionImage(file: File): Promise<{ url: string; fileName: string }> {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch(`${BASE}/upload/image`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
