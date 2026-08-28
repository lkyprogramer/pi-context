import { describe, expect, it } from "vitest";
import { normalizeOracleValue } from "../src/normalizers.js";

describe("oracle normalizers", () => {
  it("normalizes paths, hashes, numbers, commands and errors", () => {
    expect(normalizeOracleValue("path", "foo/./bar/../baz").canonical).toBe("foo/baz");
    expect(normalizeOracleValue("sha", "ABCdef").canonical).toBe("abcdef");
    expect(normalizeOracleValue("number", "01.50ms").canonical).toContain("1.5");
    expect(normalizeOracleValue("command", `echo "hi"`).canonical.split(/\s+/)).toContain("echo");
    expect(normalizeOracleValue("error", "\u001b[31m  FAIL  \u001b[0m").canonical).toBe("FAIL");
  });
});
