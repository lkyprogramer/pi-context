export default [
  {
    test: {
      name: "live-w5-lanes",
      include: ["tests/live-gate/w5-live-lanes.live.ts"],
      fileParallelism: false,
      testTimeout: 180 * 60_000,
    },
  },
];
