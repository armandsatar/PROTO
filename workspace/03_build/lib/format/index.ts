export type {
  FormatType,
  DeliveryMode,
  ConfidenceLevel,
  SignalSource,
  ReasoningSignal,
  RawRecommendation,
  RecommendationResult,
} from './types';
export { applyFormatGuardrail } from './guardrail';
export { fallbackFormatRecommendation } from './fallbackHeuristic';
export { recommendFormat } from './recommendFormat';
export type { RecommendFormatInput } from './recommendFormat';
