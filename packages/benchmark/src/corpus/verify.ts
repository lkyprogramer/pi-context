import { createFileCorpusStore } from "./file-store.js";
import { failInput } from "./errors.js";
import { createCorpusGovernor } from "./governor.js";
import type { CorpusManifest } from "./types.js";

export const CORPUS_V2_ID = "pcr-corpus-v2";
export const CORPUS_V2_SMOKE_CLUSTERS = 30;
export const CORPUS_V2_GATE_CLUSTERS = 100;

export interface VerifyLockedCorpusInput {
  root: string;
  corpusId?: string;
  benchmarkMajor: number;
  minimumClusters?: number;
  signal?: AbortSignal;
}

export async function verifyLockedCorpus(input: VerifyLockedCorpusInput): Promise<CorpusManifest> {
  if (!input || typeof input !== "object") failInput("input");
  if (typeof input.root !== "string" || input.root.length === 0) failInput("root");
  if (!Number.isSafeInteger(input.benchmarkMajor) || input.benchmarkMajor < 1) failInput("benchmarkMajor");
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("signal");
  input.signal?.throwIfAborted();
  const corpusId = input.corpusId ?? CORPUS_V2_ID;
  const store = createFileCorpusStore({ root: input.root, corpusId });
  const governor = createCorpusGovernor({ corpusId, store });
  const manifest = await governor.lock({ benchmarkMajor: input.benchmarkMajor, signal: input.signal });
  const minimum = input.minimumClusters ?? CORPUS_V2_SMOKE_CLUSTERS;
  if (Object.keys(manifest.clusters).length < minimum) failInput("clusters");
  return manifest;
}
