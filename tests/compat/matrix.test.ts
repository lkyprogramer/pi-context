import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createCompatibilityMatrix, loadToolchainLock } from "../../compat/matrix.mjs";

describe("compatibility matrix lock", () => {
  it("covers required Node/OS cells from the toolchain lock and does not run live CI on PR", async () => {
    const lock = loadToolchainLock();
    expect(lock.pnpm).toBe("10.15.0");
    expect(lock.required.node).toEqual(["22.19.0", "24.18.1"]);
    expect(lock.required.os).toEqual(["linux", "darwin"]);
    expect(lock.pi).toEqual(["0.84.4"]);
    const matrix = createCompatibilityMatrix({
      workspaceId: "ws-compat",
      lock: { node: lock.required.node, os: lock.required.os, pi: lock.pi },
      probe: {
        async run(cell) {
          return { status: "pass", evidence: `${"a".repeat(63)}${cell.node === "24.18.1" ? "b" : "a"}` };
        },
      },
    });
    const cells = await matrix.evaluate({ workspaceId: "ws-compat" });
    expect(cells).toHaveLength(4);
    expect(new Set(cells.map((cell) => `${cell.node}/${cell.os}/${cell.pi}`))).toEqual(new Set([
      "22.19.0/linux/0.84.4",
      "22.19.0/darwin/0.84.4",
      "24.18.1/linux/0.84.4",
      "24.18.1/darwin/0.84.4",
    ]));
    const workflow = readFileSync(".github/workflows/compatibility.yml", "utf8");
    expect(workflow).toContain("26.5.1");
    expect(workflow).toContain("compatibility-required");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).not.toContain("live-env.mjs");
    expect(workflow).not.toContain("live-benchmark.yml");
  });
});
