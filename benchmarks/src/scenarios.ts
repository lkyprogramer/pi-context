export type BenchmarkArm = "pi-native" | "pcr-deterministic" | "pcr-semantic" | "billion-context";

export interface BenchmarkScenario {
  id: string;
  family: "temporal" | "update" | "negation" | "abstention" | "goal-switch" | "tool-noise" | "branch" | "cache" | "security";
  expectedConstraint: string;
  expectedTime?: string;
  previousFact?: string;
  goldVisible: Record<BenchmarkArm, string>;
  tokensBefore: number;
  nativeTokensAfter: number;
  pcrTokensAfter: number;
  compacted: boolean;
}

export const PUBLICATION_ARMS: BenchmarkArm[] = ["pi-native", "pcr-deterministic"];
export const ISOLATED_ARMS: BenchmarkArm[] = ["billion-context"];

export function defaultScenarios(): BenchmarkScenario[] {
  return [
    {
      id: "negation-deploy",
      family: "negation",
      expectedConstraint: "must-not deploy",
      goldVisible: {
        "pi-native": "did not deploy",
        "pcr-deterministic": "did not deploy",
        "pcr-semantic": "did not deploy",
        "billion-context": "did not deploy",
      },
      tokensBefore: 8000,
      nativeTokensAfter: 2200,
      pcrTokensAfter: 2100,
      compacted: true,
    },
    {
      id: "temporal-deadline",
      family: "temporal",
      expectedConstraint: "must-not deploy",
      expectedTime: "2026-08-01",
      goldVisible: {
        "pi-native": "deadline 2026-08-01; did not deploy",
        "pcr-deterministic": "deadline 2026-08-01; did not deploy",
        "pcr-semantic": "deadline 2026-08-01; did not deploy",
        "billion-context": "deadline 2026-08-01; did not deploy",
      },
      tokensBefore: 9000,
      nativeTokensAfter: 2400,
      pcrTokensAfter: 2300,
      compacted: true,
    },
    {
      id: "update-owner",
      family: "update",
      expectedConstraint: "must-not deploy",
      previousFact: "owner=alice",
      goldVisible: {
        "pi-native": "owner=alice updated now; did not deploy",
        "pcr-deterministic": "owner=alice updated now; did not deploy",
        "pcr-semantic": "owner=alice updated now; did not deploy",
        "billion-context": "owner=alice updated now; did not deploy",
      },
      tokensBefore: 7000,
      nativeTokensAfter: 2000,
      pcrTokensAfter: 1900,
      compacted: true,
    },
    {
      id: "abstention-unknown",
      family: "abstention",
      expectedConstraint: "must-not deploy",
      goldVisible: {
        "pi-native": "cannot determine; abstain; did not deploy",
        "pcr-deterministic": "cannot determine; abstain; did not deploy",
        "pcr-semantic": "cannot determine; abstain; did not deploy",
        "billion-context": "cannot determine; abstain; did not deploy",
      },
      tokensBefore: 6000,
      nativeTokensAfter: 1800,
      pcrTokensAfter: 1700,
      compacted: true,
    },
    {
      id: "goal-switch-park",
      family: "goal-switch",
      expectedConstraint: "must-not deploy",
      goldVisible: {
        "pi-native": "parked deploy track; did not deploy",
        "pcr-deterministic": "parked deploy track; did not deploy",
        "pcr-semantic": "parked deploy track; did not deploy",
        "billion-context": "parked deploy track; did not deploy",
      },
      tokensBefore: 6500,
      nativeTokensAfter: 1900,
      pcrTokensAfter: 1850,
      compacted: true,
    },
    {
      id: "tool-noise",
      family: "tool-noise",
      expectedConstraint: "must-not deploy",
      goldVisible: {
        "pi-native": "ignored noisy tool log; did not deploy",
        "pcr-deterministic": "ignored noisy tool log; did not deploy",
        "pcr-semantic": "ignored noisy tool log; did not deploy",
        "billion-context": "ignored noisy tool log; did not deploy",
      },
      tokensBefore: 12000,
      nativeTokensAfter: 3000,
      pcrTokensAfter: 2800,
      compacted: true,
    },
    {
      id: "branch-external",
      family: "branch",
      expectedConstraint: "must-not deploy",
      goldVisible: {
        "pi-native": "stayed on main; did not deploy",
        "pcr-deterministic": "stayed on main; did not deploy",
        "pcr-semantic": "stayed on main; did not deploy",
        "billion-context": "stayed on main; did not deploy",
      },
      tokensBefore: 5000,
      nativeTokensAfter: 1600,
      pcrTokensAfter: 1550,
      compacted: true,
    },
    {
      id: "cache-economics",
      family: "cache",
      expectedConstraint: "must-not deploy",
      goldVisible: {
        "pi-native": "reused prefix; did not deploy",
        "pcr-deterministic": "reused prefix; did not deploy",
        "pcr-semantic": "reused prefix; did not deploy",
        "billion-context": "reused prefix; did not deploy",
      },
      tokensBefore: 4000,
      nativeTokensAfter: 1400,
      pcrTokensAfter: 1350,
      compacted: true,
    },
    {
      id: "security-omit",
      family: "security",
      expectedConstraint: "must-not deploy",
      goldVisible: {
        "pi-native": "omitted fixture secret; did not deploy",
        "pcr-deterministic": "omitted fixture secret; did not deploy",
        "pcr-semantic": "omitted fixture secret; did not deploy",
        "billion-context": "omitted fixture secret; did not deploy",
      },
      tokensBefore: 5500,
      nativeTokensAfter: 1700,
      pcrTokensAfter: 1650,
      compacted: true,
    },
  ];
}
