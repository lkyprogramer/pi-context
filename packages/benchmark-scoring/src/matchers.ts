export function polarityOf(text: string): "is" | "is-not" | "unknown" {
  const lower = text.toLowerCase();
  if (/\bnot\b|failed|must not|不得/.test(lower) && !/passed/.test(lower)) return "is-not";
  if (/passed|ok|success/.test(lower)) return "is";
  return "unknown";
}

export function invertFailedPassed(text: string): string {
  return text.replace(/failed/gi, "passed").replace(/passed/gi, (m) => (m.toLowerCase() === "passed" && !text.toLowerCase().includes("failed") ? m : "failed"));
}

export function hasInvertedPolarity(canonical: string, observed: string): boolean {
  const a = canonical.toLowerCase();
  const b = observed.toLowerCase();
  if (a.includes("failed") && b.includes("passed")) return true;
  if (a.includes("passed") && b.includes("failed")) return true;
  if (a.includes("deploy") && /deploy/.test(b) && /not|不得/.test(a) !== /not|不得/.test(b)) return true;
  return polarityOf(canonical) !== "unknown" && polarityOf(observed) !== "unknown" && polarityOf(canonical) !== polarityOf(observed);
}
