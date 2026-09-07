#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: repo, stdio: "inherit" });
const staging = join(tmpdir(), `pctx-pack-${Date.now()}`);
mkdirSync(join(staging, "dist"), { recursive: true });
execFileSync("cp", ["-R", join(repo, "dist"), staging]);
writeFileSync(join(staging, "package.json"), readFileSync(join(repo, "package.json")));
const packed = execFileSync("npm", ["pack", "--json"], { cwd: staging, encoding: "utf8" });
const tarball = JSON.parse(packed)[0]?.filename;
const tarPath = join(staging, tarball);
const hash = createHash("sha256").update(readFileSync(tarPath)).digest("hex");
const out = { tarball: tarPath, sha256: hash, name: tarball };
console.log(JSON.stringify(out, null, 2));
copyFileSync(tarPath, join(repo, tarball));
rmSync(staging, { recursive: true, force: true });
