export { createTraceCapture } from "./capture.js";
export { freezeA1Trace, type FreezeA1TraceInput, type FrozenA1Trace, type FrozenArmCopy } from "./freeze.js";
export { TraceCaptureError, type TraceErrorCode } from "./errors.js";
export { createFileTraceStore } from "./file-store.js";
export type {
  CapturedTrace,
  CaptureTraceInput,
  CreateFileTraceStoreInput,
  CreateTraceCaptureInput,
  RedactionReport,
  RedactionReplacement,
  TraceArtifacts,
  TraceCapture,
  TraceCaptureStore,
} from "./types.js";
