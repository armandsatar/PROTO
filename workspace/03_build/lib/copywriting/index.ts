export type {
  CopyPlatform,
  RealCopyPlatform,
  CopyTriggerScope,
  CopyGenerationStatus,
  CopyHardLimitStatus,
  ContentStatus,
  ContentQualityFlag,
  ContentComplianceStatus,
  ContentRiskCategory,
  ContentChangeDetector,
  NarrativeFields,
  PlatformFields,
  ComplianceChange,
  RawNarrativeWriterResponse,
  RawPlatformWriterResponse,
  RawComplianceChangeItem,
  RawReviewResponse,
  NarrativeWriterResult,
  PlatformWriterResult,
  ReviewPassResult,
} from './types';
export { REAL_PLATFORMS } from './types';
export { PLATFORM_REGISTRY, getPlatformSpec } from './platforms';
export type { PlatformHardLimits, PlatformSoftTargets, PlatformSpec } from './platforms';
export {
  REGENERATE_CAP,
  hasReachedRegenerateCap,
  checkHardLimits,
  meetsSoftTargets,
  isTitleStale,
  isFormatStale,
  isMapStale,
  isSubtopicsListStale,
  isContentBuildStale,
  isCoverLookStale,
  detectDocumentStalenessReason,
  isNarrativeStale,
} from './rules';
export type { PlatformDraftFields, HardLimitCheckResult, DocumentStalenessReason } from './rules';
export {
  extractSentenceContaining,
  scanAbsolutistClaims,
  findUncoveredAbsolutistHits,
  scanInstructionalSlopPhrases,
  scanMarketingSlopPhrases,
  scanAllSlopPhrases,
  distinctSlopPhraseCount,
} from './contentScanners';
export type { ScanHit } from './contentScanners';
