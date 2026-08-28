import { createHash } from "node:crypto";
import { ScopeDeniedError } from "./blob-faults.js";

export interface RecoveryScope {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly branchId: string;
}

export interface BlobRecoveryRecord {
  readonly handle: string;
  readonly expectedSha256: string;
  readonly observedSha256?: string;
  readonly ok: boolean;
  readonly failureCode?: string;
}

export interface RecoverabilityReport {
  exactRecoveryRate: number;
  rangeRecoveryRate: number;
  crossScopeLeaks: number;
  corruptionsDetected: number;
  records: readonly BlobRecoveryRecord[];
}

export interface RecoverabilityInput {
  scope: RecoveryScope;
  requests: readonly { handle: string; expectedSha256: string; expectedLength: number }[];
  store: {
    read(handle: string, scope: RecoveryScope): Uint8Array | undefined | "denied";
  };
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function inMemoryEncryptedStore(items: readonly { handle: string; scope: string; bytes: Uint8Array }[]) {
  return {
    read(handle: string, scope: RecoveryScope): Uint8Array | undefined | "denied" {
      const wanted = `${scope.workspaceId}/${scope.sessionId}/${scope.branchId}`;
      const found = items.find((item) => item.handle === handle);
      if (!found) return undefined;
      if (found.scope !== wanted) return "denied";
      return found.bytes;
    },
  };
}

export async function scoreRecoverability(input: RecoverabilityInput): Promise<RecoverabilityReport> {
  const records: BlobRecoveryRecord[] = input.requests.map((request) => {
    const observed = input.store.read(request.handle, input.scope);
    if (observed === "denied") {
      return { handle: request.handle, expectedSha256: request.expectedSha256, ok: false, failureCode: "SCOPE_DENIED" };
    }
    if (!observed) {
      return { handle: request.handle, expectedSha256: request.expectedSha256, ok: false, failureCode: "MISSING" };
    }
    const digest = sha256Bytes(observed);
    return {
      handle: request.handle,
      expectedSha256: request.expectedSha256,
      observedSha256: digest,
      ok: digest === request.expectedSha256 && observed.length === request.expectedLength,
      failureCode: digest === request.expectedSha256 ? undefined : "CORRUPT",
    };
  });
  const exact = records.filter((record) => record.ok).length;
  return {
    exactRecoveryRate: records.length === 0 ? 1 : exact / records.length,
    rangeRecoveryRate: records.length === 0 ? 1 : exact / records.length,
    crossScopeLeaks: records.filter((record) => record.failureCode === "SCOPE_DENIED" && record.ok).length,
    corruptionsDetected: records.filter((record) => record.failureCode === "CORRUPT").length,
    records,
  };
}

export { ScopeDeniedError };
