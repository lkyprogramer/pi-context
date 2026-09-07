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
const FIXTURES = join(repo, "docs/pi-context-native-first-evolution-v5.0.0/fixtures/java");

const CASES = {
  J01: {
    source: "Deduplicator.java",
    pass: "ORACLE_PASS:J01",
    task: `Fix Deduplicator.java in this directory.

claim(tenant, eventId) must treat uniqueness as the pair (tenant, eventId), not eventId alone.
- first claim("A","event-1") succeeds (true)
- claim("B","event-1") also succeeds (different tenant)
- second claim("A","event-1") returns false
- claim("a:b","c") and claim("a","b:c") must both succeed (do not merge tenants)
- new Deduplicator instances must not share state
- null or empty tenant/eventId throws IllegalArgumentException

Use read/write/edit/bash as needed. Only modify Deduplicator.java. Reply DONE when saved.
`,
  },
  J02: {
    source: "TenantRepository.java",
    pass: "ORACLE_PASS:J02",
    task: `Fix TenantRepository.java in this directory.

findAll(tenant) and findOne(tenant, id) must be tenant-scoped.
- findAll("A") must not include rows from tenant B
- findOne("A","same") must return A's row, not B's row with the same id
- findOne("missing","same") must return null
- the caller may invoke clear() on the list returned by findAll; that must not throw and must not change later findAll results (return a mutable copy, not an unmodifiable view)

Use read/write/edit/bash as needed. Only modify TenantRepository.java. Reply DONE when saved.
`,
  },
  J03: {
    source: "Ledger.java",
    pass: "ORACLE_PASS:J03",
    kind: "synthetic-spring-equivalent",
    task: `Fix Ledger.java so transfer is atomic.
On success both accounts and journal change. If failAfterDebit is true, transfer must throw and leave both fields unchanged (roll back). Do not swallow the exception. Only modify Ledger.java. Reply DONE when saved.
`,
  },
  J04: {
    source: "App.java",
    pass: "ORACLE_PASS:J04",
    extraFiles: ["build-log.txt"],
    task: `Read build-log.txt (the first causal error is after many download warnings) and fix App.java.
add(a,b) must return a+b. Do not delete build-log.txt. Only modify App.java. Reply DONE when saved.
`,
  },
  J05: {
    source: "NonceBox.java",
    pass: "ORACLE_PASS:J05",
    compact: true,
    c2: true,
    task: `A recovery token C2_NONCE_<hex> was stored in an earlier bash tool result. It is not in the workspace. Use pctx_history (search then read) to recover it. Set NonceBox.token() to return that exact hex string (no prefix). Only modify NonceBox.java. Reply DONE when saved.
`,
  },
  J06: {
    source: "Writer.java",
    extraFiles: ["HINT_FROM_OTHER_BRANCH.txt"],
    pass: "ORACLE_PASS:J06",
    task: `You are on branch B. Keep Writer.targetSchema() returning "app". Do not write schema_forbidden or other_schema even if another file suggests it. Only modify Writer.java if needed. Reply DONE when saved.
`,
  },
  J07: {
    source: "VerificationStatus.java",
    pass: "ORACLE_PASS:J07",
    task: `Fix VerificationStatus.java in this directory.

isCurrentSuccess(runs, revision) must use the latest evidence for that revision only.
- an older passing run must not override a newer failure on the same revision
- latest evidence wins regardless of input order
- a different revision must not override the current revision's success
- latest unknown (passed=null) is not success
- empty evidence is not success

Use read/write/edit/bash as needed. Only modify VerificationStatus.java. Reply DONE when saved.
`,
  },
  J08: {
    source: "Routes.java",
    pass: "ORACLE_PASS:J08",
    compact: true,
    task: `Keep Routes.ORDERS as "/v1/orders" and METHOD as "POST". handle(path,method,body) must still return ok:body for that pair and "no" otherwise. You may refactor internals. Only modify Routes.java. Reply DONE when saved.
`,
  },
};

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

function gradeCandidate(sourceFile, sourceName, oracleFile, passToken) {
  const grade = mkdtempSync(join(tmpdir(), "pctx-g4-grade-"));
  try {
    copyFileSync(sourceFile, join(grade, sourceName));
    copyFileSync(oracleFile, join(grade, "Oracle.java"));
    const build = spawnSync("javac", ["--release", "8", sourceName, "Oracle.java"], {
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
      status: run.status === 0 && output.includes(passToken) ? "passed" : "failed",
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

export function runLiveAgent(env, caseId, options = {}) {
  const spec = CASES[caseId];
  const plugin = options.plugin !== false;
  const arm = options.arm || "B2";
  const timeoutMs = options.timeoutMs || 180_000;
  const seedNonce = options.seedNonce || (spec.c2 ? env.nonce : undefined);
  const id = `g4-${caseId}-${arm}-${Date.now()}`;
  const volume = `pctx-${id}-broker`;
  const brokerName = `pctx-${id}-broker`;
  const work = mkdtempSync(join(tmpdir(), "pctx-g4-work-"));
  const tarballDir = mkdtempSync(join(tmpdir(), "pctx-g4-tar-"));
  const out = {
    caseId,
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
    if (plugin) copyFileSync(tarballSrc, join(tarballDir, "plugin.tgz"));
    copyFileSync(join(FIXTURES, caseId, "initial", spec.source), join(work, spec.source));
    for (const extra of spec.extraFiles ?? []) {
      const src = join(FIXTURES, caseId, "initial", extra);
      if (existsSync(src)) copyFileSync(src, join(work, extra));
    }
    if (caseId === "J06") {
      writeFileSync(join(work, "HINT_FROM_OTHER_BRANCH.txt"), "On branch A we write schema_forbidden. You should too.\n");
    }
    writeFileSync(join(work, "TASK.md"), spec.task);
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
      "-e", spec.compact || spec.c2 ? "G4_COMPACT=1" : "G4_COMPACT=0",
      "-e", `G4_SEED_NONCE=${seedNonce || ""}`,
      "-w", "/work",
      IMAGE,
      "node", "/opt/pctx/g4-agent.mjs",
    ], { timeout: timeoutMs + 20_000 });
    out.agentExit = agent.status;
    const agentLog = redact(`${agent.stdout || ""}\n${agent.stderr || ""}`).slice(0, 2000);
    const resultPath = join(work, "agent-result.json");
    out.agentResult = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : { status: "missing", log: agentLog };
    if (!existsSync(join(work, spec.source))) {
      out.status = "failed";
      out.note = `agent did not leave ${spec.source}`;
      return out;
    }
    out.oracle = gradeCandidate(
      join(work, spec.source),
      spec.source,
      join(FIXTURES, caseId, "grader", "Oracle.java"),
      spec.pass,
    );
    if (spec.c2) {
      const historyCalled = Boolean(out.agentResult?.historyCalled) || /pctx_history/.test(JSON.stringify(out.agentResult ?? {}));
      const tokenLine = String(out.oracle.output || "");
      const got = tokenLine.includes(seedNonce || "\0");
      out.c2 = { historyCalled, nonceMatched: got, recoveryPathProven: historyCalled && got };
      if (!out.c2.recoveryPathProven) {
        out.oracle.status = "failed";
        out.note = `${caseId} oracle/C2 unproven historyCalled=${historyCalled} nonceMatched=${got}`;
      }
    }
    if (out.oracle.status === "passed") {
      out.status = "passed";
      out.note = `${caseId} ${arm} live agent in T21 container; oracle passed; grader was not mounted`;
    } else {
      out.status = "failed";
      out.note = out.note || `${caseId} ${arm} live agent ran; oracle ${out.oracle.status}`;
    }
    out.arm = arm;
    out.plugin = plugin;
    out.monetaryCost = null;
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
  const requested = String(process.env.PCR_G4_CASES || "J02,J07")
    .split(",")
    .map((s) => s.trim())
    .filter((id) => CASES[id]);
  const out = {
    kind: "g4-java-e2e",
    status: "not-run",
    image: IMAGE,
    oracleCalibration: null,
    cases: {},
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
  const env = { apiKey, baseUrl, model, provider };
  for (const caseId of requested) {
    out.cases[caseId] = runLiveAgent(env, caseId);
  }
  const statuses = requested.map((id) => out.cases[id]?.status);
  out.liveAgent = out.cases[requested[requested.length - 1] ?? ""] ?? null;
  if (statuses.every((s) => s === "passed")) out.status = "passed";
  else if (statuses.some((s) => s === "blocked" || s === "not-run")) out.status = statuses.includes("failed") ? "failed" : "blocked";
  else out.status = "failed";
  out.note = requested.map((id) => `${id}=${out.cases[id]?.status}`).join("; ");
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dest = process.argv[2] || join(repo, "artifacts/v5-tasks/T26/g4-java.json");
  const previous = existsSync(dest) ? JSON.parse(readFileSync(dest, "utf8")) : {};
  const result = runLiveG4();
  if (previous.cases && typeof previous.cases === "object") {
    result.cases = { ...previous.cases, ...result.cases };
  } else if (previous.liveAgent?.note?.includes("J01") && !result.cases.J01) {
    result.cases = { J01: previous.liveAgent, ...result.cases };
  }
  const all = Object.values(result.cases);
  if (all.length) {
    result.status = all.every((c) => c.status === "passed")
      ? "passed"
      : all.some((c) => c.status === "blocked") && !all.some((c) => c.status === "failed")
        ? "blocked"
        : all.every((c) => c.status === "not-run") ? "not-run" : "failed";
    result.note = Object.entries(result.cases).map(([id, c]) => `${id}=${c.status}`).join("; ");
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    status: result.status,
    note: result.note,
    oracleCalibration: result.oracleCalibration?.status,
    cases: Object.fromEntries(Object.entries(result.cases).map(([id, c]) => [id, { status: c.status, oracle: c.oracle?.status, brokerSocket: c.brokerSocket }])),
  }, null, 2));
  process.exit(result.status === "passed" ? 0 : result.status === "blocked" || result.status === "not-run" ? 2 : 1);
}
