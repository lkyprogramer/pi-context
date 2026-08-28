export default [
  {
    test: {
      include: ["tests/**/*.test.ts", "packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
      exclude: ["tests/live-gate/verification.test.ts", "tests/live-gate/*.live.ts"],
    },
  },
];
