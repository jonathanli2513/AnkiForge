import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  extractPageLabelsWithPdfJs,
  extractPdfPagesWithPdfJs,
  releasePdfJsDocument,
  renderPdfPageWithPdfJs,
} from './pdfJsFallback';

function escapePdfText(value: string): string {
  return value.replace(/([\\()])/g, '\\$1');
}

function buildTwoPagePdf(first: string, second: string): Buffer {
  const streams = [first, second].map(text =>
    `BT\n/F1 18 Tf\n72 320 Td\n(${escapePdfText(text)}) Tj\nET\n`
  );
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(streams[0])} >>\nstream\n${streams[0]}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${Buffer.byteLength(streams[1])} >>\nstream\n${streams[1]}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

test('bundled PDF.js fallback preserves pages, labels, and rendering', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ankiforge-pdfjs-test-'));
  const pdfPath = path.join(tempDir, 'two-pages.pdf');
  const pngPath = path.join(tempDir, 'page-two.png');
  fs.writeFileSync(pdfPath, buildTwoPagePdf('First anatomy page', 'Second anatomy page'));

  try {
    const pages = await extractPdfPagesWithPdfJs(pdfPath);
    assert.equal(pages.length, 2);
    assert.match(pages[0].text, /First anatomy page/);
    assert.match(pages[1].text, /Second anatomy page/);

    const labels = await extractPageLabelsWithPdfJs(pdfPath, 1);
    assert.ok(labels.some(label => label.label.includes('Second anatomy page')));

    const rendered = await renderPdfPageWithPdfJs(pdfPath, 1, pngPath);
    assert.equal(rendered.width, 1000);
    assert.equal(rendered.height, 800);
    assert.ok(fs.statSync(pngPath).size > 100);
  } finally {
    await releasePdfJsDocument(pdfPath);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
