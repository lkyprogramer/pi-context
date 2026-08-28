export default [
  {
    test: {
      name: "live-paired-w2",
      include: ["tests/live-gate/paired-w2.live.ts"],
      fileParallelism: false,
      testTimeout: 180 * 60_000,
    },
  },
];
