#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export default {
  test: {
    include: ["benchmarks/test/**/*.test.ts"],
  },
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { defaultBenchmarkConfig, runBenchmarkSuite } = await import("../benchmarks/src/runner.ts");
  const report = await runBenchmarkSuite(defaultBenchmarkConfig(42));
  console.log(
    JSON.stringify(
      {
        publicationClaim: report.publicationClaim,
        officialControl: report.officialControl,
        seed: report.seed,
        killCriteria: report.killCriteria,
        scores: report.scores.length,
      },
      null,
      2,
    ),
  );
}
