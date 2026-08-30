import type { RuntimeCursor } from "../../contracts/src/index.js";
import { catchUpSession, type SessionStartReason } from "../../kernel/src/lifecycle/catch-up.js";
import { switchBranchScope } from "../../kernel/src/lifecycle/branch-scope.js";
import type { RecoveryService } from "../../runtime/src/recovery-service.js";

export interface LifecycleEvent {
  reason?: SessionStartReason;
  newLeafId?: string;
  hasRawBlobs?: boolean;
}

export interface LifecycleCtx {
  sessionId?: string;
  cwd?: string;
  signal?: AbortSignal;
  sessionManager?: {
    getSessionId(): string;
    getLeafId(): string | null;
    getBranch(): Array<{ id: string }>;
    getHeader(): { id: string } | null | undefined;
  };
  model?: { provider?: string; id?: string };
}

export interface LifecycleRuntime {
  openSession(ctx: LifecycleCtx, reason: SessionStartReason, hasRawBlobs?: boolean): Promise<void>;
  switchBranch(ctx: LifecycleCtx, newLeafId: string): Promise<void>;
  closeSession(ctx: LifecycleCtx): Promise<void>;
  invalidateRouteCandidates(ctx: LifecycleCtx): Promise<void>;
}

export interface LifecycleExtensionAPI {
  on(hook: string, handler: (event: LifecycleEvent, ctx: LifecycleCtx) => Promise<unknown>): void;
}

export function registerSessionLifecycle(pi: LifecycleExtensionAPI, runtime: LifecycleRuntime): void {
  if (!pi || typeof pi.on !== "function") throw new TypeError("PCR_LIFECYCLE_DEPENDENCY_MISSING");
  if (!runtime || typeof runtime.openSession !== "function") throw new TypeError("PCR_LIFECYCLE_DEPENDENCY_MISSING");
  pi.on("session_start", async (event, ctx) => {
    await runtime.openSession(ctx, event.reason ?? "new", event.hasRawBlobs);
  });
  pi.on("session_tree", async (event, ctx) => {
    await runtime.switchBranch(ctx, event.newLeafId ?? "leaf");
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    await runtime.closeSession(ctx);
  });
  pi.on("model_select", async (_event, ctx) => {
    await runtime.invalidateRouteCandidates(ctx);
  });
}

export function createLifecycleRuntimeFromRecovery(input: {
  recovery: RecoveryService;
  cursorFrom(ctx: LifecycleCtx): RuntimeCursor;
}): LifecycleRuntime {
  if (!input || typeof input !== "object") throw new TypeError("PCR_LIFECYCLE_DEPENDENCY_MISSING");
  if (!input.recovery || typeof input.recovery.onSessionStart !== "function") {
    throw new TypeError("PCR_LIFECYCLE_DEPENDENCY_MISSING");
  }
  if (typeof input.cursorFrom !== "function") throw new TypeError("PCR_LIFECYCLE_DEPENDENCY_MISSING");
  const recovery = input.recovery;
  const cursorFrom = input.cursorFrom;
  let current: RuntimeCursor | undefined;
  return {
    async openSession(ctx, reason, hasRawBlobs = true) {
      const cursor = cursorFrom(ctx);
      current = cursor;
      await recovery.onSessionStart({ cursor, reason, hasRawBlobs, signal: ctx.signal });
    },
    async switchBranch(ctx, newLeafId) {
      const cursor = cursorFrom(ctx);
      const previous = current ?? cursor;
      current = cursor;
      await recovery.onBranchChange({ cursor, previousCursor: previous, newLeafId, signal: ctx.signal });
    },
    async closeSession(ctx) {
      const cursor = current ?? cursorFrom(ctx);
      current = undefined;
      await recovery.onSessionClose({ cursor, signal: ctx.signal });
    },
    async invalidateRouteCandidates(ctx) {
      const cursor = current ?? cursorFrom(ctx);
      await recovery.onSessionStart({
        cursor,
        reason: "reload",
        hasRawBlobs: true,
        signal: ctx.signal,
      });
    },
  };
}

export { catchUpSession, switchBranchScope };
