import { describe, expect, it } from "vitest";
import { allowUrl } from "../../eval/sandbox/relay.js";
import { probeIsolation } from "../../eval/sandbox/isolation-probe.js";
import { runSandboxed } from "../../eval/sandbox/runner.js";

describe("T21 sandbox", () => {
  it("relay denies file/localhost/CONNECT", () => {
    expect(allowUrl("file:///etc/passwd")).toBe(false);
    expect(allowUrl("http://127.0.0.1/secret")).toBe(false);
    expect(allowUrl("https://example.com")).toBe(true);
  });

  it("records BLOCKED when docker isolation is unavailable", () => {
    const probe = probeIsolation();
    const run = runSandboxed("true");
    if (!probe.ok) {
      expect(run.status).toBe("blocked");
      expect(run.error).toBeTruthy();
    } else {
      expect(run.status).toBe("ok");
    }
  });
});
