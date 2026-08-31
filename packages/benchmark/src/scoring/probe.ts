export type ProbeFamily = "version" | "yes-no" | "path" | "error" | "deploy";

export type ProbeErrorCode = "PCR_PROBE_DEPENDENCY_MISSING" | "PCR_PROBE_INPUT_INVALID";

export class ProbeScorerError extends TypeError {
  readonly code: ProbeErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ProbeErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ProbeScorerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new ProbeScorerError("PCR_PROBE_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new ProbeScorerError("PCR_PROBE_INPUT_INVALID", { field });
}

export interface ProbeScore {
  ok: boolean;
  skipped: boolean;
  normalized: string;
  family: ProbeFamily;
}

const SUMMARY_MARKERS = [/checkpoint v2/i, /compaction summary/i, /^summary:/i];

export function normalizeProbeAnswer(text: string, family: ProbeFamily): string {
  if (typeof text !== "string") failInput("text");
  const trimmed = text.trim().replace(/\s+/gu, " ");
  if (family === "version") {
    const tainted = trimmed.match(/\b(\d+(?:\.\d+)*)-tu-\d+\b/iu);
    if (tainted) return tainted[0].toLowerCase();
    const match = trimmed.match(/\bversion\s+(\d+(?:\.\d+)*)\b/iu) ?? trimmed.match(/\b(\d+(?:\.\d+)*)\b/u);
    return match?.[1] ?? trimmed.toLowerCase();
  }
  if (family === "yes-no") {
    if (/^(yes|true|affirmative)\b/iu.test(trimmed)) return "yes";
    if (/^(no|false|negative)\b/iu.test(trimmed)) return "no";
  }
  if (family === "deploy") {
    if (/\bdo not deploy\b/iu.test(trimmed) || /\bmust not deploy\b/iu.test(trimmed)) return "must-not-deploy";
    if (/\b(yes,? )?deploy\b/iu.test(trimmed) && !/\bnot\b/iu.test(trimmed)) return "deploy";
  }
  if (family === "path") return trimmed.replace(/\\/gu, "/");
  return trimmed.toLowerCase();
}

export function scoreProbe(input: {
  expected: string;
  observed: string;
  family: ProbeFamily;
}): ProbeScore {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.expected !== "string" || input.expected.length === 0) failInput("expected");
  if (typeof input.observed !== "string") failInput("observed");
  if (typeof input.family !== "string") failInput("family");
  if (SUMMARY_MARKERS.some((marker) => marker.test(input.observed))) {
    return { ok: false, skipped: true, normalized: "", family: input.family };
  }
  const expected = normalizeProbeAnswer(input.expected, input.family);
  const observed = normalizeProbeAnswer(input.observed, input.family);
  if (input.family === "version" && /tu-\d+/iu.test(observed) && !/tu-\d+/iu.test(expected)) {
    return { ok: false, skipped: false, normalized: observed, family: input.family };
  }
  const ok = input.family === "version" || input.family === "yes-no" || input.family === "deploy"
    ? observed === expected
    : observed === expected || observed.includes(expected);
  return {
    ok,
    skipped: false,
    normalized: observed,
    family: input.family,
  };
}
