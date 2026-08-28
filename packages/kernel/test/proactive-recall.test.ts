import { describe, expect, it } from "vitest";
import { buildRetrievalPage } from "../src/retrieval/page-builder.js";
import {
  buildProactiveRecallPage,
  type ProactiveRecallInput,
  type RecallDeps,
} from "../src/retrieval/proactive-query.js";

function fixtureQuery(path: string): ProactiveRecallInput {
  return {
    userText: `看一下 ${path}`,
    activePaths: [path],
    errorIds: [],
    directives: [{ quote: "不要修改 public API", kind: "prohibition" }],
    maxTokens: 200,
  };
}

function fixtureDeps(): RecallDeps {
  return {
    catalog: {
      async search() {
        return [
          {
            evidenceId: "ev_old",
            quote: "不要修改 public API",
            path: "src/api.ts",
            tokens: 20,
            status: "active",
            observedAt: 1,
          },
          {
            evidenceId: "ev_recent",
            quote: "recent noise",
            path: "src/api.ts",
            tokens: 10,
            recentlyInjected: true,
          },
        ];
      },
    },
    injectionHistory: {
      isRecent(evidenceId) {
        return evidenceId === "ev_recent";
      },
    },
    pages: {
      build(query, selected, all) {
        return buildRetrievalPage(query, selected, all);
      },
    },
  };
}

describe("proactive recall", () => {
  it("recalls an old prohibition referenced by the current path without reinjecting recent evidence", async () => {
    const page = await buildProactiveRecallPage(fixtureQuery("src/api.ts"), fixtureDeps());
    expect(page.items.some((item) => item.quote.includes("不要修改 public API"))).toBe(true);
    expect(page.items.every((item) => !item.recentlyInjected)).toBe(true);
  });

  it("returns an empty page when nothing is relevant", async () => {
    const page = await buildProactiveRecallPage(
      { userText: "hello", activePaths: [], directives: [], maxTokens: 50 },
      {
        catalog: { async search() { return []; } },
        injectionHistory: { isRecent: () => false },
        pages: { build: (query, selected, all) => buildRetrievalPage(query, selected, all) },
      },
    );
    expect(page.items).toEqual([]);
    expect(page.abstained).toBe(true);
  });

  it("returns contradictory versions with time and status", async () => {
    const page = await buildProactiveRecallPage(
      { userText: "api", activePaths: ["src/api.ts"], directives: [], maxTokens: 80 },
      {
        catalog: {
          async search() {
            return [
              { evidenceId: "ev_old", quote: "must use v1", tokens: 10, status: "superseded", observedAt: 1 },
              { evidenceId: "ev_new", quote: "must use v2", tokens: 10, status: "active", observedAt: 9 },
            ];
          },
        },
        injectionHistory: { isRecent: () => false },
        pages: { build: (query, selected, all) => buildRetrievalPage(query, selected, all) },
      },
    );
    expect(page.items.map((item) => item.status).sort()).toEqual(["active", "superseded"]);
  });

  it("never treats active user directives as optional retrieval", async () => {
    const page = await buildProactiveRecallPage(
      { userText: "x", activePaths: [], directives: [{ quote: "不要修改 public API" }], maxTokens: 8 },
      {
        catalog: {
          async search() {
            return [{ evidenceId: "ev_noise", quote: "noise", tokens: 40 }];
          },
        },
        injectionHistory: { isRecent: () => false },
        pages: { build: (query, selected, all) => buildRetrievalPage(query, selected, all) },
      },
    );
    expect(page.items.some((item) => item.quote.includes("不要修改 public API") && item.required)).toBe(true);
  });

  it("debounces the same evidence in the recent-injection window", async () => {
    const page = await buildProactiveRecallPage(fixtureQuery("src/api.ts"), fixtureDeps());
    expect(page.items.some((item) => item.evidenceId === "ev_recent")).toBe(false);
  });
});
