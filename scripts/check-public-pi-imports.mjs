import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  /@earendil-works\/pi-coding-agent\/src\b/,
  /@earendil-works\/pi-agent-core\/src\b/,
  /@mariozechner\/pi-coding-agent\/src\b/,
  /@mariozechner\/pi-agent-core\/src\b/,
  /pi-coding-agent\/dist\/core\//,
  /from\s+["'][^"']*agent-loop/,
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, files);
    else if (/\.(ts|js|mjs|cjs)$/.test(name)) files.push(path);
  }
  return files;
}

export async function scanImports(roots) {
  const findings = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      const text = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) findings.push({ file, pattern: String(pattern) });
      }
    }
  }
  return findings;
}

export async function runPiContractSuite(harness) {
  const contracts = [];
  const capabilities = await (harness.probeCapabilities?.() ?? harness.probe?.() ?? { ready: false, missing: ["probe"] });
  contracts.push({ name: "capabilities", ok: capabilities.ready === true, detail: capabilities });
  if (typeof harness.llmContext === "function") {
    const filtered = harness.llmContext([
      { role: "user", content: "hi" },
      { role: "custom", content: "plugin-only" },
    ]);
    contracts.push({
      name: "custom-entry-excluded",
      ok: filtered.every((item) => item.role !== "custom") && filtered.some((item) => item.role === "user"),
    });
  }
  if (harness.host?.on && harness.host?.emit) {
    const seen = [];
    harness.host.on("context", () => {
      seen.push("a");
    });
    harness.host.on("context", () => {
      seen.push("b");
    });
    const emitted = await harness.host.emit("context", { messages: [] });
    contracts.push({
      name: "handler-chaining",
      ok: seen.join("") === "ab" && Array.isArray(emitted.errors),
    });
  }
  return contracts;
}

export async function verifyPiCompatibility(version, harness) {
  const capabilities = await (harness.probeCapabilities?.() ?? harness.probe?.() ?? { ready: false, missing: ["probe"] });
  const contracts = await runPiContractSuite(harness);
  return {
    version,
    ready: capabilities.ready === true && contracts.every((item) => item.ok),
    capabilities,
    contracts,
  };
}

export function payloadProbeUnavailable(reason) {
  return { available: false, reason, hash: null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = await scanImports(["packages/pi-adapter", "apps/pi-context-runtime"]);
  console.log(JSON.stringify({ findings }, null, 2));
  if (findings.length > 0) process.exit(1);
}
