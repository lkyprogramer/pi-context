import type { DirectiveRecord, RuntimeCursor, TaskFronts } from "@pcr/contracts";

export interface FullCheckpointState {
  directives: readonly DirectiveRecord[];
  claims: ReadonlyArray<{ key: string; status: string; value: unknown }>;
  taskFronts: TaskFronts;
  errors: readonly string[];
  validation: ReadonlyArray<{ id: string; status: string }>;
  nextSafeActions: ReadonlyArray<{ text: string }>;
  sideEffects: readonly string[];
}

function copyFronts(fronts: TaskFronts): TaskFronts {
  return {
    active: [...fronts.active],
    parked: [...fronts.parked],
    completed: [...fronts.completed],
    superseded: [...fronts.superseded],
  };
}

export function buildFullCheckpointState(
  cursor: RuntimeCursor,
  state: FullCheckpointState,
): FullCheckpointState & { cursor: RuntimeCursor } {
  return {
    cursor,
    directives: state.directives.filter((item) => item.status === "active"),
    claims: state.claims.filter((item) => item.status === "active"),
    taskFronts: copyFronts(state.taskFronts),
    errors: [...state.errors],
    validation: state.validation.map((item) => ({ id: item.id, status: item.status })),
    nextSafeActions: state.nextSafeActions.map((item) => ({ text: item.text })),
    sideEffects: [...state.sideEffects],
  };
}
