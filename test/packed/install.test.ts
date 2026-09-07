import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import register from "../../src/extension.js";
import { createPlugin, setProfile } from "../../src/plugin.js";
import { renderMessages } from "../../src/projection/render.js";
import { loadOfficialPi, packedInstallSpec } from "../helpers/official-pi.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function packTarball(): { tarball: string; spec: string } {
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: repoRoot, stdio: "pipe" });
  const packed = execFileSync("node", ["scripts/packed-host.mjs"], { cwd: repoRoot, encoding: "utf8" });
  const jsonLine = packed.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{") && l.includes("installSpec")).at(-1);
  if (!jsonLine) throw new Error(`packed-host produced no installSpec JSON: ${packed}`);
  const json = JSON.parse(jsonLine) as {
    tarball: string;
    installSpec: string;
  };
  return { tarball: json.tarball, spec: json.installSpec };
}

describe("T19 packed install", () => {
  it("observe does not rewrite provider messages and schema stays stable across profile switches", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "hello" }] }];
    const out = renderMessages({ messages, plan: null, profile: "observe", optionalBudget: 100 });
    expect(out.messages).toBe(messages);
    const state = createPlugin();
    setProfile(state, "balanced");
    setProfile(state, "observe");
    expect(state.config.history.searchLimit).toBe(8);
  });

  it("does not forge pin confirmation without UI", async () => {
    const notes: string[] = [];
    const pi = {
      on() {},
      registerTool() {},
      registerCommand(_n: string, spec: { handler: (args: string, ctx: Record<string, unknown>) => Promise<void> }) {
        void spec.handler("pin e 0 0 1", {
          hasUI: false,
          ui: { notify: (m: string) => notes.push(m) },
        });
      },
    };
    register(pi);
    await new Promise((r) => setTimeout(r, 0));
    expect(notes.join(" ")).toMatch(/not forged|requires an interactive/);
  });

  it("packed dist has no PCR ingress contract or tests", () => {
    execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: repoRoot, stdio: "pipe" });
    const js = readFileSync(join(repoRoot, "dist/extension.js"), "utf8");
    expect(js).not.toMatch(/PCR_INGRESS_METADATA_CONTRACT/);
    expect(existsSync(join(repoRoot, "dist/testing.js"))).toBe(false);
  });

  it("official Pi extracts the npm tarball to dist/extension.js, then load/task/compact/resume/uninstall", async () => {
    const { tarball, spec } = packTarball();
    expect(spec.startsWith("npm:pi-context@file:")).toBe(true);
    expect(tarball.endsWith(".tgz")).toBe(true);

    const home = mkdtempSync(join(tmpdir(), "pctx-v5-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "pctx-v5-cwd-"));
    const env = { ...process.env, HOME: home, PI_OFFLINE: "0" };
    const agentDir = join(home, ".pi", "agent");
    let sessionFile = "";
    try {
      const installOut = execFileSync("pi", ["install", spec, "--no-approve"], { env, encoding: "utf8" });
      expect(installOut).toMatch(/Installed npm:pi-context@file:/);
      const listOut = execFileSync("pi", ["list"], { env, encoding: "utf8" });
      expect(listOut).not.toMatch(/Unknown file extension "\.tgz"/);
      expect(listOut).toMatch(/node_modules\/pi-context/);

      const extracted = join(agentDir, "npm", "node_modules", "pi-context", "dist", "extension.js");
      expect(existsSync(extracted)).toBe(true);
      expect(readFileSync(extracted, "utf8")).not.toMatch(/PCR_INGRESS_METADATA_CONTRACT/);

      const pi = await loadOfficialPi();
      const settings = pi.SettingsManager.create(cwd, agentDir, { projectTrusted: true });
      const loader = new pi.DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager: settings,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      await loader.reload();
      const loaded = loader.getExtensions();
      expect(loaded.errors).toEqual([]);
      const paths = loaded.extensions.map((ext) => ext.resolvedPath ?? ext.path ?? "");
      expect(paths.some((p) => p.endsWith(`${join("pi-context", "dist", "extension.js")}`) || p.endsWith("dist/extension.js"))).toBe(true);
      expect(paths.every((p) => !p.endsWith(".tgz"))).toBe(true);
      const commandNames = loaded.extensions.flatMap((ext) => [...(ext.commands?.keys() ?? [])]);
      expect(commandNames).toContain("pctx");

      const assistant = {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "pong" }],
        api: "openai-completions" as const,
        provider: "controlled",
        model: "context-test",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as const,
        timestamp: Date.now(),
      };
      const runtime = await pi.ModelRuntime.create({
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      runtime.registerProvider("controlled", {
        api: "openai-completions",
        baseUrl: "http://127.0.0.1:9",
        apiKey: "local-only",
        models: [{
          id: "context-test",
          name: "context-test",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32_000,
          maxTokens: 256,
        }],
        streamSimple() {
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "start", partial: assistant };
              yield { type: "done", message: assistant, reason: "stop" };
            },
            async result() {
              return assistant;
            },
          };
        },
      });
      const manager = pi.SessionManager.create(cwd, join(cwd, "sessions"));
      const { session, extensionsResult } = await pi.createAgentSession({
        cwd,
        agentDir,
        settingsManager: settings,
        resourceLoader: loader,
        sessionManager: manager,
        modelRuntime: runtime,
        model: runtime.getModel("controlled", "context-test"),
        noTools: "builtin",
      });
      const sessionPaths = extensionsResult.extensions.map((ext) => ext.resolvedPath ?? ext.path ?? "");
      expect(sessionPaths.some((p) => p.endsWith("dist/extension.js"))).toBe(true);

      await session.prompt("ping");
      sessionFile = manager.getSessionFile() ?? "";
      expect(sessionFile.length).toBeGreaterThan(0);
      expect(manager.getEntries().length).toBeGreaterThan(0);
      try {
        await session.compact("keep native history");
      } catch (error) {
        expect(String(error)).toMatch(/Nothing to compact/);
      }
      await session.dispose?.();

      const resumed = pi.SessionManager.open(sessionFile, join(cwd, "sessions"), cwd);
      expect(resumed.getEntries().length).toBeGreaterThan(0);

      const uninstallOut = execFileSync("pi", ["uninstall", spec, "--no-approve"], { env, encoding: "utf8" });
      expect(uninstallOut).toMatch(/Removed/);
      expect(existsSync(sessionFile)).toBe(true);
      const afterUninstall = pi.SessionManager.open(sessionFile, join(cwd, "sessions"), cwd);
      expect(afterUninstall.getEntries().length).toBeGreaterThan(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 90_000);
});
