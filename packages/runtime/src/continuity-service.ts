import {
  ContinuityError,
  createContinuityMachine,
  type ContinuityEvent,
  type ContinuityRevision,
  type ContinuityService,
  type ContinuityStore,
  type CreateContinuityMachineInput,
} from "@pcr/core";

export type {
  ContinuityEvent,
  ContinuityRevision,
  ContinuityService,
  ContinuityStore,
};

export interface CreateContinuityServiceInput extends CreateContinuityMachineInput {}

export type ContinuityServiceErrorCode =
  | "PCR_CONTINUITY_DEPENDENCY_MISSING"
  | "PCR_CONTINUITY_INPUT_INVALID"
  | "PCR_CONTINUITY_SCOPE_MISMATCH"
  | "PCR_CONTINUITY_TRANSITION_INVALID"
  | "PCR_CONTINUITY_OVERFLOW";

export class ContinuityServiceError extends TypeError {
  readonly code: ContinuityServiceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ContinuityServiceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ContinuityServiceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function mapError(error: unknown): never {
  if (error instanceof ContinuityError) {
    throw new ContinuityServiceError(error.code, { ...error.details });
  }
  throw error;
}

export function createContinuityService(input: CreateContinuityServiceInput): ContinuityService {
  try {
    const machine = createContinuityMachine(input);
    return {
      apply: async (event: ContinuityEvent) => {
        try {
          return await machine.apply(event);
        } catch (error) {
          mapError(error);
        }
      },
      current: async (cursor) => {
        try {
          return await machine.current(cursor);
        } catch (error) {
          mapError(error);
        }
      },
    };
  } catch (error) {
    mapError(error);
  }
}
