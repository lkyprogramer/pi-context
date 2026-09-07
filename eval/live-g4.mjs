#!/usr/bin/env node
/**
 * G4 live Java E2E: T21 container agent + sidecar unix broker + host-side oracle.
 * Grader/KnownGood are never mounted into the agent workdir. API keys stay in the sidecar.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE = process.env.PCR_SANDBOX_IMAGE || "pctx-t21-sandbox:0.85.1";

function redact(value) {
  return String(value)
    .replace(/(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/giu, "[redacted]")
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]");
}

function loadDotenv() {
  const file = join(repo, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf8", timeout: opts.timeout ?? 30_000 });
}

function calibrateOracles() {
  const packRoot = join(repo, "docs/pi-context-native-first-evolution-v5.0.0");
  const verify = join(packRoot, "scripts/verify_java_fixtures.py");
  if (!existsSync(verify)) return { status: "not-run", reason: "verify script missing" };
  const tmp = mkdtempSync(join(tmpdir(), "pctx-g4-oracle-"));
  try {
    const result = spawnSync("python3", [verify, "--root", packRoot, "--output", join(tmp, "oracle.json")], {
      encoding: "utf8",
      timeout: 60_000,
    });
    const jsonPath = join(tmp, "oracle.json");
    return existsSync(jsonPath)
      ? JSON.parse(readFileSync(jsonPath, "utf8"))
      : { status: "failed", stderr: redact(result.stderr || "").slice(0, 800), exit: result.status };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function gradeCandidate(sourceFile, oracleFile) {
  const grade = mkdtempSync(join(tmpdir(), "pctx-g4-grade-"));
  try {
    copyFileSync(sourceFile, join(grade, "Deduplicator.java"));
    copyFileSync(oracleFile, join(grade, "Oracle.java"));
    const build = spawnSync("javac", ["--release", "8", "Deduplicator.java", "Oracle.java"], {
      cwd: grade,
      encoding: "utf8",
      timeout: 25_000,
    });
    if (build.status !== 0) {
      return { status: "failed", compileExit: build.status, output: redact(build.stderr || "").slice(0, 1500) };
    }
    const run = spawnSync("java", ["-cp", grade, "Oracle"], { encoding: "utf8", timeout: 10_000 });
    const output = `${run.stdout || ""}${run.stderr || ""}`;
    return {
      status: run.status === 0 && output.includes("ORACLE_PASS:J01") ? "passed" : "failed",
      compileExit: 0,
      runExit: run.status,
      output: output.slice(0, 1500),
    };
  } finally {
    rmSync(grade, { recursive: true, force: true });
  }
}

function waitBrokerSocket(name, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = docker(["exec", name, "sh", "-c", "test -S /run/pctx/broker.sock && echo OK"]);
    if ((r.stdout || "").includes("OK")) return true;
    spawnSync("sleep", ["0.25"], { timeout: 1000 });
  }
  return false;
}

function runLiveAgent(env) {
  const id = `g4-${Date.now()}`;
  const volume = `pctx-${id}-broker`;
  const brokerName = `pctx-${id}-broker`;
  const work = mkdtempSync(join(tmpdir(), "pctx-g4-work-"));
  const tarballDir = mkdtempSync(join(tmpdir(), "pctx-g4-tar-"));
  const out = {
    attempted: true,
    status: "blocked",
    isolation: "t21-container",
    brokerSocket: false,
    agentExit: null,
    agentResult: null,
    oracle: null,
    note: "",
    error: null,
  };
  try {
    const tarballSrc = join(repo, "artifacts/release-candidate/pi-context-5.0.0-dev.0.tgz");
    if (!existsSync(tarballSrc)) {
      out.note = "packed tarball missing";
      return out;
    }
    copyFileSync(tarballSrc, join(tarballDir, "plugin.tgz"));
    copyFileSync(
      join(repo, "docs/pi-context-native-first-evolution-v5.0.0/fixtures/java/J01/initial/Deduplicator.java"),
      join(work, "Deduplicator.java"),
    );
    writeFileSync(join(work, "TASK.md"), `Fix Deduplicator.java in this directory.

claim(tenant, eventId) must treat uniqueness as the pair (tenant, eventId), not eventId alone.
- first claim("A","event-1") succeeds (true)
- claim("B","event-1") also succeeds (different tenant)
- second claim("A","event-1") returns false
- claim("a:b","c") and claim("a","b:c") must both succeed (do not merge tenants)
- new Deduplicator instances must not share state
- null or empty tenant/eventId throws IllegalArgumentException

Use read/write/edit/bash as needed. Only modify Deduplicator.java. Reply DONE when saved.
`);
    docker(["volume", "create", volume]);
    const broker = docker([
      "run", "-d", "--name", brokerName,
      "--user", "0:0",
      "-v", `${volume}:/run/pctx`,
      "-v", `${join(repo, "scripts/credential-broker.mjs")}:/opt/pctx/credential-broker.mjs:ro`,
      "-v", `${join(repo, "eval/sandbox/broker-main.mjs")}:/opt/pctx/broker-main.mjs:ro`,
      "-e", `PCR_LIVE_BASE_URL=${env.baseUrl}`,
      "-e", `PCR_LIVE_API_KEY=${env.apiKey}`,
      "-e", `PCR_LIVE_MODEL=${env.model}`,
      "-e", "PCR_BROKER_SOCK=/run/pctx/broker.sock",
      "--entrypoint", "node",
      IMAGE,
      "/opt/pctx/broker-main.mjs",
    ], { timeout: 30_000 });
    if (broker.status !== 0) {
      out.error = redact(broker.stderr || broker.stdout || "broker start failed");
      out.note = "broker sidecar failed to start";
      return out;
    }
    out.brokerSocket = waitBrokerSocket(brokerName);
    if (!out.brokerSocket) {
      const logs = docker(["logs", brokerName], { timeout: 10_000 });
      out.error = redact(`${logs.stdout || ""}\n${logs.stderr || ""}`).slice(0, 800);
      out.note = "broker unix socket not ready in volume";
      return out;
    }
    const agent = docker([
      "run", "--rm",
      "--network", "none",
      "--read-only",
      "--tmpfs", "/tmp:uid=1000,gid=1000",
      "--tmpfs", "/home/node:uid=1000,gid=1000",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--memory", "1g",
      "--pids-limit", "256",
      "--user", "1000:1000",
      "-v", `${work}:/work:rw`,
      "-v", `${volume}:/run/pctx:rw`,
      "-v", `${tarballDir}:/tarball:ro`,
      "-v", `${join(repo, "eval/sandbox/g4-agent.mjs")}:/opt/pctx/g4-agent.mjs:ro`,
      "-e", "HOME=/home/node",
      "-e", "PCR_BROKER_URL=http://127.0.0.1:8080/v1",
      "-e", `PCR_LIVE_MODEL=${env.model}`,
      "-e", `PCR_LIVE_PROVIDER=${env.provider}`,
      "-w", "/work",
      IMAGE,
      "node", "/opt/pctx/g4-agent.mjs",
    ], { timeout: 300_000 });
    out.agentExit = agent.status;
    const agentLog = redact(`${agent.stdout || ""}\n${agent.stderr || ""}`).slice(0, 2000);
    const resultPath = join(work, "agent-result.json");
    out.agentResult = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : { status: "missing", log: agentLog };
    if (!existsSync(join(work, "Deduplicator.java"))) {
      out.status = "failed";
      out.note = "agent did not leave Deduplicator.java";
      return out;
    }
    out.oracle = gradeCandidate(
      join(work, "Deduplicator.java"),
      join(repo, "docs/pi-context-native-first-evolution-v5.0.0/fixtures/java/J01/grader/Oracle.java"),
    );
    if (out.oracle.status === "passed") {
      out.status = "passed";
      out.note = "J01 live agent in T21 container; oracle passed; grader was not mounted";
    } else {
      out.status = "failed";
      out.note = `J01 live agent ran; oracle ${out.oracle.status}`;
    }
    return out;
  } catch (error) {
    out.status = "blocked";
    out.error = redact(error).slice(0, 800);
    out.note = out.note || "live agent threw";
    return out;
  } finally {
    docker(["rm", "-f", brokerName], { timeout: 15_000 });
    docker(["volume", "rm", "-f", volume], { timeout: 15_000 });
    rmSync(tarballDir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

export function runLiveG4() {
  loadDotenv();
  process.env.PCR_LIVE = "1";
  const out = {
    kind: "g4-java-e2e",
    status: "not-run",
    image: IMAGE,
    oracleCalibration: null,
    liveAgent: null,
    note: "",
  };
  const inspect = docker(["image", "inspect", IMAGE], { timeout: 8000 });
  if (inspect.status !== 0) {
    out.status = "blocked";
    out.note = `T21 image missing: ${IMAGE}`;
    return out;
  }
  out.oracleCalibration = calibrateOracles();
  if (out.oracleCalibration.status !== "passed") {
    out.status = out.oracleCalibration.status === "not-run" ? "not-run" : "failed";
    out.note = "host oracle calibration did not pass; live E2E not started";
    return out;
  }
  const apiKey = process.env.PCR_LIVE_API_KEY?.trim();
  const baseUrl = process.env.PCR_LIVE_BASE_URL?.trim();
  const model = process.env.PCR_LIVE_MODEL?.trim();
  const provider = process.env.PCR_LIVE_PROVIDER?.trim() || "openclaw";
  if (!apiKey || !baseUrl || !model) {
    out.status = "blocked";
    out.note = "PCR_LIVE credentials missing";
    return out;
  }
  out.liveAgent = runLiveAgent({ apiKey, baseUrl, model, provider });
  out.status = out.liveAgent.status;
  out.note = out.liveAgent.note;
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runLiveG4();
  const dest = process.argv[2] || join(repo, "artifacts/v5-tasks/T26/g4-java.json");
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    status: result.status,
    note: result.note,
    oracleCalibration: result.oracleCalibration?.status,
    live: {
      attempted: result.liveAgent?.attempted,
      brokerSocket: result.liveAgent?.brokerSocket,
      agentExit: result.liveAgent?.agentExit,
      oracle: result.liveAgent?.oracle?.status,
    },
  }, null, 2));
  process.exit(result.status === "passed" ? 0 : result.status === "blocked" || result.status === "not-run" ? 2 : 1);
}
