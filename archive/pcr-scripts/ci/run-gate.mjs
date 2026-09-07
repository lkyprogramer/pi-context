#!/usr/bin/env node
import { parseArgs } from "node:util";

import { runCiGate } from "./gates.mjs";

const separator = process.argv.indexOf("--");
if (separator < 0 || separator === process.argv.length - 1) {
  throw new Error("usage: run-gate --name <name> --log <path> -- <command> [arguments...]");
}
const { values } = parseArgs({
  args: process.argv.slice(2, separator),
  options: {
    name: { type: "string" },
    log: { type: "string" },
  },
  strict: true,
});
if (!values.name || !values.log) {
  throw new Error("both --name and --log are required");
}
const [executable, ...arguments_] = process.argv.slice(separator + 1);
const result = await runCiGate({
  name: values.name,
  executable,
  arguments: arguments_,
  workspaceRoot: process.cwd(),
  logPath: values.log,
  mirrorOutput: true,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.status !== "passed") process.exitCode = result.exitCode || 1;
