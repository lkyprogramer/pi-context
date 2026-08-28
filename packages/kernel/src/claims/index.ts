export { admitClaim, boundClaimAuthority, isInferenceAdmission, quarantineInference } from "./admit.js";
export {
  applyTransitionToSlice,
  conflictSet,
  projectAudit,
  projectCurrent,
} from "./resolve.js";
export { ClaimLedger } from "./store.js";
export {
  applyClaimTransition,
  authorizedRetraction,
  closeSystemTime,
  explicitSupersession,
  oppositePolarity,
  transitionPolicyAllows,
  valuesConflict,
  type ClaimTransitionResult,
} from "./transitions.js";
export type {
  Claim,
  ClaimAdmission,
  ClaimAdmissionClass,
  ClaimAsOfQuery,
  ClaimPolarity,
  ClaimStatus,
  ClaimSupport,
  ClaimType,
  TimeRange,
} from "./model.js";
