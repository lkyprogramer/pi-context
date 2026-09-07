import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { plannedPair } from "./runner.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function c2Status(): { status: "not-run" | "blocked" | "passed" | "failed"; reason: string } {
  const pair = plannedPair("C2", "recovery");
  if (pair.baseline.status === "blocked") return { status: "blocked", reason: "sandbox unavailable" };
  const g3 = join(root, "artifacts/v5-tasks/T26/g3-c2.json");
  const smoke = join(root, "artifacts/v5-evaluation/report.json");
  if (existsSync(g3)) {
    const doc = JSON.parse(readFileSync(g3, "utf8")) as { recoveryPathProven?: boolean; status?: string };
    if (doc.recoveryPathProven || doc.status === "passed") {
      return { status: "passed", reason: "g3-c2 live evidence" };
    }
  }
  if (existsSync(smoke)) {
    const doc = JSON.parse(readFileSync(smoke, "utf8")) as { cases?: Record<string, { B2c2?: { recoveryPathProven?: boolean } }> };
    if (doc.cases?.J05?.B2c2?.recoveryPathProven) {
      return { status: "passed", reason: "J05 B2 C2 live evidence" };
    }
  }
  return { status: "not-run", reason: "no C2 live evidence file" };
}
