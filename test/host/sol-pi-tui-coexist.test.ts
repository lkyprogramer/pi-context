import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadOfficialPi } from "../helpers/official-pi.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SOL_PI_ROOT = process.env.PCTX_SOL_PI_ROOT?.trim() || join(homedir(), ".pi/agent/git/github.com/NVlabs/SoL-Pi");
const hasSolPi = existsSync(join(SOL_PI_ROOT, "src/sol-pi/index.ts"));
const originalHome = process.env.HOME;
const temps: string[] = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function stagePiContext(): string {
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: repoRoot, stdio: "pipe" });
  const staging = tmp("pctx-tui-pctx-");
  cpSync(join(repoRoot, "dist"), join(staging, "dist"), { recursive: true });
  writeFileSync(
    join(staging, "package.json"),
    JSON.stringify({
      name: "pi-context",
      version: "6.1.0-dev",
      type: "module",
      pi: { extensions: ["./dist/extension.js"] },
    }),
  );
  return staging;
}

function stageSolPi(): string {
  const staging = tmp("pctx-tui-sol-");
  cpSync(join(SOL_PI_ROOT, "package.json"), join(staging, "package.json"));
  cpSync(join(SOL_PI_ROOT, "src"), join(staging, "src"), { recursive: true });
  return staging;
}

async function openCoexist(opts: { solPi: boolean }) {
  const pi = await loadOfficialPi();
  const home = tmp("pctx-tui-home-");
  const cwd = tmp("pctx-tui-cwd-");
  const sessionDir = tmp("pctx-tui-sess-");
  const agentDir = join(home, ".pi", "agent");
  process.env.HOME = home;
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "pctx.json"), JSON.stringify({ schemaVersion: 6, profile: "observe" }));
  writeFileSync(
    join(agentDir, "sol-pi.json"),
    JSON.stringify({
      version: 1,
      actionFusion: true,
      observationPack: true,
      evidencePreservingReducer: true,
      onlineContextCompact: false,
    }),
  );
  const pctx = stagePiContext();
  const extras = [pctx];
  if (opts.solPi) extras.push(stageSolPi());
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProjectTrust: "always",
      extensions: extras,
    }),
  );

  const notices: string[] = [];
  const statuses: string[] = [];
  const settings = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const loader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: settings,
    additionalExtensionPaths: extras,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  const runtime = await pi.ModelRuntime.create({
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const manager = pi.SessionManager.create(cwd, sessionDir);
  const { session, extensionsResult } = await pi.createAgentSession({
    cwd,
    agentDir,
    settingsManager: settings,
    resourceLoader: loader,
    sessionManager: manager,
    modelRuntime: runtime,
    noTools: "builtin",
  });
  await session.bindExtensions?.({
    uiContext: {
      mode: "tui",
      notify: (message: string) => {
        notices.push(message);
      },
      setStatus: (key: string, value: string | undefined) => {
        if (value) statuses.push(`${key}:${value}`);
      },
    },
  });
  return {
    session,
    manager,
    notices,
    statuses,
    loaded,
    extensionsResult,
    dispose: () => session.dispose?.(),
  };
}

function commandNames(result: { extensions: Array<{ commands?: Map<string, unknown> | Array<{ name?: string }> }> }): string[] {
  const names: string[] = [];
  for (const ext of result.extensions) {
    const commands = ext.commands;
    if (!commands) continue;
    if (commands instanceof Map) names.push(...commands.keys());
    else for (const command of commands) if (command.name) names.push(command.name);
  }
  return names;
}

describe("TUI coexistence with SoL-Pi (context-mode off)", () => {
  it.skipIf(!hasSolPi)("loads /pctx and SoL-Pi tools in one isolated tui bind; context-mode stays unloaded", async () => {
    const opened = await openCoexist({ solPi: true });
    try {
      const loadErrors = (opened.loaded.errors ?? []).map((row) => `${row.path}:${row.error}`);
      expect(loadErrors, loadErrors.join("\n")).toEqual([]);
      const names = commandNames(opened.extensionsResult);
      expect(names).toContain("pctx");
      expect(names.join(" ")).not.toMatch(/ctx_/);

      await opened.session.prompt("/pctx status");
      const status = opened.notices.join("\n");
      expect(status).toMatch(/resolvedProfile=observe|profile=observe/);
      expect(status).toContain("hostVersion=0.85.1");

      const history = opened.session.getToolDefinition?.("pctx_history");
      const recall = opened.session.getToolDefinition?.("obs_recall");
      expect(history, "pctx_history").toBeTruthy();
      expect(recall, "obs_recall (SoL-Pi OP)").toBeTruthy();
      expect(opened.session.getToolDefinition?.("ctx_compact")).toBeUndefined();
    } finally {
      await opened.dispose();
    }
  });

  it("without SoL-Pi, /pctx still works and obs_recall is absent", async () => {
    const opened = await openCoexist({ solPi: false });
    try {
      expect(commandNames(opened.extensionsResult)).toContain("pctx");
      await opened.session.prompt("/pctx status");
      expect(opened.notices.join("\n")).toMatch(/profile=observe/);
      expect(opened.session.getToolDefinition?.("pctx_history")).toBeTruthy();
      expect(opened.session.getToolDefinition?.("obs_recall")).toBeUndefined();
    } finally {
      await opened.dispose();
    }
  });
});
