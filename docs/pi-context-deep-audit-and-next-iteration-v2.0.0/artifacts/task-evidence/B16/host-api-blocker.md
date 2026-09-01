# B16 Host-API blockers (honest)

Pi 0.84.4 Host APIs used by the product wrapping (`apps/pi-context-runtime/src/extension.ts` + `packages/pi-adapter/src/context-hook.ts`):

| Field | Host API | Product path | Status |
|---|---|---|---|
| system prompt | `ExtensionContext.getSystemPrompt(): string` | called on every context hook | wired |
| tools schema | `ExtensionAPI.getAllTools(): ToolInfo[]` (`name`, `description`, `parameters`, `promptGuidelines`); fallback `getActiveTools()` then locally registered tools | serialized into `toolsJson` / I_eff | wired |
| images | host message image-ref blocks | `imageReserveTokens = count * 765` | wired |
| reasoning | thinking blocks on Pi messages; `ctx.thinkingLevel` exists | thinking text into `reasoningText` | wired |
| provider reserved | `Model` has `contextWindow` / `maxTokens` only; **no** `providerReservedTokens` | defaults to `0` unless a number is actually present | **blocker** |
| cache on ContextUsage | `getContextUsage(): { tokens, contextWindow, percent }` | **not** mapped to `inputTokens` (would impersonate uncached input) | **blocker** |
| cacheRead / cacheWrite | assistant `Usage.cacheRead` / `cacheWrite` (also `cacheReadTokens` / `cacheWriteTokens`) on `sessionManager.getEntries()` | last assistant usage merged into `providerUsage` and `reconcileUsage` | wired |
| after_provider_response | event is `{ status, headers }` only | unused; do not invent usage on this event | n/a |

Do not close NF016 until a follow-up task supplies a real provider-reserved Host field or an independently measured reserved budget.
Do not invent `getContextUsage().cacheRead`.
