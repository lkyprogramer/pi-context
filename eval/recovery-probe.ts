import { plannedPair } from "./runner.js";

export function c2Status(): { status: "not-run" | "blocked"; reason: string } {
  const pair = plannedPair("C2", "recovery");
  if (pair.baseline.status === "blocked") return { status: "blocked", reason: "sandbox unavailable" };
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.OPENCLAW_API_KEY) {
    return { status: "not-run", reason: "no provider key in environment (secrets not logged)" };
  }
  return { status: "not-run", reason: "live C2 not executed in this session beyond provider presence" };
}
