import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import {
  decodeObservation,
  encodeObservation,
  observationEnvelopeSha256,
  presentExactObservationPage,
  renderObservationView,
  tryDecodeObservation,
} from "../src/observation-envelope.js";

it("preserves an image and emits useful text instead of only a pointer", () => {
  const original = {format:"pcr-observation-v1" as const,toolCallId:"c",toolName:"read",
    content:[{type:"image",mimeType:"image/png",data:"c3ludGhldGlj"}],details:{},isError:false};
  expect(decodeObservation(encodeObservation(original))).toEqual(original);
  const text = {...original,toolName:"bash",isError:true,
    content:[{type:"text",text:"noise ".repeat(8000)+"FAILED UserServiceTest exit=1"}]};
  const view=renderObservationView({original:text,reducedText:"FAILED UserServiceTest exit=1",
    evidenceId:"ev_test",budgetTokens:500,estimate:t=>Math.ceil(t.length/4)});
  expect(JSON.stringify(view.content)).toContain("UserServiceTest");
  expect(JSON.stringify(view.content)).toContain("ev_test");
});

it("keeps short text instead of replacing it with a pointer", () => {
  const original = {
    format: "pcr-observation-v1" as const,
    toolCallId: "c-short",
    toolName: "bash",
    content: [{ type: "text", text: "secret output" }],
    details: { exitCode: 0 },
    isError: false,
  };
  const view = renderObservationView({
    original,
    reducedText: "[pcr observation pointer] ctx://observation/blob_dead",
    evidenceId: "ev_short",
    budgetTokens: 500,
    estimate: (text) => Math.ceil(text.length / 4),
  });
  expect(view.mode).toBe("verbatim");
  expect(JSON.stringify(view.content)).toContain("secret output");
  expect(JSON.stringify(view.content)).not.toContain("ctx://observation");
});

it("round-trips two adjacent text blocks", () => {
  const original = {
    format: "pcr-observation-v1" as const,
    toolCallId: "c-two",
    toolName: "read",
    content: [{ type: "text", text: "alpha" }, { type: "text", text: "beta" }],
    details: null,
    isError: false,
  };
  expect(decodeObservation(encodeObservation(original))).toEqual(original);
});

it("gives image and empty text different raw hashes", () => {
  const image = {
    format: "pcr-observation-v1" as const,
    toolCallId: "c-hash",
    toolName: "read",
    content: [{ type: "image", mimeType: "image/png", data: "c3ludGhldGlj" }],
    details: {},
    isError: false,
  };
  const empty = { ...image, content: [{ type: "text", text: "" }] };
  expect(observationEnvelopeSha256(encodeObservation(image)))
    .not.toBe(observationEnvelopeSha256(encodeObservation(empty)));
  expect(createHash("sha256").update(encodeObservation(image)).digest("hex"))
    .not.toBe(createHash("sha256").update(encodeObservation(empty)).digest("hex"));
});

it("rejects undefined and NaN instead of dropping them", () => {
  const original = {
    format: "pcr-observation-v1" as const,
    toolCallId: "c-bad",
    toolName: "bash",
    content: [{ type: "text", text: "ok" }],
    details: { leaked: undefined as unknown },
    isError: false,
  };
  expect(() => encodeObservation(original)).toThrow(/NON_CANONICAL/);
  expect(() => encodeObservation({ ...original, details: { n: Number.NaN } })).toThrow(/NON_CANONICAL/);
});

it("bypasses unknown blocks instead of deleting them", () => {
  const original = {
    format: "pcr-observation-v1" as const,
    toolCallId: "c-bypass",
    toolName: "custom",
    content: [{ type: "widget", id: "w1" }],
    details: {},
    isError: false,
  };
  const view = renderObservationView({
    original,
    reducedText: "drop me",
    evidenceId: "ev_bypass",
    budgetTokens: 8,
    estimate: (text) => Math.ceil(text.length / 4),
  });
  expect(view.mode).toBe("bypass");
  expect(view.content).toEqual(original.content);
});

it("presents an envelope page without details and leaves raw text pages alone", () => {
  const original = {
    format: "pcr-observation-v1" as const,
    toolCallId: "c-page",
    toolName: "bash",
    content: [{ type: "text", text: "ok" }],
    details: { secret: "token" },
    isError: false,
  };
  const bytes = encodeObservation(original);
  const presented = presentExactObservationPage({
    bytes,
    byteLength: bytes.byteLength,
    sha256: observationEnvelopeSha256(bytes),
    range: { start: 0, endExclusive: bytes.byteLength },
  });
  expect(presented.kind).toBe("envelope");
  expect(Buffer.from(presented.bytes).toString("utf8")).toContain("ok");
  expect(Buffer.from(presented.bytes).toString("utf8")).not.toContain("token");
  const raw = Buffer.from("plain text page", "utf8");
  const textPage = presentExactObservationPage({
    bytes: raw,
    byteLength: raw.byteLength,
    sha256: "a".repeat(64),
    range: { start: 0, endExclusive: raw.byteLength },
  });
  expect(textPage.kind).toBe("text");
  expect(tryDecodeObservation(raw)).toBeNull();
});
