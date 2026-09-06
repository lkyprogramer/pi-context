import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { createPiContextExtension, resolveRuntimeMode } from "../../apps/pi-context-runtime/src/extension.js";
import { resetOwnerForTest } from "../../apps/pi-context-runtime/src/owner.js";
import { capsuleRetainsWorkingState, renderModelCheckpointView } from "../../packages/runtime/src/compaction-service.js";

afterEach(() => {
  delete process.env.PCR_RUNTIME_MODE;
  delete process.env.PCR_EVAL_MATERIALIZER;
  resetOwnerForTest();
});

describe("default extension profile", () => {
  it("does not register background worker unless semantic beta is enabled", () => {
    const source = readFileSync("apps/pi-context-runtime/src/extension.ts", "utf8");
    expect(source).toMatch(/PCR_SEMANTIC_BETA === "1"/);
    expect(source).toMatch(/if \(semanticBeta\) registerBackgroundHook/);
    expect(source).not.toMatch(/sys_runtime/);
    expect(source).not.toMatch(/lastRecoveredCursor/);
    expect(source).not.toMatch(/sessionId:\s*"unbound"/);
    expect(source).toMatch(/domainHash\("session-system"/);
    expect(source).toMatch(/PCR_RUNTIME_TOOLS_CURSOR_MISSING/);
    expect(source).toMatch(/PCR_RUNTIME_MODE/);
    expect(source).not.toMatch(/publicationClaim/);
    expect(source).not.toMatch(/PCR_EVAL_MATERIALIZER/);
  });

  it("keeps native compaction unless runtime takeover is explicit", () => {
    expect(resolveRuntimeMode(undefined)).toBe("ingress");
    expect(resolveRuntimeMode("experimental-runtime")).toBe("experimental-runtime");
    expect(() => resolveRuntimeMode("typo")).toThrow();
  });

  it("rejects unknown runtime modes with CONFIG_ERROR", () => {
    expect(() => resolveRuntimeMode("typo")).toThrowError(/CONFIG_ERROR/);
    try {
      resolveRuntimeMode("full");
      throw new Error("expected CONFIG_ERROR");
    } catch (error) {
      expect(error).toMatchObject({ code: "CONFIG_ERROR" });
    }
  });

  it("does not treat PCR_EVAL_MATERIALIZER as experimental-runtime", () => {
    process.env.PCR_EVAL_MATERIALIZER = "pcr";
    expect(resolveRuntimeMode(undefined)).toBe("ingress");
    expect(resolveRuntimeMode(process.env.PCR_RUNTIME_MODE)).toBe("ingress");
  });

  it("off registers no mutating hooks", () => {
    process.env.PCR_RUNTIME_MODE = "off";
    const hooks: Record<string, unknown> = {};
    const ext = createPiContextExtension({
      on(hook, handler) { hooks[hook] = handler; },
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    });
    expect(ext.claimed).toBe(false);
    expect(hooks).toEqual({});
  });

  it("default install returns original context order and yields native compaction", async () => {
    delete process.env.PCR_RUNTIME_MODE;
    const hooks: Record<string, (event: unknown, ctx: unknown) => Promise<unknown>> = {};
    const ext = createPiContextExtension({
      on(hook, next) { hooks[hook] = next as typeof hooks[string]; },
      registerTool() {},
      registerCommand() {},
      hasTool() { return false; },
    });
    expect(ext.claimed).toBe(true);
    const messages = [
      { role: "user", content: "keep-order-a" },
      { role: "user", content: "keep-order-b" },
    ];
    const rewritten = await hooks.context?.({ messages }, { abort() {} });
    expect(rewritten).toEqual({ messages });
    const compact = await hooks.session_before_compact?.({
      reason: "overflow",
      preparation: { tokensBefore: 4096, firstKeptEntryId: "entry-keep" },
    }, { abort() {} });
    expect(compact).toBeUndefined();
    await ext.release?.();
  });

  it("does not write tests passed from unknown work state", () => {
    const view = renderModelCheckpointView({
      snapshotHash: "a".repeat(64),
      directives: [{
        directiveId: "d".repeat(64),
        exactQuote: "do not deploy",
        kind: "prohibition",
        polarity: "must-not",
        status: "active",
      }],
      claims: [{ claimId: "c1", key: "outcome", polarity: "is", status: "active", value: "tests passed" }],
      pointers: [{ ref: "broken", kind: "evidence" }],
      heads: { contextHead: "1".repeat(64) },
      continuity: { revisionId: "cr_".padEnd(64, "e") },
    });
    expect(view.summary).toContain("do not deploy");
    expect(view.summary).not.toMatch(/tests passed/i);
    expect(view.summary).not.toContain("broken");
  });

  it("does not treat a short directive-only capsule as complete when work is pending", () => {
    expect(capsuleRetainsWorkingState("do not deploy", { activeTitles: ["fix failing tests"] })).toBe(false);
    expect(capsuleRetainsWorkingState("pending: fix failing tests\ndo not deploy", {
      activeTitles: ["fix failing tests"],
    })).toBe(true);
  });
});
