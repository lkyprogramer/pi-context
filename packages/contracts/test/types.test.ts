import { describe, expect, it } from "vitest";
import {
  actionAuthorityRank,
  derivedAuthorityCeiling,
  isPcrError,
  parseBlobId,
  parseSourceClass,
  pcrError,
  sourceAuthorityCeiling,
  workspaceId,
} from "../src/index.js";

describe("authority vocabulary", () => {
  it("keeps source identity separate from action authority", () => {
    expect(sourceAuthorityCeiling("agent-derived")).toBe("propose");
    expect(sourceAuthorityCeiling("untrusted-tool")).toBe("inform");
    expect(actionAuthorityRank("act")).toBeGreaterThan(actionAuthorityRank("propose"));
  });

  it("rejects an unknown source value by runtime parser", () => {
    const error = parseSourceClass("system-impersonation");
    expect(isPcrError(error)).toBe(true);
    if (isPcrError(error)) {
      expect(error.code).toBe("INVALID_SOURCE_CLASS");
    }
  });

  it("does not let derived authority exceed the minimum support ceiling", () => {
    expect(derivedAuthorityCeiling(["authenticated-user", "untrusted-tool"])).toBe("inform");
    expect(derivedAuthorityCeiling(["system", "trusted-tool"])).toBe("act");
  });

  it("matches errors by code, never by message substring", () => {
    const error = pcrError("INVALID_ID", { domain: "workspace" });
    expect(isPcrError(error)).toBe(true);
    expect(error.code).toBe("INVALID_ID");
    expect(workspaceId("ws_1")).toBe("ws_1");
  });

  it("parses only canonical durable blob references", () => {
    expect(parseBlobId(`blob_${"a".repeat(64)}`)).toBe(`blob_${"a".repeat(64)}`);
    expect(isPcrError(parseBlobId("blob-public"))).toBe(true);
  });
});
