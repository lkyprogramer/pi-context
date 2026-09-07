import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowBrokerRequest, allowUrl } from "../../eval/sandbox/relay.js";
import { imageAvailable, probeIsolation } from "../../eval/sandbox/isolation-probe.js";
import { runSandboxed, sandboxDockerArgs } from "../../eval/sandbox/runner.js";

describe("T21 sandbox", () => {
  it("relay denies file/localhost/CONNECT and arbitrary internet URLs", () => {
    expect(allowUrl("file:///etc/passwd")).toBe(false);
    expect(allowUrl("http://127.0.0.1/secret")).toBe(false);
    expect(allowUrl("https://example.com")).toBe(false);
    expect(allowBrokerRequest("CONNECT", "http://example.com")).toBe(false);
    expect(allowBrokerRequest("GET", "/v1/chat/completions")).toBe(false);
    expect(allowBrokerRequest("POST", "/v1/models")).toBe(false);
    expect(allowBrokerRequest("POST", "/v1/chat/completions")).toBe(true);
  });

  it("sandbox docker args never mount docker.sock or host home", () => {
    const args = sandboxDockerArgs({ workDir: "/tmp/pctx-arm", socketDir: "/tmp/pctx-sock" });
    const joined = args.join(" ");
    expect(joined).not.toContain("docker.sock");
    expect(joined).not.toMatch(/-v \/Users\//);
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("--cap-drop");
    expect(args).toContain("--read-only");
  });

  it("records BLOCKED when docker isolation is unavailable", () => {
    const probe = probeIsolation();
    const run = runSandboxed("true");
    if (!probe.ok) {
      expect(run.status).toBe("blocked");
      expect(run.error).toBeTruthy();
    } else {
      expect(run.status).toBe("ok");
      expect(imageAvailable()).toBe(true);
    }
  });

  it("container cannot read host secrets or docker.sock when the T21 image exists", () => {
    if (!imageAvailable()) return;
    const probe = probeIsolation();
    expect(probe.ok).toBe(true);
    expect(probe.details?.hostPathReadable).toBe(false);
    expect(probe.details?.dockerSockReadable).toBe(false);
    const work = mkdtempSync(join(tmpdir(), "pctx-t21-work-"));
    try {
      const run = runSandboxed("node -v && javac -version && pi --version", work);
      expect(run.status).toBe("ok");
      expect(String(run.stdout)).toMatch(/v22\.19/);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
