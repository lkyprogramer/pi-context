import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertIndependentWorkspaces,
  assertProductArmText,
  createIsolatedArmHomes,
  liveFourIdentity,
  piLaunchPlan,
  requireToolsSafe,
} from "@pcr/benchmark";

function seedHome(): { root: string; seedSessionFile: string; seedWorkspaceDir: string } {
  const root = mkdtempSync(join(tmpdir(), "pcr-arm-isolate-"));
  const seedWorkspaceDir = join(root, "seed-ws");
  mkdirSync(seedWorkspaceDir, { recursive: true });
  writeFileSync(join(seedWorkspaceDir, "shared.txt"), "same-jsonl-store-cut\n");
  const seedSessionFile = join(root, "seed.jsonl");
  writeFileSync(seedSessionFile, `${JSON.stringify({ type: "session", id: "sess-seed", cwd: seedWorkspaceDir })}\n{"type":"message","id":"u1"}\n`);
  return { root, seedSessionFile, seedWorkspaceDir };
}

describe("per-arm independent workspaces", () => {
  it("rejects a shared cwd as tools-unsafe", () => {
    expect(() => requireToolsSafe([
      { arm: "B0", cwd: "/tmp/shared-ws", agentDir: "/tmp/a0", sessionFile: "/tmp/s0.jsonl", piHome: "/tmp/a0" },
      { arm: "B1", cwd: "/tmp/shared-ws", agentDir: "/tmp/a1", sessionFile: "/tmp/s1.jsonl", piHome: "/tmp/a1" },
    ])).toThrowError(expect.objectContaining({ code: "PCR_ARM_ISOLATE_SHARED_CWD" }));
  });

  it("keeps a B0 workspace write out of the B1 clone", () => {
    const seed = seedHome();
    const homes = createIsolatedArmHomes({
      root: seed.root,
      seedSessionFile: seed.seedSessionFile,
      seedWorkspaceDir: seed.seedWorkspaceDir,
      arms: ["B0", "B1", "B2", "F0"],
    });
    assertIndependentWorkspaces(homes);
    requireToolsSafe(homes);
    const b0 = homes.find((row) => row.arm === "B0");
    const b1 = homes.find((row) => row.arm === "B1");
    if (!b0 || !b1) throw new Error("missing homes");
    writeFileSync(join(b0.cwd, "b0-only.txt"), "written-by-b0-tools");
    expect(existsSync(join(b1.cwd, "b0-only.txt"))).toBe(false);
    expect(readFileSync(join(b1.cwd, "shared.txt"), "utf8")).toBe("same-jsonl-store-cut\n");
    expect(JSON.parse(readFileSync(b0.sessionFile, "utf8").split("\n")[0] ?? "{}") as { cwd?: string }).toMatchObject({
      cwd: b0.cwd,
    });
  });

  it("labels B0/B1/B2/F0 without string-stub compactors and enables tools", () => {
    expect(liveFourIdentity("B0")).toMatchObject({ fromHook: false, materializer: "off", compact: true, compactor: "pi-native" });
    expect(liveFourIdentity("B1")).toMatchObject({ fromHook: true, materializer: "identity", compact: true });
    expect(liveFourIdentity("B2")).toMatchObject({ fromHook: true, materializer: "pcr", compact: true });
    expect(liveFourIdentity("F0")).toMatchObject({ fromHook: false, compact: false, fullContext: true, compactor: "none" });
    const plan = piLaunchPlan("B0", {
      sessionFile: "/tmp/session.jsonl",
      extensionPath: "/tmp/extension.js",
      provider: "openclaw",
      model: "openclaw/Qwen3.8-27B-WORK",
    });
    expect(plan.args).not.toContain("--no-tools");
    expect(plan.compact).toBe(true);
    expect(piLaunchPlan("F0", {
      sessionFile: "/tmp/session.jsonl",
      extensionPath: "/tmp/extension.js",
      provider: "openclaw",
      model: "openclaw/Qwen3.8-27B-WORK",
    }).compact).toBe(false);
    expect(piLaunchPlan("B2", {
      sessionFile: "/tmp/session.jsonl",
      extensionPath: "/tmp/extension.js",
      provider: "openclaw",
      model: "openclaw/Qwen3.8-27B-WORK",
    }).args.slice(0, 2)).toEqual(["-e", "/tmp/extension.js"]);
    expect(() => assertProductArmText("native:0:keep version 7")).toThrowError(
      expect.objectContaining({ code: "PCR_ARM_STRING_STUB" }),
    );
    expect(() => assertProductArmText("keep version 7 and do not deploy")).not.toThrow();
  });
});
