import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { domainHash, type RuntimeCursor } from "@pcr/contracts";
import type { ObservationService, ProjectedToolResult, ToolObservation } from "@pcr/runtime";

import { toolResultSourceClass } from "../../kernel/src/security/tool-taxonomy.js";

interface ToolResultEventResult {
  content?: ToolResultEvent["content"];
  details?: unknown;
  isError?: boolean;
  usage?: ToolResultEvent["usage"];
}

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface ToolResultHookDependencies {
  cursor(ctx: ExtensionContext): RuntimeCursor;
  service(cursor: Readonly<RuntimeCursor>, ctx: ExtensionContext): ObservationService | Promise<ObservationService>;
  clock: { now(): number };
  onHardFailure(
    error: unknown,
    phase: "ingest" | "integrity",
    ctx: ExtensionContext,
  ): void | Promise<void>;
}

export interface ToolResultHost {
  on(hook: string, handler: (...args: never[]) => unknown): void;
}

function snapshotCursor(value: RuntimeCursor): RuntimeCursor {
  if (!value || typeof value !== "object") throw new TypeError("PCR_PI_TOOL_RESULT_CURSOR_INVALID");
  const cursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (
    typeof cursor.workspaceId !== "string"
    || !WORKSPACE_PATTERN.test(cursor.workspaceId)
    || typeof cursor.sessionId !== "string"
    || cursor.sessionId.length === 0
    || (cursor.leafId !== null && (typeof cursor.leafId !== "string" || cursor.leafId.length === 0))
    || typeof cursor.lineageHash !== "string"
    || !SHA256_PATTERN.test(cursor.lineageHash)
    || typeof cursor.modelKey !== "string"
    || cursor.modelKey.length === 0
  ) throw new TypeError("PCR_PI_TOOL_RESULT_CURSOR_INVALID");
  return Object.freeze(cursor);
}

function sourceClass(toolName: string): ToolObservation["sourceClass"] {
  return toolResultSourceClass(toolName);
}

function asContent(event: ToolResultEvent): ToolObservation["content"] {
  return Array.isArray(event.content)
    ? event.content.map((block) => {
      if (block && block.type === "text" && typeof block.text === "string") {
        return { type: "text" as const, text: block.text };
      }
      return { type: "text" as const, text: "" };
    })
    : [];
}

function validateDependencies(input: ToolResultHookDependencies): void {
  if (!input || typeof input !== "object") throw new TypeError("PCR_PI_TOOL_RESULT_DEPENDENCY_MISSING:input");
  if (typeof input.cursor !== "function") throw new TypeError("PCR_PI_TOOL_RESULT_DEPENDENCY_MISSING:cursor");
  if (typeof input.service !== "function") throw new TypeError("PCR_PI_TOOL_RESULT_DEPENDENCY_MISSING:service");
  if (!input.clock || typeof input.clock.now !== "function") throw new TypeError("PCR_PI_TOOL_RESULT_DEPENDENCY_MISSING:clock");
  if (typeof input.onHardFailure !== "function") throw new TypeError("PCR_PI_TOOL_RESULT_DEPENDENCY_MISSING:onHardFailure");
}

function toHostResult(projected: ProjectedToolResult, event: ToolResultEvent): ToolResultEventResult {
  return {
    content: projected.visibleContent as ToolResultEventResult["content"],
    details: event.details,
    isError: event.isError,
    ...(event.usage === undefined ? {} : { usage: event.usage }),
  };
}

export function registerToolResultHook(
  pi: Pick<ExtensionAPI, "on">,
  dependencies: ToolResultHookDependencies,
): void {
  if (!pi || typeof pi.on !== "function") throw new TypeError("PCR_PI_TOOL_RESULT_DEPENDENCY_MISSING:pi");
  validateDependencies(dependencies);

  const fail = async (
    error: unknown,
    phase: Parameters<ToolResultHookDependencies["onHardFailure"]>[1],
    ctx: ExtensionContext,
  ): Promise<void> => {
    try {
      ctx?.abort();
    } catch {
      // The explicit failure sink remains authoritative if a stale Pi context rejects abort.
    }
    try {
      await dependencies.onHardFailure(error, phase, ctx);
    } catch {
      // Do not replace the original integrity failure.
    }
  };

  pi.on("tool_result", async (event: ToolResultEvent, ctx: ExtensionContext): Promise<ToolResultEventResult> => {
    try {
      if (!event || typeof event !== "object") throw new TypeError("PCR_PI_TOOL_RESULT_EVENT_INVALID");
      if (typeof event.toolCallId !== "string" || event.toolCallId.length === 0) {
        throw new TypeError("PCR_PI_TOOL_RESULT_EVENT_INVALID");
      }
      if (typeof event.toolName !== "string" || event.toolName.length === 0) {
        throw new TypeError("PCR_PI_TOOL_RESULT_EVENT_INVALID");
      }
      const cursor = snapshotCursor(dependencies.cursor(ctx));
      const capturedAt = dependencies.clock.now();
      if (!Number.isSafeInteger(capturedAt) || capturedAt < 0) throw new TypeError("PCR_PI_TOOL_RESULT_CLOCK_INVALID");
      const operationId = `obsop_${domainHash("pi-tool-result-operation", {
        cursor,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
      })}`;
      const service = await dependencies.service(cursor, ctx);
      const projected = await service.ingest({
        operationId,
        cursor,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.input,
        content: asContent(event),
        details: event.details ?? null,
        isError: event.isError === true,
        capturedAt,
        sourceClass: sourceClass(event.toolName),
        authority: "inform",
        ...(ctx?.signal === undefined ? {} : { signal: ctx.signal }),
      });
      return toHostResult(projected, event);
    } catch (error) {
      await fail(error, "integrity", ctx);
      throw error;
    }
  });
}

/** Production bind. Every stateful dependency must be supplied; there is no fake default path. */
export function bindToolResultCapture(
  host: ToolResultHost,
  dependencies: ToolResultHookDependencies,
): void {
  registerToolResultHook(host as Pick<ExtensionAPI, "on">, dependencies);
}
