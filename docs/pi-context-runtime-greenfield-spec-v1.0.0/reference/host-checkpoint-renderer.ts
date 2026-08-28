export function renderHostCheckpoint(input: HostCheckpointRenderInput): string {
  return [
    "## Active User Directives",
    ...input.directives.map((d) => `- [${d.directiveId}] ${d.quote}`),
    "## Continuity",
    input.continuityMarkdown,
    "## Unresolved Errors and External Side Effects",
    input.riskMarkdown,
    "## Retrieval",
    "Use context_search/context_read with the listed opaque IDs when exact history is needed.",
    input.directoryMarkdown,
  ].join("\n");
}
