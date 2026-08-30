import * as PiHost from "@earendil-works/pi-coding-agent";
import type {
  AgentSettledEvent,
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  InputEventResult,
  MessageStartEvent,
  SessionStartEvent,
  SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import { domainHash, type RuntimeCursor } from "@pcr/contracts";
import type { UserInputReceipt, UserTurnService } from "@pcr/runtime";

/*
 * This runtime import is intentional: Pi's extension loader aliases the package
 * to the active host, so an unpatched stock 0.84.4 host fails during extension
 * loading instead of accepting and then swallowing user input.
 */
if (PiHost.PCR_INGRESS_METADATA_CONTRACT !== "pcr-ingress-metadata-v1") {
  throw new TypeError("PCR_PI_INGRESS_METADATA_CONTRACT_MISSING");
}

const METADATA_NAMESPACE = "pcr.user-input-receipt.v1";
const INPUT_ID_PATTERN = /^pi_input_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface UserInputHookDependencies {
  cursor(ctx: ExtensionContext): RuntimeCursor;
  service(cursor: Readonly<RuntimeCursor>, ctx: ExtensionContext): UserTurnService | Promise<UserTurnService>;
  clock: { now(): number };
  onHardFailure(
    error: unknown,
    phase: "capture" | "handled" | "link" | "metadata" | "unsupported-images",
    ctx: ExtensionContext,
  ): void | Promise<void>;
}

export interface RegisteredUserInputHook {
  readonly metadataNamespace: typeof METADATA_NAMESPACE;
  reconcile(ctx: ExtensionContext): Promise<void>;
}

interface PersistedIngressMetadata {
  version: 1;
  inputId: string;
  receiptId: string;
  operationId: string;
  originSessionId: string;
  cursor: RuntimeCursor;
  rawTextHash: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function snapshotCursor(value: RuntimeCursor): RuntimeCursor {
  if (!value || typeof value !== "object") throw new TypeError("PCR_PI_INPUT_CURSOR_INVALID");
  const cursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (
    typeof cursor.workspaceId !== "string"
    || !/^ws_[a-f0-9]{40}$/u.test(cursor.workspaceId)
    || typeof cursor.sessionId !== "string"
    || cursor.sessionId.length === 0
    || (cursor.leafId !== null && (typeof cursor.leafId !== "string" || cursor.leafId.length === 0))
    || typeof cursor.lineageHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(cursor.lineageHash)
    || typeof cursor.modelKey !== "string"
    || cursor.modelKey.length === 0
  ) throw new TypeError("PCR_PI_INPUT_CURSOR_INVALID");
  return Object.freeze(cursor);
}

function sourceClass(source: InputEvent["source"]): UserInputReceipt["sourceClass"] {
  if (source === "interactive") return "authenticated-user";
  if (source === "extension") return "agent-derived";
  return "untrusted-user";
}

function parseMetadata(value: unknown): PersistedIngressMetadata | null {
  const record = asRecord(value);
  if (
    record.version !== 1
    || typeof record.inputId !== "string"
    || !INPUT_ID_PATTERN.test(record.inputId)
    || typeof record.receiptId !== "string"
    || !/^receipt_[a-f0-9]{64}$/u.test(record.receiptId)
    || typeof record.operationId !== "string"
    || !/^input_[a-f0-9]{64}$/u.test(record.operationId)
    || typeof record.originSessionId !== "string"
    || record.originSessionId.length === 0
    || typeof record.rawTextHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(record.rawTextHash)
  ) return null;
  try {
    return Object.freeze({
      version: 1,
      inputId: record.inputId,
      receiptId: record.receiptId,
      operationId: record.operationId,
      originSessionId: record.originSessionId,
      cursor: snapshotCursor(record.cursor as RuntimeCursor),
      rawTextHash: record.rawTextHash,
    });
  } catch {
    return null;
  }
}

function metadataFromReceipt(
  receipt: UserInputReceipt,
  inputId: string,
  originSessionId: string,
): PersistedIngressMetadata {
  return Object.freeze({
    version: 1,
    inputId,
    receiptId: receipt.receiptId,
    operationId: receipt.operationId,
    originSessionId,
    cursor: snapshotCursor(receipt.cursor),
    rawTextHash: receipt.rawTextHash,
  });
}

function metadataValue(value: unknown): unknown {
  return asRecord(value)[METADATA_NAMESPACE];
}

function validateDependencies(input: UserInputHookDependencies): void {
  if (!input || typeof input !== "object") throw new TypeError("PCR_PI_INPUT_DEPENDENCY_MISSING:input");
  if (typeof input.cursor !== "function") throw new TypeError("PCR_PI_INPUT_DEPENDENCY_MISSING:cursor");
  if (typeof input.service !== "function") throw new TypeError("PCR_PI_INPUT_DEPENDENCY_MISSING:service");
  if (!input.clock || typeof input.clock.now !== "function") throw new TypeError("PCR_PI_INPUT_DEPENDENCY_MISSING:clock");
  if (typeof input.onHardFailure !== "function") throw new TypeError("PCR_PI_INPUT_DEPENDENCY_MISSING:onHardFailure");
}

export function registerUserInputHook(
  pi: Pick<ExtensionAPI, "on">,
  dependencies: UserInputHookDependencies,
): RegisteredUserInputHook {
  if (!pi || typeof pi.on !== "function") throw new TypeError("PCR_PI_INPUT_DEPENDENCY_MISSING:pi");
  validateDependencies(dependencies);
  const linkedEntries = new Set<string>();

  const fail = async (
    error: unknown,
    phase: Parameters<UserInputHookDependencies["onHardFailure"]>[1],
    ctx: ExtensionContext,
  ): Promise<void> => {
    try {
      ctx.abort();
    } catch {
      // The explicit failure sink remains authoritative if a stale Pi context rejects abort.
    }
    try {
      await dependencies.onHardFailure(error, phase, ctx);
    } catch {
      // Pi swallows hook exceptions; do not replace the original ingress failure.
    }
  };

  const reconcile = async (ctx: ExtensionContext): Promise<void> => {
    const originSessionId = ctx.sessionManager.getSessionId();
    for (const value of ctx.sessionManager.getEntries()) {
      const entry = asRecord(value);
      if (entry.type !== "message" || typeof entry.id !== "string" || linkedEntries.has(entry.id)) continue;
      const message = asRecord(entry.message);
      if (message.role !== "user") continue;
      const sidecar = asRecord(entry.ingressMetadata);
      if (!Object.hasOwn(sidecar, METADATA_NAMESPACE)) continue;
      const metadata = parseMetadata(sidecar[METADATA_NAMESPACE]);
      if (!metadata) {
        await fail(new TypeError("PCR_PI_INPUT_METADATA_INVALID"), "metadata", ctx);
        return;
      }
      if (metadata.originSessionId !== originSessionId) continue;
      try {
        const service = await dependencies.service(metadata.cursor, ctx);
        await service.link(metadata.receiptId, entry.id);
        linkedEntries.add(entry.id);
      } catch (error) {
        await fail(error, "link", ctx);
        return;
      }
    }
  };

  pi.on("input", async (event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> => {
    if (event.images && event.images.length > 0) {
      const error = new TypeError("PCR_PI_INPUT_IMAGES_UNSUPPORTED");
      await fail(error, "unsupported-images", ctx);
      return { action: "reject", error };
    }
    try {
      if (!INPUT_ID_PATTERN.test(event.inputId)) throw new TypeError("PCR_PI_INPUT_ID_INVALID");
      const cursor = snapshotCursor(dependencies.cursor(ctx));
      const capturedAt = dependencies.clock.now();
      if (!Number.isSafeInteger(capturedAt) || capturedAt < 0) throw new TypeError("PCR_PI_INPUT_CLOCK_INVALID");
      const operationId = `input_${domainHash("pi-input-operation", {
        cursor,
        inputId: event.inputId,
        source: event.source,
        streamingBehavior: event.streamingBehavior ?? null,
      })}`;
      const service = await dependencies.service(cursor, ctx);
      const receipt = await service.capture({
        operationId,
        cursor,
        rawText: event.text,
        sourceClass: sourceClass(event.source),
        capturedAt,
        ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      });
      const originSessionId = ctx.sessionManager.getSessionId();
      if (originSessionId !== cursor.sessionId) throw new TypeError("PCR_PI_INPUT_SESSION_MISMATCH");
      const ingressMetadata = {
        [METADATA_NAMESPACE]: metadataFromReceipt(receipt, event.inputId, originSessionId),
      } as never;
      return receipt.status === "handled"
        ? { action: "handled", ingressMetadata }
        : { action: "continue", ingressMetadata };
    } catch (error) {
      await fail(error, "capture", ctx);
      return { action: "reject", error };
    }
  });

  pi.on("input_result", async (event, ctx) => {
    if (event.action !== "handled" && event.action !== "rejected") return;
    const value = metadataValue(event.ingressMetadata);
    if (value === undefined) return;
    const metadata = parseMetadata(value);
    if (!metadata) {
      await fail(new TypeError("PCR_PI_INPUT_METADATA_INVALID"), "metadata", ctx);
      return;
    }
    try {
      const service = await dependencies.service(metadata.cursor, ctx);
      await service.abandon(metadata.receiptId, "handled");
    } catch (error) {
      await fail(error, "handled", ctx);
      throw error;
    }
  });

  pi.on("message_start", async (_event: MessageStartEvent, ctx: ExtensionContext) => reconcile(ctx));
  pi.on("agent_settled", async (_event: AgentSettledEvent, ctx: ExtensionContext) => reconcile(ctx));
  pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => reconcile(ctx));
  pi.on("session_tree", async (_event: SessionTreeEvent, ctx: ExtensionContext) => reconcile(ctx));

  return Object.freeze({ metadataNamespace: METADATA_NAMESPACE, reconcile });
}
