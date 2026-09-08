import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { bindHooks, type PiExtensionAPI } from "../../src/pi/adapter.js";
import { createPlugin } from "../../src/plugin.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

function officialPiRoot(): string {
  const local = join(repoRoot, "node_modules/@earendil-works/pi-coding-agent");
  if (existsSync(join(local, "package.json"))) return local;
  const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const global = join(npmRoot, "@earendil-works/pi-coding-agent");
  if (!existsSync(join(global, "package.json"))) {
    throw new Error("blocked-environment: @earendil-works/pi-coding-agent@0.85.1 is not installed");
  }
  return global;
}

describe("A01 config activation", () => {
  it("session_compact with willRetry does not count a completed compaction", () => {
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
      cwd: process.cwd(),
      ui: { notify() {} },
      isProjectTrusted: () => false,
      sessionManager: {
        getSessionId: () => "s",
        getLeafId: () => null,
        getEntries: () => [],
      },
    };
    handlers.get("session_compact")?.(
      {
        type: "session_compact",
        compactionEntry: { id: "c1", summary: "retrying" },
        fromExtension: false,
        reason: "overflow",
        willRetry: true,
      },
      ctx,
    );
    expect(state.nativeCompactions).toBe(0);
    handlers.get("session_compact")?.(
      {
        type: "session_compact",
        compactionEntry: { id: "c2", summary: "done" },
        fromExtension: false,
        reason: "threshold",
        willRetry: false,
      },
      ctx,
    );
    expect(state.nativeCompactions).toBe(1);
  });

  it("loads dist/extension.js through createAgentSession and /pctx status follows .pi/pctx.json", async () => {
    execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: repoRoot, stdio: "pipe" });
    const piRoot = officialPiRoot();
    const piPkg = JSON.parse(readFileSync(join(piRoot, "package.json"), "utf8")) as { version: string };
    expect(piPkg.version).toBe("0.85.1");
    const pi = (await import(pathToFileURL(join(piRoot, "dist/index.js")).href)) as {
      DefaultResourceLoader: new (opts: Record<string, unknown>) => {
        reload: () => Promise<void>;
        getExtensions: () => { extensions: unknown[]; errors: unknown[] };
      };
      SettingsManager: { create: (cwd: string, agentDir?: string, options?: Record<string, unknown>) => unknown };
      SessionManager: { create: (cwd: string, sessionDir?: string) => unknown };
      ModelRuntime: { create: (opts: Record<string, unknown>) => Promise<unknown> };
      createAgentSession: (opts: Record<string, unknown>) => Promise<{
        session: {
          prompt: (text: string) => Promise<void>;
          bindExtensions: (bindings: Record<string, unknown>) => Promise<void>;
          dispose?: () => void | Promise<void>;
        };
      }>;
    };

    const home = mkdtempSync(join(tmpdir(), "pctx-a01-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "pctx-a01-cwd-"));
    const staging = mkdtempSync(join(tmpdir(), "pctx-a01-ext-"));
    const agentDir = join(home, ".pi", "agent");
    process.env.HOME = home;
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(join(cwd, ".pi", "pctx.json"), JSON.stringify({ schemaVersion: 6, profile: "balanced" }));
    cpSync(join(repoRoot, "dist"), join(staging, "dist"), { recursive: true });
    writeFileSync(
      join(staging, "package.json"),
      JSON.stringify({
        name: "pi-context",
        version: "5.0.0-dev.0",
        type: "module",
        pi: { extensions: ["./dist/extension.js"] },
      }),
    );

    const notices: string[] = [];
    try {
      const settings = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: true });
      const loader = new pi.DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager: settings,
        additionalExtensionPaths: [staging],
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      await loader.reload();
      const runtime = await pi.ModelRuntime.create({
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      const manager = pi.SessionManager.create(cwd, join(cwd, "sessions"));
      const { session } = await pi.createAgentSession({
        cwd,
        agentDir,
        settingsManager: settings,
        resourceLoader: loader,
        sessionManager: manager,
        modelRuntime: runtime,
        noTools: "all",
      });
      await session.bindExtensions({
        uiContext: {
          notify: (message: string) => {
            notices.push(message);
          },
        },
      });
      await session.prompt("/pctx status");
      await session.dispose?.();
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
      rmSync(staging, { recursive: true, force: true });
    }

    const text = notices.join("\n");
    expect(text).toContain("profile=balanced");
    expect(text).toMatch(/configHash=[0-9a-f]{64}/);
    expect(text).toContain("hostVersion=0.85.1");
  });
});
