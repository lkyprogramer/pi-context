import type { UserDirective } from "../../../contracts/src/index.js";
import { verifyDirectiveQuote } from "./capture.js";

export class DirectiveStore {
  private readonly items = new Map<string, UserDirective>();

  append(directive: UserDirective): UserDirective {
    this.items.set(directive.directiveId, { ...directive, status: "active" });
    return this.items.get(directive.directiveId) as UserDirective;
  }

  supersede(targetId: string, replacement: UserDirective): UserDirective {
    const current = this.items.get(targetId);
    if (!current) throw Object.assign(new Error("PCR_DIRECTIVE_NOT_FOUND"), { code: "PCR_DIRECTIVE_NOT_FOUND" });
    if (replacement.sourceClass !== "authenticated-user") {
      throw Object.assign(new Error("PCR_DIRECTIVE_UNAUTHENTICATED"), { code: "PCR_DIRECTIVE_UNAUTHENTICATED" });
    }
    this.items.set(targetId, { ...current, status: "superseded" });
    return this.append(replacement);
  }

  active(): UserDirective[] {
    return [...this.items.values()].filter((item) => item.status === "active");
  }

  all(): UserDirective[] {
    return [...this.items.values()];
  }

  sweepSemantic(): void {
    // Authenticated directives are never retired by a semantic model.
  }

  renderActive(budget: number): string {
    const quotes = this.active().map((item) => item.quote);
    const rendered = quotes.join("\n");
    if (rendered.length > budget) {
      throw Object.assign(new Error("PCR_DIRECTIVE_BUDGET_EXCEEDED"), { code: "PCR_DIRECTIVE_BUDGET_EXCEEDED" });
    }
    return rendered;
  }
}

export function assertExactQuote(text: string, directive: UserDirective): void {
  if (!verifyDirectiveQuote(text, directive)) {
    throw Object.assign(new Error("PCR_DIRECTIVE_QUOTE_MISMATCH"), { code: "PCR_DIRECTIVE_QUOTE_MISMATCH" });
  }
}
