import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STATED_SOURCE = "9767ba275f3e9a5ee0f5c5342249b629ab1b2282";

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

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

describe("T01 stock loader on official Pi 0.85.1", () => {
  it("rejects PCR patches and loads the packed plugin via DefaultResourceLoader", async () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      name?: string;
      version?: string;
      private?: boolean;
      patchedDependencies?: unknown;
      pi?: { extensions?: string[] };
      peerDependencies?: Record<string, string>;
      piHostContract?: { runtimeExport?: string };
    };
    expect(manifest.private).toBe(true);
    expect(manifest.name).toBe("pi-context");
    expect(manifest.version).toBe("6.1.0");
    expect(manifest.patchedDependencies).toBeUndefined();
    expect(manifest.piHostContract?.runtimeExport).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toMatch(/PCR_INGRESS_METADATA_CONTRACT/);
    expect(manifest.pi?.extensions).toEqual(["./dist/extension.js"]);
    expect(manifest.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBe("0.85.1");

    const distJs = join(repoRoot, "dist/extension.js");
    expect(existsSync(distJs)).toBe(true);
    const distText = readFileSync(distJs, "utf8");
    expect(distText).not.toMatch(/PCR_INGRESS_METADATA_CONTRACT/);
    expect(distText).not.toMatch(/patchedDependencies/);
    expect(distText).not.toMatch(/@earendil-works\/pi-coding-agent\/(?:src|dist\/core)\//);

    const piRoot = officialPiRoot();
    const piPkg = JSON.parse(readFileSync(join(piRoot, "package.json"), "utf8")) as {
      version: string;
      gitHead?: string;
    };
    expect(piPkg.version).toBe("0.85.1");
    const npmGitHead = String(
      execFileSync("npm", ["view", "@earendil-works/pi-coding-agent@0.85.1", "gitHead"], { encoding: "utf8" }).trim(),
    );
    const identity = {
      node: process.version,
      piPackageVersion: piPkg.version,
      npmGitHead,
      statedSource: STATED_SOURCE,
      match: npmGitHead === STATED_SOURCE,
      loader: "DefaultResourceLoader",
    };
    if (!identity.match) {
      identity.blockedReason = "npm 0.85.1 gitHead does not equal stated source 9767ba2; using unmodified official npm package, not a fork";
    }

    const pi = await import(pathToFileURL(join(piRoot, "dist/index.js")).href) as {
      DefaultResourceLoader: new (opts: Record<string, unknown>) => {
        reload: () => Promise<void>;
        getExtensions: () => { extensions: Array<{ name?: string; commands?: Array<{ name: string }> }> };
      };
      SettingsManager: { inMemory: (settings: unknown, opts?: unknown) => unknown };
    };
    expect(pi.DefaultResourceLoader.name).toBe("DefaultResourceLoader");

    const staging = mkdtempSync(join(tmpdir(), "pctx-v5-pack-"));
    const agentDir = mkdtempSync(join(tmpdir(), "pctx-v5-agent-"));
    try {
      cpSync(join(repoRoot, "dist"), join(staging, "dist"), { recursive: true });
      const packedManifest = {
        name: "pi-context",
        version: "5.0.0-dev.0",
        private: true,
        type: "module",
        pi: { extensions: ["./dist/extension.js"] },
      };
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(staging, "package.json"), JSON.stringify(packedManifest, null, 2));

      const packedScan = `${readFileSync(join(staging, "package.json"), "utf8")}\n${readFileSync(join(staging, "dist/extension.js"), "utf8")}`;
      expect(packedScan).not.toMatch(/patchedDependencies/);
      expect(packedScan).not.toMatch(/PCR_INGRESS_METADATA_CONTRACT/);

      const settings = pi.SettingsManager.inMemory(
        { defaultProvider: "google", defaultModel: "unused", defaultTools: [] },
        { projectTrusted: true },
      );
      const loader = new pi.DefaultResourceLoader({
        cwd: staging,
        agentDir,
        settingsManager: settings,
        additionalExtensionPaths: [staging],
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      await loader.reload();
      const loaded = loader.getExtensions();
      const names = loaded.extensions.flatMap((ext) => [...((ext.commands as Map<string, unknown> | undefined)?.keys?.() ?? [])]);
      expect(names).toContain("pctx");
      expect(identity.loader).toBe("DefaultResourceLoader");
      expect(sha256(packedScan).length).toBe(64);
    } finally {
      rmSync(staging, { recursive: true, force: true });
      rmSync(agentDir, { recursive: true, force: true });
    }
  });
});
