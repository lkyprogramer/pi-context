import { describe, expect, it } from "vitest";

import { authorizeAction, createRuntimeCursor } from "@pcr/core";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t22-authority",
    sessionId: "session-t22-authority",
    leafId: "leaf-t22-authority",
    lineageEntryIds: ["root", "leaf-t22-authority"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

describe("authority gate", () => {
  it("defaults custom, mcp, and external tools to untrusted-tool", () => {
    const bound = cursor();
    const policy = { allowlistedToolNames: ["read"] };
    for (const origin of ["custom", "mcp", "external"] as const) {
      const decision = authorizeAction({
        cursor: bound,
        toolName: `mystery-${origin}`,
        origin,
        requestedAuthority: "act",
        verifiedReceipt: true,
        policy,
      });
      expect(decision).toMatchObject({
        kind: "deny",
        sourceClass: "untrusted-tool",
        authority: "inform",
      });
    }
  });

  it("requires an allowlisted name and verified receipt before trusted-tool", () => {
    const bound = cursor();
    const policy = { allowlistedToolNames: ["read"] };
    expect(authorizeAction({
      cursor: bound,
      toolName: "read",
      origin: "builtin",
      requestedAuthority: "act",
      verifiedReceipt: false,
      policy,
    }).sourceClass).toBe("untrusted-tool");
    expect(authorizeAction({
      cursor: bound,
      toolName: "read",
      origin: "builtin",
      requestedAuthority: "act",
      verifiedReceipt: true,
      policy,
    })).toMatchObject({ kind: "allow", sourceClass: "trusted-tool", authority: "act" });
  });

  it("does not escalate untrusted evidence to act", () => {
    const decision = authorizeAction({
      cursor: cursor(),
      toolName: "deploy",
      origin: "custom",
      requestedAuthority: "act",
      verifiedReceipt: true,
      policy: { allowlistedToolNames: ["deploy"] },
    });
    expect(decision.kind).toBe("deny");
    expect(decision.authority).toBe("inform");
    expect(decision.sourceClass).toBe("untrusted-tool");
  });
});
