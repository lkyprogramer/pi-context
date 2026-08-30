import type { RuntimeCursor } from "@pcr/contracts";

import {
  ReducerRegistryError,
  type CreateReducerRegistryInput,
  type ReducedObservation,
  type Reducer,
  type ReducerInput,
} from "./types.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function failInput(field: string): never {
  throw new ReducerRegistryError("PCR_REDUCER_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function snapshotCursor(value: RuntimeCursor, field = "cursor"): Readonly<RuntimeCursor> {
  if (!value || typeof value !== "object") failInput(field);
  const cursor: RuntimeCursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput(`${field}.workspaceId`);
  requireNonEmpty(cursor.sessionId, `${field}.sessionId`);
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, `${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  requireNonEmpty(cursor.modelKey, `${field}.modelKey`);
  return Object.freeze(cursor);
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

export interface ReducerRegistry {
  reduce(input: ReducerInput): Promise<ReducedObservation>;
}

class DefaultReducerRegistry implements ReducerRegistry {
  readonly #cursor: Readonly<RuntimeCursor>;
  readonly #reducers: readonly Reducer[];

  constructor(input: CreateReducerRegistryInput) {
    if (!input || typeof input !== "object") {
      throw new ReducerRegistryError("PCR_REDUCER_DEPENDENCY_MISSING", { dependency: "input" });
    }
    if (!input.cursor || typeof input.cursor !== "object") {
      throw new ReducerRegistryError("PCR_REDUCER_DEPENDENCY_MISSING", { dependency: "cursor" });
    }
    if (!Array.isArray(input.reducers) || input.reducers.length === 0) {
      throw new ReducerRegistryError("PCR_REDUCER_DEPENDENCY_MISSING", { dependency: "reducers" });
    }
    const seen = new Set<string>();
    for (const [index, reducer] of input.reducers.entries()) {
      if (!reducer || typeof reducer.id !== "string" || reducer.id.length === 0) {
        throw new ReducerRegistryError("PCR_REDUCER_DEPENDENCY_MISSING", { dependency: `reducers[${index}].id` });
      }
      if (typeof reducer.supports !== "function" || typeof reducer.reduce !== "function") {
        throw new ReducerRegistryError("PCR_REDUCER_DEPENDENCY_MISSING", { dependency: `reducers[${index}]` });
      }
      if (seen.has(reducer.id)) {
        throw new ReducerRegistryError("PCR_REDUCER_INPUT_INVALID", { field: "reducers.id", id: reducer.id });
      }
      seen.add(reducer.id);
    }
    this.#cursor = snapshotCursor(input.cursor, "input.cursor");
    this.#reducers = Object.freeze([...input.reducers]);
  }

  async reduce(value: ReducerInput): Promise<ReducedObservation> {
    if (!value || typeof value !== "object") failInput("input");
    if (!value.observation || typeof value.observation !== "object") failInput("input.observation");
    requireNonEmpty(value.observation.toolName, "input.observation.toolName");
    requireNonEmpty(value.observation.toolCallId, "input.observation.toolCallId");
    if (typeof value.text !== "string") failInput("input.text");
    const cursor = snapshotCursor(value.cursor ?? value.observation.cursor, "input.cursor");
    if (!sameCursor(cursor, this.#cursor)) {
      throw new ReducerRegistryError("PCR_REDUCER_SCOPE_MISMATCH");
    }
    const signal = value.signal ?? value.observation.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("input.signal");
    signal?.throwIfAborted();
    const reducer = this.#reducers.find((item) => item.supports(value.observation));
    if (!reducer) {
      throw new ReducerRegistryError("PCR_REDUCER_UNSUPPORTED", { toolName: value.observation.toolName });
    }
    const output = await reducer.reduce(value);
    if (!output || typeof output.visibleText !== "string" || !Array.isArray(output.facts)) {
      failInput("reducer.reduce.result");
    }
    return {
      ...output,
      reducer: { id: reducer.id },
    };
  }
}

export function createReducerRegistry(input: CreateReducerRegistryInput): ReducerRegistry {
  return new DefaultReducerRegistry(input);
}
