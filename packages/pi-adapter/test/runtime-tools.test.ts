import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import type { EvidenceService } from "@pcr/runtime";
import { createRegisteredRuntimeTools, registerRuntimeTools, type ToolsRuntime } from "../src/commands/context.js";

function boundCursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-runtime-tools",
    sessionId: "s1",
    leafId: "leaf-tools",
    lineageEntryIds: ["root", "leaf-tools"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function stubEvidence(cursor = boundCursor()): EvidenceService {
  const body = "exact evidence body cache";
  return {
    async admit() {
      throw new Error("unused");
    },
    async search(query) {
      if (query.cursor.workspaceId !== cursor.workspaceId || query.cursor.sessionId !== cursor.sessionId) {
        throw Object.assign(new Error("PCR_EVIDENCE_SCOPE_MISMATCH"), { code: "PCR_EVIDENCE_SCOPE_MISMATCH" });
      }
      if (!body.toLowerCase().includes(query.text.toLowerCase())) return [];
      return [{ evidenceId: "ev_aaaaaaaa", kind: "note", rank: 0, snippet: body.slice(0, 160) }];
    },
    async read(req) {
      if (req.cursor.workspaceId !== cursor.workspaceId || req.cursor.sessionId !== cursor.sessionId) {
        throw Object.assign(new Error("PCR_EVIDENCE_SCOPE_MISMATCH"), { code: "PCR_EVIDENCE_SCOPE_MISMATCH" });
      }
      if (req.evidenceId !== "ev_aaaaaaaa") {
        throw Object.assign(new Error("PCR_EVIDENCE_NOT_FOUND"), { code: "PCR_EVIDENCE_NOT_FOUND" });
      }
      const bytes = new TextEncoder().encode(body);
      return {
        evidenceId: req.evidenceId,
        rawBlobId: "blob_" + "a".repeat(64),
        bytes,
        byteLength: bytes.byteLength,
        sha256: "b".repeat(64),
        range: { start: 0, endExclusive: bytes.byteLength },
        verified: true as const,
      };
    },
  };
}

function fixtureRuntime(partial: Partial<ToolsRuntime> = {}): ToolsRuntime {
  const cursor = boundCursor();
  return {
    workspaceId: cursor.workspaceId,
    cursor,
    evidence: stubEvidence(cursor),
    encryptionKey: "encryptionKey-must-never-leak",
    recalledEvidence: { ev_aaaaaaaa: "exact evidence body ".repeat(20) },
    evidenceWorkspace: { ev_aaaaaaaa: cursor.workspaceId },
    claimed: true,
    ...partial,
  };
}

function fixtureCtx(workspaceId?: string) {
  const cursor = boundCursor();
  return { workspaceId: workspaceId ?? cursor.workspaceId, sessionId: "s1", channel: "authenticated-user" as const };
}

describe("runtime tools", () => {
  it("returns a bounded exact evidence page and never emits secret metadata", async () => {
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    const result = await tools.context_recall.execute("c1", { evidenceId: "ev_aaaaaaaa", maxTokens: 256 }, undefined, undefined, fixtureCtx());
    expect(result.content[0]?.text.length).toBeLessThan(2048);
    expect(JSON.stringify(result)).not.toContain("encryptionKey");
  });

  it("rejects invalid IDs and ranges", async () => {
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    await expect(tools.context_recall.execute("c1", { evidenceId: "nope" }, undefined, undefined, fixtureCtx())).rejects.toMatchObject({
      code: "PCR_INVALID_ID",
    });
    await expect(
      tools.context_recall.execute("c1", { evidenceId: "ev_aaaaaaaa", start: 8, end: 1 }, undefined, undefined, fixtureCtx()),
    ).rejects.toMatchObject({ code: "PCR_INVALID_RANGE" });
  });

  it("denies cross-scope recall", async () => {
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    await expect(
      tools.context_recall.execute("c1", { evidenceId: "ev_aaaaaaaa" }, undefined, undefined, { workspaceId: "ws_other" }),
    ).rejects.toMatchObject({ code: "PCR_RETRIEVAL_SCOPE_DENIED" });
  });

  it("bounds search limit and time and rejects regex or SQL", async () => {
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    await expect(tools.context_search.execute("c1", { query: "SELECT * FROM t" }, undefined, undefined, fixtureCtx())).rejects.toMatchObject({
      code: "PCR_SEARCH_UNSAFE",
    });
    await expect(tools.context_search.execute("c1", { query: "/cache.*/i" }, undefined, undefined, fixtureCtx())).rejects.toMatchObject({
      code: "PCR_SEARCH_UNSAFE",
    });
    const result = await tools.context_search.execute("c1", { query: "cache", limit: 99, timeoutMs: 5000 }, undefined, undefined, fixtureCtx());
    const body = JSON.parse(result.content[0]?.text ?? "{}") as { limit: number; timeoutMs: number; hits: unknown[] };
    expect(body.limit).toBe(20);
    expect(body.timeoutMs).toBe(250);
    expect(body.hits).toHaveLength(1);
  });

  it("requires authenticated user confirmation to pin", async () => {
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    await expect(tools.context_pin.execute("c1", { directive: "must keep tests" }, undefined, undefined, fixtureCtx())).rejects.toMatchObject({
      code: "PCR_PIN_DENIED",
    });
    await expect(
      tools.context_pin.execute("c1", { directive: "must keep tests", approved: true }, undefined, undefined, {
        ...fixtureCtx(),
        channel: "agent",
      }),
    ).rejects.toMatchObject({ code: "PCR_PIN_DENIED" });
    const pinned = await tools.context_pin.execute("c1", { directive: "must keep tests", approved: true }, undefined, undefined, fixtureCtx());
    expect(JSON.parse(pinned.content[0]?.text ?? "{}")).toMatchObject({ pinned: true });
  });

  it("detects tool name collisions and registers commands", async () => {
    const names: string[] = [];
    const commands: string[] = [];
    const pi = {
      registerTool(tool: { name: string }) {
        if (names.includes(tool.name)) throw new Error(`tool name collision: ${tool.name}`);
        names.push(tool.name);
      },
      registerCommand(name: string) {
        commands.push(name);
      },
      hasTool(name: string) {
        return names.includes(name);
      },
    };
    registerRuntimeTools(pi, fixtureRuntime());
    expect(names).toEqual(["context_recall", "context_search", "context_read", "context_status", "context_pin"]);
    expect(commands).toEqual(["context", "context-doctor", "context-compact"]);
    const tools = createRegisteredRuntimeTools(fixtureRuntime());
    for (const tool of tools) {
      expect(tool.parameters.type).toBe("object");
      expect(tool.label.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
    }
    expect(() => registerRuntimeTools(pi, fixtureRuntime())).toThrow(/collision/);
  });
});
