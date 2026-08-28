import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function resolvePiBin(): string {
  const pinned = join(homedir(), ".nvm/versions/node/v22.19.0/bin/pi");
  if (existsSync(pinned)) return pinned;
  const fromPath = process.env.PATH?.split(":").map((dir) => join(dir, "pi")).find((file) => existsSync(file));
  if (fromPath) return fromPath;
  const versioned = join(homedir(), ".nvm/versions/node", process.version, "bin/pi");
  if (existsSync(versioned)) return versioned;
  throw new Error("pi binary not found; run `nvm use v22.19.0` first");
}

export function resolvePiPackageEntry(): string {
  const bin = resolvePiBin();
  const candidates = [
    join(dirname(bin), "../lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js"),
    join(homedir(), ".nvm/versions/node", process.version, "lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js"),
  ];
  const found = candidates.find((file) => existsSync(file));
  if (!found) throw new Error("pi-coding-agent package not found next to the pi binary");
  return found;
}
