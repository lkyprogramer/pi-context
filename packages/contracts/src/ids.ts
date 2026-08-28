import { pcrError, type PcrError } from "./errors.js";

export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type OperationId = string & { readonly __brand: "OperationId" };
export type ObservationId = string & { readonly __brand: "ObservationId" };
export type EvidenceId = string & { readonly __brand: "EvidenceId" };
export type BlobId = string & { readonly __brand: "BlobId" };
export type HostMessageId = string & { readonly __brand: "HostMessageId" };

function branded<T extends string>(domain: string, value: string): T | PcrError {
  if (typeof value !== "string" || value.length === 0) {
    return pcrError("INVALID_ID", { domain });
  }
  return value as T;
}

export const workspaceId = (value: string): WorkspaceId => branded<WorkspaceId>("workspace", value) as WorkspaceId;
export const sessionId = (value: string): SessionId => branded<SessionId>("session", value) as SessionId;
export const operationId = (value: string): OperationId => branded<OperationId>("operation", value) as OperationId;
export const observationId = (value: string): ObservationId => branded<ObservationId>("observation", value) as ObservationId;
export const evidenceId = (value: string): EvidenceId => branded<EvidenceId>("evidence", value) as EvidenceId;
export const blobId = (value: string): BlobId => branded<BlobId>("blob", value) as BlobId;
export const hostMessageId = (value: string): HostMessageId => branded<HostMessageId>("host-message", value) as HostMessageId;
