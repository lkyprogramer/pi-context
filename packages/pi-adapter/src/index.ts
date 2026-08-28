export { probePiCapabilities, REQUIRED_PI_CAPABILITIES, type PiCapability, type PiCapabilityProbeResult } from "./capabilities.js";
export { bindInputCorrelation } from "./input-correlation.js";
export { bindToolResultCapture } from "./tool-result-hook.js";
export { bindToolCallGate } from "../../kernel/src/security/action-gate.js";
export { registerContextHook, normalizePcrError } from "./context-hook.js";
export { toHostMessages, toPiMessages } from "./message-conversion.js";

