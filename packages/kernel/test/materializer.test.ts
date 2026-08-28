import { describe, expect, it } from "vitest";
import type { HostMessage, MaterializationInput } from "../../contracts/src/index.js";
import { ContextMaterializer } from "../src/materialization/materializer.js";

function msg(partial: Partial<HostMessage> & Pick<HostMessage, "role" | "hostMessageId">): HostMessage {
  return {
    timestamp: 1,
    content: [{ type: "text", text: partial.hostMessageId }],
    sourceClass: partial.role === "user" ? "authenticated-user" : "agent-derived",
    ...partial,
  };
}

function fixtureInput(): MaterializationInput {
  return {
    cursor: {
      workspaceId: "ws_0123456789abcdef",
      sessionId: "s1",
      leafId: "leaf",
      lineageHash: "1111111111111111111111111111111111111111111111111111111111111111",
      modelKey: "test",
      thinkingLevel: "off",
    },
    canonicalMessages: [
      msg({ role: "user", hostMessageId: "u-old", content: [{ type: "text", text: "old" }] }),
      msg({ role: "assistant", hostMessageId: "a-old", content: [{ type: "text", text: "ack" }] }),
      msg({ role: "user", hostMessageId: "u-now", content: [{ type: "text", text: "now" }] }),
    ],
    currentContextWindow: 8000,
    maxOutputTokens: 1000,
    reason: "normal",
    now: 1,
  };
}

function fixtureMaterializer(): ContextMaterializer {
  return new ContextMaterializer({
    directives: "do not deploy prod",
    historyText: "yesterday's work",
    directoryText: "src/\nREADME.md",
    recallText: "leased recall page",
  });
}

describe("materializer", () => {
  it("places volatile recall before the exact active-turn suffix and preserves user-last semantics", async () => {
    const view = await fixtureMaterializer().materialize(fixtureInput());
    expect(view.sections.map((x) => x.cacheZone)).toEqual(
      expect.arrayContaining(["stable-prefix", "append-only-history", "volatile-augmentation", "active-turn"]),
    );
    expect(view.messages.at(-1)?.sourceClass).toBe("authenticated-user");
    expect(view.tokenEstimate).toBeLessThanOrEqual(fixtureInput().currentContextWindow - fixtureInput().maxOutputTokens);
    const kinds = view.sections.map((item) => item.kind);
    expect(kinds.indexOf("retrieval-page")).toBeLessThan(kinds.indexOf("active-turn"));
  });

  it("aborts when hard directives cannot fit the effective input budget", async () => {
    const materializer = new ContextMaterializer({ directives: "MUST ".repeat(4000) });
    await expect(
      materializer.materialize({ ...fixtureInput(), currentContextWindow: 80, maxOutputTokens: 40 }),
    ).rejects.toThrow(/PCR_DIRECTIVE_BUDGET_EXCEEDED/);
  });

  it("drops leases, directory, resolved state, then history, never directives or suffix", async () => {
    const materializer = new ContextMaterializer({
      directives: "keep",
      historyText: "H".repeat(2000),
      directoryText: "D".repeat(2000),
      recallText: "R".repeat(2000),
      continuityText: "ok",
    });
    const view = await materializer.materialize({
      ...fixtureInput(),
      currentContextWindow: 80,
      maxOutputTokens: 20,
    });
    const kinds = view.sections.map((item) => item.kind);
    expect(kinds).toContain("hard-directives");
    expect(kinds).toContain("active-turn");
    expect(kinds).not.toContain("retrieval-page");
    expect(kinds).not.toContain("directory");
    expect(view.omissions.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["retrieval-page", "directory"]),
    );
  });

  it("is deterministic and ignores cache toggle for outputHash", async () => {
    const input = fixtureInput();
    const a = await new ContextMaterializer({ directives: "keep", cacheEnabled: true }).materialize(input);
    const b = await new ContextMaterializer({ directives: "keep", cacheEnabled: true }).materialize(input);
    const c = await new ContextMaterializer({ directives: "keep", cacheEnabled: false }).materialize(input);
    expect(a.outputHash).toBe(b.outputHash);
    expect(a.outputHash).toBe(c.outputHash);
    expect(a.cachePlan.providerCapability).not.toBe(c.cachePlan.providerCapability);
  });
});
