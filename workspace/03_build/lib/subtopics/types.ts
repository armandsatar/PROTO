import type { FormatType } from '../format/types';

// Reused as-is — same DB enum reused across migrations 0002-0005. Re-exported so
// callers only need one import.
export type { FormatType };

export type SubtopicDepth = 'shallow' | 'medium' | 'deep';
export type SubtopicSource = 'ai_generated' | 'manual' | 'ai_regenerated';
export type SubtopicGenerationType = 'full_list' | 'single_item';
export type SubtopicGenerationStatus = 'succeeded' | 'succeeded_below_target' | 'failed_fallback' | 'failed_blocked';

export interface Subtopic {
  title: string;
  description: string;
  depth: SubtopicDepth;
}

// Unvalidated shapes as they come back from the AI (or are synthesized by the
// fallback) — deliberately `unknown` throughout; applyFullListGuardrail() /
// applySingleItemGuardrail() in guardrail.ts are what actually validate these.
export interface RawSubtopicItem {
  title: unknown;
  description: unknown;
  depth: unknown;
}

export interface RawFullListResponse {
  subtopics: unknown;
}

export interface RawSingleItemResponse {
  subtopic: unknown;
}

export interface FullListGuardrailResult {
  subtopics: Subtopic[];
  generationStatus: 'succeeded' | 'succeeded_below_target';
}

export interface TargetCountRange {
  min: number;
  max: number;
}
