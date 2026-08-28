export interface ToolOutcome {
  isError: boolean;
  exitCode?: number;
  text?: string;
}

export interface OutcomeAttestation {
  attested: boolean;
  reason: "tool-success" | "tool-failed" | "assistant-mismatch";
}

export function attestOutcome(input: { assistantClaim?: string; tool: ToolOutcome }): OutcomeAttestation {
  if (input.tool.isError || (input.tool.exitCode != null && input.tool.exitCode !== 0)) {
    return { attested: false, reason: "tool-failed" };
  }
  if (input.assistantClaim && /pass|passed|success|ok/i.test(input.assistantClaim) && /fail|error|denied/i.test(input.tool.text ?? "")) {
    return { attested: false, reason: "assistant-mismatch" };
  }
  return { attested: true, reason: "tool-success" };
}
