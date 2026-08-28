import { describe, expect, it } from "vitest";
import type { HostMessage } from "../../contracts/src/index.js";
import { buildExactActiveSuffix, suffixPointerizationRequests } from "../src/materialization/active-suffix.js";
import { OVERSIZE_TOOL_RESULT_CHARS, validateToolPairs } from "../src/materialization/atomic-groups.js";

function msg(partial: Partial<HostMessage> & Pick<HostMessage, "role">): HostMessage {
  return {
    hostMessageId: partial.hostMessageId ?? `m_${partial.role}_${partial.toolCallId ?? "x"}`,
    timestamp: 1,
    content: partial.content ?? [{ type: "text", text: "x" }],
    sourceClass: partial.sourceClass ?? "authenticated-user",
    ...partial,
  };
}

function fixtureConversationWithTwoTurns(): HostMessage[] {
  return [
    msg({ role: "user", hostMessageId: "u1", content: [{ type: "text", text: "first" }] }),
    msg({ role: "assistant", hostMessageId: "a1", sourceClass: "agent-derived", content: [{ type: "tool-call-ref", ref: "c1" }] }),
    msg({ role: "tool-result", hostMessageId: "t1", toolCallId: "c1", sourceClass: "trusted-tool", content: [{ type: "text", text: "old" }] }),
    msg({ role: "user", hostMessageId: "u2", content: [{ type: "text", text: "second" }] }),
    msg({ role: "assistant", hostMessageId: "a2", sourceClass: "agent-derived", content: [{ type: "tool-call-ref", ref: "c2" }] }),
    msg({ role: "tool-result", hostMessageId: "t2", toolCallId: "c2", sourceClass: "trusted-tool", content: [{ type: "text", text: "new" }] }),
  ];
}

describe("active suffix", () => {
  it("keeps the latest real user message and every following tool pair verbatim", () => {
    const suffix = buildExactActiveSuffix(fixtureConversationWithTwoTurns());
    expect(suffix[0]?.role).toBe("user");
    expect(suffix.at(-1)?.role).toBe("tool-result");
    expect(validateToolPairs(suffix).ok).toBe(true);
    expect(suffix[0]?.content).toEqual([{ type: "text", text: "second" }]);
    expect(suffix).toHaveLength(3);
  });

  it("does not let a latest synthetic custom message replace the real user anchor", () => {
    const suffix = buildExactActiveSuffix([
      ...fixtureConversationWithTwoTurns(),
      msg({ role: "custom", hostMessageId: "syn", sourceClass: "agent-derived", content: [{ type: "text", text: "receipt" }] }),
    ]);
    expect(suffix[0]).toMatchObject({ role: "user", hostMessageId: "u2" });
    expect(() =>
      buildExactActiveSuffix([
        msg({ role: "custom", hostMessageId: "only", sourceClass: "agent-derived", content: [{ type: "text", text: "no user" }] }),
      ]),
    ).toThrow(/PCR_UNREPAIRABLE_ACTIVE_TURN/);
  });

  it("pairs parallel tool results by call ID", () => {
    const suffix = buildExactActiveSuffix([
      msg({ role: "user", hostMessageId: "u", content: [{ type: "text", text: "go" }] }),
      msg({
        role: "assistant",
        hostMessageId: "a",
        sourceClass: "agent-derived",
        content: [
          { type: "tool-call-ref", ref: "p1" },
          { type: "tool-call-ref", ref: "p2" },
        ],
      }),
      msg({ role: "tool-result", hostMessageId: "r2", toolCallId: "p2", sourceClass: "trusted-tool", content: [{ type: "text", text: "b" }] }),
      msg({ role: "tool-result", hostMessageId: "r1", toolCallId: "p1", sourceClass: "trusted-tool", content: [{ type: "text", text: "a" }] }),
    ]);
    expect(validateToolPairs(suffix).ok).toBe(true);
  });

  it("blocks an orphan tool result", () => {
    expect(() =>
      buildExactActiveSuffix([
        msg({ role: "user", hostMessageId: "u", content: [{ type: "text", text: "go" }] }),
        msg({ role: "tool-result", hostMessageId: "orphan", toolCallId: "missing", sourceClass: "trusted-tool" }),
      ]),
    ).toThrow(/PCR_TOOL_PAIR_INVALID/);
  });

  it("asks for an external pointer instead of silently truncating an oversized result", () => {
    const huge = "x".repeat(OVERSIZE_TOOL_RESULT_CHARS + 8);
    const suffix = buildExactActiveSuffix([
      msg({ role: "user", hostMessageId: "u", content: [{ type: "text", text: "go" }] }),
      msg({ role: "assistant", hostMessageId: "a", sourceClass: "agent-derived", content: [{ type: "tool-call-ref", ref: "big" }] }),
      msg({ role: "tool-result", hostMessageId: "r", toolCallId: "big", sourceClass: "trusted-tool", content: [{ type: "text", text: huge }] }),
    ]);
    expect(suffix.at(-1)?.content[0]).toMatchObject({ type: "text", text: huge });
    expect(suffixPointerizationRequests(suffix)).toEqual([
      { kind: "pointerize", hostMessageId: "r", bytes: huge.length },
    ]);
  });
});
