import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function resolvePiBin(): string {
  const projectLocal = join(process.cwd(), "node_modules/.bin/pi");
  if (existsSync(projectLocal)) return projectLocal;
  const pinned = join(homedir(), ".nvm/versions/node/v22.19.0/bin/pi");
  if (existsSync(pinned)) return pinned;
  const fromPath = process.env.PATH?.split(":").map((dir) => join(dir, "pi")).find((file) => existsSync(file));
  if (fromPath) return fromPath;
  const versioned = join(homedir(), ".nvm/versions/node", process.version, "bin/pi");
  if (existsSync(versioned)) return versioned;
  throw new Error("pi binary not found; run `nvm use v22.19.0` first");
}

export function resolvePiPackageRoot(): string {
  const bin = resolvePiBin();
  const candidates = [
    join(dirname(bin), "../@earendil-works/pi-coding-agent"),
    join(dirname(bin), "../lib/node_modules/@earendil-works/pi-coding-agent"),
    join(homedir(), ".nvm/versions/node", process.version, "lib/node_modules/@earendil-works/pi-coding-agent"),
  ];
  const found = candidates.find((file) => existsSync(join(file, "dist/index.js")));
  if (!found) throw new Error("pi-coding-agent package not found next to the pi binary");
  return found;
}

export function resolvePiPackageEntry(): string {
  return join(resolvePiPackageRoot(), "dist/index.js");
}

export function resolvePiJitiEntry(): string {
  const packageJson = createRequire(resolvePiPackageEntry()).resolve("jiti/package.json");
  return join(dirname(packageJson), "lib/jiti-static.mjs");
}

export function resolvePiCli(): string {
  const root = resolvePiPackageRoot();
  const candidates = [join(root, "dist/cli.js"), join(root, "dist/bundle/cli.js")];
  const found = candidates.find((file) => existsSync(file));
  if (!found) throw new Error("pi-coding-agent CLI entry not found");
  return found;
}
