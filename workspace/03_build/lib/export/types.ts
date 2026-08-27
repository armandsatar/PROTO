import type { FormatType, DeliveryMode } from '../format/types';

// Reused as-is — same DB enums reused across migrations. Re-exported so callers only
// need one import.
export type { FormatType, DeliveryMode };

// Decision 3: 3-value set, no epub — "ebook" resolves to a specially-styled static PDF.
export type ExportOutputFormat = 'pdf' | 'notion_markdown' | 'docx';
export type ExportTriggerScope = 'initial' | 'regenerate';
// One more value than cover_generation_status's 3 — succeeded_with_warnings covers a
// non-blocking sanity-check failure (§5 rules 4/5), a real outcome distinct from a
// clean success or a genuine failure.
export type ExportGenerationStatus = 'succeeded' | 'succeeded_with_warnings' | 'failed_fallback' | 'failed_blocked';
// Decision 1's structure-extraction output shape (§4.1) — fillable-delivery products only.
export type ExportFieldType = 'heading' | 'instructional_paragraph' | 'checklist_item' | 'user_input_blank' | 'table_row';

// Reused verbatim from lib/format/format_recommendations' own shape (migration 0002) —
// the identical kind of AI call (small enum classification + a stated reason).
export type RecommendationGenerationStatus = 'succeeded' | 'failed_fallback' | 'failed_blocked';

export interface ExportRecommendationResult {
  outputFormat: ExportOutputFormat;
  reasoning: string;
}

export interface FieldStructureBlock {
  fieldType: ExportFieldType;
  text: string;
  order: number;
}

export interface FieldStructureResult {
  blocks: FieldStructureBlock[];
}

// Unvalidated shapes as they come back from the AI — deliberately `unknown`
// throughout; guardrail.ts's validate*Output() functions are what actually validate these.
export interface RawExportRecommendationResponse {
  output_format: unknown;
  reasoning: unknown;
}

export interface RawFieldStructureItem {
  field_type: unknown;
  text: unknown;
}

export interface RawFieldStructureResponse {
  blocks: unknown;
}
