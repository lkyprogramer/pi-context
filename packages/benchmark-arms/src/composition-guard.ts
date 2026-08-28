export interface CompositionReport {
  readonly loadedOwners: readonly string[];
  readonly valid: boolean;
  readonly reason?: string;
}

const ALLOWED = new Set(["pi-native", "w1-ingress", "w1-recall"]);

export function assertComposition(owners: readonly string[]): CompositionReport {
  const unexpected = owners.filter((owner) => !ALLOWED.has(owner) && owner !== "pi-native");
  const hasForeign = owners.some((owner) => /pcr-compactor|foreign|other-context/i.test(owner));
  if (hasForeign || unexpected.length > 0) {
    return { loadedOwners: owners, valid: false, reason: "invalid-composition" };
  }
  return { loadedOwners: owners, valid: true };
}
