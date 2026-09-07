const SECRET = /(api[_-]?key|token|bearer|password|secret)/i;

export function redactDiagnostic(text: string): string {
  return text.replace(SECRET, "[redacted]");
}

export function stripContent<T extends { text?: string }>(value: T): T {
  if ("text" in value) return { ...value, text: undefined };
  return value;
}
