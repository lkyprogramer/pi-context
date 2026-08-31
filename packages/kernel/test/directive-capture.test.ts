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

  it("does not let a prohibition quote swallow the rest of a period-free dump", () => {
    const text = `do not deploy prod\n# Secret\nsk-live-compact-omit-001\n${"batch-note\n".repeat(40)}`;
    const [directive] = captureUserDirectives({ sourceClass: "authenticated-user", text, messageId: "m1" });
    expect(directive?.quote).toBe("do not deploy prod");
    expect(directive?.quote).not.toContain("sk-live-compact-omit-001");
    expect(directive?.quote.length).toBeLessThan(80);
  });

  it("yields no hard directive from untrusted or agent-derived input", () => {
    const text = "不要修改 public API";
    expect(captureUserDirectives({ sourceClass: "untrusted-user", text, messageId: "m1" })).toEqual([]);
    expect(captureUserDirectives({ sourceClass: "agent-derived", text, messageId: "m1" })).toEqual([]);
  });

  it("records utf8 byte offsets separately from utf16 for CJK", () => {
    const text = "不要部署生产";
    const [directive] = captureUserDirectives({
      sourceClass: "authenticated-user",
      text,
      messageId: "m-cjk",
    }) as Array<{ utf8ByteRange: { start: number; end: number }; utf16Range: { start: number; end: number } }>;
    expect(directive.utf16Range.end).toBe(text.length);
    expect(directive.utf8ByteRange.end).toBe(Buffer.byteLength(text, "utf8"));
    expect(directive.utf8ByteRange.end).toBeGreaterThan(directive.utf16Range.end);
  });

  it("captures the full correction clause, not only the marker word", () => {
    const text = "改为 version 7；以最新值为准";
    const [correction] = captureUserDirectives({
      sourceClass: "authenticated-user",
      text,
      messageId: "m-correction",
    });
    expect(correction?.kind).toBe("correction");
    expect(correction?.quote).toContain("version 7");
    expect(correction?.quote).not.toBe("改为");
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
