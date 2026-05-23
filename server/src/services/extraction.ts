import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ProcessedFile, ProcessedPage } from '../types';

const execFileAsync = promisify(execFile);

// Python script: extract per-page text from PDF using PyMuPDF (preserves reading order)
const PDF_EXTRACT_SCRIPT = `
import sys, json, fitz
doc = fitz.open(sys.argv[1])
result = []
for i, page in enumerate(doc):
    text = page.get_text('text', sort=True)
    lines = [l.strip() for l in text.split('\\n') if l.strip()]
    section = None
    for l in lines:
        if len(l) < 80 and l == l.upper() and len(l) > 3 and not l.replace(' ', '').isdigit():
            section = l
            break
    result.append({'pageNumber': i + 1, 'text': text.strip(), 'sectionTitle': section})
print(json.dumps(result))
`;

async function extractPdfText(filePath: string): Promise<ProcessedFile> {
  const scriptPath = path.join(path.dirname(filePath), `_extract_${Date.now()}.py`);
  fs.writeFileSync(scriptPath, PDF_EXTRACT_SCRIPT.trim());

  try {
    const { stdout } = await execFileAsync('python3', [scriptPath, filePath], { timeout: 60000 });
    const rawPages = JSON.parse(stdout) as Array<{ pageNumber: number; text: string; sectionTitle: string | null }>;

    const pages: ProcessedPage[] = rawPages.map(p => ({
      pageNumber: p.pageNumber,
      text: p.text,
      hasImages: false,
      imagePaths: [],
      sectionTitle: p.sectionTitle ?? undefined,
    }));

    if (pages.length === 0) {
      pages.push({ pageNumber: 1, text: '', hasImages: false, imagePaths: [] });
    }

    return { fileName: path.basename(filePath), fileType: 'pdf', pages, totalPages: pages.length };
  } catch {
    // Fallback: pdf-parse single-page extraction
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    const rawPages = data.text.split(/\f/).filter((p: string) => p.trim().length > 0);
    const pages: ProcessedPage[] = rawPages.length > 0
      ? rawPages.map((text: string, idx: number) => {
          const lines = text.split('\n').filter((l: string) => l.trim());
          const sectionTitle = lines.find((l: string) => l.length < 80 && l === l.toUpperCase() && l.length > 3);
          return { pageNumber: idx + 1, text: text.trim(), hasImages: false, imagePaths: [], sectionTitle };
        })
      : [{ pageNumber: 1, text: data.text.trim(), hasImages: false, imagePaths: [] }];
    return { fileName: path.basename(filePath), fileType: 'pdf', pages, totalPages: pages.length };
  } finally {
    fs.unlink(scriptPath, () => {});
  }
}

async function extractImageText(filePath: string): Promise<ProcessedFile> {
  const Tesseract = require('tesseract.js');
  const { data: { text } } = await Tesseract.recognize(filePath, 'eng', {
    logger: () => {},
  });

  const pages: ProcessedPage[] = [{
    pageNumber: 1,
    text: text.trim(),
    hasImages: true,
    imagePaths: [filePath],
  }];

  return {
    fileName: path.basename(filePath),
    fileType: 'image',
    pages,
    totalPages: 1,
  };
}

async function extractTextFile(filePath: string): Promise<ProcessedFile> {
  const text = fs.readFileSync(filePath, 'utf-8');
  return {
    fileName: path.basename(filePath),
    fileType: 'text',
    pages: [{ pageNumber: 1, text: text.trim(), hasImages: false, imagePaths: [] }],
    totalPages: 1,
  };
}

async function extractDocx(filePath: string): Promise<ProcessedFile> {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return {
    fileName: path.basename(filePath),
    fileType: 'docx',
    pages: [{ pageNumber: 1, text: result.value.trim(), hasImages: false, imagePaths: [] }],
    totalPages: 1,
  };
}

export async function extractFile(filePath: string): Promise<ProcessedFile> {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf':
      return extractPdfText(filePath);
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
      return extractImageText(filePath);
    case '.txt':
      return extractTextFile(filePath);
    case '.docx':
      return extractDocx(filePath);
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}
