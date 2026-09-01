import fs from 'fs';
import type { ProcessedPage } from '../types';
import type { OcclusionLabelCandidate } from './contentFilters';

// pdfjs-dist is ESM-only, while the server is compiled as CommonJS. Keeping the
// native dynamic import prevents TypeScript from rewriting it to require().
const importEsm = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<any>;

let pdfJsPromise: Promise<any> | undefined;
const documentCache = new Map<string, Promise<any>>();

interface TextToken {
  text: string;
  x: number;
  top: number;
  baseline: number;
  width: number;
  height: number;
  fontSize: number;
  isHorizontal: boolean;
}

interface TextLine {
  tokens: TextToken[];
  baseline: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface AnalyzedPage {
  text: string;
  sectionTitle?: string;
  layout: NonNullable<ProcessedPage['layout']>;
  labels: OcclusionLabelCandidate[];
}

async function getPdfJs(): Promise<any> {
  pdfJsPromise ??= importEsm('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfJsPromise;
}

async function getDocument(pdfPath: string): Promise<any> {
  let cached = documentCache.get(pdfPath);
  if (!cached) {
    cached = (async () => {
      const pdfjs = await getPdfJs();
      const data = new Uint8Array(fs.readFileSync(pdfPath));
      return pdfjs.getDocument({
        data,
        disableWorker: true,
        useSystemFonts: true,
      }).promise;
    })();
    documentCache.set(pdfPath, cached);
  }
  return cached;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cleanJoinedText(parts: string[]): string {
  return parts
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;:!?%)\]])/g, '$1')
    .replace(/([([])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function groupTokensIntoLines(tokens: TextToken[]): TextLine[] {
  const sorted = [...tokens].sort((a, b) => {
    const vertical = a.baseline - b.baseline;
    return Math.abs(vertical) > 1.5 ? vertical : a.x - b.x;
  });
  const lines: TextLine[] = [];

  for (const token of sorted) {
    const tolerance = Math.max(2, token.fontSize * 0.28);
    const candidates = lines.filter(line =>
      Math.abs(line.baseline - token.baseline) <= tolerance
    );
    const line = candidates.find(candidate => {
      const gap = token.x - candidate.x1;
      return gap >= -2 && gap <= Math.max(24, token.fontSize * 3);
    });

    if (line) {
      line.tokens.push(token);
      line.baseline = (line.baseline * (line.tokens.length - 1) + token.baseline) / line.tokens.length;
      line.x0 = Math.min(line.x0, token.x);
      line.y0 = Math.min(line.y0, token.top);
      line.x1 = Math.max(line.x1, token.x + token.width);
      line.y1 = Math.max(line.y1, token.top + token.height);
    } else {
      lines.push({
        tokens: [token],
        baseline: token.baseline,
        x0: token.x,
        y0: token.top,
        x1: token.x + token.width,
        y1: token.top + token.height,
      });
    }
  }

  return lines.sort((a, b) => {
    const vertical = a.y0 - b.y0;
    return Math.abs(vertical) > 1.5 ? vertical : a.x0 - b.x0;
  });
}

async function analyzePage(pdfPath: string, pageIndex: number): Promise<AnalyzedPage> {
  const [pdfjs, document] = await Promise.all([getPdfJs(), getDocument(pdfPath)]);
  const page = await document.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const tokens: TextToken[] = [];

  for (const item of content.items as any[]) {
    const text = typeof item.str === 'string' ? item.str.trim() : '';
    if (!text) continue;

    const transform = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.max(
      Math.hypot(transform[2], transform[3]),
      Number(item.height) || 0,
      1
    );
    const style = content.styles?.[item.fontName];
    const ascent = typeof style?.ascent === 'number'
      ? style.ascent
      : typeof style?.descent === 'number'
        ? 1 + style.descent
        : 0.9;
    const baseline = Number(transform[5]) || 0;
    const angle = Math.atan2(transform[1], transform[0]);
    const width = Math.max(Number(item.width) || 0, text.length * fontSize * 0.2, 1);

    tokens.push({
      text,
      x: Number(transform[4]) || 0,
      top: baseline - fontSize * ascent,
      baseline,
      width,
      height: fontSize,
      fontSize,
      isHorizontal: Math.abs(Math.sin(angle)) < 0.15 && Math.cos(angle) > 0.8,
    });
  }

  const lines = groupTokensIntoLines(tokens);
  const lineTexts = lines
    .map(line => cleanJoinedText(line.tokens.map(token => token.text)))
    .filter(Boolean);
  const fontSizes = tokens.map(token => token.fontSize).filter(size => size > 0);
  const medianFontSize = median(fontSizes);
  const maxFontSize = fontSizes.length > 0 ? Math.max(...fontSizes) : 0;
  const largestLine = lines
    .filter(line => line.tokens.some(token => Math.abs(token.fontSize - maxFontSize) < 0.01))
    .sort((a, b) => a.y0 - b.y0)[0];
  const sectionTitle = lineTexts.find(line =>
    line.length > 3 && line.length < 80 && line === line.toUpperCase() &&
    !/^\d+$/.test(line.replace(/\s/g, ''))
  );

  const labels: OcclusionLabelCandidate[] = lines.map(line => ({
    label: cleanJoinedText(line.tokens.map(token => token.text)),
    x: round(Math.max(0, (line.x0 - 2) / viewport.width * 100), 1),
    y: round(Math.max(0, (line.y0 - 2) / viewport.height * 100), 1),
    width: round(Math.min((line.x1 - line.x0) / viewport.width * 100 + 1.5, 100), 1),
    height: round(Math.min((line.y1 - line.y0) / viewport.height * 100 + 1.5, 100), 1),
    fontSize: round(Math.max(...line.tokens.map(token => token.fontSize)), 2),
    medianFontSize: round(medianFontSize, 2),
    isBold: false,
    isHorizontal: line.tokens.every(token => token.isHorizontal),
    opacity: 1,
  }));

  page.cleanup();
  return {
    text: lineTexts.join('\n'),
    sectionTitle,
    layout: {
      maxFontSize: round(maxFontSize, 2),
      medianFontSize: round(medianFontSize, 2),
      largestTextYPercent: round((largestLine?.y0 ?? 0) / Math.max(viewport.height, 1) * 100, 2),
    },
    labels,
  };
}

/**
 * Bundled per-page extraction used when the optional PyMuPDF command fails.
 * Unlike the old pdf-parse fallback, this never collapses a multi-page PDF
 * into one oversized text block.
 */
export async function extractPdfPagesWithPdfJs(pdfPath: string): Promise<ProcessedPage[]> {
  const document = await getDocument(pdfPath);
  const pages: ProcessedPage[] = [];

  for (let pageIndex = 0; pageIndex < document.numPages; pageIndex++) {
    const analyzed = await analyzePage(pdfPath, pageIndex);
    pages.push({
      pageNumber: pageIndex + 1,
      text: analyzed.text,
      hasImages: false,
      imagePaths: [],
      sectionTitle: analyzed.sectionTitle,
      layout: analyzed.layout,
    });
  }

  return pages;
}

export async function extractPageLabelsWithPdfJs(
  pdfPath: string,
  pageIndex: number
): Promise<OcclusionLabelCandidate[]> {
  return (await analyzePage(pdfPath, pageIndex)).labels;
}

export async function renderPdfPageWithPdfJs(
  pdfPath: string,
  pageIndex: number,
  outputPath: string
): Promise<{ width: number; height: number }> {
  const document = await getDocument(pdfPath);
  const page = await document.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 2 });
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const canvasContext = canvas.getContext('2d');

  await page.render({ canvasContext, viewport, canvas }).promise;
  fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
  page.cleanup();

  return { width: canvas.width, height: canvas.height };
}

export async function releasePdfJsDocument(pdfPath: string): Promise<void> {
  const cached = documentCache.get(pdfPath);
  documentCache.delete(pdfPath);
  if (!cached) return;

  try {
    const document = await cached;
    await document.destroy();
  } catch {
    // A failed cache entry does not need further cleanup.
  }
}
