import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createCompatibilityMatrix } from "../../compat/matrix.mjs";

const WORKSPACE = "ws-t53";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function lock() {
  return {
    node: ["22.19.0", "24.18.1"],
    os: ["linux"],
    pi: ["0.84.4"],
  };
}

async function runT53Fixture() {
  const matrix = createCompatibilityMatrix({
    workspaceId: WORKSPACE,
    lock: lock(),
    probe: {
      async run(cell: { node: string; os: string; pi: string }) {
        const evidence = sha(`${cell.node}|${cell.os}|${cell.pi}|gates`);
        return { status: "pass" as const, evidence };
      },
    },
  });
  const cells = await matrix.evaluate({ workspaceId: WORKSPACE });
  expect(cells).toHaveLength(2);
  expect(cells[0]).toMatchObject({
    node: "22.19.0",
    os: "linux",
    pi: "0.84.4",
    status: "pass",
  });
  expect(cells[0]?.evidence).toMatch(/^[a-f0-9]{64}$/u);
  const failed = await createCompatibilityMatrix({
    workspaceId: WORKSPACE,
    lock: lock(),
    probe: {
      async run(cell: { node: string }) {
        return {
          status: cell.node === "24.18.1" ? "fail" : "pass",
          evidence: sha(cell.node),
        };
      },
    },
  }).evaluate({ workspaceId: WORKSPACE });
  expect(failed.map((row) => row.status)).toEqual(["pass", "fail"]);
  const toolchain = JSON.parse(readFileSync("compat/toolchain.lock.json", "utf8")) as {
    pnpm: string;
    node: { required: string[]; advisory: string[] };
  };
  expect(toolchain.pnpm).toBe("10.15.0");
  expect(toolchain.node.required).toEqual(["22.19.0", "24.18.1"]);
  const workflow = readFileSync(".github/workflows/compatibility.yml", "utf8");
  expect(workflow).toContain("pnpm install --frozen-lockfile");
  expect(workflow).toContain("compatibility-required");
  expect(workflow).not.toContain("live-env.mjs");
  expect(workflow).not.toContain("pull_request:\n        types");
  return { ok: true as const, task: "T53" as const, cells };
}

describe("T53 Pi/Node/OS compatibility matrix", () => {
  it("pi_node_os_compatibility_matrix", async () => {
    await expect(runT53Fixture()).resolves.toMatchObject({ ok: true, task: "T53" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createCompatibilityMatrix({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_COMPAT_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed locks", async () => {
    expect(() => createCompatibilityMatrix({
      workspaceId: WORKSPACE,
      lock: { node: [], os: ["linux"], pi: ["0.84.4"] },
      probe: { async run() { return { status: "pass", evidence: "a".repeat(64) }; } },
    } as never)).toThrowError(expect.objectContaining({ code: "PCR_COMPAT_INPUT_INVALID" }));
  });

  it("replays equal cells for the same probes", async () => {
    const matrix = createCompatibilityMatrix({
      workspaceId: WORKSPACE,
      lock: lock(),
      probe: {
        async run(cell: { node: string }) {
          return { status: "pass", evidence: sha(cell.node) };
        },
      },
    });
    const first = await matrix.evaluate({ workspaceId: WORKSPACE });
    const second = await matrix.evaluate({ workspaceId: WORKSPACE });
    expect(second).toEqual(first);
  });

  it("denies evaluate from another workspace", async () => {
    const matrix = createCompatibilityMatrix({
      workspaceId: WORKSPACE,
      lock: lock(),
      probe: { async run() { return { status: "pass", evidence: "a".repeat(64) }; } },
    });
    await expect(matrix.evaluate({ workspaceId: "ws-other" })).rejects.toMatchObject({
      code: "PCR_COMPAT_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before probing cells", async () => {
    let probes = 0;
    const matrix = createCompatibilityMatrix({
      workspaceId: WORKSPACE,
      lock: lock(),
      probe: {
        async run() {
          probes += 1;
          return { status: "pass", evidence: "a".repeat(64) };
        },
      },
    });
    await expect(matrix.evaluate({ workspaceId: WORKSPACE, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(probes).toBe(0);
  });
});
