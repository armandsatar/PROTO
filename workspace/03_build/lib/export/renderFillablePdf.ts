import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { FieldStructureBlock } from './types';

export interface FillablePdfSubtopicInput {
  title: string;
  blocks: FieldStructureBlock[];
}

export interface RenderFillablePdfInput {
  productTitle: string;
  coverImageBytes: Buffer;
  coverImageMimeType: 'image/jpeg' | 'image/png';
  subtopics: FillablePdfSubtopicInput[];
}

export interface RenderFillablePdfResult {
  buffer: Buffer;
  fieldCount: number;
}

const PAGE_WIDTH = 612; // US Letter, in points
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 16;
const FONT_SIZE = 11;
const HEADING_FONT_SIZE = 16;
const CHECKBOX_SIZE = 12;
const TEXT_FIELD_HEIGHT = 20;

// Live-caught during Increment 9's end-to-end smoke test: pdf-lib's StandardFonts draw
// text using WinAnsi encoding, which cannot represent every Unicode character real
// AI-generated text produces. This started as a per-character allowlist (a
// non-breaking hyphen, then a narrow no-break space, then a rightwards arrow — three
// different Unicode blocks across three separate live runs) — genuine whack-a-mole,
// since there is no bounded set of "characters an LLM might produce." Fixed properly
// instead: ask pdf-lib itself whether a character is encodable (the same check
// drawText relies on internally, surfaced here ahead of time via widthOfTextAtSize)
// rather than maintaining a growing guess-list of Unicode blocks. Known-common
// substitutions still get a meaningful ASCII equivalent; anything else pdf-lib can't
// encode falls back to a plain space — a general, guaranteed catch-all that cannot
// throw regardless of what character shows up next.
const KNOWN_SUBSTITUTIONS: ReadonlyArray<readonly [string, string]> = [
  ['‐', '-'], // hyphen
  ['‑', '-'], // non-breaking hyphen
  ['‒', '-'], // figure dash
  ['–', '-'], // en dash
  ['—', '--'], // em dash
  ['‘', "'"], // left single quote
  ['’', "'"], // right single quote
  ['“', '"'], // left double quote
  ['”', '"'], // right double quote
  ['…', '...'], // ellipsis
  ['→', '->'], // rightwards arrow
  ['←', '<-'], // leftwards arrow
  ['•', '-'], // bullet
  ['✓', 'x'], // check mark
];

function isEncodableByFont(font: PDFFont, char: string): boolean {
  try {
    font.widthOfTextAtSize(char, 1);
    return true;
  } catch {
    return false;
  }
}

function sanitizeForFont(text: string, font: PDFFont): string {
  let result = text;
  for (const [unicodeChar, asciiChar] of KNOWN_SUBSTITUTIONS) {
    result = result.split(unicodeChar).join(asciiChar);
  }
  return Array.from(result)
    .map((char) => (isEncodableByFont(font, char) ? char : ' '))
    .join('');
}

/**
 * §2.3's geometry-bridging problem, resolved by not bridging at all: rather than
 * extracting computed layout geometry from @react-pdf/renderer (Increment 5's engine)
 * and translating it into pdf-lib coordinates — the unverified step the locked doc
 * flagged as unsolved anywhere in this ecosystem — fillable PDFs are laid out directly
 * in pdf-lib, one line at a time, in the same coordinate system the form fields get
 * placed in. Every field's (x, y, width, height) is a number this function itself just
 * computed, not something recovered after the fact from a different rendering engine.
 * The real, disclosed tradeoff: fillable PDFs get simpler typography (Helvetica, manual
 * word-wrap) than the @react-pdf/renderer static path — a genuinely different, more
 * utilitarian rendering engine for this one delivery mode, not the same engine with
 * fields bolted on.
 */
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

export async function renderFillablePdfDocument(input: RenderFillablePdfInput): Promise<RenderFillablePdfResult> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const form = pdfDoc.getForm();

  // Cover page: full-bleed image, same §2.7 requirement as the static PDF path.
  const coverImage = input.coverImageMimeType === 'image/png' ? await pdfDoc.embedPng(input.coverImageBytes) : await pdfDoc.embedJpg(input.coverImageBytes);
  const coverPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  coverPage.drawImage(coverImage, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });

  let page: PDFPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  let fieldCount = 0;

  function ensureSpace(neededHeight: number) {
    if (y - neededHeight < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  for (const subtopic of input.subtopics) {
    for (const block of subtopic.blocks) {
      if (block.fieldType === 'heading') {
        const text = sanitizeForFont(block.text, boldFont);
        ensureSpace(HEADING_FONT_SIZE + 12);
        y -= HEADING_FONT_SIZE;
        page.drawText(text, { x: MARGIN, y, size: HEADING_FONT_SIZE, font: boldFont });
        y -= 12;
      } else if (block.fieldType === 'instructional_paragraph' || block.fieldType === 'table_row') {
        const text = sanitizeForFont(block.text, font);
        for (const line of wrapText(text, font, FONT_SIZE, CONTENT_WIDTH)) {
          ensureSpace(LINE_HEIGHT);
          y -= LINE_HEIGHT;
          page.drawText(line, { x: MARGIN, y, size: FONT_SIZE, font });
        }
        y -= 6;
      } else if (block.fieldType === 'checklist_item') {
        const text = sanitizeForFont(block.text, font);
        ensureSpace(LINE_HEIGHT + 4);
        y -= LINE_HEIGHT;
        const checkbox = form.createCheckBox(`checklist_${fieldCount}`);
        checkbox.addToPage(page, { x: MARGIN, y: y - 2, width: CHECKBOX_SIZE, height: CHECKBOX_SIZE });
        fieldCount++;
        page.drawText(text, { x: MARGIN + CHECKBOX_SIZE + 8, y, size: FONT_SIZE, font });
        y -= 4;
      } else if (block.fieldType === 'user_input_blank') {
        const text = sanitizeForFont(block.text, font);
        ensureSpace(LINE_HEIGHT + TEXT_FIELD_HEIGHT + 12);
        y -= LINE_HEIGHT;
        page.drawText(text, { x: MARGIN, y, size: FONT_SIZE, font });
        y -= TEXT_FIELD_HEIGHT + 4;
        const textField = form.createTextField(`input_${fieldCount}`);
        textField.addToPage(page, { x: MARGIN, y, width: CONTENT_WIDTH, height: TEXT_FIELD_HEIGHT });
        fieldCount++;
        y -= 8;
      }
    }
    y -= 10;
  }

  const bytes = await pdfDoc.save();
  return { buffer: Buffer.from(bytes), fieldCount };
}

/** Reload the saved file and inspect its own real AcroForm fields — §5 rule 1's existence check. */
export async function countRealFormFields(buffer: Buffer): Promise<number> {
  const pdfDoc = await PDFDocument.load(buffer);
  return pdfDoc.getForm().getFields().length;
}
