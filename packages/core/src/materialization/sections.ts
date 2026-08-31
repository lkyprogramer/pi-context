import {
  canonicalJson,
  domainHash,
  type CacheZone,
  type HostMessage,
  type MaterializedSectionKind,
  type RuntimeCursor,
} from "@pcr/contracts";

import { BudgetError, snapshotBudgetCursor, type TokenPricer } from "../budget/pricer.js";

export type SectionKind = MaterializedSectionKind;

export const CACHE_LAYOUT_VERSION = 1 as const;

export const SECTION_KINDS: readonly SectionKind[] = [
  "runtime-preamble",
  "hard-directives",
  "stable-continuity",
  "historical-tail",
  "continuity-delta",
  "directory",
  "retrieval-page",
  "runtime-warning",
  "active-turn",
];

const KIND_SET = new Set<SectionKind>(SECTION_KINDS);

export const SECTION_ZONE: Readonly<Record<SectionKind, CacheZone>> = {
  "runtime-preamble": "stable-prefix",
  "hard-directives": "stable-prefix",
  "stable-continuity": "stable-prefix",
  "historical-tail": "append-only-history",
  "continuity-delta": "volatile-augmentation",
  directory: "volatile-augmentation",
  "retrieval-page": "volatile-augmentation",
  "runtime-warning": "volatile-augmentation",
  "active-turn": "active-turn",
};

export interface SectionPlan {
  kind: SectionKind;
  zone: CacheZone;
  contentHash: string;
  tokenCost: number;
  messages: HostMessage[];
}

export interface PlanSectionInput {
  kind: SectionKind;
  messages: readonly HostMessage[];
}

export interface PlanSectionsInput {
  cursor: RuntimeCursor;
  sections: readonly PlanSectionInput[];
  signal?: AbortSignal;
}

export interface SectionPlanner {
  plan(input: PlanSectionsInput): Promise<SectionPlan[]>;
}

export interface CreateSectionPlannerInput {
  cursor: RuntimeCursor;
  pricer: TokenPricer;
}

export type SectionErrorCode =
  | "PCR_SECTION_DEPENDENCY_MISSING"
  | "PCR_SECTION_INPUT_INVALID"
  | "PCR_SECTION_SCOPE_MISMATCH";

export class SectionError extends TypeError {
  readonly code: SectionErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: SectionErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "SectionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new SectionError("PCR_SECTION_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new SectionError("PCR_SECTION_INPUT_INVALID", { field });
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function snapshotMessages(messages: readonly HostMessage[], field: string): HostMessage[] {
  if (!Array.isArray(messages)) failInput(field);
  return messages.map((message, index) => {
    if (!message || typeof message !== "object") failInput(`${field}[${index}]`);
    if (typeof message.hostMessageId !== "string" || message.hostMessageId.length === 0) {
      failInput(`${field}[${index}].hostMessageId`);
    }
    if (!Array.isArray(message.content)) failInput(`${field}[${index}].content`);
    return {
      hostMessageId: message.hostMessageId,
      role: message.role,
      timestamp: message.timestamp,
      sourceClass: message.sourceClass,
      content: message.content,
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(message.toolName ? { toolName: message.toolName } : {}),
      ...(message.isError !== undefined ? { isError: message.isError } : {}),
    };
  });
}

function sectionHash(kind: SectionKind, zone: CacheZone, messages: readonly HostMessage[]): string {
  return domainHash("section-plan", {
    kind,
    zone,
    messages: messages.map((message) => ({
      hostMessageId: message.hostMessageId,
      role: message.role,
      timestamp: message.timestamp,
      sourceClass: message.sourceClass,
      content: canonicalJson(message.content),
      toolCallId: message.toolCallId ?? null,
    })),
  });
}

export function createSectionPlanner(input: CreateSectionPlannerInput): SectionPlanner {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.pricer || typeof input.pricer.priceMessage !== "function") failMissing("pricer");
  const bound = snapshotBudgetCursor(input.cursor, "input.cursor");
  const pricer = input.pricer;

  return {
    async plan(event: PlanSectionsInput): Promise<SectionPlan[]> {
      if (!event || typeof event !== "object") failInput("event");
      if (event.signal !== undefined && !(event.signal instanceof AbortSignal)) failInput("event.signal");
      event.signal?.throwIfAborted();
      let cursor: RuntimeCursor;
      try {
        cursor = snapshotBudgetCursor(event.cursor, "event.cursor");
      } catch (error) {
        if (error instanceof BudgetError) failInput("event.cursor");
        throw error;
      }
      if (!sameCursor(bound, cursor)) throw new SectionError("PCR_SECTION_SCOPE_MISMATCH");
      if (!Array.isArray(event.sections) || event.sections.length === 0) failInput("event.sections");
      const seen = new Set<SectionKind>();
      const plans: SectionPlan[] = [];
      for (const [index, section] of event.sections.entries()) {
        event.signal?.throwIfAborted();
        if (!section || typeof section !== "object") failInput(`event.sections[${index}]`);
        if (typeof section.kind !== "string" || !KIND_SET.has(section.kind as SectionKind)) {
          failInput(`event.sections[${index}].kind`);
        }
        const kind = section.kind as SectionKind;
        if (seen.has(kind)) failInput(`event.sections[${index}].kind`);
        seen.add(kind);
        const messages = snapshotMessages(section.messages, `event.sections[${index}].messages`);
        const zone = SECTION_ZONE[kind];
        let tokenCost = 0;
        for (const message of messages) {
          try {
            tokenCost += await pricer.priceMessage(message, {
              modelKey: cursor.modelKey,
              cursor,
              signal: event.signal,
            });
          } catch (error) {
            if (error instanceof BudgetError) failInput(`event.sections[${index}].messages`);
            throw error;
          }
        }
        event.signal?.throwIfAborted();
        plans.push({
          kind,
          zone,
          contentHash: sectionHash(kind, zone, messages),
          tokenCost,
          messages,
        });
      }
      return plans;
    },
  };
}
