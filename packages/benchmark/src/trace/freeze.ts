import { domainHash } from "@pcr/contracts";

import { failInput, failMissing } from "./errors.js";

export type FrozenArmId = "B0" | "B1" | "B2";

export interface FrozenArmCopy {
  arm: FrozenArmId;
  sessionJsonl: string;
  workspaceSnapshot: unknown;
  inputHash: string;
}

export interface FrozenA1Trace {
  inputHash: string;
  copies: Record<FrozenArmId, FrozenArmCopy>;
  hostAck: true;
  ingressExecuted: true;
}

export interface FreezeA1TraceInput {
  sessionJsonl: string;
  workspaceSnapshot: unknown;
  hostAck: boolean;
  signal?: AbortSignal;
}

function cloneJson<T>(value: T, field: string): T {
  try {
    return structuredClone(value);
  } catch {
    failInput(field);
  }
}

export function freezeA1Trace(input: FreezeA1TraceInput): FrozenA1Trace {
  if (!input || typeof input !== "object") failMissing("input");
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("signal");
  input.signal?.throwIfAborted();
  if (typeof input.sessionJsonl !== "string" || input.sessionJsonl.length === 0) failInput("sessionJsonl");
  if (input.workspaceSnapshot === undefined) failInput("workspaceSnapshot");
  if (input.hostAck !== true) failInput("hostAck");
  const sessionJsonl = input.sessionJsonl;
  const workspaceSnapshot = cloneJson(input.workspaceSnapshot, "workspaceSnapshot");
  const inputHash = domainHash("trace.a1-shaped-input", { sessionJsonl, workspaceSnapshot });
  const copies = {} as Record<FrozenArmId, FrozenArmCopy>;
  for (const arm of ["B0", "B1", "B2"] as const) {
    copies[arm] = Object.freeze({
      arm,
      sessionJsonl,
      workspaceSnapshot: cloneJson(workspaceSnapshot, `copies.${arm}`),
      inputHash,
    });
  }
  return Object.freeze({
    inputHash,
    copies: Object.freeze(copies),
    hostAck: true,
    ingressExecuted: true,
  });
}
