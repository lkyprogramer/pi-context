export type OracleItemKind =
  | "constraint"
  | "outcome"
  | "secret"
  | "directive"
  | "claim"
  | "path"
  | "sha"
  | "number"
  | "command"
  | "error"
  | string;

export interface NormalizedValue {
  readonly kind: string;
  readonly canonical: string;
}

function collapseDotSegments(path: string): string {
  const posix = path.replace(/\\/g, "/");
  const parts = posix.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  const collapsed = out.join("/");
  return posix.startsWith("/") ? `/${collapsed}` : collapsed;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function canonicalNumber(value: string): string {
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return value.normalize("NFC");
  const num = Number(match[0]);
  return value.replace(match[0], String(num));
}

function tokenizeCommand(value: string): string {
  return value
    .replace(/["']/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function normalizeOracleValue(kind: OracleItemKind, value: unknown): NormalizedValue {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (kind === "path") {
    return { kind, canonical: collapseDotSegments(raw) };
  }
  if (kind === "sha" || kind === "id") {
    return { kind, canonical: raw.toLowerCase() };
  }
  if (kind === "number") {
    return { kind, canonical: canonicalNumber(raw) };
  }
  if (kind === "command") {
    return { kind, canonical: tokenizeCommand(raw) };
  }
  if (kind === "error") {
    return { kind, canonical: stripAnsi(raw).normalize("NFC").replace(/\s+/g, " ").trim() };
  }
  return { kind, canonical: raw.normalize("NFC") };
}
