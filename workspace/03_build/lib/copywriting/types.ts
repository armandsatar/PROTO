import type { FormatType } from '../format/types';

// Reused as-is — same DB enum reused across migrations. Re-exported so callers only
// need one import.
export type { FormatType };

// The 6 real platforms plus the 'narrative' sentinel value (decision 14, §0.4) — the
// narrative isn't really "a platform," it reuses this same enum/tables deliberately
// rather than standing up a second parallel shape.
export type CopyPlatform = 'etsy' | 'gumroad' | 'stanstore' | 'whop' | 'pinterest' | 'instagram' | 'narrative';
export type RealCopyPlatform = Exclude<CopyPlatform, 'narrative'>;

export const REAL_PLATFORMS: readonly RealCopyPlatform[] = ['etsy', 'gumroad', 'stanstore', 'whop', 'pinterest', 'instagram'];

export type CopyTriggerScope = 'initial' | 'regenerate_one' | 'regenerate_all';
export type CopyGenerationStatus = 'succeeded' | 'succeeded_outside_soft_target' | 'failed_hard_limit_exceeded' | 'failed_fallback' | 'failed_blocked';
export type CopyHardLimitStatus = 'within_limit' | 'exceeds_limit';

// Reused verbatim from lib/content's own types (same Postgres enum types, migration
// 0006, decision in phase8-requirements.md §9.3) — own copies here, not cross-phase
// imports, per the established decoupling convention.
export type ContentStatus = 'generated' | 'manual' | 'failed_empty';
export type ContentQualityFlag = 'clean' | 'below_specificity_threshold';
export type ContentComplianceStatus = 'no_changes_needed' | 'changes_applied' | 'review_pass_failed';
export type ContentRiskCategory = 'unsupported_claim' | 'absolute_language' | 'missing_disclaimer' | 'diagnostic_language' | 'other';
export type ContentChangeDetector = 'ai_judgment' | 'deterministic_keyword_catch';

// The narrative's 4 structured fields (decision 14) — stored in platform_fields on the
// 'narrative' sentinel row, never in title/body (those stay null for that row).
export interface NarrativeFields {
  hook: string;
  transformationStory: string;
  cta: string;
  summary: string;
}

// The heterogeneous extra fields per real platform (§0.3/§9.2) — every key optional
// since no single platform needs all of them.
export interface PlatformFields {
  tags?: string[];
  subtitle?: string;
  buttonText?: string;
  headline?: string;
}

export interface ComplianceChange {
  originalText: string;
  rewrittenText: string;
  reason: string;
  riskCategory: ContentRiskCategory;
  detectedBy: ContentChangeDetector;
}

// Unvalidated shapes as they come back from the AI — deliberately `unknown`
// throughout; guardrail.ts's validate*Output() functions are what actually validate these.
export interface RawNarrativeWriterResponse {
  hook: unknown;
  transformation_story: unknown;
  cta: unknown;
  summary: unknown;
}

export interface RawPlatformWriterResponse {
  title: unknown;
  body: unknown;
  platform_fields: unknown;
}

export interface RawComplianceChangeItem {
  original_text: unknown;
  rewritten_text: unknown;
  reason: unknown;
  risk_category: unknown;
}

// Generic over both the narrative's 4 fields and a platform's title/body pair — `final`
// is expected to mirror whatever field names were sent in the draft, each a string.
export interface RawReviewResponse {
  final: unknown;
  compliance_changes: unknown;
  specificity_score: unknown;
  specificity_issues?: unknown;
}

export interface NarrativeWriterResult {
  fields: NarrativeFields;
}

export interface PlatformWriterResult {
  title: string | null;
  body: string;
  platformFields: PlatformFields;
}

/** PlatformWriterResult plus the hard-limit retry loop's own outcome (§4.1, decision 4). */
export interface PlatformWriterOutcome extends PlatformWriterResult {
  hardLimitStatus: CopyHardLimitStatus;
  hardLimitViolations: string[];
}

/**
 * `finalFields` mirrors the exact field-name set the draft was sent with (e.g.
 * {hook, transformation_story, cta, summary} for the narrative, {title, body} for a
 * platform) — the review pass never renames or drops a field, only rewrites values.
 */
export interface ReviewPassResult {
  finalFields: Record<string, string>;
  // AI-judgment changes only, shape- and substring-validated against the draft. Force-
  // flagged deterministic-catch entries are appended by generateReviewPass.ts after its
  // retry loop settles, not by this guardrail — a single guardrail call can't know
  // whether a retry is still coming.
  complianceChanges: ComplianceChange[];
  specificityScore: number;
  specificityIssues: string[];
  slopHitCount: number;
  meetsSpecificityThreshold: boolean;
  // Absolutist-claim phrases the deterministic scanner found that no AI-provided
  // complianceChanges entry already covers — the review-pass-miss signal the
  // deterministic backstop is built around.
  uncoveredAbsolutistPhrases: string[];
}
