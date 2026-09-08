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
  if (!input.hash) return emptyProposal(input.generation);
  if (input.nativeAlreadyWritten) {
    return { generation: input.generation, proposedHash: input.hash, nativeEntryId: null, ackCount: 0, status: "idle" };
  }
  return { generation: input.generation, proposedHash: input.hash, nativeEntryId: null, ackCount: 0, status: "proposed" };
}

export function ack(proposal: Proposal, input: { hash: string; generation: number }): Proposal {
  if (input.generation !== proposal.generation) return proposal;
  if (proposal.status === "committed") return proposal;
  if (proposal.status === "idle") return proposal;
  if (!input.hash || input.hash !== proposal.proposedHash) return proposal;
  if (proposal.status === "acked") {
    return { ...proposal, ackCount: 1 };
  }
  return { ...proposal, status: "acked", ackCount: 1 };
}

export function commitNative(proposal: Proposal, input: {
  generation: number;
  nativeEntryId: string;
  nativeHash: string;
}): Proposal {
  if (input.generation !== proposal.generation) return proposal;
  if (!input.nativeHash || !input.nativeEntryId) return proposal;
  if (proposal.status === "committed") return proposal;
  if (proposal.status === "acked" && input.nativeHash === proposal.proposedHash) {
    return { ...proposal, status: "committed", nativeEntryId: input.nativeEntryId, ackCount: 1 };
  }
  return proposal;
}

export function restoreFromNative(input: {
  generation: number;
  nativeEntryId: string;
  nativeHash: string;
}): Proposal {
  if (!input.nativeHash || !input.nativeEntryId) return emptyProposal(input.generation);
  return {
    generation: input.generation,
    proposedHash: input.nativeHash,
    nativeEntryId: input.nativeEntryId,
    ackCount: 0,
    status: "committed",
  };
}

export function onCompactFailed(proposal: Proposal): Proposal {
  return emptyProposal(proposal.generation);
}

export function bumpFence(proposal: Proposal): Proposal {
  return emptyProposal(proposal.generation + 1);
}
