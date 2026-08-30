import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import {
  createAuthorizationService,
  type ActionAuthorizationInput,
  type ToolTrustPolicy,
} from "@pcr/runtime";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t22",
    sessionId: "session-t22",
    leafId: "leaf-t22",
    lineageEntryIds: ["root", "leaf-t22"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function policy(): ToolTrustPolicy {
  return { allowlistedToolNames: ["read", "search"] };
}

function service() {
  return createAuthorizationService({ cursor: cursor(), policy: policy() });
}

function input(
  overrides: Partial<ActionAuthorizationInput> = {},
): Omit<ActionAuthorizationInput, "policy"> {
  return {
    cursor: cursor(),
    toolName: "read",
    origin: "builtin",
    requestedAuthority: "act",
    verifiedReceipt: true,
    ...overrides,
  };
}

async function runT22Fixture() {
  const gate = service();
  const custom = gate.authorize(input({
    toolName: "mystery-mcp",
    origin: "mcp",
    requestedAuthority: "act",
    verifiedReceipt: true,
  }));
  const external = gate.authorize(input({
    toolName: "web-scrape",
    origin: "external",
    requestedAuthority: "act",
  }));
  const customTool = gate.authorize(input({
    toolName: "user-script",
    origin: "custom",
    requestedAuthority: "act",
  }));
  const unverifiedBuiltin = gate.authorize(input({
    toolName: "read",
    origin: "builtin",
    requestedAuthority: "act",
    verifiedReceipt: false,
  }));
  const trusted = gate.authorize(input({
    toolName: "read",
    origin: "builtin",
    requestedAuthority: "act",
    verifiedReceipt: true,
  }));
  const informUntrusted = gate.authorize(input({
    toolName: "mystery-mcp",
    origin: "mcp",
    requestedAuthority: "inform",
    verifiedReceipt: true,
  }));
  expect(custom).toMatchObject({
    kind: "deny",
    code: "PCR_ACTION_AUTHORITY_MISSING",
    sourceClass: "untrusted-tool",
    authority: "inform",
  });
  expect(external).toMatchObject({
    kind: "deny",
    sourceClass: "untrusted-tool",
    authority: "inform",
  });
  expect(customTool).toMatchObject({
    kind: "deny",
    sourceClass: "untrusted-tool",
  });
  expect(unverifiedBuiltin).toMatchObject({
    kind: "deny",
    sourceClass: "untrusted-tool",
  });
  expect(trusted).toMatchObject({
    kind: "allow",
    sourceClass: "trusted-tool",
    authority: "act",
  });
  expect(informUntrusted).toMatchObject({
    kind: "allow",
    sourceClass: "untrusted-tool",
    authority: "inform",
  });
  expect(gate.authorize(input({
    toolName: "read",
    origin: "builtin",
    requestedAuthority: "act",
    verifiedReceipt: true,
  }))).toEqual(trusted);
  return { ok: true as const, task: "T22" as const, trusted, custom };
}

describe("T22 Tool trust and action authority gate", () => {
  it("tool_trust_and_action_authority_gate", async () => {
    await expect(runT22Fixture()).resolves.toMatchObject({ ok: true, task: "T22" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createAuthorizationService({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_AUTHORIZATION_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed input instead of defaulting trust", () => {
    const gate = service();
    expect(() => gate.authorize({} as never)).toThrowError(/PCR_AUTHORIZATION_INPUT_INVALID/);
    expect(() => gate.authorize(input({ origin: "unknown-origin" as never }))).toThrowError(
      /PCR_AUTHORIZATION_INPUT_INVALID/,
    );
  });

  it("replays the same authorization without changing the decision", () => {
    const gate = service();
    const first = gate.authorize(input());
    const second = gate.authorize(input());
    expect(second).toEqual(first);
    expect(first.kind).toBe("allow");
  });

  it("rejects a cursor from another workspace/session/branch", () => {
    const gate = service();
    const other = { ...cursor(), sessionId: "other-session" };
    expect(() => gate.authorize(input({ cursor: other }))).toThrowError(/PCR_AUTHORIZATION_SCOPE_MISMATCH/);
  });

  it("does not let untrusted evidence raise a requested act decision", () => {
    const gate = service();
    const decision = gate.authorize(input({
      toolName: "deploy",
      origin: "custom",
      requestedAuthority: "act",
      verifiedReceipt: true,
    }));
    expect(decision.kind).toBe("deny");
    expect(decision.sourceClass).toBe("untrusted-tool");
    expect(decision.authority).not.toBe("act");
  });

  it("stops at the abort boundary before authorizing", () => {
    const gate = service();
    const controller = new AbortController();
    controller.abort();
    expect(() => gate.authorize(input({ signal: controller.signal }))).toThrow();
  });
});
