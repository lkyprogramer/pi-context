export {
  AuthorizationError,
  TOOL_ORIGINS,
  type ActionAuthorizationDecision,
  type ActionAuthorizationInput,
  type AuthorizationErrorCode,
  type AuthorizationService,
  type CreateAuthorizationMachineInput,
  type ToolOrigin,
  type ToolTrustPolicy,
} from "./types.js";
export { authorizeAction, createAuthorizationMachine } from "./authorize.js";
export { attestOutcome, type ClaimTransition, type OutcomeAttestation, type OutcomeKind } from "./outcome.js";
