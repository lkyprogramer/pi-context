import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { PI_AGENT_DIR_ENV, resolveAgentDir } from "../../src/pi/agent-dir.js";
import { bindHooks, type PiExtensionAPI } from "../../src/pi/adapter.js";
import { createPlugin } from "../../src/plugin.js";
import { writeStatusFile } from "../../src/telemetry/metrics.js";

const originalEnv = process.env[PI_AGENT_DIR_ENV];
const temps: string[] = [];

beforeEach(() => {
  delete process.env[PI_AGENT_DIR_ENV];
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env[PI_AGENT_DIR_ENV];
  else process.env[PI_AGENT_DIR_ENV] = originalEnv;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

describe("agent dir resolution", () => {
  it("prefers PI_CODING_AGENT_DIR, then the host-provided dir, then ~/.pi/agent", () => {
    expect(resolveAgentDir()).toBe(join(homedir(), ".pi", "agent"));
    expect(resolveAgentDir("/from/ctx")).toBe("/from/ctx");
    process.env[PI_AGENT_DIR_ENV] = "/from/env";
    expect(resolveAgentDir("/from/ctx")).toBe("/from/env");
    process.env[PI_AGENT_DIR_ENV] = "~/alt-agent";
    expect(resolveAgentDir()).toBe(join(homedir(), "alt-agent"));
    process.env[PI_AGENT_DIR_ENV] = "   ";
    expect(resolveAgentDir("/from/ctx")).toBe("/from/ctx");
    expect(resolveAgentDir()).toBe(join(homedir(), ".pi", "agent"));
    process.env[PI_AGENT_DIR_ENV] = "relative/agent";
    expect(resolveAgentDir("/from/ctx")).toBe("relative/agent");
  });

  it("loadConfig reads the global pctx.json from PI_CODING_AGENT_DIR and keeps <cwd>/.pi/pctx.json precedence", () => {
    const agentDir = temp("pctx-envagent-");
    const cwd = temp("pctx-envcwd-");
    process.env[PI_AGENT_DIR_ENV] = agentDir;
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(join(agentDir, "pctx.json"), JSON.stringify({ schemaVersion: 6, profile: "balanced" }));
    const loaded = loadConfig(cwd, false);
    expect(loaded.config.profile).toBe("balanced");
    expect(loaded.source).toBe(join(agentDir, "pctx.json"));
    writeFileSync(join(cwd, ".pi", "pctx.json"), JSON.stringify({ schemaVersion: 6, profile: "observe" }));
    const project = loadConfig(cwd, true);
    expect(project.config.profile).toBe("observe");
    expect(project.source).toBe(join(cwd, ".pi", "pctx.json"));
  });

  it("session_start + status file follow PI_CODING_AGENT_DIR when ctx has no agentDir", () => {
    const agentDir = temp("pctx-envagent-");
    const cwd = temp("pctx-envcwd-");
    process.env[PI_AGENT_DIR_ENV] = agentDir;
    writeFileSync(join(agentDir, "pctx.json"), JSON.stringify({ schemaVersion: 6, profile: "balanced" }));
    const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
    const pi: PiExtensionAPI = {
      on(event, handler) {
        handlers.set(event, handler as (event: unknown, ctx: unknown) => unknown);
      },
      registerTool() {},
      registerCommand() {},
    };
    const state = bindHooks(pi, createPlugin());
    const ctx = {
      cwd,
      ui: { notify() {} },
      isProjectTrusted: () => false,
      model: { id: "m", contextWindow: 1000 },
      sessionManager: {
        getSessionId: () => "s",
        getLeafId: () => null,
        getEntries: () => [],
        getEntry: () => undefined,
      },
    };
    handlers.get("session_start")?.({}, ctx);
    expect(state.profile).toBe("balanced");
    expect(state.configSource).toBe(join(agentDir, "pctx.json"));
    expect(state.agentDir).toBe(agentDir);
    expect(state.index.dbPath).toBe(join(agentDir, "pctx", "index.sqlite"));
    handlers.get("agent_end")?.({}, ctx);
    const statusPath = join(agentDir, "pctx-status.json");
    expect(existsSync(statusPath)).toBe(true);
    const status = JSON.parse(readFileSync(statusPath, "utf8")) as { resolvedProfile: string };
    expect(status.resolvedProfile).toBe("balanced");
    handlers.get("session_shutdown")?.({}, ctx);
  });

  it("writeStatusFile without any ctx lands in PI_CODING_AGENT_DIR", () => {
    const agentDir = temp("pctx-envagent-");
    process.env[PI_AGENT_DIR_ENV] = agentDir;
    const state = createPlugin();
    writeStatusFile(state);
    expect(existsSync(join(agentDir, "pctx-status.json"))).toBe(true);
  });
});
