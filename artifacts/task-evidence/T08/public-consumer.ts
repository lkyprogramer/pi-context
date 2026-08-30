import { createRuntimeCursor } from "@pcr/core";
import {
  createRuntimeSessionRegistry,
  type RuntimeSessionFactory,
  type RuntimeSessionRegistry,
} from "@pcr/runtime";
import {
  createProductionCompositionRoot,
  type ProductionCompositionRoot,
  type ProductionSessionResourcesFactory,
} from "pi-context-runtime/composition-root";

declare const sessionFactory: RuntimeSessionFactory;
declare const resources: ProductionSessionResourcesFactory;

const registry: RuntimeSessionRegistry = createRuntimeSessionRegistry({
  workspaceId: "ws_downstream",
  factory: sessionFactory,
});
const root: ProductionCompositionRoot = createProductionCompositionRoot({
  identity: { create: createRuntimeCursor },
  resources,
});

void registry;
void root;
