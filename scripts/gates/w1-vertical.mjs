#!/usr/bin/env node
import { createHash } from "node:crypto";

import { createProductionReducers, createReducerRegistry } from "@pcr/core";
import { createRetrievalTools } from "@pcr/pi-adapter";

export class W1VerticalError extends TypeError {
  constructor(code, details = {}) {
    super(code);
    this.name = "W1VerticalError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency) {
  throw new W1VerticalError("PCR_W1_VERTICAL_DEPENDENCY_MISSING", { dependency });
}

function failInput(field) {
  throw new W1VerticalError("PCR_W1_VERTICAL_INPUT_INVALID", { field });
}

function sha256(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function queryFrom(text) {
  return text.split(/\s+/u).filter(Boolean).slice(0, 2).join(" ");
}

export async function runW1Vertical(input) {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.observation || typeof input.observation.ingest !== "function") failMissing("observation");
  if (
    !input.evidence
    || typeof input.evidence.admit !== "function"
    || typeof input.evidence.search !== "function"
    || typeof input.evidence.read !== "function"
  ) {
    failMissing("evidence");
  }
  if (!input.blobs || typeof input.blobs.put !== "function" || typeof input.blobs.read !== "function") {
    failMissing("blobs");
  }
  if (typeof input.text !== "string" || input.text.length === 0) failInput("text");
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("signal");
  input.signal?.throwIfAborted();

  const rawHash = sha256(input.text);
  const operationId = typeof input.operationId === "string" && input.operationId.length > 0
    ? input.operationId
    : `op_${rawHash.slice(0, 16)}`;
  const toolCallId = typeof input.toolCallId === "string" && input.toolCallId.length > 0
    ? input.toolCallId
    : `call_${rawHash.slice(0, 16)}`;
  const capturedAt = Number.isSafeInteger(input.capturedAt) ? input.capturedAt : 23;

  const observation = {
    operationId,
    cursor: input.cursor,
    toolCallId,
    toolName: "bash",
    args: { command: "npm test" },
    content: [{ type: "text", text: input.text }],
    details: { exitCode: 1 },
    isError: true,
    capturedAt,
    sourceClass: "untrusted-tool",
    authority: "inform",
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };

  const projected = await input.observation.ingest(observation);
  input.signal?.throwIfAborted();
  const registry = createReducerRegistry({
    cursor: input.cursor,
    reducers: createProductionReducers(),
  });
  const reduced = await registry.reduce({
    observation,
    text: input.text,
    rawBlobId: projected.rawBlobId,
    cursor: input.cursor,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const visibleTokens = reduced.visibleText.split(/\s+/u).filter(Boolean).length;
  const admitted = await input.evidence.admit({
    cursor: input.cursor,
    operationId: projected.operationId,
    observationId: projected.observationId,
    rawBlobId: projected.rawBlobId,
    reducer: { id: reduced.reducer.id, revision: "1" },
    sourceClass: "untrusted-tool",
    facts: reduced.facts,
    observedAt: capturedAt,
    visibleText: reduced.visibleText,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (!admitted[0]?.evidenceId) failInput("evidence.admit");
  const tools = createRetrievalTools({ cursor: input.cursor, evidence: input.evidence });
  const query = queryFrom(input.text);
  const found = await tools.search({
    query,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const page = await tools.read({
    evidenceId: admitted[0].evidenceId,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  return {
    rawHash,
    visibleTokens,
    exactReadHash: page.sha256,
    searchRank: found.hits[0]?.rank ?? Number.POSITIVE_INFINITY,
  };
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("w1-vertical.mjs")) {
  process.stderr.write("runW1Vertical is a library entry; invoke it from tests/acceptance/w1-vertical.test.ts\n");
  process.exit(2);
}
