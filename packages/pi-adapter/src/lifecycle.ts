import { catchUpSession, type SessionStartReason } from "../../kernel/src/lifecycle/catch-up.js";
import { switchBranchScope } from "../../kernel/src/lifecycle/branch-scope.js";

export interface LifecycleEvent {
  reason?: SessionStartReason;
  newLeafId?: string;
  hasRawBlobs?: boolean;
}

export interface LifecycleCtx {
  sessionId?: string;
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

export { catchUpSession, switchBranchScope };
