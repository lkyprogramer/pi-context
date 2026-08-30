import {
  createDirectiveResolver,
  TemporalDirectiveError,
  type CreateDirectiveResolverInput,
  type DirectiveRecordStore,
  type DirectiveResolver,
} from "@pcr/core";

export type { DirectiveRecordStore, DirectiveResolver };

export interface CreateDirectiveServiceInput extends CreateDirectiveResolverInput {}

export type DirectiveServiceErrorCode =
  | "PCR_DIRECTIVE_DEPENDENCY_MISSING"
  | "PCR_DIRECTIVE_INPUT_INVALID"
  | "PCR_DIRECTIVE_SCOPE_MISMATCH"
  | "PCR_DIRECTIVE_UNAUTHENTICATED";

export class DirectiveServiceError extends TypeError {
  readonly code: DirectiveServiceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DirectiveServiceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "DirectiveServiceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function mapError(error: unknown): never {
  if (error instanceof TemporalDirectiveError) {
    throw new DirectiveServiceError(error.code, { ...error.details });
  }
  throw error;
}

export function createDirectiveService(input: CreateDirectiveServiceInput): DirectiveResolver {
  try {
    const resolver = createDirectiveResolver(input);
    return {
      apply: async (candidate, signal) => {
        try {
          return await resolver.apply(candidate, signal);
        } catch (error) {
          mapError(error);
        }
      },
      active: async (cursor, signal) => {
        try {
          return await resolver.active(cursor, signal);
        } catch (error) {
          mapError(error);
        }
      },
    };
  } catch (error) {
    mapError(error);
  }
}
