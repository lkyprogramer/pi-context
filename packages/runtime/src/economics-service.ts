import type { RuntimeCursor } from "@pcr/contracts";
import {
  EconomicsError,
  computeEffectiveInput,
  computeRealizedNet,
  snapshotBudgetCursor,
  snapshotProviderPrices,
  type CacheReceiptService,
  type ProviderPrices,
  type RealizedNet,
  type RouteInfo,
} from "@pcr/core";

export interface RealizeEconomicsInput {
  cursor: RuntimeCursor;
  tokensBefore: number;
  tokensAfter: number;
  summaryTokens: number;
  recallTokens: number;
  succeeded: boolean;
  signal?: AbortSignal;
}

export interface EconomicsController {
  realize(input: RealizeEconomicsInput): Promise<RealizedNet>;
}

export interface CreateEconomicsControllerInput {
  cursor: RuntimeCursor;
  cache: Pick<CacheReceiptService, "current">;
  prices: ProviderPrices;
  routes: Readonly<Record<string, RouteInfo>>;
}

export type EconomicsControllerErrorCode =
  | "PCR_ECONOMICS_DEPENDENCY_MISSING"
  | "PCR_ECONOMICS_INPUT_INVALID"
  | "PCR_ECONOMICS_SCOPE_MISMATCH";

export class EconomicsControllerError extends TypeError {
  readonly code: EconomicsControllerErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: EconomicsControllerErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "EconomicsControllerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new EconomicsControllerError("PCR_ECONOMICS_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new EconomicsControllerError("PCR_ECONOMICS_INPUT_INVALID", { field });
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function snapshotRoutes(routes: CreateEconomicsControllerInput["routes"]): Readonly<Record<string, RouteInfo>> {
  if (!routes || typeof routes !== "object" || Array.isArray(routes)) failMissing("routes");
  const next: Record<string, RouteInfo> = {};
  for (const [key, route] of Object.entries(routes)) {
    if (typeof key !== "string" || key.length === 0) failInput("routes[]");
    computeEffectiveInput(route);
    if (route.modelKey !== key) failInput(`routes.${key}.modelKey`);
    next[key] = {
      modelKey: route.modelKey,
      contextWindow: route.contextWindow,
      maxOutputTokens: route.maxOutputTokens,
      providerReservedTokens: route.providerReservedTokens,
    };
  }
  return Object.freeze(next);
}

function mapError(error: unknown): never {
  if (error instanceof EconomicsError) {
    throw new EconomicsControllerError(error.code, { ...error.details });
  }
  throw error;
}

export function createEconomicsController(input: CreateEconomicsControllerInput): EconomicsController {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.cache || typeof input.cache !== "object") failMissing("cache");
  if (typeof input.cache.current !== "function") failMissing("cache.current");
  let prices: ProviderPrices;
  try {
    prices = snapshotProviderPrices(input.prices);
  } catch (error) {
    mapError(error);
  }
  const bound = snapshotBudgetCursor(input.cursor, "input.cursor");
  const routes = snapshotRoutes(input.routes);
  const cache = input.cache;

  return {
    async realize(request: RealizeEconomicsInput): Promise<RealizedNet> {
      if (!request || typeof request !== "object") failInput("request");
      if (typeof request.succeeded !== "boolean") failInput("request.succeeded");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("request.signal");
      request.signal?.throwIfAborted();
      const cursor = snapshotBudgetCursor(request.cursor, "request.cursor");
      if (!sameCursor(bound, cursor)) throw new EconomicsControllerError("PCR_ECONOMICS_SCOPE_MISMATCH");
      const route = routes[cursor.modelKey];
      if (!route) failInput("request.cursor.modelKey");
      request.signal?.throwIfAborted();
      const receipt = await cache.current(cursor, request.signal);
      request.signal?.throwIfAborted();
      const rewriteTokens = receipt
        ? Math.max(0, receipt.sections.reduce((sum, item) => sum + item.tokenCost, 0) - receipt.eligiblePrefixTokens)
        : 0;
      const window = computeEffectiveInput(route);
      try {
        return computeRealizedNet({
          tokensBefore: request.tokensBefore,
          tokensAfter: request.tokensAfter,
          summaryTokens: request.summaryTokens,
          recallTokens: request.recallTokens,
          rewriteTokens,
          succeeded: request.succeeded,
          overflowAvoided: request.tokensBefore > window && request.tokensAfter <= window,
        }, prices);
      } catch (error) {
        mapError(error);
      }
    },
  };
}

export type { ProviderPrices, RealizedNet };
