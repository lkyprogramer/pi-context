import {
  domainHash,
  type CacheZone,
  type HostMessage,
  type MaterializationOmission,
  type MaterializedSection,
  type MaterializedView,
  type RuntimeCursor,
} from "@pcr/contracts";

import { BudgetError, snapshotBudgetCursor, type TokenPricer } from "../budget/pricer.js";
import { CacheError, type CacheReceiptService } from "./cache.js";
import { dedupMaterializationMessages } from "./dedup.js";
import { CACHE_LAYOUT_VERSION, SectionError, type PlanSectionInput, type SectionPlan, type SectionPlanner } from "./sections.js";

const ZONE_ORDER: readonly CacheZone[] = [
  "stable-prefix",
  "append-only-history",
  "volatile-augmentation",
  "active-turn",
];

const REDUCTION_LADDER = ["retrieval-page", "directory", "continuity-delta", "historical-tail"] as const;
const REASONS = new Set(["normal", "overflow-retry", "manual-preview"]);

export interface MaterializationRequest {
  cursor: RuntimeCursor;
  canonicalMessages: readonly HostMessage[];
  currentContextWindow: number;
  maxOutputTokens: number;
  providerReservedTokens?: number;
  systemTokens?: number;
  toolsTokens?: number;
  imageReserveTokens?: number;
  reason: "normal" | "overflow-retry" | "manual-preview";
  now: number;
  signal?: AbortSignal;
}

export interface RuntimeSnapshot {
  cursor: RuntimeCursor;
  directives: readonly HostMessage[];
  continuity: readonly HostMessage[];
  continuityDelta?: readonly HostMessage[];
  directory?: readonly HostMessage[];
  recall?: readonly HostMessage[];
  warnings?: readonly HostMessage[];
}

export interface Materializer {
  materialize(input: MaterializationRequest, snapshot: RuntimeSnapshot): Promise<MaterializedView>;
}

export interface CreateMaterializerInput {
  cursor: RuntimeCursor;
  pricer: TokenPricer;
  planner: SectionPlanner;
  cache: CacheReceiptService;
}

export type MaterializerErrorCode =
  | "PCR_MATERIALIZER_DEPENDENCY_MISSING"
  | "PCR_MATERIALIZER_INPUT_INVALID"
  | "PCR_MATERIALIZER_SCOPE_MISMATCH"
  | "PCR_DIRECTIVE_BUDGET_EXCEEDED"
  | "PCR_UNREPAIRABLE_ACTIVE_TURN";

export class MaterializerError extends TypeError {
  readonly code: MaterializerErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: MaterializerErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "MaterializerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new MaterializerError("PCR_MATERIALIZER_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new MaterializerError("PCR_MATERIALIZER_INPUT_INVALID", { field });
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function mapBoundError(error: unknown): never {
  if (error instanceof BudgetError || error instanceof SectionError || error instanceof CacheError) {
    if (error.code.endsWith("SCOPE_MISMATCH")) {
      throw new MaterializerError("PCR_MATERIALIZER_SCOPE_MISMATCH", { ...error.details });
    }
    if (error.code.endsWith("INPUT_INVALID")) {
      throw new MaterializerError("PCR_MATERIALIZER_INPUT_INVALID", { ...error.details });
    }
    failInput(error.code);
  }
  throw error;
}

function snapshotCursor(value: RuntimeCursor, field: string): RuntimeCursor {
  try {
    return snapshotBudgetCursor(value, field);
  } catch (error) {
    mapBoundError(error);
  }
}

function findLatestAuthenticatedUserIndex(messages: readonly HostMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.sourceClass === "authenticated-user") return index;
  }
  return -1;
}

function preambleMessage(cursor: RuntimeCursor): HostMessage {
  return {
    hostMessageId: `hm_${domainHash("materializer-preamble", { cursor }).slice(0, 24)}`,
    role: "custom",
    timestamp: 0,
    sourceClass: "system",
    content: [{ type: "text", text: "pcr-runtime" }],
  };
}

function optionalSection(kind: PlanSectionInput["kind"], messages: readonly HostMessage[] | undefined): PlanSectionInput[] {
  if (!messages || messages.length === 0) return [];
  return [{ kind, messages }];
}

function totalCost(sections: readonly SectionPlan[]): number {
  return sections.reduce((sum, item) => sum + item.tokenCost, 0);
}

function reduceToBudget(sections: SectionPlan[], budget: number): { sections: SectionPlan[]; omissions: MaterializationOmission[] } {
  let selected = [...sections];
  const omissions: MaterializationOmission[] = [];
  for (const kind of REDUCTION_LADDER) {
    if (totalCost(selected) <= budget) break;
    const dropped = selected.filter((item) => item.kind === kind);
    if (dropped.length === 0) continue;
    selected = selected.filter((item) => item.kind !== kind);
    omissions.push({ kind, reason: "budget-ladder", count: dropped.length });
  }
  return { sections: selected, omissions };
}

function toMaterializedSections(plans: readonly SectionPlan[]): MaterializedSection[] {
  return plans.map((plan) => ({
    kind: plan.kind,
    cacheZone: plan.zone,
    contentHash: plan.contentHash,
    estimatedTokens: plan.tokenCost,
    messageIds: plan.messages.map((message) => message.hostMessageId),
  }));
}

function orderedMessages(plans: readonly SectionPlan[]): HostMessage[] {
  return ZONE_ORDER.flatMap((zone) => plans.filter((item) => item.zone === zone).flatMap((item) => item.messages));
}

export function createMaterializer(input: CreateMaterializerInput): Materializer {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.pricer || typeof input.pricer.priceMessage !== "function" || typeof input.pricer.effectiveInput !== "function") {
    failMissing("pricer");
  }
  if (!input.planner || typeof input.planner.plan !== "function") failMissing("planner");
  if (!input.cache || typeof input.cache.commit !== "function" || typeof input.cache.current !== "function") {
    failMissing("cache");
  }
  const bound = snapshotCursor(input.cursor, "input.cursor");
  const pricer = input.pricer;
  const planner = input.planner;
  const cache = input.cache;

  return {
    async materialize(request: MaterializationRequest, snapshot: RuntimeSnapshot): Promise<MaterializedView> {
      if (!request || typeof request !== "object") failInput("request");
      if (!snapshot || typeof snapshot !== "object") failInput("snapshot");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("request.signal");
      request.signal?.throwIfAborted();
      const requestCursor = snapshotCursor(request.cursor, "request.cursor");
      const snapshotCursorValue = snapshotCursor(snapshot.cursor, "snapshot.cursor");
      if (!sameCursor(bound, requestCursor) || !sameCursor(bound, snapshotCursorValue)) {
        throw new MaterializerError("PCR_MATERIALIZER_SCOPE_MISMATCH");
      }
      if (!Array.isArray(request.canonicalMessages) || request.canonicalMessages.length === 0) {
        failInput("request.canonicalMessages");
      }
      if (typeof request.reason !== "string" || !REASONS.has(request.reason)) failInput("request.reason");
      if (typeof request.now !== "number" || !Number.isFinite(request.now)) failInput("request.now");
      if (!Array.isArray(snapshot.directives)) failInput("snapshot.directives");
      if (!Array.isArray(snapshot.continuity)) failInput("snapshot.continuity");
      let budget: number;
      try {
        budget = pricer.effectiveInput({
          modelKey: requestCursor.modelKey,
          contextWindow: request.currentContextWindow,
          maxOutputTokens: request.maxOutputTokens,
          providerReservedTokens: request.providerReservedTokens ?? 0,
          ...(request.systemTokens === undefined ? {} : { systemTokens: request.systemTokens }),
          ...(request.toolsTokens === undefined ? {} : { toolsTokens: request.toolsTokens }),
          ...(request.imageReserveTokens === undefined ? {} : { imageReserveTokens: request.imageReserveTokens }),
        });
      } catch (error) {
        mapBoundError(error);
      }
      request.signal?.throwIfAborted();
      const start = findLatestAuthenticatedUserIndex(request.canonicalMessages);
      if (start < 0) failInput("request.canonicalMessages");
      const suffix = request.canonicalMessages.slice(start);
      const history = request.canonicalMessages.slice(0, start);
      const owned = dedupMaterializationMessages(snapshot.directives, history, suffix);
      const sectionInput: PlanSectionInput[] = [
        { kind: "runtime-preamble", messages: [preambleMessage(requestCursor)] },
        { kind: "hard-directives", messages: owned.directives },
        { kind: "stable-continuity", messages: snapshot.continuity },
        ...optionalSection("historical-tail", owned.history),
        ...optionalSection("continuity-delta", snapshot.continuityDelta),
        ...optionalSection("directory", snapshot.directory),
        ...optionalSection("retrieval-page", snapshot.recall),
        ...optionalSection("runtime-warning", snapshot.warnings),
        { kind: "active-turn", messages: owned.active },
      ];
      let planned: SectionPlan[];
      try {
        planned = await planner.plan({ cursor: requestCursor, sections: sectionInput, signal: request.signal });
      } catch (error) {
        mapBoundError(error);
      }
      const directives = planned.find((item) => item.kind === "hard-directives");
      if (directives && directives.tokenCost > budget) {
        throw new MaterializerError("PCR_DIRECTIVE_BUDGET_EXCEEDED", { tokenCost: directives.tokenCost, budget });
      }
      const reduced = reduceToBudget(planned, budget);
      if (totalCost(reduced.sections) > budget) {
        throw new MaterializerError("PCR_UNREPAIRABLE_ACTIVE_TURN", {
          tokenEstimate: totalCost(reduced.sections),
          budget,
        });
      }
      request.signal?.throwIfAborted();
      let receipt;
      try {
        receipt = await cache.commit({ cursor: requestCursor, sections: reduced.sections, signal: request.signal });
      } catch (error) {
        mapBoundError(error);
      }
      const messages = orderedMessages(reduced.sections);
      const sections = toMaterializedSections(reduced.sections);
      const outputHash = domainHash("materialized-output", {
        messages: messages.map((item) => ({
          hostMessageId: item.hostMessageId,
          role: item.role,
          sourceClass: item.sourceClass,
          content: item.content,
        })),
        sections: sections.map((item) => ({ kind: item.kind, contentHash: item.contentHash })),
      });
      return {
        viewId: receipt.viewId,
        outputHash,
        messages,
        sections,
        tokenEstimate: totalCost(reduced.sections),
        cachePlan: {
          layoutVersion: CACHE_LAYOUT_VERSION,
          sectionOrder: sections.map((item) => item.kind),
          eligiblePrefixTokens: receipt.eligiblePrefixTokens,
          firstDifferentSection: receipt.firstDifferentSection,
          previousViewId: receipt.previousViewId,
          providerCapability: "automatic-prefix",
        },
        omissions: reduced.omissions,
      };
    },
  };
}
