import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import { waitForReadyJson } from "../../eval/local/sidecar-ready.mjs";

test("ready JSON is observed without a blocking sleep", async () => {
  const stream = new PassThrough();
  const pending = waitForReadyJson(stream, 1_000);
  setTimeout(() => stream.write(`${JSON.stringify({ ready: true, socketPath: "/run/pctx/broker.sock" })}\n`), 20);
  await expect(pending).resolves.toBe(true);
});

test("missing ready JSON times out as not-ready", async () => {
  const stream = new PassThrough();
  await expect(waitForReadyJson(stream, 30)).resolves.toBe(false);
});
