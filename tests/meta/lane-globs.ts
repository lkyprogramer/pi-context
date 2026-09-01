export type TestLane =
  | "unit"
  | "contract"
  | "hermetic-integration"
  | "product-acceptance"
  | "packed-install"
  | "live-provider-smoke"
  | "publication-benchmark";

export interface LaneGlob {
  include: string[];
  exclude: string[];
  testTimeout: number;
  retry: number;
  allowNetwork: boolean;
}

export const LANES: Record<TestLane, LaneGlob> = {
  unit: {
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
      "tests/audit/**/*.test.ts",
      "tests/meta/**/*.test.ts",
      "tests/ci/**/*.test.ts",
      "tests/security/**/*.test.ts",
      "tests/support/**/*.test.ts",
      "tests/tasks/**/*.test.ts",
    ],
    exclude: [
      "tests/tasks/t06.test.ts",
      "tests/tasks/t52.test.ts",
      "tests/live-gate/**",
      "tests/live/**",
      "tests/acceptance/**",
      "tests/integration/**",
      "tests/contract/**",
      "tests/w1-gate/**",
      "tests/w2-gate/**",
      "tests/release/**",
      "tests/e2e/**",
      "tests/performance/**",
      "tests/fault/**",
      "tests/compat/**",
      "tests/pi-contract/**",
    ],
    testTimeout: 15_000,
    retry: 0,
    allowNetwork: false,
  },
  contract: {
    include: [
      "tests/contract/**/*.test.ts",
      "tests/compat/**/*.test.ts",
      "tests/pi-contract/**/*.test.ts",
    ],
    exclude: [],
    testTimeout: 15_000,
    retry: 0,
    allowNetwork: false,
  },
  "hermetic-integration": {
    include: [
      "tests/integration/**/*.test.ts",
      "tests/fault/**/*.test.ts",
      "tests/e2e/**/*.test.ts",
    ],
    exclude: ["tests/live-gate/**", "tests/live/**"],
    testTimeout: 30_000,
    retry: 0,
    allowNetwork: false,
  },
  "product-acceptance": {
    include: ["tests/acceptance/**/*.test.ts"],
    exclude: ["tests/acceptance/packed-install.test.ts"],
    testTimeout: 60_000,
    retry: 0,
    allowNetwork: false,
  },
  "packed-install": {
    include: [
      "tests/acceptance/packed-install.test.ts",
      "tests/release/clean-install.test.ts",
      "tests/tasks/t06.test.ts",
      "tests/tasks/t52.test.ts",
    ],
    exclude: [],
    testTimeout: 60_000,
    retry: 0,
    allowNetwork: false,
  },
  "live-provider-smoke": {
    include: [
      "tests/live/**/*.test.ts",
      "tests/live-gate/**/*.test.ts",
    ],
    exclude: [],
    testTimeout: 120_000,
    retry: 0,
    allowNetwork: true,
  },
  "publication-benchmark": {
    include: [
      "tests/w1-gate/**/*.test.ts",
      "tests/w2-gate/**/*.test.ts",
      "tests/performance/**/*.test.ts",
      "tests/release/**/*.test.ts",
    ],
    exclude: ["tests/release/clean-install.test.ts"],
    testTimeout: 120_000,
    retry: 0,
    allowNetwork: false,
  },
};

export const LANE_ORDER: TestLane[] = [
  "unit",
  "contract",
  "hermetic-integration",
  "product-acceptance",
  "packed-install",
  "live-provider-smoke",
  "publication-benchmark",
];
