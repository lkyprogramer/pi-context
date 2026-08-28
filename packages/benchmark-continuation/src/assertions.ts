export interface AssertionEvaluationInput {
  readonly actions: readonly string[];
  readonly assertions: readonly { id: string; kind: string; pattern?: string }[];
}

export interface EnvironmentAssertionResult {
  readonly id: string;
  readonly passed: boolean;
}

export async function evaluateEnvironmentAssertions(input: AssertionEvaluationInput): Promise<EnvironmentAssertionResult[]> {
  return input.assertions.map((assertion) => {
    const pattern = assertion.pattern ?? "";
    const hit = input.actions.some((action) => (pattern ? action.includes(pattern) : false));
    const passed = assertion.kind.includes("forbidden") ? !hit : hit || pattern.length === 0;
    return { id: assertion.id, passed };
  });
}
