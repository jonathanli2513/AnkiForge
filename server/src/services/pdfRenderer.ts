import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

const execFileAsync = promisify(execFile);

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Python script that renders a single PDF page to PNG via PyMuPDF and prints "width,height"
const RENDER_SCRIPT = `
import sys, fitz
pdf_path, page_num, output_path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
doc = fitz.open(pdf_path)
page = doc[page_num]
mat = fitz.Matrix(2.0, 2.0)
pix = page.get_pixmap(matrix=mat)
pix.save(output_path)
print(f"{pix.width},{pix.height}")
`;

// Python script: extract word-level bounding boxes and group them into logical labels.
// Groups nearby words on the same line; skips punctuation-only tokens and long sentences.
// Returns JSON array of {label, x, y, width, height} in percentages of page dimensions.
const LABEL_EXTRACT_SCRIPT = `
import sys, json, fitz

doc = fitz.open(sys.argv[1])
page_idx = int(sys.argv[2])
page = doc[page_idx]
pw = page.rect.width
ph = page.rect.height

words = page.get_text('words')  # (x0, y0, x1, y1, text, block, line, word)

groups = []
for w in words:
    x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
    stripped = text.strip('->.,;:() ')
    if len(stripped) < 2:
        continue
    placed = False
    for g in groups:
        gy_center = (g['y0'] + g['y1']) / 2
        my_center = (y0 + y1) / 2
        # Same group if vertically within 8pt and horizontally within 130pt
        if abs(gy_center - my_center) < 8 and abs(x0 - g['x1']) < 130:
            g['x1'] = max(g['x1'], x1)
            g['y0'] = min(g['y0'], y0)
            g['y1'] = max(g['y1'], y1)
            g['words'].append(text)
            placed = True
            break
    if not placed:
        groups.append({'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'words': [text]})

result = []
for g in groups:
    label = ' '.join(g['words'])
    w_pct = (g['x1'] - g['x0']) / pw * 100
    h_pct = (g['y1'] - g['y0']) / ph * 100
    # Skip very long text (sentences > 55 chars or > 50% wide) — not a label
    if w_pct > 50 or len(label) > 55:
        continue
    # Add 2pt padding around the text
    x_pct = max(0, (g['x0'] - 2) / pw * 100)
    y_pct = max(0, (g['y0'] - 2) / ph * 100)
    result.append({
        'label': label,
        'x': round(x_pct, 1),
        'y': round(y_pct, 1),
        'width': round(min(w_pct + 1.5, 45), 1),
        'height': round(min(h_pct + 1.5, 20), 1)
    })

print(json.dumps(result))
`;

export interface RenderedPage {
  imagePath: string;
  imageUrl: string;
  width: number;
  height: number;
}

export interface PageLabel {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function renderPdfPage(pdfPath: string, pageIndex: number): Promise<RenderedPage> {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const outputFile = `pdf_page_${uuidv4()}.png`;
  const outputPath = path.join(UPLOADS_DIR, outputFile);

  const scriptPath = path.join(UPLOADS_DIR, `_render_${uuidv4()}.py`);
  fs.writeFileSync(scriptPath, RENDER_SCRIPT.trim());

  try {
    const { stdout } = await execFileAsync('python3', [scriptPath, pdfPath, String(pageIndex), outputPath], {
      timeout: 30000,
    });
    const [w, h] = stdout.trim().split(',').map(Number);
    return {
      imagePath: outputPath,
      imageUrl: `/uploads/${outputFile}`,
      width: w,
      height: h,
    };
  } finally {
    fs.unlink(scriptPath, () => {});
  }
}

/**
 * Extract text label bounding boxes from a PDF page using PyMuPDF's embedded text layer.
 * Returns grouped labels (words on the same line merged) with percentage coordinates.
 * Falls back to empty array if the page has no embedded text (purely raster images).
 */
export async function extractPageLabels(pdfPath: string, pageIndex: number): Promise<PageLabel[]> {
  const scriptPath = path.join(UPLOADS_DIR, `_labels_${uuidv4()}.py`);
  fs.writeFileSync(scriptPath, LABEL_EXTRACT_SCRIPT.trim());
  try {
    const { stdout } = await execFileAsync('python3', [scriptPath, pdfPath, String(pageIndex)], {
      timeout: 20000,
    });
    const parsed = JSON.parse(stdout.trim());
    return Array.isArray(parsed) ? parsed as PageLabel[] : [];
  } catch {
    return [];
  } finally {
    fs.unlink(scriptPath, () => {});
  }
}

export async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const sharp = require('sharp');
  const meta = await sharp(imagePath).metadata();
  return { width: meta.width ?? 800, height: meta.height ?? 600 };
}
