import {
  AuthorizationError,
  authorizeAction,
  createAuthorizationMachine,
  type ActionAuthorizationDecision,
  type ActionAuthorizationInput,
  type AuthorizationService,
  type CreateAuthorizationMachineInput,
  type ToolTrustPolicy,
} from "@pcr/core";

export {
  authorizeAction,
  type ActionAuthorizationDecision,
  type ActionAuthorizationInput,
  type AuthorizationService,
  type ToolTrustPolicy,
};

export interface CreateAuthorizationServiceInput extends CreateAuthorizationMachineInput {}

export type AuthorizationServiceErrorCode =
  | "PCR_AUTHORIZATION_DEPENDENCY_MISSING"
  | "PCR_AUTHORIZATION_INPUT_INVALID"
  | "PCR_AUTHORIZATION_SCOPE_MISMATCH";

export class AuthorizationServiceError extends TypeError {
  readonly code: AuthorizationServiceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: AuthorizationServiceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "AuthorizationServiceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function mapError(error: unknown): never {
  if (error instanceof AuthorizationError) {
    throw new AuthorizationServiceError(error.code, { ...error.details });
  }
  throw error;
}

export function createAuthorizationService(input: CreateAuthorizationServiceInput): AuthorizationService {
  try {
    const machine = createAuthorizationMachine(input);
    return {
      authorize: (event: Omit<ActionAuthorizationInput, "policy">): ActionAuthorizationDecision => {
        try {
          return machine.authorize(event);
        } catch (error) {
          mapError(error);
        }
      },
    };
  } catch (error) {
    mapError(error);
  }
}
