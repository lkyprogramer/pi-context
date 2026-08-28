export default [
  {
    test: {
      name: "live-compact",
      include: ["tests/live-gate/compact-trigger.live.ts"],
      fileParallelism: false,
      testTimeout: 20 * 60_000,
    },
  },
];
