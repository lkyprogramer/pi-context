import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeRef, encodeRef, imageSourceHash, isFieldRef, refForField, textSourceHash } from "../../src/history/refs.js";
import type { NativeEntry, Scope } from "../../src/contracts.js";

const scope: Scope = { workspaceId: "w1", sessionId: "s1", leafId: "r", visibleEntryIds: new Set(["r"]) };
const entry: NativeEntry = {
  id: "r",
  parentId: null,
  type: "message",
  message: {
    role: "toolResult",
    toolCallId: "c",
    toolName: "read",
    isError: false,
    content: [
      { type: "text", text: "alpha" },
      { type: "text", text: "Ω🙂 second" },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
    ],
  },
};

it("returns one ref per block with per-block hash and kind", () => {
  const second = refForField(scope, entry, 1);
  const image = refForField(scope, entry, 2);
  expect("blockIndex" in second && second.blockIndex).toBe(1);
  expect("sourceHash" in second && second.sourceHash).toBe(textSourceHash("Ω🙂 second"));
  expect("kind" in image && image.kind).toBe("image");
  expect(refForField(scope, entry, 3)).toMatchObject({ code: "REF_OUT_OF_RANGE" });
  expect(refForField({ ...scope, visibleEntryIds: new Set() }, entry, 0)).toMatchObject({ code: "REF_SCOPE" });
  expect(isFieldRef(second)).toBe(true);
  if (!isFieldRef(second)) return;
  expect(decodeRef(encodeRef(second))).toEqual(second);
});

it("hashes utf-8 text and canonical image JSON independently per block", () => {
  const second = refForField(scope, entry, 1);
  expect(isFieldRef(second)).toBe(true);
  if (!isFieldRef(second)) return;
  expect(second.sourceHash).toBe(createHash("sha256").update(Buffer.from("Ω🙂 second", "utf8")).digest("hex"));
  expect(Buffer.byteLength("Ω🙂 second", "utf8")).not.toBe("Ω🙂 second".length);
  const a = imageSourceHash({ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" });
  const b = imageSourceHash({ data: "iVBORw0KGgo=", type: "image", mimeType: "image/png" });
  expect(a).toBe(b);
  expect(decodeRef("pctx:5:abc")).toMatchObject({ code: "REF_VERSION" });
  const empty: NativeEntry = { id: "r", parentId: null, type: "message", message: { content: [{ type: "text", text: "" }] } };
  const emptyRef = refForField(scope, empty, 0);
  expect(emptyRef).toMatchObject({ kind: "text", blockIndex: 0 });
  expect(refForField({ ...scope, visibleEntryIds: new Set(["sibling"]) }, entry, 0)).toMatchObject({ code: "REF_SCOPE" });
});
