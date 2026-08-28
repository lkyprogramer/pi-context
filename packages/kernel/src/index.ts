export { captureUserDirectives, verifyDirectiveQuote } from "./directives/capture.js";
export { DirectiveStore } from "./directives/store.js";
export { InputCorrelator, classifyInputSource } from "./directives/raw-input.js";
export { captureObservation } from "./ingress/raw-capture.js";
export { ReducerRegistry } from "./reducers/registry.js";
export { defaultPointerReducer } from "./reducers/default.js";
export type { ObservationReducer, ReducedObservation, CapturedObservation } from "./reducers/types.js";
export { readEvidenceById } from "./retrieval/exact-read.js";
export {
  authorizeToolCall,
  bindToolCallGate,
  blockedToolResult,
  type ActionDecision,
  type ActionGateDeps,
} from "./security/action-gate.js";
export { classifyTool, effectiveToolClass, TOOL_TAXONOMY_VERSION } from "./security/tool-taxonomy.js";
export { attestOutcome } from "./security/outcome-attestation.js";
export {
  computeEffectiveInputBudget,
  estimateMessages,
  estimateTextTokens,
  pressure,
} from "./budget/token-counter.js";
export { CalibrationBucket, safeUsageDelta } from "./budget/calibration.js";
export { predictNextStepGrowth } from "./budget/growth.js";
