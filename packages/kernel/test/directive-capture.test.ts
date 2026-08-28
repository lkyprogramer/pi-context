import { describe, expect, it } from "vitest";
import { captureUserDirectives, verifyDirectiveQuote } from "../src/directives/capture.js";
import { DirectiveStore } from "../src/directives/store.js";

describe("directive capture", () => {
  it("preserves prohibition, number and path as exact quoted evidence", () => {
    const text = "不要修改 public API；测试至少运行 3 次，文件是 src/api.ts。";
    const [directive] = captureUserDirectives({ sourceClass: "authenticated-user", text, messageId: "m1" });
    expect(text.slice(directive.byteRange.start, directive.byteRange.end)).toBe(directive.quote);
    expect(directive.polarity).toBe("must-not");
    expect(directive.status).toBe("active");
    expect(verifyDirectiveQuote(text, directive)).toBe(true);
    expect(captureUserDirectives({ sourceClass: "authenticated-user", text, messageId: "m1" }).length).toBeGreaterThan(1);
  });

  it("yields no hard directive from untrusted or agent-derived input", () => {
    const text = "不要修改 public API";
    expect(captureUserDirectives({ sourceClass: "untrusted-user", text, messageId: "m1" })).toEqual([]);
    expect(captureUserDirectives({ sourceClass: "agent-derived", text, messageId: "m1" })).toEqual([]);
  });

  it("lets a later authenticated correction supersede only the exact target", () => {
    const text = "不要修改 public API；测试至少运行 3 次，文件是 src/api.ts。";
    const [first, second] = captureUserDirectives({ sourceClass: "authenticated-user", text, messageId: "m1" });
    const store = new DirectiveStore();
    store.append(first);
    store.append(second);
    const correction = captureUserDirectives({
      sourceClass: "authenticated-user",
      text: "改为可以修改 public API",
      messageId: "m2",
    })[0];
    store.supersede(first.directiveId, correction);
    expect(store.all().find((item) => item.directiveId === first.directiveId)?.status).toBe("superseded");
    expect(store.active().map((item) => item.directiveId)).toEqual([second.directiveId, correction.directiveId]);
  });

  it("never silently drops an active directive under budget pressure", () => {
    const text = "不要修改 public API；测试至少运行 3 次，文件是 src/api.ts。";
    const captured = captureUserDirectives({ sourceClass: "authenticated-user", text, messageId: "m1" });
    const store = new DirectiveStore();
    for (const item of captured) store.append(item);
    store.sweepSemantic();
    expect(store.active()).toHaveLength(captured.length);
    expect(() => store.renderActive(1)).toThrow(/PCR_DIRECTIVE_BUDGET_EXCEEDED/);
    expect(store.active()).toHaveLength(captured.length);
  });

  it("surfaces DIRECTIVE_BUDGET_EXCEEDED as a typed error", () => {
    const store = new DirectiveStore();
    const [directive] = captureUserDirectives({
      sourceClass: "authenticated-user",
      text: "不要修改 public API",
      messageId: "m1",
    });
    store.append(directive);
    try {
      store.renderActive(0);
      throw new Error("expected budget error");
    } catch (error) {
      expect(error).toMatchObject({ code: "PCR_DIRECTIVE_BUDGET_EXCEEDED" });
    }
  });
});
