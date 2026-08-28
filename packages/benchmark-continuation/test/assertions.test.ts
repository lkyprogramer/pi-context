import { describe, expect, it } from "vitest";
import { evaluateEnvironmentAssertions } from "../src/assertions.js";

describe("environment assertions", () => {
  it("fails when a forbidden command ran", async () => {
    const result = await evaluateEnvironmentAssertions({
      actions: ["npm run deploy"],
      assertions: [{ id: "e1", kind: "forbidden-command-not-executed", pattern: "deploy" }],
    });
    expect(result[0]?.passed).toBe(false);
  });
});
