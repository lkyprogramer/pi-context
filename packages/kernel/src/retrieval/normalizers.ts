export function normalizeExactTokens(literal: string): string[] {
  const folded = literal.trim();
  if (!folded) return [];
  const latin = folded.split(/[^A-Za-z0-9_./-]+/).filter(Boolean);
  const cjk = folded.match(/[\u4e00-\u9fff]+/g) ?? [];
  const pathParts = folded.includes("/") ? [folded, folded.split("/").pop() ?? ""] : [];
  return [...new Set([...latin, ...cjk, ...pathParts, folded])].filter(Boolean);
}

export function rejectUnsafeQuery(literal: string): void {
  if (literal.startsWith("/") && literal.endsWith("/") && literal.length > 2) {
    throw Object.assign(new Error("PCR_REGEX_QUERY_DENIED"), { code: "PCR_REGEX_QUERY_DENIED" });
  }
}

export function foldPath(path: string): string {
  return path.replace(/\\/g, "/");
}
