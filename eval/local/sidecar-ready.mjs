/**
 * Wait for a sidecar stdout stream to print {"ready":true,...}.
 * Must not block the event loop — a sync sleep would freeze the stream's data handler.
 */
export function waitForReadyJson(stream, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    let settled = false;
    let buf = "";
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    const onData = (chunk) => {
      if (settled) return;
      buf += String(chunk);
      if (buf.includes('"ready":true') || buf.includes('"ready": true')) done(true);
    };
    stream.on("data", onData);
    stream.once("end", () => done(buf.includes('"ready":true') || buf.includes('"ready": true')));
    stream.once("error", () => done(false));
    if (typeof stream.readableEnded === "boolean" && stream.readableEnded) {
      done(false);
    }
  });
}
