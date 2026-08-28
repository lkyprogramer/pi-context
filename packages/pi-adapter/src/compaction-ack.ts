import type { HostCheckpointDetails } from "../../contracts/src/index.js";

export interface HostCompactionCandidate {
  firstKeptEntryId: string;
  summary: string;
  tokensBefore: number;
  estimatedTokensAfter: number;
  details: HostCheckpointDetails;
}

export interface PiCompactionResult {
  firstKeptEntryId: string;
  summary: string;
  tokensBefore: number;
  estimatedTokensAfter: number;
  fromExtension: true;
  details: HostCheckpointDetails;
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
