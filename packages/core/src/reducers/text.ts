const ANSI = /\u001b\[[0-9;]*m/g;
const MAX_LINE = 240;

export function observationText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

export function normalizeLines(text: string): string[] {
  return text
    .replace(ANSI, "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line));
}

export function boundedWindows(
  lines: string[],
  indexes: number[],
  opts: { before: number; after: number; maxLines: number },
): string[] {
  const keep = new Set<number>();
  for (const index of indexes) {
    for (let i = Math.max(0, index - opts.before); i <= Math.min(lines.length - 1, index + opts.after); i += 1) {
      keep.add(i);
    }
  }
  return [...keep]
    .sort((a, b) => a - b)
    .slice(0, opts.maxLines)
    .map((i) => lines[i] ?? "");
}

export function rawPointer(blobId?: string): string {
  return blobId ? `ctx://observation/${blobId}` : "ctx://observation/raw";
}

export function detailsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
