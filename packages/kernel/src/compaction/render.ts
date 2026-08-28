import type { HostCheckpoint, HostCheckpointClaim, HostCheckpointDirective } from "../../../contracts/src/index.js";
import { checkpointTokenPrice, hashCheckpointBody, sortByKeyThenId } from "./host-checkpoint.js";

export function renderHostCheckpoint(checkpoint: HostCheckpoint): string {
  const body = [
    `<pi-context-runtime-checkpoint version="1">`,
    renderDirectiveQuotes(checkpoint.directives),
    renderContinuity(checkpoint.continuity),
    renderActiveClaims(checkpoint.claims),
    renderPointers(checkpoint.pointers),
    renderHeads(checkpoint.heads),
    `</pi-context-runtime-checkpoint>`,
  ].join("\n\n");
  const price = checkpointTokenPrice(body);
  if (checkpoint.maxCheckpointTokens != null && price > checkpoint.maxCheckpointTokens) {
    const withoutPointers = [
      `<pi-context-runtime-checkpoint version="1">`,
      renderDirectiveQuotes(checkpoint.directives),
      renderContinuity(checkpoint.continuity),
      renderActiveClaims(checkpoint.claims),
      "## Pointers\n- omitted:token-budget",
      renderHeads(checkpoint.heads),
      `</pi-context-runtime-checkpoint>`,
    ].join("\n\n");
    const reduced = checkpointTokenPrice(withoutPointers);
    if (reduced > checkpoint.maxCheckpointTokens) {
      throw Object.assign(new Error("PCR_CHECKPOINT_TOKEN_BUDGET"), { code: "PCR_CHECKPOINT_TOKEN_BUDGET" });
    }
    return withoutPointers;
  }
  void hashCheckpointBody(body);
  return body;
}

export function renderDirectiveQuotes(directives: readonly HostCheckpointDirective[]): string {
  const ordered = sortByKeyThenId(directives, (item) => item.quote, (item) => item.directiveId);
  return [
    "## Active User Directives",
    ...ordered.map((item) => `- [${item.directiveId}] ${item.quote} (${item.polarity ?? "is"}/${item.status ?? "active"})`),
  ].join("\n");
}

export function renderContinuity(continuity: HostCheckpoint["continuity"]): string {
  const errors = (continuity.unresolvedErrors ?? []).map((item) => `- error ${item.id} ${item.stage} ${item.message ?? ""}`.trim());
  const effects = (continuity.externalSideEffects ?? []).map((item) => `- side-effect ${item.id} ${item.kind} ${item.status}`);
  return [
    "## Continuity",
    `revision: ${continuity.revisionId}`,
    continuity.markdown ?? "",
    "## Unresolved Errors and External Side Effects",
    ...errors,
    ...effects,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function renderActiveClaims(claims: readonly HostCheckpointClaim[]): string {
  const ordered = sortByKeyThenId(claims, (item) => item.key, (item) => item.claimId);
  return [
    "## Active Claims",
    ...ordered.map((item) => {
      const time = item.validTime ? ` valid=${item.validTime.start}..${item.validTime.end ?? "open"}` : "";
      return `- [${item.claimId}] ${item.key} ${item.polarity}/${item.status}${time}`;
    }),
  ].join("\n");
}

export function renderPointers(pointers: readonly HostCheckpoint["pointers"]): string {
  return [
    "## Pointers",
    "Use context_search/context_read with the listed opaque IDs when exact history is needed.",
    ...pointers.map((item) => `- ${item.kind}:${item.ref}`),
  ].join("\n");
}

export function renderHeads(heads: HostCheckpoint["heads"]): string {
  return [
    "## Heads",
    `contextHead: ${heads.contextHead}`,
    `directiveHead: ${heads.directiveHead}`,
    `claimHead: ${heads.claimHead}`,
    `continuityHead: ${heads.continuityHead}`,
    heads.catalogHead ? `catalogHead: ${heads.catalogHead}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
