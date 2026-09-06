import { expect, it } from "vitest";

import {
  createRequestUsageLedger,
  logicalInput,
  totalTaskUsage,
} from "../src/telemetry/request-usage.js";

it("does not confuse cache-exclusive input with context capacity",()=>{
  const u={requestId:"q1",sessionId:"s",phase:"continuation" as const,input:100,
    cacheRead:900,cacheWrite:0,output:20,inputSemantics:"exclusive-cache" as const,elapsedMs:10};
  expect(logicalInput(u)).toBe(1000);
  expect(logicalInput({...u,inputSemantics:"inclusive-cache"})).toBe(100);
  expect(logicalInput({...u,cacheRead:null})).toBeNull();
  expect(totalTaskUsage([u,{...u,requestId:"q2",input:50}]).logicalInput).toBe(1950);
});

it("does not double-count streaming updates for the same requestId", () => {
  const first = {
    requestId: "q1",
    sessionId: "s",
    phase: "continuation" as const,
    input: 10,
    cacheRead: 0,
    cacheWrite: 0,
    output: 1,
    inputSemantics: "exclusive-cache" as const,
    elapsedMs: 5,
  };
  expect(totalTaskUsage([first, { ...first, output: 4, elapsedMs: 9 }]).output).toBe(4);
  expect(totalTaskUsage([first, { ...first, output: 4 }]).totalRequests).toBe(1);
});

it("keeps unknown distinct from zero and leaves output total null when any output is missing", () => {
  const known = {
    requestId: "q1",
    sessionId: "s",
    phase: "continuation" as const,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 3,
    inputSemantics: "exclusive-cache" as const,
    elapsedMs: 1,
  };
  const missing = {
    ...known,
    requestId: "q2",
    input: 8,
    output: null,
  };
  expect(logicalInput(known)).toBe(0);
  expect(logicalInput({ ...known, inputSemantics: "unknown" })).toBeNull();
  const total = totalTaskUsage([known, missing]);
  expect(total.logicalInput).toBe(8);
  expect(total.output).toBeNull();
  expect(total.knownOutput).toBe(3);
  expect(total.knownRequests).toBe(1);
  expect(total.totalRequests).toBe(2);
});

it("does not mix usage across sessions after a model or branch switch", () => {
  const first = {
    requestId: "q1",
    sessionId: "s1",
    phase: "continuation" as const,
    input: 100,
    cacheRead: 0,
    cacheWrite: 0,
    output: 2,
    inputSemantics: "exclusive-cache" as const,
    elapsedMs: 4,
  };
  const switched = {
    ...first,
    requestId: "q2",
    sessionId: "s2",
    input: 9,
    output: 1,
  };
  const ledger = createRequestUsageLedger();
  ledger.upsert(first);
  ledger.upsert(switched);
  expect(ledger.total("s1").logicalInput).toBe(100);
  expect(ledger.total("s2").logicalInput).toBe(9);
  expect(ledger.total().logicalInput).toBe(109);
});

it("does not bill a request that was never emitted", () => {
  const ledger = createRequestUsageLedger();
  ledger.upsert({
    requestId: "sent",
    sessionId: "s",
    phase: "continuation",
    input: 4,
    cacheRead: 0,
    cacheWrite: 0,
    output: 1,
    inputSemantics: "exclusive-cache",
    elapsedMs: 2,
  });
  expect(ledger.total().totalRequests).toBe(1);
  expect(ledger.get("unsent")).toBeUndefined();
  expect(ledger.total("other-session").totalRequests).toBe(0);
});
