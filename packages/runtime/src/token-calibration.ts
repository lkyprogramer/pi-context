import {
  BudgetError,
  createTokenPricer,
  type CreateTokenPricerInput,
  type RouteInfo,
  type RouteKey,
  type TokenPricer,
} from "@pcr/core";
import type { HostMessage } from "@pcr/contracts";

export type { RouteInfo, RouteKey, TokenPricer };

export interface CalibrationSample {
  modelKey: string;
  heuristicTokens: number;
  providerInputTokens: number;
  viewId?: string;
  outputHash?: string;
}

export interface TokenCalibration extends TokenPricer {
  observe(sample: CalibrationSample): number;
}

export interface CreateTokenCalibrationInput extends CreateTokenPricerInput {}

export type TokenCalibrationErrorCode =
  | "PCR_BUDGET_DEPENDENCY_MISSING"
  | "PCR_BUDGET_INPUT_INVALID"
  | "PCR_BUDGET_SCOPE_MISMATCH"
  | "PCR_BUDGET_ROUTE_UNKNOWN";

export class TokenCalibrationError extends TypeError {
  readonly code: TokenCalibrationErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: TokenCalibrationErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "TokenCalibrationError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new TokenCalibrationError("PCR_BUDGET_INPUT_INVALID", { field });
}

function mapError(error: unknown): never {
  if (error instanceof BudgetError) {
    throw new TokenCalibrationError(error.code, { ...error.details });
  }
  throw error;
}

interface DensityState {
  modelKey: string;
  density: number;
  frozen: boolean;
  viewId?: string;
  outputHash?: string;
}

export function createTokenCalibration(input: CreateTokenCalibrationInput): TokenCalibration {
  let pricer: TokenPricer;
  try {
    pricer = createTokenPricer(input);
  } catch (error) {
    mapError(error);
  }
  const states = new Map<string, DensityState>();

  function densityFor(modelKey: string): number {
    return states.get(modelKey)?.density ?? 1;
  }

  return {
    async priceMessage(message: HostMessage, route: RouteKey): Promise<number> {
      try {
        const heuristic = await pricer.priceMessage(message, route);
        return heuristic * densityFor(route.modelKey);
      } catch (error) {
        mapError(error);
      }
    },
    effectiveInput(route: RouteInfo): number {
      try {
        return pricer.effectiveInput(route);
      } catch (error) {
        mapError(error);
      }
    },
    observe(sample: CalibrationSample): number {
      if (!sample || typeof sample !== "object") failInput("sample");
      if (typeof sample.modelKey !== "string" || sample.modelKey.length === 0) failInput("sample.modelKey");
      if (typeof sample.heuristicTokens !== "number" || !(sample.heuristicTokens > 0)) failInput("sample.heuristicTokens");
      if (typeof sample.providerInputTokens !== "number" || sample.providerInputTokens < 0) {
        failInput("sample.providerInputTokens");
      }
      const current = states.get(sample.modelKey);
      if (!current || current.modelKey !== sample.modelKey) {
        const density = sample.providerInputTokens / sample.heuristicTokens;
        states.set(sample.modelKey, {
          modelKey: sample.modelKey,
          density: Math.max(0, density),
          frozen: false,
          viewId: sample.viewId,
          outputHash: sample.outputHash,
        });
        return Math.max(0, density);
      }
      if (
        (current.viewId && sample.viewId && current.viewId !== sample.viewId)
        || (current.outputHash && sample.outputHash && current.outputHash !== sample.outputHash)
      ) {
        current.frozen = true;
        return current.density;
      }
      if (current.frozen) return current.density;
      current.density = Math.max(0, sample.providerInputTokens / sample.heuristicTokens);
      current.viewId = sample.viewId ?? current.viewId;
      current.outputHash = sample.outputHash ?? current.outputHash;
      return current.density;
    },
  };
}
