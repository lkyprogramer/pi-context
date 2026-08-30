import type { HostMessage, RuntimeCursor } from "@pcr/contracts";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HOST_ROLES = new Set(["user", "assistant", "tool-result", "custom"]);

export interface RouteKey {
  modelKey: string;
  cursor: RuntimeCursor;
  signal?: AbortSignal;
}

export interface RouteInfo {
  modelKey: string;
  contextWindow: number;
  maxOutputTokens: number;
  providerReservedTokens: number;
}

export interface TokenPricer {
  priceMessage(message: HostMessage, route: RouteKey): Promise<number>;
  effectiveInput(route: RouteInfo): number;
}

export interface CreateTokenPricerInput {
  cursor: RuntimeCursor;
  routes: Readonly<Record<string, RouteInfo>>;
}

export type BudgetErrorCode =
  | "PCR_BUDGET_DEPENDENCY_MISSING"
  | "PCR_BUDGET_INPUT_INVALID"
  | "PCR_BUDGET_SCOPE_MISMATCH"
  | "PCR_BUDGET_ROUTE_UNKNOWN";

export class BudgetError extends TypeError {
  readonly code: BudgetErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: BudgetErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "BudgetError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new BudgetError("PCR_BUDGET_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new BudgetError("PCR_BUDGET_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function requireNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) failInput(field);
}

export function snapshotBudgetCursor(value: RuntimeCursor, field = "cursor"): Readonly<RuntimeCursor> {
  if (!value || typeof value !== "object") failInput(field);
  const cursor: RuntimeCursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput(`${field}.workspaceId`);
  requireNonEmpty(cursor.sessionId, `${field}.sessionId`);
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, `${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  requireNonEmpty(cursor.modelKey, `${field}.modelKey`);
  return Object.freeze(cursor);
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

export function estimateTextTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0x1f300 && code < 0x1faff) tokens += 2;
    else if (code > 0x2e80) tokens += 1;
    else tokens += 0.25;
  }
  return Math.max(1, Math.ceil(tokens));
}

export function estimateMessageTokens(message: HostMessage): number {
  if (!message || typeof message !== "object") failInput("message");
  requireNonEmpty(message.hostMessageId, "message.hostMessageId");
  if (typeof message.role !== "string" || !HOST_ROLES.has(message.role)) failInput("message.role");
  if (!Array.isArray(message.content)) failInput("message.content");
  let tokens = 0;
  for (const block of message.content) {
    if (!block || typeof block !== "object" || typeof block.type !== "string") failInput("message.content[]");
    if (block.type === "text") {
      if (typeof block.text !== "string") failInput("message.content[].text");
      tokens += estimateTextTokens(block.text);
    } else if (block.type === "pointer" || block.type === "image-ref" || block.type === "tool-call-ref") {
      if (!("ref" in block) || typeof block.ref !== "string" || block.ref.length === 0) {
        failInput("message.content[].ref");
      }
      tokens += estimateTextTokens(block.ref);
    } else {
      failInput("message.content[].type");
    }
  }
  return tokens;
}

export function computeEffectiveInput(route: RouteInfo): number {
  if (!route || typeof route !== "object") failInput("route");
  requireNonEmpty(route.modelKey, "route.modelKey");
  requireNonNegativeInteger(route.contextWindow, "route.contextWindow");
  requireNonNegativeInteger(route.maxOutputTokens, "route.maxOutputTokens");
  requireNonNegativeInteger(route.providerReservedTokens, "route.providerReservedTokens");
  return Math.max(0, route.contextWindow - route.maxOutputTokens - route.providerReservedTokens);
}

function snapshotRoutes(routes: CreateTokenPricerInput["routes"]): Readonly<Record<string, RouteInfo>> {
  if (!routes || typeof routes !== "object" || Array.isArray(routes)) failMissing("routes");
  const next: Record<string, RouteInfo> = {};
  for (const [key, route] of Object.entries(routes)) {
    requireNonEmpty(key, "routes[]");
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

export function createTokenPricer(input: CreateTokenPricerInput): TokenPricer {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  const bound = snapshotBudgetCursor(input.cursor, "input.cursor");
  const routes = snapshotRoutes(input.routes);
  return {
    async priceMessage(message: HostMessage, route: RouteKey): Promise<number> {
      if (!route || typeof route !== "object") failInput("route");
      if (route.signal !== undefined && !(route.signal instanceof AbortSignal)) failInput("route.signal");
      route.signal?.throwIfAborted();
      const cursor = snapshotBudgetCursor(route.cursor, "route.cursor");
      if (!sameCursor(bound, cursor)) throw new BudgetError("PCR_BUDGET_SCOPE_MISMATCH");
      requireNonEmpty(route.modelKey, "route.modelKey");
      if (!routes[route.modelKey]) throw new BudgetError("PCR_BUDGET_ROUTE_UNKNOWN", { modelKey: route.modelKey });
      route.signal?.throwIfAborted();
      return estimateMessageTokens(message);
    },
    effectiveInput(route: RouteInfo): number {
      return computeEffectiveInput(route);
    },
  };
}
