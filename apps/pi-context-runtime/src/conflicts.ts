export const KNOWN_CONTEXT_OWNERS = ["billion-context-pi"] as const;

export type ConflictPolicy = "strict" | "warn" | "off";

export interface ConflictFinding {
  code: "PCR_KNOWN_CONTEXT_CONFLICT";
  severity: "blocking" | "warning";
  packageName: string;
}

export function checkKnownOwnerConflicts(packages: readonly string[], policy: ConflictPolicy): ConflictFinding[] {
  if (policy === "off") return [];
  return packages
    .filter((name) => (KNOWN_CONTEXT_OWNERS as readonly string[]).includes(name))
    .map((packageName) => ({
      code: "PCR_KNOWN_CONTEXT_CONFLICT" as const,
      severity: policy === "strict" ? "blocking" : "warning",
      packageName,
    }));
}
