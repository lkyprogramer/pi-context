export type SourceClass = "system" | "authenticated-user" | "untrusted-user" | "trusted-tool" | "untrusted-tool" | "external-content" | "agent-derived";
export type ActionAuthority = "none" | "inform" | "propose" | "act";
export type CacheZone = "stable-prefix" | "append-only-history" | "volatile-augmentation" | "active-turn";
export type MaterializedSectionKind = "runtime-preamble" | "hard-directives" | "stable-continuity" | "historical-tail" | "continuity-delta" | "directory" | "retrieval-page" | "runtime-warning" | "active-turn";

export interface HostSessionCursor {
  workspaceId: string;
  sessionId: string;
  leafId: string | null;
  lineageHash: string;
  modelKey: string;
  thinkingLevel: string;
}

export interface HostTextBlock { type: "text"; text: string }
export interface HostPointerBlock { type: "pointer"; ref: string }
export interface HostImageRefBlock { type: "image-ref"; ref: string }
export interface HostToolCallRefBlock { type: "tool-call-ref"; ref: string }
export type HostContentBlock = HostTextBlock | HostPointerBlock | HostImageRefBlock | HostToolCallRefBlock;

export interface HostMessage {
  hostMessageId: string;
  role: "user" | "assistant" | "tool-result" | "custom";
  timestamp: number;
  content: HostContentBlock[];
  sourceClass: SourceClass;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export interface MaterializationInput {
  cursor: HostSessionCursor;
  canonicalMessages: readonly HostMessage[];
  currentContextWindow: number;
  maxOutputTokens: number;
  reason: "normal" | "overflow-retry" | "manual-preview";
  now: number;
}

export interface MaterializedSection {
  kind: MaterializedSectionKind;
  cacheZone: CacheZone;
  contentHash: string;
  estimatedTokens: number;
  messageIds: string[];
}

export interface PromptCachePlan {
  layoutVersion: 1;
  sectionOrder: MaterializedSectionKind[];
  eligiblePrefixTokens: number;
  firstDifferentSection: MaterializedSectionKind | null;
  previousViewId: string | null;
  providerCapability: "unknown" | "automatic-prefix" | "explicit-breakpoint" | "disabled";
}

export interface MaterializedView {
  viewId: string;
  outputHash: string;
  messages: HostMessage[];
  sections: MaterializedSection[];
  tokenEstimate: number;
  cachePlan: PromptCachePlan;
  omissions: Array<{ kind: string; reason: string; count: number }>;
  createdAt: number;
}
