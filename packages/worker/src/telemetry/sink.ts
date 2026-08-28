import { sanitizeTelemetry, type TelemetryEvent } from "../../../kernel/src/control/economics.js";

export interface TelemetrySink {
  write(event: TelemetryEvent): void;
}

export function createMemorySink(): TelemetrySink & { events: TelemetryEvent[] } {
  const events: TelemetryEvent[] = [];
  return {
    events,
    write(event) {
      events.push(event);
    },
  };
}

export function emitTelemetry(raw: unknown, sink: TelemetrySink): TelemetryEvent {
  const event = sanitizeTelemetry(raw);
  sink.write(event);
  return event;
}
