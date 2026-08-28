export async function decideAction(input: ActionDecisionInput): Promise<ActionDecision> {
  const classification = classifyTool(input.toolName, input.args);
  if (classification === "query") return { decision: "allow", policyId: "query-v1", supportingDirectiveIds: [], reasonCode: "QUERY" };
  const support = await resolveActionSupport(input.dependencyRefs);
  if (support.authority === "act") return { decision: "allow", policyId: "command-v1", supportingDirectiveIds: support.directiveIds, reasonCode: "ACT_SUPPORT" };
  return { decision: "require-user-approval", policyId: "command-v1", supportingDirectiveIds: [], reasonCode: "MISSING_ACT_SUPPORT" };
}
