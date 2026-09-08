import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { encodeRef, isFieldRef, refForField } from "../../src/history/refs.js";
import { buildScope } from "../../src/history/scope.js";
import type { NativeEntry } from "../../src/contracts.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const originalHome = process.env.HOME;
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

it("pctx_history read returns a real image block from official SessionManager", async () => {
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: repoRoot, stdio: "pipe" });
  const piRoot = officialPiRoot();
  const pi = (await import(pathToFileURL(join(piRoot, "dist/index.js")).href)) as {
    DefaultResourceLoader: new (opts: Record<string, unknown>) => {
      reload: () => Promise<void>;
    };
    SettingsManager: { create: (cwd: string, agentDir?: string, options?: Record<string, unknown>) => unknown };
    SessionManager: { create: (cwd: string, sessionDir?: string) => {
      appendMessage: (message: unknown) => string;
      getEntries: () => NativeEntry[];
      getSessionId: () => string;
      getLeafId: () => string | null;
      getEntry: (id: string) => NativeEntry | undefined;
    } };
    ModelRuntime: { create: (opts: Record<string, unknown>) => Promise<unknown> };
    createAgentSession: (opts: Record<string, unknown>) => Promise<{
      session: {
        getToolDefinition: (name: string) => {
          execute: (
            id: string,
            params: Record<string, unknown>,
            signal: unknown,
            upd: unknown,
            ctx: unknown,
          ) => Promise<{ content: Array<{ type: string; text?: string; mimeType?: string; data?: string }> }>;
        } | undefined;
        dispose?: () => void | Promise<void>;
      };
    }>;
  };

  const home = mkdtempSync(join(tmpdir(), "pctx-img-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "pctx-img-cwd-"));
  const staging = mkdtempSync(join(tmpdir(), "pctx-img-ext-"));
  const sessionDir = mkdtempSync(join(tmpdir(), "pctx-img-sess-"));
  const agentDir = join(home, ".pi", "agent");
  process.env.HOME = home;
  mkdirSync(agentDir, { recursive: true });
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

  const manager = pi.SessionManager.create(cwd, sessionDir);

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
    const { session } = await pi.createAgentSession({
      cwd,
      agentDir,
      settingsManager: settings,
      resourceLoader: loader,
      sessionManager: manager,
      modelRuntime: runtime,
      tools: ["pctx_history"],
    });
    try {
      manager.appendMessage({
        role: "user",
        content: [
          { type: "image", mimeType: "image/png", data: PNG },
          { type: "text", text: "inspect" },
        ],
        timestamp: Date.now(),
      });
      const tool = session.getToolDefinition("pctx_history");
      expect(tool).toBeTruthy();
      const leafId = manager.getLeafId();
      const entry = leafId ? manager.getEntry(leafId) : manager.getEntries()[0];
      expect(entry).toBeTruthy();
      const scope = buildScope({
        cwd,
        sessionId: manager.getSessionId(),
        leafId,
        getEntry: (id) => manager.getEntry(id),
      });
      const field = refForField(scope, entry!, 0);
      expect(isFieldRef(field)).toBe(true);
      if (!isFieldRef(field)) return;
      expect(field.kind).toBe("image");
      const result = await tool!.execute(
        "call-1",
        { action: "read", ref: encodeRef(field) },
        undefined,
        undefined,
        {
          cwd,
          sessionManager: manager,
          ui: { notify() {} },
          getContextUsage: () => ({ tokens: 1000, contextWindow: 262144, percent: 1 }),
          model: { contextWindow: 262144 },
          isProjectTrusted: () => true,
        },
      );
      const image = result.content.find((block) => block.type === "image");
      expect(image?.type).toBe("image");
      expect(image?.data).toBe(PNG);
      expect(image?.mimeType).toBe("image/png");
    } finally {
      await session.dispose?.();
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  }
});
