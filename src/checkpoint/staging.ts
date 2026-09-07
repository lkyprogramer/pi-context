export type StageStatus = "idle" | "proposed" | "acked" | "committed";

export interface Proposal {
  generation: number;
  proposedHash: string;
  nativeEntryId: string | null;
  ackCount: number;
  status: StageStatus;
}

export function emptyProposal(generation = 0): Proposal {
  return { generation, proposedHash: "", nativeEntryId: null, ackCount: 0, status: "idle" };
}

export function propose(input: { generation: number; hash: string; nativeAlreadyWritten?: boolean }): Proposal {
  if (input.nativeAlreadyWritten) {
    return { generation: input.generation, proposedHash: input.hash, nativeEntryId: null, ackCount: 0, status: "idle" };
  }
  return { generation: input.generation, proposedHash: input.hash, nativeEntryId: null, ackCount: 0, status: "proposed" };
}

export function ack(proposal: Proposal, input: {
  hash: string;
  generation: number;
  nativeEntryId: string;
  nativeAlreadyWritten?: boolean;
}): Proposal {
  if (input.generation !== proposal.generation) return proposal;
  if (proposal.status === "committed") return proposal;
  if (!input.hash || input.hash !== proposal.proposedHash) return { ...proposal, status: "proposed" };
  if (input.nativeAlreadyWritten && proposal.status === "idle") {
    return { ...proposal, nativeEntryId: input.nativeEntryId, status: "committed", ackCount: proposal.ackCount };
  }
  const ackCount = proposal.ackCount + 1;
  if (proposal.status === "acked" || ackCount > 1) {
    return { ...proposal, ackCount: 1, nativeEntryId: input.nativeEntryId, status: "committed" };
  }
  return { ...proposal, ackCount: 1, nativeEntryId: input.nativeEntryId, status: "committed" };
}

export function onCompactFailed(proposal: Proposal): Proposal {
  return emptyProposal(proposal.generation);
}

export function bumpFence(proposal: Proposal): Proposal {
  return emptyProposal(proposal.generation + 1);
}
