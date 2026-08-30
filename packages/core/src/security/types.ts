import type { ActionAuthority, RuntimeCursor, SourceClass } from "@pcr/contracts";

export const TOOL_ORIGINS = ["builtin", "custom", "mcp", "external"] as const;
export type ToolOrigin = (typeof TOOL_ORIGINS)[number];

export interface ToolTrustPolicy {
  allowlistedToolNames: readonly string[];
}

export interface ActionAuthorizationInput {
  cursor: RuntimeCursor;
  toolName: string;
  origin: ToolOrigin;
  requestedAuthority: ActionAuthority;
  verifiedReceipt?: boolean;
  policy: ToolTrustPolicy;
  signal?: AbortSignal;
}

export type ActionAuthorizationDecision =
  | {
    kind: "allow";
    sourceClass: SourceClass;
    authority: ActionAuthority;
    ceiling: ActionAuthority;
    toolName: string;
    origin: ToolOrigin;
    reason: string;
  }
  | {
    kind: "deny";
    code: "PCR_ACTION_AUTHORITY_MISSING";
    sourceClass: SourceClass;
    authority: ActionAuthority;
    ceiling: ActionAuthority;
    toolName: string;
    origin: ToolOrigin;
    reason: string;
  };

export interface AuthorizationService {
  authorize(input: Omit<ActionAuthorizationInput, "policy">): ActionAuthorizationDecision;
}

export interface CreateAuthorizationMachineInput {
  cursor: RuntimeCursor;
  policy: ToolTrustPolicy;
}

export type AuthorizationErrorCode =
  | "PCR_AUTHORIZATION_DEPENDENCY_MISSING"
  | "PCR_AUTHORIZATION_INPUT_INVALID"
  | "PCR_AUTHORIZATION_SCOPE_MISMATCH";

export class AuthorizationError extends TypeError {
  readonly code: AuthorizationErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: AuthorizationErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "AuthorizationError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
