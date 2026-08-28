import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  ARM_COMPACTORS,
  ARM_INGRESS,
  ARM_MATERIALIZERS,
  ARM_RECALL,
  ARM_STAGES,
  BOUNDARY_KINDS,
  GATE_DECISIONS,
  GATE_NAMES,
  ORACLE_POLARITIES,
  ORACLE_RISKS,
  ORACLE_STATUSES,
  ORACLE_VISIBILITIES,
  REPORT_STAGES,
  defineBenchmarkContracts,
} from "../src/index.js";

const specRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../docs/pi-context-compression-benchmark-spec");
const examplesDir = join(specRoot, "examples");

function loadExample(name: string): unknown {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf8"));
}

const validItem = {
  id: "c1",
  kind: "constraint",
  canonical: "do not deploy",
  polarity: "must-not",
  status: "active",
  sourceRefs: ["u1"],
  visibility: "must-visible",
  risk: "hard-directive",
  aliases: ["不得部署"],
  supersededBy: null,
};

const validOracle = {
  scenarioId: "s1",
  oracleVersion: "1",
  items: [validItem],
  environmentAssertions: [],
  forbiddenActions: [],
};

describe("benchmark contracts", () => {
  it("rejects an oracle with a missing sourceRef", () => {
    const c = defineBenchmarkContracts();
    expect(() => c.parseOracle({ ...validOracle, items: [{ ...validItem, sourceRefs: [] }] })).toThrow(/sourceRefs/);
  });

  it("canonicalizes object key order without mutating input", () => {
    const c = defineBenchmarkContracts();
    const a = { z: 1, a: { y: 2, x: 3 } };
    const before = structuredClone(a);
    expect(c.sha256Canonical(a)).toBe(c.sha256Canonical({ a: { x: 3, y: 2 }, z: 1 }));
    expect(a).toEqual(before);
  });

  it("parses all public examples", () => {
    const c = defineBenchmarkContracts();
    expect(c.parseOracle(loadExample("oracle.example.json")).scenarioId).toBe("deploy-constraint-001");
    expect(c.parseArmManifest(loadExample("arm-a0.example.json")).armId).toBe("A0");
    expect(c.parseArmManifest(loadExample("arm-a2.example.json")).armId).toBe("A2");
    expect(c.parseCompressionArtifact(loadExample("compression-artifact.example.json")).runId).toBe("run-example");
    expect(c.parseRunManifest(loadExample("run-manifest.example.json")).runId).toBe("run-example");
    expect(c.parseBenchmarkReport(loadExample("benchmark-report.example.json")).runId).toBe("run-example");
    expect(c.parseGateDecision(loadExample("gate-decision.example.json")).decision).toBe("proceed-to-w2");
    const trace = c.parseRawTrace(loadExample("trace-snapshot.example.json"));
    expect(trace.traceId).toBe("trace-deploy-constraint-001");
    const snapshot = c.parseBoundarySnapshot({
      workspaceSnapshotSha256: (trace as { workspaceSnapshotSha256: string }).workspaceSnapshotSha256,
      boundary: (trace as { boundary: unknown }).boundary,
    });
    expect(snapshot.workspaceSnapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects unknown fields", () => {
    const c = defineBenchmarkContracts();
    expect(() => c.parseOracle({ ...validOracle, extra: true })).toThrow(/unknown field|additional/i);
    expect(() => c.parseArmManifest({ ...loadExample("arm-a0.example.json") as object, extra: 1 })).toThrow(
      /unknown field|additional/i,
    );
  });

  it("rejects empty or duplicate IDs", () => {
    const c = defineBenchmarkContracts();
    expect(() => c.parseOracle({ ...validOracle, items: [{ ...validItem, id: "" }] })).toThrow(/id/);
    expect(() => c.parseOracle({ ...validOracle, items: [validItem, { ...validItem, sourceRefs: ["u2"] }] })).toThrow(
      /duplicate/i,
    );
  });

  it("keeps canonical hash stable across key order and does not mutate input", () => {
    const c = defineBenchmarkContracts();
    const left = { seed: 1, pi: { commit: "c", version: "v" }, entries: [{ role: "user", entryId: "u1" }] };
    const right = { entries: [{ entryId: "u1", role: "user" }], pi: { version: "v", commit: "c" }, seed: 1 };
    const before = structuredClone(left);
    expect(c.canonicalJson(left)).toBe(c.canonicalJson(right));
    expect(c.sha256Canonical(left)).toBe(c.sha256Canonical(right));
    expect(left).toEqual(before);
  });

  it("rejects non-canonical numeric values", () => {
    const c = defineBenchmarkContracts();
    expect(() => c.canonicalJson({ n: Number.NaN })).toThrow(/NaN|Infinity|undefined/);
    expect(() => c.canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow(/NaN|Infinity|undefined/);
    expect(() => c.canonicalJson({ n: undefined })).toThrow(/NaN|Infinity|undefined/);
  });

  it("returns deep-frozen clones", () => {
    const c = defineBenchmarkContracts();
    const parsed = c.parseOracle(validOracle);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.items)).toBe(true);
    expect(Object.isFrozen(parsed.items[0])).toBe(true);
    expect(() => {
      (parsed as { scenarioId: string }).scenarioId = "mutated";
    }).toThrow();
  });

  it("fails CI when schema enums drift from exported consts", () => {
    const result = spawnSync(process.execPath, ["scripts/check-contract-drift.mjs"], {
      cwd: join(specRoot, "../.."),
      encoding: "utf8",
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(ORACLE_POLARITIES).toEqual(["must", "must-not", "may", "is", "is-not", "unknown"]);
    expect(ORACLE_STATUSES).toEqual(["active", "superseded", "resolved", "retracted", "contested", "unknown"]);
    expect(ORACLE_VISIBILITIES).toEqual(["must-visible", "recallable", "must-omit"]);
    expect(ORACLE_RISKS).toEqual(["ordinary", "hard-directive", "high-risk-outcome", "secret"]);
    expect(BOUNDARY_KINDS).toEqual([
      "pre-threshold",
      "native-threshold",
      "overflow-recovery",
      "semantic-boundary",
      "branch-boundary",
      "single-huge-turn",
    ]);
    expect(ARM_STAGES).toEqual(["w1", "w2", "semantic", "oracle"]);
    expect(ARM_INGRESS).toEqual(["pass-through", "w1"]);
    expect(ARM_RECALL).toEqual(["off", "manual-only", "proactive"]);
    expect(ARM_COMPACTORS).toEqual(["pi-native", "pcr-deterministic", "pcr-semantic", "none"]);
    expect(ARM_MATERIALIZERS).toEqual(["off", "identity", "pcr-deterministic", "pcr-semantic"]);
    expect(REPORT_STAGES).toEqual(["w1", "w2", "semantic"]);
    expect(GATE_NAMES).toEqual(["w1-early-net-value", "w2-compactor", "semantic-beta"]);
    expect(GATE_DECISIONS).toEqual([
      "proceed-to-w2",
      "keep-reducers-only",
      "keep-recovery-only",
      "stop",
      "repeat-after-infrastructure-fix",
      "adopt-pcr-compactor",
      "keep-pi-native",
      "proceed-to-semantic",
    ]);
  });
});
