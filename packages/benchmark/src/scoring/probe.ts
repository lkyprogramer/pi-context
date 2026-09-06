export type ProbeFamily = "version" | "yes-no" | "path" | "error" | "deploy";

export type ProbeParseBucket =
  | "ok"
  | "summary"
  | "tool-call"
  | "non-answer"
  | "wrong-file"
  | "unknown"
  | "unparseable"
  | "mismatch"
  | "unscorable"
  | "ambiguous";

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
  bucket: ProbeParseBucket;
}

const TOOL_CALL_MARKERS = [
  /<tool_call\b/i,
  /<\/tool_call>/i,
  /<function\s*=/i,
  /\btoolCall\b/i,
  /\btool_call\b/i,
  /"type"\s*:\s*"tool_call"/i,
  /<read_file\b/i,
  /<\/read_file>/i,
  /<bash\b/i,
  /<\/bash>/i,
];
const NON_ANSWER_MARKERS = [
  /^(i don'?t know|unknown|n\/a|none|idk)\b/i,
  /cannot (?:answer|tell|determine)/i,
  /as an ai\b/i,
  /no (?:idea|information)\b/i,
];
const ACTION_REFUSAL = /(?:do not|must not|should not|don'?t)\s+(?:merge|change|modify|deploy)\b/iu;
const CJK_ACTION_REFUSAL = /不要(?:修改|合并|部署)|不应(?:修改|合并|部署)|不能(?:改|合并|部署)|禁止(?:修改|合并|部署)|不具备部署|暂不部署/u;

function stripMarkdown(text: string): string {
  return text.replace(/[*_`]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function parseStructuredAnswer(text: string): { answer: string; kind?: string } | undefined {
  const match = text.match(/\{[\s\S]*\}/u);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]) as { answer?: unknown; kind?: unknown };
    if (!parsed || typeof parsed !== "object" || typeof parsed.answer !== "string" || parsed.answer.length === 0) {
      return undefined;
    }
    return {
      answer: parsed.answer,
      ...(typeof parsed.kind === "string" ? { kind: parsed.kind } : {}),
    };
  } catch {
    return undefined;
  }
}

function leadingPolarity(text: string): "yes" | "no" | undefined {
  const trimmed = stripMarkdown(text);
  if (/^(?:yes|true|affirmative)(?:$|[^A-Za-z0-9])/iu.test(trimmed) || /^是(?:$|[^\p{L}])/u.test(trimmed)) {
    return "yes";
  }
  if (/^(?:no|false|negative)(?:$|[^A-Za-z0-9])/iu.test(trimmed) || /^否(?:$|[^\p{L}])/u.test(trimmed)) {
    return "no";
  }
  return undefined;
}

function actionRefusal(text: string): boolean {
  const trimmed = stripMarkdown(text);
  return ACTION_REFUSAL.test(trimmed) || CJK_ACTION_REFUSAL.test(trimmed);
}

function contradictoryYesNo(text: string): boolean {
  const polarity = leadingPolarity(text);
  const permission = /(?:actually|however|but)\s*,?\s*(?:yes\b|you may\b)/iu.test(text)
    || /you may (?:modify|change|merge|deploy)/iu.test(text)
    || /可以(?:修改|变更|合并|部署)|允许(?:修改|变更|合并|部署)/u.test(text);
  if (polarity === "no" && permission) return true;
  if (polarity === "yes" && actionRefusal(text) && /(?:actually|however)\s*,?\s*no\b/iu.test(text)) return true;
  return false;
}

function explicitVersions(text: string): string[] {
  return unique([...text.matchAll(/\bversion\s*[:=]?\s*(\d+(?:\.\d+)*)\b/giu)].map((match) => match[1]!));
}

function bareNumbers(text: string): string[] {
  return unique([...text.matchAll(/\b(\d+(?:\.\d+)*)\b/gu)].map((match) => match[1]!));
}

export function normalizeProbeAnswer(text: string, family: ProbeFamily): string {
  if (typeof text !== "string") failInput("text");
  const structured = parseStructuredAnswer(text);
  const trimmed = stripMarkdown(structured?.answer ?? text);
  if (family === "version") {
    const tainted = trimmed.match(/\b(\d+(?:\.\d+)*)-tu-\d+\b/iu);
    if (tainted) return tainted[0].toLowerCase();
    if (structured) return trimmed;
    const explicit = explicitVersions(trimmed);
    if (explicit.length === 1) return explicit[0]!;
    if (explicit.length > 1) return trimmed.toLowerCase();
    const numbers = bareNumbers(trimmed);
    if (numbers.length === 1) return numbers[0]!;
    return trimmed.toLowerCase();
  }
  if (family === "yes-no") {
    const polarity = leadingPolarity(trimmed);
    if (polarity) return polarity;
    if (actionRefusal(trimmed)) return "no";
  }
  if (family === "deploy") {
    if (actionRefusal(trimmed) && /deploy|部署/u.test(trimmed)) return "must-not-deploy";
    const polarity = leadingPolarity(trimmed);
    if (polarity === "no" && /deploy|部署/u.test(trimmed)) return "must-not-deploy";
    if (polarity === "yes" && /deploy|部署/u.test(trimmed) && !actionRefusal(trimmed)) return "deploy";
    if (polarity === "no") return "must-not-deploy";
  }
  if (family === "path") return trimmed.replace(/\\/gu, "/");
  if (family === "error") return trimmed.toLowerCase();
  return trimmed.toLowerCase();
}

function fail(family: ProbeFamily, bucket: ProbeParseBucket, normalized = ""): ProbeScore {
  return { ok: false, skipped: false, normalized, family, bucket };
}

function basename(path: string): string {
  const parts = path.replace(/\\/gu, "/").split("/");
  return (parts.at(-1) ?? path).toLowerCase();
}

export function scoreProbe(input: {
  expected: string;
  observed: string;
  family: ProbeFamily;
  fullAnswer?: boolean;
}): ProbeScore {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.expected !== "string" || input.expected.length === 0) failInput("expected");
  if (typeof input.observed !== "string") failInput("observed");
  if (typeof input.family !== "string") failInput("family");
  const families: ProbeFamily[] = ["version", "yes-no", "path", "error", "deploy"];
  if (!families.includes(input.family)) failInput("family");
  if (input.fullAnswer === false) return fail(input.family, "unscorable");
  if (input.observed.trim().length === 0) return fail(input.family, "non-answer");
  if (TOOL_CALL_MARKERS.some((marker) => marker.test(input.observed))) {
    return fail(input.family, "tool-call", input.observed.trim().slice(0, 80));
  }
  if (NON_ANSWER_MARKERS.some((marker) => marker.test(stripMarkdown(input.observed)))) {
    return fail(input.family, "non-answer", input.observed.trim().slice(0, 80));
  }
  if (input.family === "yes-no" && contradictoryYesNo(input.observed)) {
    return fail(input.family, "ambiguous", stripMarkdown(input.observed).slice(0, 80));
  }
  if (input.family === "version") {
    const explicit = explicitVersions(stripMarkdown(input.observed));
    const numbers = bareNumbers(stripMarkdown(input.observed));
    if (explicit.length > 1 || (explicit.length === 0 && numbers.length > 1)) {
      return fail(input.family, "ambiguous", stripMarkdown(input.observed).slice(0, 80));
    }
  }
  const expected = normalizeProbeAnswer(input.expected, input.family);
  const observed = normalizeProbeAnswer(input.observed, input.family);
  if (input.family === "version" && /tu-\d+/iu.test(observed) && !/tu-\d+/iu.test(expected)) {
    return fail(input.family, "mismatch", observed);
  }
  if (input.family === "path") {
    const expectedName = basename(expected);
    const observedName = basename(observed);
    if (expectedName.length > 0 && observedName.length > 0 && expectedName !== observedName && !observed.includes(expected)) {
      return fail(input.family, "wrong-file", observed);
    }
  }
  if (input.family === "yes-no" && observed !== "yes" && observed !== "no") {
    return fail(input.family, /^\d/.test(observed) ? "unknown" : "unparseable", observed);
  }
  if (input.family === "deploy" && observed !== "must-not-deploy" && observed !== "deploy") {
    return fail(input.family, "unparseable", observed);
  }
  if (input.family === "version" && !/^\d+(?:\.\d+)*$/u.test(observed)) {
    return fail(input.family, "unparseable", observed);
  }
  const ok = input.family === "version" || input.family === "yes-no" || input.family === "deploy"
    ? observed === expected
    : observed === expected || observed.includes(expected);
  if (!ok) return fail(input.family, "mismatch", observed);
  return {
    ok: true,
    skipped: false,
    normalized: observed,
    family: input.family,
    bucket: "ok",
  };
}
