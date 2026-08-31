import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createLiveCiEnv } from "../../scripts/ci/live-env.mjs";

const EMPTY_DIFF = createHash("sha256").update("").digest("hex");
const SEEDS = [7, 11, 23] as const;
const WORKSPACE = "ws-t50";

function envPort(values: Record<string, string | undefined> = {
  PCR_LIVE_PROVIDER_KEY: "test-key",
  PCR_LIVE_MODEL: "openclaw/Qwen3.8-27B-WORK",
}) {
  return {
    get(name: string) {
      return values[name];
    },
  };
}

function gitPort(workspaceId = WORKSPACE, dirty = false, diffHash = EMPTY_DIFF) {
  return {
    async status(scope: { workspaceId: string }) {
      if (scope.workspaceId !== workspaceId) {
        throw Object.assign(new Error("denied"), { code: "PCR_RETRIEVAL_SCOPE_DENIED" });
      }
      return { commit: "a".repeat(40), diffHash, dirty };
    },
  };
}

function runner(overrides: { env?: ReturnType<typeof envPort>; git?: ReturnType<typeof gitPort> } = {}) {
  return createLiveCiEnv({
    workspaceId: WORKSPACE,
    env: overrides.env ?? envPort(),
    git: overrides.git ?? gitPort(),
  });
}

async function runT50Fixture() {
  const live = runner();
  const policy = live.policy();
  expect(policy).toEqual({
    requiredSecrets: ["PCR_LIVE_PROVIDER_KEY", "PCR_LIVE_MODEL"],
    maxConcurrency: 1,
    artifactRetentionDays: 14,
  });
  const ready = await live.prepare({ seeds: [...SEEDS], signal: undefined });
  expect(ready.seeds).toEqual([...SEEDS]);
  expect(ready.provenance.diffHash).toBe(EMPTY_DIFF);
  expect(ready.provenance.dirty).toBe(false);
  const nightly = readFileSync(".github/workflows/nightly.yml", "utf8");
  const liveWorkflow = readFileSync(".github/workflows/live-benchmark.yml", "utf8");
  expect(nightly).toContain("schedule:");
  expect(nightly).toContain("environment: live");
  expect(nightly).toContain("seed: [7, 11, 23]");
  expect(nightly).not.toContain("pull_request:");
  expect(liveWorkflow).toContain("workflow_dispatch:");
  expect(liveWorkflow).toContain("environment: live");
  expect(liveWorkflow).not.toContain("pull_request:");
  expect(nightly).toContain("scripts/ci/live-env.mjs");
  expect(liveWorkflow).toContain("secrets.PCR_LIVE_PROVIDER_KEY");
  expect(JSON.stringify(ready)).not.toContain("test-key");
  return { ok: true as const, task: "T50" as const, policy };
}

describe("T50 Scheduled live CI and protected credentials", () => {
  it("scheduled_live_ci_and_protected_credentials", async () => {
    await expect(runT50Fixture()).resolves.toMatchObject({ ok: true, task: "T50" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createLiveCiEnv({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_LIVE_CI_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed seed sets", async () => {
    await expect(runner().prepare({ seeds: [7, 11] as never })).rejects.toMatchObject({
      code: "PCR_LIVE_CI_INPUT_INVALID",
    });
  });

  it("replays equal policy and provenance for the same inputs", async () => {
    const live = runner();
    const first = await live.prepare({ seeds: [...SEEDS] });
    const second = await live.prepare({ seeds: [...SEEDS] });
    expect(second).toEqual(first);
    expect(live.policy()).toEqual(live.policy());
  });

  it("denies git status from another workspace", async () => {
    await expect(runner().prepare({ seeds: [...SEEDS], workspaceId: "ws-other" })).rejects.toMatchObject({
      code: "PCR_LIVE_CI_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before reading secrets or git", async () => {
    let envReads = 0;
    let gitReads = 0;
    const live = createLiveCiEnv({
      workspaceId: WORKSPACE,
      env: {
        get() {
          envReads += 1;
          return "x";
        },
      },
      git: {
        async status() {
          gitReads += 1;
          return { commit: "a".repeat(40), diffHash: EMPTY_DIFF, dirty: false };
        },
      },
    });
    await expect(live.prepare({ seeds: [...SEEDS], signal: AbortSignal.abort() })).rejects.toThrow();
    expect(envReads).toBe(0);
    expect(gitReads).toBe(0);
  });

  it("does not treat a dirty tree as a live-ready runner", async () => {
    await expect(runner({ git: gitPort(WORKSPACE, true, "b".repeat(64)) }).prepare({ seeds: [...SEEDS] })).rejects.toMatchObject({
      code: "PCR_LIVE_CI_DIRTY_TREE",
    });
  });

  it("fails closed when a required secret is missing without echoing values", async () => {
    await expect(runner({ env: envPort({ PCR_LIVE_MODEL: "openclaw/Qwen3.8-27B-WORK" }) }).prepare({ seeds: [...SEEDS] })).rejects.toMatchObject({
      code: "PCR_LIVE_CI_SECRET_MISSING",
      details: { secret: "PCR_LIVE_PROVIDER_KEY" },
    });
  });
});
