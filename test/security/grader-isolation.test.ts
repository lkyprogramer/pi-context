import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const repo = join(import.meta.dirname, "../..");
const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
const dockerOk = docker.status === 0;   // no Docker → ctx.skip(): reported as blocked-environment, never counted as pass
const image = spawnSync("docker", ["image", "inspect", "pctx-t21-sandbox:0.85.1"], { encoding: "utf8" });
const imageOk = dockerOk && image.status === 0;

it("ships the container grader and no host live-g4 runner", () => {
  expect(existsSync(join(repo, "eval/local/grade.sh"))).toBe(true);
  expect(existsSync(join(repo, "eval/local/sandbox/run-agent.sh"))).toBe(true);
  expect(existsSync(join(repo, "eval/local/sandbox/run-in-container.mjs"))).toBe(true);
  expect(existsSync(join(repo, "eval/live-g4.mjs"))).toBe(false);
});

it("a candidate that prints ORACLE_PASS but exits 1 is graded failed, and cannot reach the network", { timeout: 120_000 }, (ctx) => {
  if (!dockerOk || !imageOk) ctx.skip();
  const cand = mkdtempSync(join(tmpdir(), "pctx-cand-"));
  mkdirSync(join(cand, "src/main/java/com/acme/order"), { recursive: true });
  writeFileSync(join(cand, "src/main/java/com/acme/order/OrderService.java"), "public class OrderService { static { System.out.println(\"ORACLE_PASS:L01\"); } }\n");
  writeFileSync(join(cand, "verify.sh"), "#!/bin/sh\ncurl -m 3 http://example.com >/dev/null 2>&1 && echo NET_OK\necho ORACLE_PASS:L01\nexit 1\n");
  const out = mkdtempSync(join(tmpdir(), "pctx-grade-"));
  const r = spawnSync("bash", [join(repo, "eval/local/grade.sh"), "L01", cand, out], { encoding: "utf8" });
  expect(r.status).toBe(0);                               // grader itself ran
  const grade = JSON.parse(readFileSync(join(out, "grade.json"), "utf8"));
  expect(grade.passed).toBe(false);
  expect(grade.exitCode).not.toBe(0);
  expect(r.stdout + r.stderr).not.toContain("NET_OK");
});

it("candidate verify.sh is ignored in favour of the trusted grader copy", { timeout: 120_000 }, (ctx) => {
  if (!dockerOk || !imageOk) ctx.skip();
  const cand = mkdtempSync(join(tmpdir(), "pctx-cand-"));
  writeFileSync(join(cand, "verify.sh"), "#!/bin/sh\nexit 0\n");
  const out = mkdtempSync(join(tmpdir(), "pctx-grade-"));
  spawnSync("bash", [join(repo, "eval/local/grade.sh"), "L01", cand, out], { encoding: "utf8" });
  const grade = JSON.parse(readFileSync(join(out, "grade.json"), "utf8"));
  expect(grade.passed).toBe(false);                       // trusted verify.sh compiles real sources → fails on empty candidate
});

it("mutating a protected test file fails protectedIntact", { timeout: 120_000 }, (ctx) => {
  if (!imageOk) ctx.skip();
  const cand = mkdtempSync(join(tmpdir(), "pctx-prot-"));
  cpSync(join(repo, "eval/local/fixtures/L01"), cand, { recursive: true });
  writeFileSync(join(cand, "src/test/java/com/acme/order/OrderServiceTest.java"), "public class OrderServiceTest { public static void main(String[] a) {} }\n");
  const out = mkdtempSync(join(tmpdir(), "pctx-grade-"));
  spawnSync("bash", [join(repo, "eval/local/grade.sh"), "L01", cand, out], { encoding: "utf8" });
  const grade = JSON.parse(readFileSync(join(out, "grade.json"), "utf8"));
  expect(grade.protectedIntact).toBe(false);
  expect(grade.passed).toBe(false);
});

it("rejects a symlink in an editable path", { timeout: 120_000 }, (ctx) => {
  if (!imageOk) ctx.skip();
  const cand = mkdtempSync(join(tmpdir(), "pctx-link-"));
  mkdirSync(join(cand, "src/main"), { recursive: true });
  symlinkSync("/etc/passwd", join(cand, "src/main/java"));
  const out = mkdtempSync(join(tmpdir(), "pctx-grade-"));
  spawnSync("bash", [join(repo, "eval/local/grade.sh"), "L01", cand, out], { encoding: "utf8" });
  const grade = JSON.parse(readFileSync(join(out, "grade.json"), "utf8"));
  expect(grade.passed).toBe(false);
  expect(grade.exitCode).toBe(97);
});
