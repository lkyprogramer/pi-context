import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function officialPiRoot(): string {
  const local = join(repoRoot, "node_modules/@earendil-works/pi-coding-agent");
  if (existsSync(join(local, "package.json"))) return local;
  const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const global = join(npmRoot, "@earendil-works/pi-coding-agent");
  if (!existsSync(join(global, "package.json"))) {
    throw new Error("blocked-environment: @earendil-works/pi-coding-agent@0.85.1 is not installed");
  }
  return global;
}

export async function loadOfficialPi(): Promise<{
  DefaultResourceLoader: new (opts: Record<string, unknown>) => {
    reload: () => Promise<void>;
    getExtensions: () => {
      extensions: Array<{ path?: string; resolvedPath?: string; commands?: Map<string, unknown> }>;
      errors: Array<{ path: string; error: string }>;
    };
  };
  SettingsManager: {
    create: (cwd: string, agentDir?: string, options?: Record<string, unknown>) => unknown;
    inMemory: (settings?: unknown, options?: unknown) => unknown;
  };
    SessionManager: {
    create: (cwd: string, sessionDir?: string) => {
      getSessionFile: () => string | undefined;
      getEntries: () => unknown[];
      appendMessage: (message: unknown) => string;
      getSessionId: () => string;
      getLeafId: () => string | null;
      getEntry: (id: string) => unknown;
      buildSessionContext: () => { messages: unknown[] };
    };
    open: (path: string, sessionDir?: string, cwd?: string) => {
      getSessionFile: () => string | undefined;
      getEntries: () => unknown[];
      appendMessage: (message: unknown) => string;
      getSessionId: () => string;
      getLeafId: () => string | null;
      getEntry: (id: string) => unknown;
      buildSessionContext: () => { messages: unknown[] };
    };
  };
  ModelRuntime: { create: (opts: Record<string, unknown>) => Promise<{
    registerProvider: (id: string, config: Record<string, unknown>) => void;
    getModel: (provider: string, id: string) => unknown;
  }> };
  createAgentSession: (opts: Record<string, unknown>) => Promise<{
    session: {
      prompt: (text: string) => Promise<void>;
      compact: (instructions?: string) => Promise<unknown>;
      dispose?: () => void | Promise<void>;
      bindExtensions?: (opts: Record<string, unknown>) => Promise<void>;
      getToolDefinition?: (name: string) => {
        execute: (id: string, params: Record<string, unknown>, signal: unknown, upd: unknown, ctx: unknown) => Promise<unknown>;
      } | undefined;
      getActiveTools?: () => unknown;
      messages: unknown[];
      sessionManager?: { appendMessage: (message: unknown) => string };
    };
    extensionsResult: { extensions: Array<{ path?: string; resolvedPath?: string; commands?: Map<string, unknown> }> };
  }>;
}> {
  const root = officialPiRoot();
  return import(pathToFileURL(join(root, "dist/index.js")).href) as never;
}

export function packedInstallSpec(tarballAbs: string): string {
  return `npm:pi-context@file:${tarballAbs}`;
}
