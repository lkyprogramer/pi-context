import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FoldPlan } from "../../src/contracts.js";
import { loadPlan, planPath, savePlan } from "../../src/projection/plan-store.js";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function agent(): string {
  const dir = mkdtempSync(join(tmpdir(), "pctx-plan-store-"));
  temps.push(dir);
  return dir;
}

function plan(sessionId = "sess"): FoldPlan {
  return {
    planId: "p1",
    sessionId,
    compactionBoundary: null,
    modelId: "m",
    configHash: "h",
    createdAt: "t",
    usagePercentAtPlan: 70,
    replacements: new Map([
      ["3f9a2c1e:0", { entryId: "3f9a2c1e", blockIndex: 0, sourceHash: "a".repeat(64), stub: "STUB", originalBytes: 10, savedTokensEstimate: 5 }],
    ]),
    savedTokensEstimate: 5,
  };
}

describe("plan store", () => {
  it("persists only locators, with 0600 mode, and no stub text or token numbers", () => {
    const dir = agent();
    savePlan(dir, "ws", plan());
    const path = planPath(dir, "ws", "sess");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const raw = JSON.parse(readFileSync(path, "utf8")) as { replacements: unknown[]; workspaceId: string };
    expect(raw.workspaceId).toBe("ws");
    expect(raw.replacements).toEqual([{ key: "3f9a2c1e:0", entryId: "3f9a2c1e", blockIndex: 0, sourceHash: "a".repeat(64) }]);
    expect(readFileSync(path, "utf8")).not.toContain("STUB");
    expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(false);
    const loaded = loadPlan(dir, "ws", "sess");
    expect(loaded?.planId).toBe("p1");
    expect(loaded?.replacements).toHaveLength(1);
  });

  it("returns null without throwing and deletes corrupt, empty and foreign files", () => {
    const dir = agent();
    const path = planPath(dir, "ws", "sess");
    mkdirSync(dirname(path), { recursive: true });

    writeFileSync(path, "{not json");
    expect(loadPlan(dir, "ws", "sess")).toBeNull();
    expect(existsSync(path), "corrupt file is deleted").toBe(false);

    writeFileSync(path, "");
    expect(loadPlan(dir, "ws", "sess")).toBeNull();
    expect(existsSync(path), "zero-length file is deleted").toBe(false);

    // Valid payload for another session copied to this session's path.
    savePlan(dir, "ws", plan("other-session"));
    const otherPath = planPath(dir, "ws", "other-session");
    writeFileSync(path, readFileSync(otherPath));
    expect(loadPlan(dir, "ws", "sess")).toBeNull();
    expect(existsSync(path), "other-session file is deleted").toBe(false);
    expect(loadPlan(dir, "ws", "other-session")?.sessionId).toBe("other-session");

    // Same session id, different workspace.
    savePlan(dir, "ws-b", plan());
    writeFileSync(path, readFileSync(planPath(dir, "ws-b", "sess")));
    expect(loadPlan(dir, "ws", "sess")).toBeNull();
    expect(existsSync(path)).toBe(false);

    // Out-of-range or non-finite usage percent.
    for (const bad of ["500", "-1", "null", '"70"']) {
      savePlan(dir, "ws", plan());
      writeFileSync(path, readFileSync(path, "utf8").replace('"usagePercentAtPlan":70', `"usagePercentAtPlan":${bad}`));
      expect(loadPlan(dir, "ws", "sess"), bad).toBeNull();
      expect(existsSync(path), bad).toBe(false);
    }

    // Missing file: null, nothing to delete.
    expect(loadPlan(dir, "ws", "never")).toBeNull();
  });
});
