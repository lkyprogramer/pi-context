import { describe, expect, it } from "vitest";
import { observationFixture } from "./support.js";

describe("raw observation capture", () => {
  it("publishes the raw blob before invoking any reducer", async () => {
    const fx = observationFixture();
    await fx.capture({ toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "full" }] });
    expect(fx.events()).toEqual(["blob-published", "receipt-prepared"]);
    expect(await fx.blobText()).toBe("full");
  });

  it("is idempotent for the same toolCallId and content", async () => {
    const fx = observationFixture();
    const first = await fx.capture({ toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "full" }] });
    const second = await fx.capture({ toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "full" }] });
    expect(second.operationId).toBe(first.operationId);
    expect(second.state).toBe("prepared");
    expect(second.rawBlobId).toBe(first.rawBlobId);
  });

  it("quarantines the same call ID when content diverges", async () => {
    const fx = observationFixture();
    await fx.capture({ toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "full" }] });
    const diverged = await fx.capture({ toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "other" }] });
    expect(diverged.state).toBe("quarantined");
  });

  it("retains image and details metadata on the prepared receipt", async () => {
    const fx = observationFixture();
    const receipt = await fx.capture({
      toolCallId: "call-2",
      toolName: "read",
      content: [{ type: "image-ref", ref: "img://1" }],
      details: { mime: "image/png", bytes: 12 },
    });
    expect(receipt.content).toEqual([{ type: "image-ref", ref: "img://1" }]);
    expect(receipt.details).toEqual({ mime: "image/png", bytes: 12 });
  });

  it("follows the profile and never claims success when raw capture fails", async () => {
    const closed = observationFixture({ failingBlobs: true, profile: "strict" });
    await expect(
      closed.capture({ toolCallId: "call-3", toolName: "bash", content: [{ type: "text", text: "full" }] }),
    ).rejects.toMatchObject({ code: "PCR_RAW_CAPTURE_FAILED" });
    expect(closed.events()).toEqual(["raw-capture-failed"]);

    const cost = observationFixture({ failingBlobs: true, profile: "cost" });
    const receipt = await cost.capture({
      toolCallId: "call-4",
      toolName: "bash",
      content: [{ type: "text", text: "full" }],
    });
    expect(receipt.rawCaptureUnavailable).toBe(true);
    expect(receipt.state).not.toBe("committed");
    expect(cost.events()).toEqual(["raw-capture-failed"]);
  });
});
