export { probePiCapabilities, REQUIRED_PI_CAPABILITIES, type PiCapability, type PiCapabilityProbeResult } from "./capabilities.js";
export { bindInputCorrelation } from "./input-correlation.js";
export { bindToolResultCapture, registerToolResultHook } from "./tool-result-hook.js";
export { bindToolCallGate } from "../../kernel/src/security/action-gate.js";
export { registerContextHook, normalizePcrError } from "./context-hook.js";
export { toHostMessages, toPiMessages } from "./message-conversion.js";
export {
  createMessageCodec,
  MessageCodecError,
  type CreateMessageCodecInput,
  type MessageCodec,
  type PiMessageEnvelope,
  type WrapMessageInput,
} from "./message-codec.js";

export * from "./user-input-hook.js";
export {
  createRetrievalTools,
  createSearchTool,
  RetrievalToolsError,
  type CreateRetrievalToolsInput,
  type RetrievalToolsPort,
  type SearchToolInput,
  type SearchToolOutput,
  type ReadToolInput,
  type ReadToolOutput,
} from "./tools/search.js";
export { createReadTool } from "./tools/read.js";
