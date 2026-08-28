import { domainHash } from "../../../contracts/src/index.js";
import type { MaterializedSection, MaterializedSectionKind, PromptCachePlan } from "../../../contracts/src/index.js";

export function buildCachePlan(
  sections: readonly MaterializedSection[],
  previous: PromptCachePlan | null,
  cacheEnabled: boolean,
): PromptCachePlan {
  const sectionOrder = sections.map((item) => item.kind);
  let firstDifferentSection: MaterializedSectionKind | null = null;
  if (previous) {
    const max = Math.max(previous.sectionOrder.length, sectionOrder.length);
    for (let index = 0; index < max; index += 1) {
      if (previous.sectionOrder[index] !== sectionOrder[index]) {
        firstDifferentSection = sectionOrder[index] ?? previous.sectionOrder[index] ?? null;
        break;
      }
    }
  }
  const prefixKinds = new Set<MaterializedSectionKind>(["runtime-preamble", "hard-directives", "stable-continuity"]);
  const eligiblePrefixTokens = sections
    .filter((item) => prefixKinds.has(item.kind))
    .reduce((sum, item) => sum + item.estimatedTokens, 0);
  return {
    layoutVersion: 1,
    sectionOrder,
    eligiblePrefixTokens,
    firstDifferentSection,
    previousViewId: previous ? `prev_${domainHash("cache-prev", previous.sectionOrder)}` : null,
    providerCapability: cacheEnabled ? "automatic-prefix" : "disabled",
  };
}
