# B23 live tools environment (unrun)

Shipped:

- `scoreToolPairsFromSession` counts orphan/mismatched JSONL toolCall/toolResult pairs.
- Report `toolPairViolation` is the sum of parsed violations, not the constant 0.
- `--no-tools` stays until B24 gives each arm its own workspace clone (shared cwd + Promise.all would race if tools were enabled).

Not run: `pnpm benchmark:closed-loop:live-smoke` does not exist. Model-chosen read/edit/test in an independent workspace was not executed against a real Provider.

NF008 stays open until a tools-enabled live JSONL has real pairs and environment assertions.
