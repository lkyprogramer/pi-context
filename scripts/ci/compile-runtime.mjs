import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sources = [
  "apps/pi-context-runtime/src/extension.ts",
  "apps/pi-context-runtime/src/composition-root.ts",
  "apps/pi-context-runtime/src/owner.ts",
  "apps/pi-context-runtime/src/runtime.ts",
  "apps/pi-context-runtime/src/doctor.ts",
  "apps/pi-context-runtime/src/conflicts.ts",
];
const result = spawnSync(process.env.npm_execpath ?? "pnpm", ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--types", "node", ...sources], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
