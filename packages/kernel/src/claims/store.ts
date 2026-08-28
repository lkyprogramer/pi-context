import type { ActionAuthority } from "../../../contracts/src/index.js";
import type { ClaimWriteStore, StoredClaimRecord } from "../../../storage/src/protocol.js";
import { admitClaim, isInferenceAdmission, quarantineInference, supportMissing } from "./admit.js";
import {
  claimVisibleAsOf,
  type Claim,
  type ClaimAdmission,
  type ClaimAsOfQuery,
  type ClaimSupport,
} from "./model.js";

export class ClaimLedger {
  private readonly evidence = new Map<string, ClaimSupport>();
  private readonly quarantinedClaims: Claim[] = [];

  private constructor(private readonly store: ClaimWriteStore) {}

  static async inMemory(): Promise<ClaimLedger> {
    const rows: StoredClaimRecord[] = [];
    const ledger = new ClaimLedger({
      insertClaim: async (claim) => {
        rows.push(claim);
      },
      listClaims: async () => rows,
    });
    ledger.registerSupport({ evidenceId: "ev_fixture", authority: "inform" });
    return ledger;
  }

  registerSupport(support: ClaimSupport): void {
    this.evidence.set(support.evidenceId, support);
  }

  async append(input: ClaimAdmission): Promise<Claim> {
    if (isInferenceAdmission(input)) {
      const claim = quarantineInference(input);
      this.quarantinedClaims.push(claim);
      return claim;
    }
    if (input.supportIds.length === 0) throw supportMissing();
    const loaded = await this.loadAll(input.supportIds);
    const claim = admitClaim(input, loaded);
    await this.store.insertClaim(toStoredClaim(claim));
    return claim;
  }

  async asOf(query: ClaimAsOfQuery): Promise<Claim[]> {
    const rows = await this.store.listClaims();
    return rows.map(fromStoredClaim).filter((claim) => claimVisibleAsOf(claim, query));
  }

  async retract(claimId: string, systemAt: number): Promise<Claim> {
    const rows = await this.store.listClaims();
    const index = rows.findIndex((row) => row.claimId === claimId);
    if (index < 0) throw Object.assign(new Error("PCR_CLAIM_NOT_FOUND"), { code: "PCR_CLAIM_NOT_FOUND" });
    const current = fromStoredClaim(rows[index] as StoredClaimRecord);
    const retracted: Claim = {
      ...current,
      status: "retracted",
      systemTime: { start: current.systemTime.start, end: systemAt },
    };
    rows[index] = toStoredClaim(retracted);
    return retracted;
  }

  quarantined(): Claim[] {
    return [...this.quarantinedClaims];
  }

  private async loadAll(ids: string[]): Promise<ClaimSupport[]> {
    return ids.flatMap((id) => {
      const item = this.evidence.get(id);
      return item ? [item] : [];
    });
  }
}

function toStoredClaim(claim: Claim): StoredClaimRecord {
  return {
    claimId: claim.claimId,
    key: claim.key,
    claimType: claim.claimType,
    polarity: claim.polarity,
    status: claim.status,
    authority: claim.authority,
    value: claim.value,
    validStart: claim.validTime?.start,
    validEnd: claim.validTime?.end ?? null,
    systemStart: claim.systemTime.start,
    systemEnd: claim.systemTime.end ?? null,
    supportIds: claim.support,
    supersedes: claim.supersedes,
    conflictsWith: claim.conflictsWith,
  };
}

function fromStoredClaim(row: StoredClaimRecord): Claim {
  return {
    claimId: row.claimId,
    key: row.key,
    claimType: row.claimType as Claim["claimType"],
    value: row.value,
    polarity: row.polarity as Claim["polarity"],
    status: row.status as Claim["status"],
    validTime: row.validStart == null ? undefined : { start: row.validStart, end: row.validEnd ?? null },
    systemTime: { start: row.systemStart, end: row.systemEnd ?? null },
    support: row.supportIds,
    authority: row.authority as ActionAuthority,
    supersedes: row.supersedes,
    conflictsWith: row.conflictsWith,
  };
}
