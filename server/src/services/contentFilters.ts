import type { ProcessedPage } from '../types';

export type ExcludedPageReason = 'title page' | 'table of contents';

export interface OcclusionLabelCandidate {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  medianFontSize?: number;
  isBold?: boolean;
  isHorizontal?: boolean;
  opacity?: number;
}

const BRANDING_PATTERN = /(?:\u00a9|\u00ae|\u2122|all rights reserved|confidential|do not distribute|watermark|https?:\/\/|www\.|\.(?:com|org|net|edu)\b)/i;
const BULLET_PATTERN = /^(?:[\u2022\u2023\u25e6\u2043\u2219\-*]|\d+[.)])\s+/;

export function normalizePageLine(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

export function classifyExcludedPage(
  page: ProcessedPage,
  pageIndex: number,
  totalPages: number
): ExcludedPageReason | null {
  const lines = nonEmptyLines(page.text);
  const normalizedLines = lines.map(normalizePageLine).filter(Boolean);
  const openingLines = normalizedLines.slice(0, 5);

  const hasContentsHeading = openingLines.some(line =>
    /^(?:table of contents?|contents?)(?: page)?$/.test(line)
  );
  const navigationLines = lines.filter(line =>
    /\.{2,}\s*\d{1,4}\s*$/.test(line) ||
    /^(?:\d+(?:\.\d+)*\s+)?[^.!?]{3,80}\s+\d{1,4}\s*$/.test(line)
  ).length;

  if (hasContentsHeading || (navigationLines >= 4 && navigationLines >= Math.ceil(lines.length * 0.4))) {
    return 'table of contents';
  }

  // Cover/title pages are normally the opening page and contain a prominent title,
  // a byline/course cue, and little or no prose. Keep short first-page content slides
  // when they contain a list or a sentence that can produce a useful card.
  if (pageIndex !== 0 || totalPages < 1 || lines.length === 0) return null;

  const wordCount = page.text.trim().split(/\s+/).filter(Boolean).length;
  const characterCount = page.text.trim().length;
  const bulletLines = lines.filter(line => BULLET_PATTERN.test(line)).length;
  const proseLines = lines.filter(line => {
    const words = line.split(/\s+/).filter(Boolean).length;
    return words >= 12 || (words >= 8 && /[.!?]\s*$/.test(line));
  }).length;
  const sparseLayout = lines.length <= 9 && wordCount <= 65 && characterCount <= 420;
  const hasTitleCue = normalizedLines.some(line =>
    /^(?:lecture|chapter|module|unit|course|presentation|seminar|workshop)\b/.test(line) ||
    /^(?:presented|prepared|written) by\b/.test(line) ||
    /^(?:professor|instructor|author|presenter)\b/.test(line)
  );
  const layout = page.layout;
  const hasProminentOpeningText = Boolean(layout &&
    layout.maxFontSize >= Math.max(18, layout.medianFontSize * 1.35) &&
    layout.largestTextYPercent < 70
  );
  const extremelySparse = totalPages > 1 && lines.length <= 3 && wordCount <= 20;

  if (sparseLayout && bulletLines < 2 && proseLines === 0 &&
      (hasTitleCue || hasProminentOpeningText || extremelySparse)) {
    return 'title page';
  }

  return null;
}

export function findRepeatedPageLines(pageTexts: string[]): Set<string> {
  if (pageTexts.length < 2) return new Set();

  const pagesByLine = new Map<string, Set<number>>();
  pageTexts.forEach((text, pageIndex) => {
    const uniqueLines = new Set(
      nonEmptyLines(text)
        .map(normalizePageLine)
        .filter(line => line.length >= 2 && line.length <= 120)
    );
    uniqueLines.forEach(line => {
      const pages = pagesByLine.get(line) ?? new Set<number>();
      pages.add(pageIndex);
      pagesByLine.set(line, pages);
    });
  });

  const repeatThreshold = Math.max(2, Math.ceil(pageTexts.length * 0.3));
  return new Set(
    [...pagesByLine.entries()]
      .filter(([, pages]) => pages.size >= repeatThreshold)
      .map(([line]) => line)
  );
}

export function filterOcclusionLabels(
  candidates: OcclusionLabelCandidate[],
  repeatedPageLines: ReadonlySet<string> = new Set()
): OcclusionLabelCandidate[] {
  return candidates.filter(candidate => {
    const label = candidate.label.trim();
    const normalized = normalizePageLine(label);
    const wordCount = label.split(/\s+/).filter(Boolean).length;

    if (normalized.length < 2 || label.length > 55 || candidate.width > 50) return false;
    if (candidate.isHorizontal === false || (candidate.opacity ?? 1) < 0.75) return false;
    if (BRANDING_PATTERN.test(label)) return false;

    const bottom = candidate.y + candidate.height;
    if (candidate.y < 2.5 || bottom > 97.5) return false;

    const fontSize = candidate.fontSize ?? 0;
    const medianFontSize = candidate.medianFontSize ?? fontSize;
    const isProminent = medianFontSize > 0 &&
      fontSize >= Math.max(medianFontSize * 1.3, medianFontSize + 1.5);
    const likelyHeading = wordCount <= 16 && (
      (candidate.y < 20 && (candidate.isBold || isProminent || candidate.width >= 24)) ||
      (isProminent && Boolean(candidate.isBold))
    );
    if (likelyHeading) return false;

    const isRepeatedBoilerplate = repeatedPageLines.has(normalized) &&
      (candidate.y < 18 || bottom > 88 || candidate.opacity !== undefined && candidate.opacity < 0.9);
    return !isRepeatedBoilerplate;
  });
}
