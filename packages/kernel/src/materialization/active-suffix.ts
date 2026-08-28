import type { HostMessage } from "../../../contracts/src/index.js";
import { requestPointerization, validateToolPairs } from "./atomic-groups.js";

export function findLatestAuthenticatedUserIndex(messages: readonly HostMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.sourceClass === "authenticated-user") return index;
  }
  return -1;
}

export function buildExactActiveSuffix(messages: readonly HostMessage[]): HostMessage[] {
  const start = findLatestAuthenticatedUserIndex(messages);
  if (start < 0) {
    throw Object.assign(new Error("PCR_UNREPAIRABLE_ACTIVE_TURN"), { code: "PCR_UNREPAIRABLE_ACTIVE_TURN" });
  }
  const suffix = structuredClone(messages.slice(start));
  const pairing = validateToolPairs(suffix);
  if (!pairing.ok) {
    throw Object.assign(new Error("PCR_TOOL_PAIR_INVALID"), { code: "PCR_TOOL_PAIR_INVALID", ...pairing });
  }
  return suffix;
}

export function suffixPointerizationRequests(messages: readonly HostMessage[]) {
  return messages.map(requestPointerization).filter((item): item is NonNullable<typeof item> => item !== null);
}
