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
