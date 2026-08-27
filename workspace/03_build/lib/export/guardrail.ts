import type {
  RawExportRecommendationResponse,
  RawFieldStructureItem,
  RawFieldStructureResponse,
  ExportOutputFormat,
  ExportFieldType,
  ExportRecommendationResult,
  FieldStructureResult,
  FieldStructureBlock,
} from './types';

const VALID_OUTPUT_FORMATS: readonly ExportOutputFormat[] = ['pdf', 'notion_markdown', 'docx'];

function isValidOutputFormat(v: unknown): v is ExportOutputFormat {
  return typeof v === 'string' && (VALID_OUTPUT_FORMATS as readonly string[]).includes(v);
}

/** Defensive re-check at the confirm action's own boundary — same posture as every prior phase's confirm action. */
export function assertValidOutputFormat(value: string): asserts value is ExportOutputFormat {
  if (!isValidOutputFormat(value)) {
    throw new Error(`Invalid output format: "${value}" — expected "pdf", "notion_markdown", or "docx"`);
  }
}

/** §4's output-format recommendation call — same Step-4-shaped small-enum guardrail. */
export function validateExportRecommendationOutput(raw: RawExportRecommendationResponse): ExportRecommendationResult {
  if (!isValidOutputFormat(raw.output_format)) {
    throw new Error(`Export recommendation returned an invalid output_format: ${JSON.stringify(raw.output_format)}`);
  }
  if (typeof raw.reasoning !== 'string' || !raw.reasoning.trim()) {
    throw new Error('Export recommendation returned empty or non-string reasoning');
  }
  return { outputFormat: raw.output_format, reasoning: raw.reasoning.trim() };
}

const VALID_FIELD_TYPES: readonly ExportFieldType[] = ['heading', 'instructional_paragraph', 'checklist_item', 'user_input_blank', 'table_row'];

function isValidFieldType(v: unknown): v is ExportFieldType {
  return typeof v === 'string' && (VALID_FIELD_TYPES as readonly string[]).includes(v);
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The returned span must actually appear in the source body — decision 1 forbids rewriting, so every block is checkable this way, unlike a compliance rewrite. */
function isRealSubstring(candidate: string, source: string): boolean {
  return normalizeForMatch(source).includes(normalizeForMatch(candidate));
}

function validateFieldStructureItem(raw: unknown, order: number, sourceBody: string): FieldStructureBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as RawFieldStructureItem;
  if (!isValidFieldType(item.field_type)) return null;
  if (typeof item.text !== 'string' || !item.text.trim()) return null;
  const text = item.text.trim();
  if (!isRealSubstring(text, sourceBody)) return null;
  return { fieldType: item.field_type, text, order };
}

/**
 * Decision 1's structure-extraction pass guardrail — a genuinely new AI-usage
 * category (parsing/classifying already-confirmed text, not generating new prose or
 * picking a small enum). Every block's text must be a real substring of the source
 * body (decision 1 forbids rewriting, so this check is meaningful here in a way a
 * generative pass's output couldn't be checked) — individual blocks failing this are
 * silently dropped rather than invalidating the whole response, never fabricated,
 * same posture as every guardrail in this codebase. There remains no deterministic
 * way to check whether a *correctly extracted* span was classified into the *right*
 * field_type (the honest gap §5 rule 3 names).
 */
export function validateFieldStructureOutput(raw: RawFieldStructureResponse, sourceBody: string): FieldStructureResult {
  if (!Array.isArray(raw.blocks)) {
    throw new Error('Field structure extraction response missing a "blocks" array');
  }
  const blocks = raw.blocks.map((item, i) => validateFieldStructureItem(item, i, sourceBody)).filter((b): b is FieldStructureBlock => b !== null);
  return { blocks };
}

/** §6's Approve action, mirrors cover's assertCanApprove exactly — the one deterministic hard rule. */
export function assertCanApprove(currentExportGenerationId: string | null): void {
  if (!currentExportGenerationId) {
    throw new Error('Cannot approve — no current export generation exists yet for this format');
  }
}
