# packages/kernel/src/control/economics.ts:45-70

```text
   45: export function sanitizeTelemetry(event: unknown): TelemetryEvent {
   46:   return schemaParseTelemetry(hashSensitiveDimensions(event));
   47: }
   48: 
   49: export function hashSensitiveDimensions(event: unknown): Record<string, unknown> {
   50:   const raw = event !== null && typeof event === "object" && !Array.isArray(event) ? { ...(event as Record<string, unknown>) } : {};
   51:   const dimensions: Record<string, string | number | boolean | null> = {};
   52:   const incoming = raw.dimensions !== null && typeof raw.dimensions === "object" ? (raw.dimensions as Record<string, unknown>) : raw;
   53:   for (const [key, value] of Object.entries(incoming)) {
   54:     if (key === "prompt" || key === "message" || key === "blob" || key === "text") continue;
   55:     if (typeof value === "string" && looksSensitive(key, value)) {
   56:       dimensions[key] = domainHash("telemetry-dim", value);
   57:     } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
   58:       dimensions[key] = value;
   59:     }
   60:   }
   61:   return {
   62:     name: typeof raw.name === "string" ? raw.name : "pcr.event",
   63:     timestamp: typeof raw.timestamp === "number" ? raw.timestamp : 0,
   64:     workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : "ws_opaque",
   65:     sessionId: typeof raw.sessionId === "string" ? raw.sessionId : "s_opaque",
   66:     viewId: typeof raw.viewId === "string" || raw.viewId === null ? raw.viewId : null,
   67:     dimensions,
   68:     metrics: asMetrics(raw.metrics),
   69:   };
   70: }
```
