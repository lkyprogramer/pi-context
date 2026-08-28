import { domainHash } from "../../contracts/src/index.js";

export interface CandidateSnapshot {
  workspaceId: string;
  sessionId: string;
  leafId: string;
  lineageHash: string;
  sourceHead: string;
  modelKey: string;
  thinkingLevel: string;
  contextWindow: number;
  systemPromptHash: string;
  activeToolSetHash: string;
  reducerRevisionSet: string;
  extractorRevision: string;
  schemaVersion: string;
  configFingerprint: string;
}

export function candidateKey(snapshot: CandidateSnapshot): string {
  return domainHash("candidate-key", snapshot);
}

export function sameCandidateKey(left: string, right: string): boolean {
  return left === right;
}
