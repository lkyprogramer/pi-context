#!/usr/bin/env node
/**
 * G4 Java/E2E attempt: host oracle calibration + container isolation probe.
 * Does not enable coding tools unless T21 sandbox (network-none + loopback relay + unmounted grader) is proven.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preflightIsolation, toolsEnabledAllowed } from "../scripts/credential-broker.mjs";

function javaAvailable() {
  return existsSync("/usr/bin/javac") || existsSync("/opt/homebrew/bin/javac");
}

function probeIsolation() {
  const r = spawnSync("docker", ["info"], { encoding: "utf8", timeout: 8000 });
  if (r.status === 0) return { ok: true };
  return { ok: false, blocked: r.stderr || r.error?.message || "docker info failed" };
}

function runSandboxed(_cmd) {
  const probe = probeIsolation();
  if (!probe.ok) return { status: "blocked", error: probe.blocked };
  return { status: "ok" };
}

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

function redact(value) {
  return String(value).replace(/(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/giu, "[redacted]");
}

export function runLiveG4() {
  const out = {
    kind: "g4-java-e2e",
    status: "not-run",
    javac: javaAvailable(),
    dockerInfo: null,
    sandboxRun: null,
    containerNetworkNone: null,
    jdkInNodeImage: null,
    oracleCalibration: null,
    liveAgent: null,
    note: "",
  };
  const docker = probeIsolation();
  out.dockerInfo = { ok: docker.ok, blocked: docker.blocked ? redact(docker.blocked).slice(0, 400) : null };
  out.sandboxRun = runSandboxed("true");
  const isolation = preflightIsolation({ ...process.env, PCR_LIVE: "1", API_KEY: "SYNTHETIC_SECRET_123" });
  const tools = toolsEnabledAllowed({ live: process.env.PCR_LIVE === "1", isolation: isolation.proven, brokerReady: false });
  out.liveAgent = {
    attempted: false,
    status: "blocked",
    reason: "coding tools require T21 container (network none, loopback unix relay, unmounted grader, JDK). docker info / env isolation is not that sandbox.",
    envIsolationProven: isolation.proven,
    toolsEnabledAllowed: tools,
  };

  const netNone = spawnSync("docker", [
    "run", "--rm", "--network", "none", "--read-only", "--tmpfs", "/tmp",
    "--cap-drop", "ALL", "--user", "1000:1000",
    "node:22.19.0-bookworm", "node", "-e", "console.log('sandbox-ok')",
  ], { encoding: "utf8", timeout: 60_000 });
  out.containerNetworkNone = {
    status: netNone.status,
    stdout: (netNone.stdout || "").trim().slice(0, 200),
    stderr: redact(netNone.stderr || "").slice(0, 400),
  };

  const jdkProbe = spawnSync("docker", [
    "run", "--rm", "--network", "none",
    "node:22.19.0-bookworm", "bash", "-lc", "command -v javac || echo NO_JAVAC",
  ], { encoding: "utf8", timeout: 60_000 });
  out.jdkInNodeImage = {
    status: jdkProbe.status,
    stdout: (jdkProbe.stdout || "").trim().slice(0, 200),
  };

  const packRoot = join(repo, "docs/pi-context-native-first-evolution-v5.0.0");
  const verify = join(packRoot, "scripts/verify_java_fixtures.py");
  if (existsSync(verify) && out.javac) {
    const tmp = mkdtempSync(join(tmpdir(), "pctx-g4-oracle-"));
    try {
      const result = spawnSync("python3", [verify, "--root", packRoot, "--output", join(tmp, "oracle.json")], {
        encoding: "utf8",
        timeout: 60_000,
      });
      const jsonPath = join(tmp, "oracle.json");
      out.oracleCalibration = existsSync(jsonPath)
        ? JSON.parse(readFileSync(jsonPath, "utf8"))
        : { status: "failed", stderr: redact(result.stderr || "").slice(0, 800), exit: result.status };
    } catch (error) {
      out.oracleCalibration = { status: "failed", error: redact(error) };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } else {
    out.oracleCalibration = { status: "not-run", reason: out.javac ? "verify script missing" : "javac missing" };
  }

  const oracleOk = out.oracleCalibration?.status === "passed";
  const containerOk = out.containerNetworkNone?.status === 0 && out.containerNetworkNone.stdout.includes("sandbox-ok");
  const jdkInSandbox = typeof out.jdkInNodeImage?.stdout === "string" && out.jdkInNodeImage.stdout.includes("javac") && !out.jdkInNodeImage.stdout.includes("NO_JAVAC");
  if (!oracleOk) {
    out.status = out.oracleCalibration?.status === "not-run" ? "not-run" : "failed";
    out.note = "host oracle calibration did not pass; live E2E not started";
  } else if (!containerOk || !jdkInSandbox) {
    out.status = "blocked";
    out.note = `oracle calibrated on host; live Java E2E blocked: network-none container=${containerOk} jdkInSandbox=${jdkInSandbox}. Containerfile has no JDK/Maven/unix relay.`;
  } else {
    out.status = "blocked";
    out.note = "sandbox has javac but grader-unmounted live loop is not wired; not claimed as E2E pass";
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runLiveG4();
  const dest = process.argv[2] || join(repo, "artifacts/v5-tasks/T26/g4-java.json");
  writeFileSync(dest, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: result.status, note: result.note, javac: result.javac, dockerInfo: result.dockerInfo, containerNetworkNone: result.containerNetworkNone?.status, oracle: result.oracleCalibration?.status }, null, 2));
  process.exit(result.status === "passed" ? 0 : result.status === "blocked" || result.status === "not-run" ? 2 : 1);
}
