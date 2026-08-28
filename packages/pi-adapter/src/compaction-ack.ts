import type { HostCheckpointDetails } from "../../contracts/src/index.js";

export interface HostCompactionCandidate {
  firstKeptEntryId: string;
  summary: string;
  tokensBefore: number;
  estimatedTokensAfter: number;
  details: HostCheckpointDetails;
}

export interface PiCompactionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface PiCompactionResult {
  firstKeptEntryId: string;
  summary: string;
  tokensBefore: number;
  estimatedTokensAfter: number;
  fromExtension: true;
  details: HostCheckpointDetails;
  usage: PiCompactionUsage;
}

export function emptyPiCompactionUsage(): PiCompactionUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export interface StagedCompaction {
  candidate: HostCompactionCandidate;
  result: PiCompactionResult;
}

export function ackHostCompaction(
  staged: StagedCompaction | null,
  entry: PiCompactionResult | undefined,
  onCommit: () => void,
): boolean {
  if (!staged || !entry) return false;
  if (staged.result.details.outputHash !== entry.details?.outputHash) return false;
  onCommit();
  return true;
}

export function failStagedCompaction(staged: StagedCompaction | null, onClear: () => void): void {
  if (staged) onClear();
}
