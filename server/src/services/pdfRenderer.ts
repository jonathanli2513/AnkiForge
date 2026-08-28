import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { filterOcclusionLabels, type OcclusionLabelCandidate } from './contentFilters';

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

// Extract text-line bounding boxes plus style metadata. TypeScript applies the final
// safety filters so headings, branding, and watermark-like text remain visible.
const LABEL_EXTRACT_SCRIPT = `
import sys, json, fitz, statistics

doc = fitz.open(sys.argv[1])
page_idx = int(sys.argv[2])
page = doc[page_idx]
pw = page.rect.width
ph = page.rect.height

text_dict = page.get_text('dict')
all_sizes = []
for block in text_dict.get('blocks', []):
    if block.get('type') != 0:
        continue
    for line in block.get('lines', []):
        for span in line.get('spans', []):
            if span.get('text', '').strip() and float(span.get('size', 0)) > 0:
                all_sizes.append(float(span.get('size', 0)))
median_font = statistics.median(all_sizes) if all_sizes else 0

result = []
for block in text_dict.get('blocks', []):
    if block.get('type') != 0:
        continue
    for line in block.get('lines', []):
        spans = [span for span in line.get('spans', []) if span.get('text', '').strip()]
        if not spans:
            continue
        label = ' '.join(span.get('text', '').strip() for span in spans).strip()
        stripped = label.strip('->.,;:() ')
        if len(stripped) < 2:
            continue
        x0 = min(span.get('bbox', [0, 0, 0, 0])[0] for span in spans)
        y0 = min(span.get('bbox', [0, 0, 0, 0])[1] for span in spans)
        x1 = max(span.get('bbox', [0, 0, 0, 0])[2] for span in spans)
        y1 = max(span.get('bbox', [0, 0, 0, 0])[3] for span in spans)
        direction = line.get('dir', (1, 0))
        alpha_values = [float(span.get('alpha', 255)) for span in spans]
        opacity = min(alpha_values) / 255 if alpha_values else 1
        font_size = max(float(span.get('size', 0)) for span in spans)
        is_bold = any('bold' in span.get('font', '').lower() or int(span.get('flags', 0)) & 16 for span in spans)
        result.append({
            'label': label,
            'x': round(max(0, (x0 - 2) / pw * 100), 1),
            'y': round(max(0, (y0 - 2) / ph * 100), 1),
            'width': round(min((x1 - x0) / pw * 100 + 1.5, 100), 1),
            'height': round(min((y1 - y0) / ph * 100 + 1.5, 100), 1),
            'fontSize': round(font_size, 2),
            'medianFontSize': round(median_font, 2),
            'isBold': is_bold,
            'isHorizontal': abs(float(direction[1])) < 0.15 and float(direction[0]) > 0.8,
            'opacity': round(opacity, 3)
        })

print(json.dumps(result))
`;

export interface RenderedPage {
  imagePath: string;
  imageUrl: string;
  width: number;
  height: number;
}

export type PageLabel = OcclusionLabelCandidate;

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
export async function extractPageLabels(
  pdfPath: string,
  pageIndex: number,
  repeatedPageLines: ReadonlySet<string> = new Set()
): Promise<PageLabel[]> {
  const scriptPath = path.join(UPLOADS_DIR, `_labels_${uuidv4()}.py`);
  fs.writeFileSync(scriptPath, LABEL_EXTRACT_SCRIPT.trim());
  try {
    const { stdout } = await execFileAsync('python3', [scriptPath, pdfPath, String(pageIndex)], {
      timeout: 20000,
    });
    const parsed = JSON.parse(stdout.trim());
    return Array.isArray(parsed)
      ? filterOcclusionLabels(parsed as PageLabel[], repeatedPageLines)
      : [];
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
