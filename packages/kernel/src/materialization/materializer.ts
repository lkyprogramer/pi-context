import {
  domainHash,
  type CacheZone,
  type HostMessage,
  type MaterializationInput,
  type MaterializedSection,
  type MaterializedSectionKind,
  type MaterializedView,
  type PromptCachePlan,
} from "../../../contracts/src/index.js";
import { computeEffectiveInputBudget, estimateTextTokens } from "../budget/token-counter.js";
import { buildExactActiveSuffix } from "./active-suffix.js";
import { validateToolPairs } from "./atomic-groups.js";
import { buildCachePlan } from "./cache-plan.js";
import { PINNED_SECTIONS, reduceSectionsToBudget } from "./reduction.js";

export interface MaterializerOptions {
  directives?: string;
  historyText?: string;
  directoryText?: string;
  recallText?: string;
  continuityText?: string;
  cacheEnabled?: boolean;
  providerReservedTokens?: number;
}

interface BuiltSection extends MaterializedSection {
  messages: HostMessage[];
}

export class ContextMaterializer {
  private previousPlan: PromptCachePlan | null = null;

  constructor(private readonly options: MaterializerOptions = {}) {}

  async materialize(input: MaterializationInput): Promise<MaterializedView> {
    const budget = this.resolveBudget(input);
    const exactSuffix = buildExactActiveSuffix(input.canonicalMessages);
    const built = this.buildSections(input, exactSuffix);
    const directives = built.find((item) => item.kind === "hard-directives");
    if (directives && directives.estimatedTokens > budget) {
      throw Object.assign(new Error("PCR_DIRECTIVE_BUDGET_EXCEEDED"), { code: "PCR_DIRECTIVE_BUDGET_EXCEEDED" });
    }
    const reduced = reduceSectionsToBudget(built, budget);
    assertDirectivesPresent(reduced.sections, built);
    assertToolPairs(exactSuffix);
    assertExactSuffix(reduced.sections, exactSuffix);
    return this.buildView(reduced.sections, reduced.omissions, budget, exactSuffix);
  }

  private resolveBudget(input: MaterializationInput): number {
    return computeEffectiveInputBudget({
      contextWindow: input.currentContextWindow,
      maxOutputTokens: input.maxOutputTokens,
      providerReservedTokens: this.options.providerReservedTokens ?? 0,
    });
  }

  private buildSections(input: MaterializationInput, exactSuffix: HostMessage[]): BuiltSection[] {
    const history = input.canonicalMessages.slice(0, input.canonicalMessages.length - exactSuffix.length);
    const directiveBody = this.directiveSection(input);
    return [
      section("runtime-preamble", "stable-prefix", "pcr-runtime", [textMessage("preamble", "pcr-runtime", "system")]),
      section("hard-directives", "stable-prefix", directiveBody.text, directiveBody.messages),
      section("stable-continuity", "stable-prefix", this.options.continuityText ?? "continuity", [
        textMessage("continuity", this.options.continuityText ?? "continuity", "system"),
      ]),
      section("historical-tail", "append-only-history", this.options.historyText ?? historyText(history), history),
      section("continuity-delta", "volatile-augmentation", "delta", [textMessage("delta", "delta", "system")]),
      section("directory", "volatile-augmentation", this.options.directoryText ?? "", [
        textMessage("directory", this.options.directoryText ?? "", "system"),
      ]),
      section("retrieval-page", "volatile-augmentation", this.options.recallText ?? "", [
        textMessage("recall", this.options.recallText ?? "", "system"),
      ]),
      section("active-turn", "active-turn", historyText(exactSuffix), exactSuffix),
    ];
  }

  private directiveSection(input: MaterializationInput): { text: string; messages: HostMessage[] } {
    const declared = this.options.directives;
    if (declared && declared !== "keep") {
      return { text: declared, messages: [textMessage("directives", declared, "authenticated-user")] };
    }
    const users = input.canonicalMessages
      .filter((message) => message.role === "user")
      .map((message) => ({
        ...message,
        content: message.content.map((block) => ({ ...block })),
      }));
    if (users.length > 0) {
      return { text: historyText(users), messages: users };
    }
    return { text: "", messages: [textMessage("directives", "", "authenticated-user")] };
  }

  private buildView(
    selected: MaterializedSection[],
    omissions: MaterializedView["omissions"],
    budget: number,
    exactSuffix: HostMessage[],
  ): MaterializedView {
    const order: CacheZone[] = ["stable-prefix", "append-only-history", "volatile-augmentation", "active-turn"];
    const messages = order.flatMap((zone) =>
      selected.filter((item) => item.cacheZone === zone).flatMap((item) => ("messages" in item ? (item as BuiltSection).messages : [])),
    );
    const tokenEstimate = selected.reduce((sum, item) => sum + item.estimatedTokens, 0);
    if (tokenEstimate > budget) {
      throw Object.assign(new Error("PCR_UNREPAIRABLE_ACTIVE_TURN"), { code: "PCR_UNREPAIRABLE_ACTIVE_TURN" });
    }
    const outputHash = domainHash("materialized-output", {
      messages: messages.map((item) => ({ role: item.role, content: item.content, sourceClass: item.sourceClass })),
      sections: selected.map((item) => ({ kind: item.kind, contentHash: item.contentHash })),
    });
    const view: MaterializedView = {
      viewId: `vw_${domainHash("materialized-view", outputHash).slice(0, 16)}`,
      outputHash,
      messages: messages.length > 0 ? messages : exactSuffix,
      sections: selected.map(({ kind, cacheZone, contentHash, estimatedTokens, messageIds }) => ({
        kind,
        cacheZone,
        contentHash,
        estimatedTokens,
        messageIds,
      })),
      tokenEstimate,
      cachePlan: buildCachePlan(selected, this.previousPlan, this.options.cacheEnabled !== false),
      omissions,
    };
    this.previousPlan = view.cachePlan;
    return view;
  }
}

function section(kind: MaterializedSectionKind, cacheZone: CacheZone, text: string, messages: HostMessage[]): BuiltSection {
  return {
    kind,
    cacheZone,
    contentHash: domainHash("section", { kind, text }),
    estimatedTokens: Math.max(1, estimateTextTokens(text)),
    messageIds: messages.map((item) => item.hostMessageId),
    messages,
  };
}

function textMessage(id: string, text: string, sourceClass: HostMessage["sourceClass"]): HostMessage {
  const role = sourceClass === "authenticated-user" ? "user" : "custom";
  return {
    hostMessageId: id,
    role,
    timestamp: 1,
    content: [{ type: "text", text }],
    sourceClass,
  };
}

function historyText(messages: readonly HostMessage[]): string {
  return messages
    .map((item) => item.content.map((block) => (block.type === "text" ? block.text : "")).join(""))
    .join("\n");
}

function assertDirectivesPresent(selected: readonly MaterializedSection[], original: readonly MaterializedSection[]): void {
  const directive = original.find((item) => item.kind === "hard-directives");
  if (directive && !selected.some((item) => item.kind === "hard-directives")) {
    throw Object.assign(new Error("PCR_DIRECTIVE_BUDGET_EXCEEDED"), { code: "PCR_DIRECTIVE_BUDGET_EXCEEDED" });
  }
}

function assertToolPairs(suffix: readonly HostMessage[]): void {
  const pairing = validateToolPairs(suffix);
  if (!pairing.ok) {
    throw Object.assign(new Error("PCR_TOOL_PAIR_INVALID"), { code: "PCR_TOOL_PAIR_INVALID" });
  }
}

function assertExactSuffix(selected: readonly MaterializedSection[], exactSuffix: readonly HostMessage[]): void {
  const active = selected.find((item) => item.kind === "active-turn");
  if (!active) {
    throw Object.assign(new Error("PCR_UNREPAIRABLE_ACTIVE_TURN"), { code: "PCR_UNREPAIRABLE_ACTIVE_TURN" });
  }
  const ids = exactSuffix.map((item) => item.hostMessageId);
  if (ids.some((id) => !active.messageIds.includes(id))) {
    throw Object.assign(new Error("PCR_UNREPAIRABLE_ACTIVE_TURN"), { code: "PCR_UNREPAIRABLE_ACTIVE_TURN" });
  }
}

export { PINNED_SECTIONS };
