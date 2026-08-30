import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerPi0844ContractHandlers } from "../../../packages/pi-adapter/src/contracts/pi-0844.js";

export default function pi0844ContractExtension(pi: ExtensionAPI): void {
  registerPi0844ContractHandlers(pi);
}
