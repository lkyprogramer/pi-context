import type { W1ArmCase, W1ArmCaseCatalog } from "../arms/w1.js";

export interface ReaderCeilingResult {
  answerable: boolean;
  fullContextScore: number;
  candidateRetention?: number;
}

export interface ReaderCeiling {
  evaluate(input: { caseId: string; candidateText?: string; signal?: AbortSignal }): Promise<ReaderCeilingResult>;
}

export interface CreateReaderCeilingInput {
  corpusId: string;
  cases: W1ArmCaseCatalog;
}

export type ReaderCeilingErrorCode =
  | "PCR_READER_DEPENDENCY_MISSING"
  | "PCR_READER_INPUT_INVALID"
  | "PCR_READER_SCOPE_MISMATCH";

export class ReaderCeilingError extends TypeError {
  readonly code: ReaderCeilingErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ReaderCeilingErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ReaderCeilingError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new ReaderCeilingError("PCR_READER_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new ReaderCeilingError("PCR_READER_INPUT_INVALID", { field });
}

function failScope(details: Record<string, unknown> = {}): never {
  throw new ReaderCeilingError("PCR_READER_SCOPE_MISMATCH", details);
}

function freezeResult(result: ReaderCeilingResult): ReaderCeilingResult {
  return Object.freeze({ ...result });
}

export function createReaderCeiling(input: CreateReaderCeilingInput): ReaderCeiling {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.corpusId !== "string" || input.corpusId.length === 0) failMissing("corpusId");
  if (!input.cases || typeof input.cases.get !== "function") failMissing("cases");
  const corpusId = input.corpusId;
  const cases = input.cases;
  return {
    async evaluate(request): Promise<ReaderCeilingResult> {
      if (!request || typeof request !== "object") failInput("request");
      if (typeof request.caseId !== "string" || request.caseId.length === 0) failInput("caseId");
      if (request.candidateText !== undefined && typeof request.candidateText !== "string") failInput("candidateText");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("signal");
      request.signal?.throwIfAborted();
      const record = await cases.get(request.caseId);
      if (!record) failInput("caseId");
      if (record.caseId !== request.caseId) failInput("case.caseId");
      if (record.corpusId !== corpusId) failScope({ expected: corpusId, actual: record.corpusId });
      if (!record.trace || !Array.isArray(record.trace.entries) || record.trace.entries.length === 0) failInput("case.trace");
      if (!record.oracle || !Array.isArray(record.oracle.items) || record.oracle.items.length === 0) failInput("case.oracle");
      const fullText = record.trace.entries.map((entry) => entry.text).join("\n");
      const expected = record.oracle.items.map((item) => {
        if (!item || typeof item.expected !== "string" || item.expected.length === 0) failInput("oracle.items.expected");
        return item.expected;
      });
      const fullHits = expected.filter((value) => fullText.includes(value)).length;
      const fullContextScore = fullHits / expected.length;
      const answerable = fullHits === expected.length;
      const result: ReaderCeilingResult = { answerable, fullContextScore };
      if (request.candidateText !== undefined) {
        const candidateHits = expected.filter((value) => fullText.includes(value) && request.candidateText!.includes(value)).length;
        result.candidateRetention = fullHits === 0 ? 0 : candidateHits / fullHits;
      }
      return freezeResult(result);
    },
  };
}
