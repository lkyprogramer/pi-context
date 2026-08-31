import { describe, expect, it } from "vitest";

import { attestOutcome } from "../../src/security/outcome.js";

describe("tool outcome attestation", () => {
  it("does not let an assistant claim tests-passed when the tool failed", () => {
    const assistant = attestOutcome({
      outcome: "tests-passed",
      source: "assistant",
      toolSucceeded: false,
      toolName: "vitest",
    });
    expect(assistant.accepted).toBe(false);
    expect(assistant.authority).toBe("propose");
    const failedTool = attestOutcome({
      outcome: "tests-passed",
      source: "tool",
      toolSucceeded: false,
      toolName: "vitest",
    });
    expect(failedTool.accepted).toBe(false);
    const logOnly = attestOutcome({
      outcome: "tests-passed",
      source: "tool",
      toolSucceeded: true,
      toolName: "cat",
    });
    expect(logOnly.accepted).toBe(false);
  });

  it("forbids unattested deploy/delete outcomes", () => {
    const deploy = attestOutcome({
      outcome: "deployed",
      source: "tool",
      toolSucceeded: false,
      toolName: "deploy",
    });
    expect(deploy.accepted).toBe(false);
    expect(deploy.authority).toBe("none");
    const ok = attestOutcome({
      outcome: "tests-passed",
      source: "tool",
      toolSucceeded: true,
      toolName: "vitest",
    });
    expect(ok.accepted).toBe(true);
    expect(ok.authority).toBe("act");
  });
});
