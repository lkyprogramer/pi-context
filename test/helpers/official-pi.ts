import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function officialPiRoot(): string {
  const npmRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  return join(npmRoot, "@earendil-works/pi-coding-agent");
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
    };
    open: (path: string, sessionDir?: string, cwd?: string) => { getEntries: () => unknown[]; getSessionFile: () => string | undefined };
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
