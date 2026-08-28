import { describe, expect, it } from "vitest";
import { classifyInputSource, InputCorrelator } from "../src/directives/raw-input.js";

describe("InputCorrelator", () => {
  it("keeps raw text while linking the expanded persisted user message", () => {
    const c = new InputCorrelator();
    const raw = c.capture({ sessionId: "s1", source: "interactive", text: "/skill:review src/x.ts", at: 10 });
    const linked = c.link(raw.operationId, { hostMessageId: "m1", expandedText: "<skill>...\nsrc/x.ts", at: 11 });
    expect(linked.rawText).toBe("/skill:review src/x.ts");
    expect(linked.sourceClass).toBe("authenticated-user");
  });

  it("does not cross-link two queued identical texts", () => {
    const c = new InputCorrelator();
    const first = c.capture({ sessionId: "s1", source: "interactive", text: "same", at: 1 });
    const second = c.capture({ sessionId: "s1", source: "interactive", text: "same", at: 2 });
    expect(first.operationId).not.toBe(second.operationId);
    const linkedFirst = c.link(first.operationId, { hostMessageId: "m1", expandedText: "same", at: 3 });
    const linkedSecond = c.link(second.operationId, { hostMessageId: "m2", expandedText: "same", at: 4 });
    expect(linkedFirst.hostMessageId).toBe("m1");
    expect(linkedSecond.hostMessageId).toBe("m2");
    expect(() =>
      new InputCorrelator().capture({ sessionId: "s1", source: "interactive", text: "same", at: 1 }).operationId &&
        new InputCorrelator(),
    ).toBeTruthy();
    const isolated = new InputCorrelator();
    const a = isolated.capture({ sessionId: "s1", source: "interactive", text: "same", at: 1 });
    isolated.capture({ sessionId: "s1", source: "interactive", text: "same", at: 2 });
    expect(() => isolated.link(a.operationId, { hostMessageId: "m9", expandedText: "same", at: 3 })).not.toThrow();
    const crossed = new InputCorrelator();
    crossed.capture({ sessionId: "s1", source: "interactive", text: "same", at: 1 });
    const later = crossed.capture({ sessionId: "s1", source: "interactive", text: "same", at: 2 });
    expect(() => crossed.link(later.operationId, { hostMessageId: "m2", expandedText: "same", at: 4 })).toThrow(
      /PCR_INPUT_CROSS_LINK/,
    );
  });

  it("preserves steer and follow-up source identity", () => {
    const c = new InputCorrelator();
    const steer = c.capture({ sessionId: "s1", source: "interactive", text: "stop", at: 1, kind: "steer" });
    const follow = c.capture({ sessionId: "s1", source: "interactive", text: "also", at: 2, kind: "follow-up" });
    expect(steer.kind).toBe("steer");
    expect(follow.kind).toBe("follow-up");
    expect(steer.sourceClass).toBe("authenticated-user");
  });

  it("trusts RPC only with an explicit authenticated channel", () => {
    expect(classifyInputSource("rpc")).toBe("untrusted-user");
    expect(classifyInputSource("rpc", true)).toBe("authenticated-user");
    expect(classifyInputSource("extension")).toBe("agent-derived");
    const c = new InputCorrelator();
    const untrusted = c.capture({ sessionId: "s1", source: "rpc", text: "run", at: 1 });
    const trusted = c.capture({ sessionId: "s1", source: "rpc", text: "run", at: 2, trustedRpc: true });
    expect(untrusted.sourceClass).toBe("untrusted-user");
    expect(trusted.sourceClass).toBe("authenticated-user");
  });

  it("expires an orphan raw receipt by policy while keeping it auditable", () => {
    const c = new InputCorrelator();
    const raw = c.capture({ sessionId: "s1", source: "interactive", text: "orphan", at: 10 });
    const expired = c.expireOrphans(100, 50);
    expect(expired.map((item) => item.operationId)).toEqual([raw.operationId]);
    expect(c.get(raw.operationId)).toMatchObject({ rawText: "orphan", expired: true });
  });
});
