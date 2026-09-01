import { describe, expect, it } from "vitest";
import { GithubProtectionError, verifyGithubProtection } from "../../scripts/ci/github-protection.mjs";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

describe("github protection verify", () => {
  it("fails when the repository has no required ruleset or classic contexts", async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/rulesets")) return jsonResponse(200, []);
      return jsonResponse(404, { message: "Not Found" });
    };
    await expect(verifyGithubProtection({ fetchImpl, token: "unused" })).rejects.toMatchObject({
      code: "PCR_PROTECTION_UNVERIFIED",
    });
  });

  it("passes when required-gate and compatibility-required are present", async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/rulesets")) {
        return jsonResponse(200, [
          {
            id: 1,
            rules: [
              {
                type: "required_status_checks",
                parameters: {
                  required_status_checks: [
                    { context: "required-gate" },
                    { context: "compatibility-required" },
                  ],
                },
              },
            ],
          },
        ]);
      }
      return jsonResponse(404, {});
    };
    const summary = await verifyGithubProtection({ fetchImpl, token: "unused" });
    expect(summary.ok).toBe(true);
    expect(summary.missing).toEqual([]);
  });

  it("stops when aborted", async () => {
    const signal = AbortSignal.abort(new DOMException("stopped", "AbortError"));
    await expect(verifyGithubProtection({ signal, fetchImpl: async () => jsonResponse(200, []) })).rejects.toThrow(
      /stopped|AbortError/,
    );
  });

  it("keeps apply explicit", async () => {
    const { applyGithubProtection } = await import("../../scripts/ci/github-protection.mjs");
    await expect(applyGithubProtection()).rejects.toBeInstanceOf(GithubProtectionError);
  });
});
