import type { FormatType } from '../format/types';
import type { SubtopicDepth } from '../subtopics/types';

// Reused as-is — same DB enums reused across migrations. Re-exported so callers only
// need one import.
export type { FormatType, SubtopicDepth };

export type ContentStatus = 'generated' | 'manual' | 'failed_empty';
export type ContentQualityFlag = 'clean' | 'below_specificity_threshold';
export type ContentTriggerScope = 'initial' | 'regenerate_one' | 'regenerate_all' | 'new_subtopic_backfill';
export type ContentComplianceStatus = 'no_changes_needed' | 'changes_applied' | 'review_pass_failed';
export type ContentGenerationStatus = 'succeeded' | 'succeeded_outside_length_target' | 'failed_fallback' | 'failed_blocked';
export type ContentRiskCategory = 'unsupported_claim' | 'absolute_language' | 'missing_disclaimer' | 'diagnostic_language' | 'other';
export type ContentChangeDetector = 'ai_judgment' | 'deterministic_keyword_catch';

export interface WordCountRange {
  min: number;
  max: number;
}

// A frozen title/description/depth triple — either content_generations.subtopic_snapshot
// (what content_contents.body was actually generated against) or the live subtopics
// row it's compared to for per-row staleness (rules.ts's isSubtopicContentStale).
export interface SubtopicSnapshot {
  title: string;
  description: string;
  depth: SubtopicDepth;
}

export interface ComplianceChange {
  originalText: string;
  rewrittenText: string;
  reason: string;
  riskCategory: ContentRiskCategory;
  detectedBy: ContentChangeDetector;
}

// Unvalidated shapes as they come back from the AI — deliberately `unknown`
// throughout; guardrail.ts's validateWriterOutput()/validateReviewOutput() are what
// actually validate these.
export interface RawWriterResponse {
  content: unknown;
}

export interface RawComplianceChangeItem {
  original_text: unknown;
  rewritten_text: unknown;
  reason: unknown;
  risk_category: unknown;
}

export interface RawReviewResponse {
  final_content: unknown;
  compliance_changes: unknown;
  specificity_score: unknown;
  specificity_issues?: unknown;
}

export interface WriterPassResult {
  content: string;
  wordCount: number;
  meetsLengthTarget: boolean;
}

export interface ReviewPassResult {
  finalContent: string;
  // AI-judgment changes only, shape- and substring-validated against the draft.
  // Force-flagged deterministic-catch entries are appended by generateReviewPass.ts
  // (increment 3) after its retry loop settles, not by this guardrail — a single
  // guardrail call can't know whether a retry is still coming.
  complianceChanges: ComplianceChange[];
  specificityScore: number;
  specificityIssues: string[];
  slopHitCount: number;
  meetsSpecificityThreshold: boolean;
  // Absolutist-claim phrases the deterministic scanner found in finalContent that no
  // AI-provided complianceChanges entry already covers — the review-pass-miss signal
  // decision 7's backstop is built around.
  uncoveredAbsolutistPhrases: string[];
}
