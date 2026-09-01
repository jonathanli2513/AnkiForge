import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProcessedPage } from '../types';
import {
  classifyExcludedPage,
  filterOcclusionLabels,
  findRepeatedPageLines,
  type OcclusionLabelCandidate,
} from './contentFilters';

function page(text: string, layout?: ProcessedPage['layout']): ProcessedPage {
  return {
    pageNumber: 1,
    text,
    hasImages: false,
    imagePaths: [],
    layout,
  };
}

test('classifies explicit and implicit table-of-contents pages', () => {
  assert.equal(
    classifyExcludedPage(page('TABLE OF CONTENTS\nIntroduction ........ 2\nMethods ........ 5'), 1, 8),
    'table of contents'
  );
  assert.equal(
    classifyExcludedPage(page('Table of Content\nAnatomical Terminology\nOsteology\nMusculature'), 2, 353),
    'table of contents'
  );
  assert.equal(
    classifyExcludedPage(page('Introduction 2\nMethods 5\nResults 9\nDiscussion 12\nReferences 18'), 1, 8),
    'table of contents'
  );
});

test('classifies a sparse, prominent opening cover as a title page', () => {
  const cover = page('Cardiovascular Physiology\nLecture 1\nPresented by Jonathan Li', {
    maxFontSize: 32,
    medianFontSize: 15,
    largestTextYPercent: 24,
  });
  assert.equal(classifyExcludedPage(cover, 0, 20), 'title page');
});

test('keeps an opening page that contains study content', () => {
  const content = page('Cardiac output\n• Heart rate increases cardiac output\n• Stroke volume also changes cardiac output', {
    maxFontSize: 28,
    medianFontSize: 14,
    largestTextYPercent: 8,
  });
  assert.equal(classifyExcludedPage(content, 0, 20), null);
});

test('does not treat a sparse standalone diagram as a title page', () => {
  assert.equal(classifyExcludedPage(page('Femur\nTibia\nFibula'), 0, 1), null);
});

test('finds text repeated across enough pages', () => {
  const repeated = findRepeatedPageLines([
    'Muscle physiology\nUniversity of Example',
    'Cardiac physiology\nUniversity of Example',
    'Neural physiology\nUniversity of Example',
  ]);
  assert.equal(repeated.has('university of example'), true);
  assert.equal(repeated.has('muscle physiology'), false);
});

test('occlusion filtering preserves diagram labels but removes protected page elements', () => {
  const base = { x: 30, y: 40, width: 12, height: 4, fontSize: 10, medianFontSize: 10, isBold: false, isHorizontal: true, opacity: 1 };
  const candidates: OcclusionLabelCandidate[] = [
    { ...base, label: 'Anterior cruciate ligament' },
    { ...base, label: 'Knee anatomy', y: 7, width: 30, fontSize: 24, isBold: true },
    { ...base, label: 'DRAFT', opacity: 0.35 },
    { ...base, label: 'University of Example', y: 91 },
    { ...base, label: 'example.edu' },
    { ...base, label: 'Rotated watermark', isHorizontal: false },
  ];

  const kept = filterOcclusionLabels(candidates, new Set(['university of example']));
  assert.deepEqual(kept.map(candidate => candidate.label), ['Anterior cruciate ligament']);
});
