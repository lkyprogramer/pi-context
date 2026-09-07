#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const context = join(repo, "eval/sandbox");
const tag = process.env.PCR_SANDBOX_IMAGE || "pctx-t21-sandbox:0.85.1";
const outDir = join(repo, "artifacts/v5-tasks/T21");
mkdirSync(outDir, { recursive: true });

const result = {
  kind: "t21-image-build",
  tag,
  status: "blocked",
  command: `docker build -f eval/sandbox/Containerfile -t ${tag} eval/sandbox`,
  imageId: null,
  digest: null,
  versions: null,
  error: null,
};

try {
  execFileSync("docker", ["build", "-f", "Containerfile", "-t", tag, "."], {
    cwd: context,
    stdio: "inherit",
    timeout: 600_000,
  });
  const inspect = JSON.parse(execFileSync("docker", ["image", "inspect", tag], { encoding: "utf8" }));
  const img = inspect[0] ?? {};
  result.imageId = img.Id ?? null;
  result.digest = Array.isArray(img.RepoDigests) ? img.RepoDigests[0] ?? null : null;
  const versions = execFileSync("docker", [
    "run", "--rm", "--network", "none", "--read-only", "--tmpfs", "/tmp:uid=1000,gid=1000",
    "--cap-drop", "ALL", "--user", "1000:1000", tag,
    "sh", "-c", "node -v; pi --version; javac -version; mvn -version | head -1",
  ], { encoding: "utf8", timeout: 60_000 });
  result.versions = versions.trim();
  result.status = "passed";
} catch (error) {
  result.status = "blocked";
  result.error = String(error).slice(0, 1500);
}

writeFileSync(join(outDir, "image.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ status: result.status, tag: result.tag, imageId: result.imageId, versions: result.versions, error: result.error }, null, 2));
process.exit(result.status === "passed" ? 0 : 2);
