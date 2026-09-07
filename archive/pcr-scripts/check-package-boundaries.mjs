import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FROZEN_PACKAGES = ["contracts", "kernel", "storage", "worker", "pi-adapter", "testkit"];

function collectTsSources(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsSources(path));
    } else if (entry.name.endsWith(".ts")) {
      out.push(readFileSync(path, "utf8"));
    }
  }
  return out;
}

export function assertWorkspaceLayout(overrides = {}) {
  const root = overrides.root ?? process.cwd();
  if (overrides.missingPackage) {
    throw new Error(`missing workspace package: ${overrides.missingPackage}`);
  }
  const workspace = overrides.workspaceYaml ?? readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  if (!workspace.includes("apps/*") || !workspace.includes("packages/*")) {
    throw new Error("workspace must declare apps/* and packages/*");
  }
  for (const dir of FROZEN_PACKAGES) {
    if (!existsSync(join(root, "packages", dir, "package.json"))) {
      throw new Error(`missing workspace package: ${dir}`);
    }
  }
  const app = overrides.appManifest ?? JSON.parse(readFileSync(join(root, "apps/pi-context-runtime/package.json"), "utf8"));
  const extensions = app?.pi?.extensions ?? [];
  if (extensions.length !== 1) {
    throw new Error("app must declare exactly one extension entry");
  }
  const kernelSources = overrides.kernelSources ?? collectTsSources(join(root, "packages/kernel"));
  for (const source of kernelSources) {
    if (/@earendil-works\//.test(source)) {
      throw new Error("packages/kernel must not import @earendil-works/*");
    }
  }
  return true;
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("check-package-boundaries.mjs")) {
  assertWorkspaceLayout();
  process.stdout.write("boundaries: ok\n");
}
