export type {
  LeadMagnetType,
  ConfidenceLevel,
  SignalSource,
  ReasoningSignal,
  RawLeadMagnetRecommendation,
  LeadMagnetRecommendationResult,
} from './types';
export { applyLeadMagnetGuardrail } from './guardrail';
export { fallbackLeadMagnetRecommendation } from './fallbackRecommendation';
export { recommendLeadMagnet } from './recommendLeadMagnet';
export type { RecommendLeadMagnetInput } from './recommendLeadMagnet';
export {
  RECONSIDER_CAP,
  hasReachedReconsiderCap,
  detectStalenessReason,
  assertValidConfirmation,
  computeIsOverride,
} from './rules';
export type { StalenessReason } from './rules';
export {
  generateLeadMagnetRecommendation,
  confirmLeadMagnetRecommendation,
  changeLeadMagnetRecommendation,
  getActiveLeadMagnetRecommendation,
} from './runLeadMagnetCheck';
export type { LeadMagnetRecommendationRow } from './runLeadMagnetCheck';
