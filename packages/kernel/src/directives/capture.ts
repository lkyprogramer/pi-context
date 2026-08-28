import { domainHash, type SourceClass, type UserDirective } from "../../../contracts/src/index.js";

export interface DirectiveCaptureInput {
  sourceClass: SourceClass;
  text: string;
  messageId: string;
  sessionId?: string;
  workspaceId?: string;
}

interface DirectiveSpan {
  start: number;
  end: number;
  kind: UserDirective["kind"];
  polarity: UserDirective["polarity"];
}

export function verifyDirectiveQuote(text: string, directive: UserDirective): boolean {
  return text.slice(directive.byteRange.start, directive.byteRange.end) === directive.quote;
}

function makeDirectiveId(messageId: string, start: number, end: number): string {
  return `ud_${domainHash("directive", { messageId, start, end })}`;
}

export function explicitDirectiveSpans(text: string): DirectiveSpan[] {
  const spans: DirectiveSpan[] = [];
  const rules: Array<{ pattern: RegExp; kind: DirectiveSpan["kind"]; polarity: DirectiveSpan["polarity"] }> = [
    { pattern: /不要[^；。]+/g, kind: "prohibition", polarity: "must-not" },
    { pattern: /\b(?:do not|don't|never)\b[^.;]*/gi, kind: "prohibition", polarity: "must-not" },
    { pattern: /至少[^；。,，]*\d+[^；。,，]*/g, kind: "constraint", polarity: "must" },
    { pattern: /(?:src|lib|app|packages)\/[\w./-]+\.\w+/g, kind: "constraint", polarity: "is" },
    { pattern: /改为|instead|correction:/gi, kind: "correction", polarity: "must" },
  ];
  const seen = new Set<string>();
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;
      const key = `${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      spans.push({ start, end, kind: rule.kind, polarity: rule.polarity });
    }
  }
  return spans.sort((left, right) => left.start - right.start);
}

export function captureUserDirectives(input: DirectiveCaptureInput): UserDirective[] {
  if (input.sourceClass !== "authenticated-user") return [];
  return explicitDirectiveSpans(input.text).map((span) => ({
    directiveId: makeDirectiveId(input.messageId, span.start, span.end),
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    sourceInputId: input.messageId,
    sourceMessageId: input.messageId,
    sourceContentHash: domainHash("user-message", input.text),
    quote: input.text.slice(span.start, span.end),
    byteRange: { start: span.start, end: span.end },
    kind: span.kind,
    polarity: span.polarity,
    status: "active",
    scope: { kind: "session", value: input.sessionId ?? input.messageId },
    sourceClass: "authenticated-user",
    authority: "act",
  }));
}
