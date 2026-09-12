import { join } from "node:path";
import { loadReviewFixture, validateScenario } from "./scenarios.mjs";

export const REVIEW_BUDGET = {
  episode: { wallMs: 600_000, modelCalls: 24, toolCalls: 48 },
  episodeLong: { wallMs: 900_000, modelCalls: 40, toolCalls: 80 },
  run: { totalWallMs: 7_200_000, totalModelCalls: 1_500, totalToolCalls: 2_400 },
};

const FILE_ORACLE_BY_ID = {
  Q01: { file: "contract-revision.txt", equals: "tenant-contract-73" },
  Q02: { file: "retry-contract.txt", equals: "7" },
  Q03: { file: "grace-ms.txt", equals: "1730" },
  Q04: { file: "build-tag.txt", equals: "build-r9q7" },
  Q05: { file: "root-cause.txt", contains: "ZX-731" },
  Q06: { file: "ticket.txt", equals: "TK-442", forbidden: ["TK-991"] },
  Q07: { file: "recovered.json", keyA: "alpha-931", keyB: "beta-527" },
  Q08: { file: "rollback-marker.txt", equals: "rollback-619" },
  C01: { file: "restored.txt", needles: ["nce-8f3a21c4", "c01-end-8f3a-page2"] },
  C02: { file: "needles.txt", needles: ["needle-alpha", "needle-beta"], forbidden: ["decoy-gamma"] },
};

const JAVA_ORACLE = new Set(["Q01", "Q04", "Q06", "Q07"]);
const VERIFY_ORACLE = new Set(["Q02", "Q03", "Q05", "Q08"]);

export function fileOracleOf(id) {
  const oracle = FILE_ORACLE_BY_ID[id];
  if (!oracle) throw new Error(`no file oracle for ${id}`);
  return oracle;
}

export function graderKindOf(id) {
  if (JAVA_ORACLE.has(id)) return "oracle-java+file";
  if (VERIFY_ORACLE.has(id)) return "verify-sh+file";
  return "file-oracle";
}

export function evaluateFileOracle(oracle, readText) {
  const raw = readText(oracle.file);
  if (raw == null) return { ok: false, reason: `missing ${oracle.file}` };
  const text = raw.replace(/^\uFEFF/, "");
  const trimmed = text.replace(/\s+$/u, "");
  if (oracle.equals != null && trimmed !== String(oracle.equals)) {
    return { ok: false, reason: `${oracle.file} != ${oracle.equals}` };
  }
  if (oracle.contains != null && !text.includes(oracle.contains)) {
    return { ok: false, reason: `${oracle.file} missing ${oracle.contains}` };
  }
  if (oracle.keyA != null || oracle.keyB != null) {
    let parsed;
    try { parsed = JSON.parse(text); } catch {
      return { ok: false, reason: `${oracle.file} not json` };
    }
    if (oracle.keyA != null && parsed.keyA !== oracle.keyA) return { ok: false, reason: "keyA mismatch" };
    if (oracle.keyB != null && parsed.keyB !== oracle.keyB) return { ok: false, reason: "keyB mismatch" };
  }
  if (Array.isArray(oracle.needles)) {
    for (const needle of oracle.needles) {
      if (!text.includes(needle)) return { ok: false, reason: `missing ${needle}` };
    }
  }
  if (Array.isArray(oracle.forbidden)) {
    for (const bad of oracle.forbidden) {
      if (text.includes(bad)) return { ok: false, reason: `forbidden ${bad}` };
    }
  }
  return { ok: true, reason: "file-oracle" };
}

export function requiresFoldMap(ids) {
  const out = {};
  for (const id of ids) {
    try {
      const fx = loadReviewFixture(id);
      out[id] = fx.requiresFold === true;
    } catch (error) {
      if (id === "X01") {
        out[id] = true;
        continue;
      }
      throw error;
    }
  }
  return out;
}

export function materializeReviewCase(spec, repo) {
  const fx = loadReviewFixture(spec.id);
  const v = validateScenario(fx);
  if (!v.ok) throw new Error(`${spec.id} fixture invalid: ${v.errors.join(",")}`);
  const fileOracle = spec.grader?.fileOracle ?? fileOracleOf(spec.id);
  const kind = spec.grader?.kind ?? graderKindOf(spec.id);
  const editable = spec.grader?.editable ?? [
    ...(JAVA_ORACLE.has(spec.id) || VERIFY_ORACLE.has(spec.id) ? (spec.grader?.editable ?? []) : []),
    fileOracle.file,
  ];
  return {
    ...spec,
    runner: "review",
    requiresFold: fx.requiresFold,
    seed: spec.seed ?? join("eval/local/seeds/review", `${spec.id}.jsonl`),
    taskFile: spec.taskFile ?? join("eval/local/cases", spec.id, "TASK.md"),
    fixture: spec.fixture ?? (spec.id.startsWith("C") ? join("eval/local/fixtures", spec.id) : spec.fixture),
    grader: {
      kind,
      trusted: spec.grader?.trusted ?? [],
      editable: spec.grader?.editable ?? unique(editable),
      fileOracle,
    },
    protectedPaths: spec.protectedPaths ?? [],
    reviewFixture: spec.reviewFixture ?? join("eval/local/review-fixtures", `${spec.id}.json`),
    repo,
  };
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
