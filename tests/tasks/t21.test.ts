import { describe, expect, it } from "vitest";

import { createRuntimeCursor, type RecallCatalog, type RecallHit } from "@pcr/core";
import {
  createLeaseService,
  createProactiveRecallPolicy,
  type LeaseRecord,
  type LeaseStore,
} from "@pcr/runtime";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-t21",
    sessionId: "session-t21",
    leafId: "leaf-t21",
    lineageEntryIds: ["root", "leaf-t21"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function memoryCatalog(hits: RecallHit[]): RecallCatalog {
  return {
    async search(query) {
      if (!query.text.includes("api.ts") && !query.text.includes("public API")) return [];
      return hits;
    },
  };
}

function memoryLeases(): LeaseStore {
  const rows: LeaseRecord[] = [];
  return {
    async put(lease) {
      const index = rows.findIndex((row) => row.leaseId === lease.leaseId);
      if (index >= 0) rows[index] = lease;
      else rows.push(lease);
    },
    async get(scope, leaseId) {
      return rows.find((row) => (
        row.leaseId === leaseId
        && row.cursor.workspaceId === scope.workspaceId
        && row.cursor.sessionId === scope.sessionId
        && row.cursor.leafId === scope.leafId
        && row.cursor.lineageHash === scope.lineageHash
        && row.cursor.modelKey === scope.modelKey
      )) ?? null;
    },
    async findByPage(scope, pageId) {
      return [...rows].reverse().find((row) => (
        row.pageId === pageId
        && row.cursor.workspaceId === scope.workspaceId
        && row.cursor.sessionId === scope.sessionId
        && row.cursor.leafId === scope.leafId
        && row.cursor.lineageHash === scope.lineageHash
        && row.cursor.modelKey === scope.modelKey
      )) ?? null;
    },
    async delete(scope, leaseId) {
      const index = rows.findIndex((row) => (
        row.leaseId === leaseId
        && row.cursor.workspaceId === scope.workspaceId
        && row.cursor.sessionId === scope.sessionId
      ));
      if (index >= 0) rows.splice(index, 1);
    },
    async list(scope) {
      return rows.filter((row) => (
        row.cursor.workspaceId === scope.workspaceId
        && row.cursor.sessionId === scope.sessionId
        && row.cursor.leafId === scope.leafId
        && row.cursor.lineageHash === scope.lineageHash
        && row.cursor.modelKey === scope.modelKey
      ));
    },
  };
}

function clock(now = 21_000) {
  return { now: () => now };
}

function hits(): RecallHit[] {
  return [
    { evidenceId: `ev_${"a".repeat(64)}`, quote: "不要修改 public API", tokens: 20 },
    { evidenceId: `ev_${"b".repeat(64)}`, quote: "recent noise", tokens: 10 },
    { evidenceId: `ev_${"c".repeat(64)}`, quote: "overflow candidate", tokens: 80 },
  ];
}

function stack(options: { catalog?: RecallCatalog; now?: number } = {}) {
  const bound = cursor();
  const store = memoryLeases();
  const leases = createLeaseService({
    cursor: bound,
    store,
    clock: clock(options.now),
    limits: { maxTurns: 4, maxTokenTurns: 6000, ttlMs: 60_000 },
  });
  const policy = createProactiveRecallPolicy({
    cursor: bound,
    catalog: options.catalog ?? memoryCatalog(hits()),
    leases,
  });
  return { bound, leases, policy };
}

async function runT21Fixture() {
  const { bound, policy } = stack();
  const needed = await policy.decide({
    cursor: bound,
    userText: "看一下 src/api.ts",
    activePaths: ["src/api.ts"],
    directives: [{ quote: "不要修改 public API", kind: "prohibition" }],
    recentlyInjected: [`ev_${"b".repeat(64)}`],
    maxTokens: 50,
    taskStatus: "active",
  });
  expect(needed.kind).toBe("needed");
  if (needed.kind !== "needed") throw new Error("expected needed");
  expect(needed.page.items.map((item) => item.quote)).toContain("不要修改 public API");
  expect(needed.page.items.every((item) => item.evidenceId !== `ev_${"b".repeat(64)}`)).toBe(true);
  expect(needed.page.items.every((item) => item.quote !== "recent noise")).toBe(true);
  expect(needed.page.omitted.some((item) => item.evidenceId === `ev_${"c".repeat(64)}`)).toBe(true);
  expect(needed.lease.authority).toBe("inform");
  expect(needed.lease.authority).not.toBe("act");
  const replayed = await policy.decide({
    cursor: bound,
    userText: "看一下 src/api.ts",
    activePaths: ["src/api.ts"],
    directives: [{ quote: "不要修改 public API", kind: "prohibition" }],
    recentlyInjected: [`ev_${"b".repeat(64)}`],
    maxTokens: 50,
    taskStatus: "active",
  });
  expect(replayed).toEqual(needed);
  const idle = await policy.decide({
    cursor: bound,
    userText: "hello",
    activePaths: [],
    directives: [],
    maxTokens: 50,
    taskStatus: "active",
  });
  expect(idle.kind).toBe("not-needed");
  return { ok: true as const, task: "T21" as const, needed, idle };
}

describe("T21 Proactive recall policy and leases", () => {
  it("proactive_recall_policy_and_leases", async () => {
    await expect(runT21Fixture()).resolves.toMatchObject({ ok: true, task: "T21" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createLeaseService({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_LEASE_DEPENDENCY_MISSING" }),
    );
    expect(() => createProactiveRecallPolicy({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_RECALL_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed input and completed-front recall", async () => {
    const { bound, policy } = stack();
    await expect(policy.decide({} as never)).rejects.toThrow(/PCR_RECALL_INPUT_INVALID/);
    const completed = await policy.decide({
      cursor: bound,
      userText: "看一下 src/api.ts",
      activePaths: ["src/api.ts"],
      maxTokens: 50,
      taskStatus: "completed",
    });
    expect(completed.kind).toBe("not-needed");
    if (completed.kind === "not-needed") expect(completed.reason).toBe("task-completed");
  });

  it("replays the same page lease without duplicating grants", async () => {
    const { bound, policy, leases } = stack();
    const first = await policy.decide({
      cursor: bound,
      userText: "看一下 src/api.ts",
      activePaths: ["src/api.ts"],
      maxTokens: 50,
      taskStatus: "active",
    });
    const second = await policy.decide({
      cursor: bound,
      userText: "看一下 src/api.ts",
      activePaths: ["src/api.ts"],
      maxTokens: 50,
      taskStatus: "active",
    });
    expect(second).toEqual(first);
    if (first.kind === "needed" && second.kind === "needed") {
      expect(second.lease.leaseId).toBe(first.lease.leaseId);
      expect(await leases.active(bound)).toHaveLength(1);
    }
  });

  it("rejects a cursor from another workspace/session/branch", async () => {
    const { policy } = stack();
    const other = { ...cursor(), sessionId: "other-session" };
    await expect(policy.decide({
      cursor: other,
      userText: "看一下 src/api.ts",
      maxTokens: 50,
    })).rejects.toThrow(/PCR_RECALL_SCOPE_MISMATCH/);
  });

  it("does not promote a retrieval lease to act", async () => {
    const { bound, leases } = stack();
    const lease = await leases.grant({
      cursor: bound,
      pageId: "pg_test",
      purpose: "recall",
      requestedAuthority: "act",
    });
    expect(lease.authority).toBe("inform");
  });

  it("stops at the abort boundary before searching", async () => {
    const { bound, policy } = stack();
    const controller = new AbortController();
    controller.abort();
    await expect(policy.decide({
      cursor: bound,
      userText: "看一下 src/api.ts",
      maxTokens: 50,
      signal: controller.signal,
    })).rejects.toThrow();
  });
});
