#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specSchemas = join(root, "docs/pi-context-compression-benchmark-spec/schemas");
const contractsSrc = join(root, "packages/benchmark-contracts/src/index.ts");
const src = readFileSync(contractsSrc, "utf8");

function readConst(name) {
  const match = src.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`));
  if (!match) {
    throw new Error(`missing exported const ${name}`);
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function loadSchema(name) {
  return JSON.parse(readFileSync(join(specSchemas, name), "utf8"));
}

function assertEqual(label, actual, expected) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${label} drift\n  ts:     ${left}\n  schema: ${right}`);
  }
}

const oracle = loadSchema("oracle.schema.json");
const trace = loadSchema("trace-snapshot.schema.json");
const arm = loadSchema("arm-manifest.schema.json");
const artifact = loadSchema("compression-artifact.schema.json");
const run = loadSchema("run-manifest.schema.json");
const report = loadSchema("benchmark-report.schema.json");
const gate = loadSchema("gate-decision.schema.json");

assertEqual("ORACLE_POLARITIES", readConst("ORACLE_POLARITIES"), oracle.properties.items.items.properties.polarity.enum);
assertEqual("ORACLE_STATUSES", readConst("ORACLE_STATUSES"), oracle.properties.items.items.properties.status.enum);
assertEqual("ORACLE_VISIBILITIES", readConst("ORACLE_VISIBILITIES"), oracle.properties.items.items.properties.visibility.enum);
assertEqual("ORACLE_RISKS", readConst("ORACLE_RISKS"), oracle.properties.items.items.properties.risk.enum);
assertEqual("ORACLE_REQUIRED", readConst("ORACLE_REQUIRED"), oracle.required);
assertEqual("ORACLE_ITEM_REQUIRED", readConst("ORACLE_ITEM_REQUIRED"), oracle.properties.items.items.required);
assertEqual("BOUNDARY_KINDS", readConst("BOUNDARY_KINDS"), trace.properties.boundary.properties.kind.enum);
assertEqual("RAW_TRACE_REQUIRED", readConst("RAW_TRACE_REQUIRED"), trace.required);
assertEqual("BOUNDARY_REQUIRED", readConst("BOUNDARY_REQUIRED"), trace.properties.boundary.required);
assertEqual("ARM_STAGES", readConst("ARM_STAGES"), arm.properties.stage.enum);
assertEqual("ARM_INGRESS", readConst("ARM_INGRESS"), arm.properties.ingress.enum);
assertEqual("ARM_RECALL", readConst("ARM_RECALL"), arm.properties.recall.enum);
assertEqual("ARM_COMPACTORS", readConst("ARM_COMPACTORS"), arm.properties.compactor.enum);
assertEqual("ARM_MATERIALIZERS", readConst("ARM_MATERIALIZERS"), arm.properties.materializer.enum);
assertEqual("ARM_MANIFEST_REQUIRED", readConst("ARM_MANIFEST_REQUIRED"), arm.required);
assertEqual("COMPRESSION_ARTIFACT_REQUIRED", readConst("COMPRESSION_ARTIFACT_REQUIRED"), artifact.required);
assertEqual("RUN_MANIFEST_REQUIRED", readConst("RUN_MANIFEST_REQUIRED"), run.required);
assertEqual("REPORT_STAGES", readConst("REPORT_STAGES"), report.properties.stage.enum);
assertEqual("BENCHMARK_REPORT_REQUIRED", readConst("BENCHMARK_REPORT_REQUIRED"), report.required);
assertEqual("GATE_NAMES", readConst("GATE_NAMES"), gate.properties.gate.enum);
assertEqual("GATE_DECISIONS", readConst("GATE_DECISIONS"), gate.properties.decision.enum);
assertEqual("GATE_DECISION_REQUIRED", readConst("GATE_DECISION_REQUIRED"), gate.required);

console.log("contract drift: ok");
