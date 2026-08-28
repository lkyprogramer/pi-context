import { createFakePiHost, type FakePiHost } from "./fake-pi-host.js";
import { probePiCapabilities, REQUIRED_PI_CAPABILITIES } from "../../pi-adapter/src/capabilities.js";

export interface HarnessMessage {
  role: string;
  content: unknown;
}

export interface PiContractHarness {
  host: FakePiHost;
  probe(available?: ReadonlySet<string>): ReturnType<typeof probePiCapabilities>;
  llmContext(messages: readonly HarnessMessage[]): HarnessMessage[];
}

export function createPiContractHarness(): PiContractHarness {
  return {
    host: createFakePiHost(),
    probe(available = new Set(REQUIRED_PI_CAPABILITIES)) {
      return probePiCapabilities(available);
    },
    llmContext(messages) {
      return messages.filter((message) => message.role !== "custom");
    },
  };
}
