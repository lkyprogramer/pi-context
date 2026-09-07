export type ScenarioFamily = "tool-heavy" | "constraint" | "temporal-update" | "branch" | "overflow";

export interface W2Case {
  id: string;
  family: ScenarioFamily;
  cjk: boolean;
  userText: string;
  raw: string;
  path: string;
  toolName: string;
  mustOmit: string;
  hardDirective: string;
  latestValue: string;
  staleValue: string;
  siblingClaim: string;
  retainedTail: string;
  sourceSpan: { first: string; last: string };
  retainedTailStartId: string;
}

function passBlock(n: number): string {
  return Array.from({ length: n }, (_, i) => `PASS case-${i}.test.ts`).join("\n");
}

function fillerLines(prefix: string, n: number): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, "0")} ${"x".repeat(48)}`).join("\n");
}

function boundaryIds(id: string): Pick<W2Case, "sourceSpan" | "retainedTailStartId"> {
  return {
    sourceSpan: { first: `u_start_${id}`, last: `tr_raw_${id}` },
    retainedTailStartId: `u_tail_${id}`,
  };
}

function pushFamily(cases: W2Case[], family: ScenarioFamily, prefix: string, build: (i: number, id: string, cjk: boolean) => Omit<W2Case, "id" | "family" | "cjk" | "sourceSpan" | "retainedTailStartId">): void {
  for (let i = 0; i < 20; i += 1) {
    const id = `${prefix}-${String(i).padStart(2, "0")}`;
    const cjk = i < 8;
    cases.push({ id, family, cjk, ...boundaryIds(id), ...build(i, id, cjk) });
  }
}

export function buildW2SyntheticCorpus(): W2Case[] {
  const cases: W2Case[] = [];
  pushFamily(cases, "tool-heavy", "th", (i, id, cjk) => {
    const hardDirective = cjk ? "不要修改 public API" : "do not change the public API";
    const failLine = cjk ? "FAIL 认证.test.ts" : `FAIL auth-${i}.test.ts`;
    return {
      hardDirective,
      userText: `${hardDirective}；${cjk ? "继续修测试" : "keep fixing tests"}`,
      raw: `${passBlock(40)}\n${failLine}\nExpected 200 received 500\nTests: 1 failed, 19 passed\nsk-live-w2-omit-${id}`,
      path: cjk ? "packages/kernel/test/认证.test.ts" : `packages/kernel/test/auth-${i}.test.ts`,
      toolName: i % 2 === 0 ? "test" : "bash",
      mustOmit: `sk-live-w2-omit-${id}`,
      latestValue: "version 7",
      staleValue: "version=3",
      siblingClaim: `sibling-branch:deploy-approved-${id}`,
      retainedTail: cjk ? "下一步只修当前失败" : "fix only the current failure",
    };
  });
  pushFamily(cases, "constraint", "ct", (i, id, cjk) => {
    const hardDirective = cjk ? "不要部署生产" : "do not deploy prod";
    return {
      hardDirective,
      userText: `${hardDirective}；${cjk ? "先看配置" : "inspect config first"}`,
      raw: `export const env = ${i};\n${fillerLines("// cfg ", 80)}\nsk-live-w2-omit-${id}`,
      path: "deploy/prod.yaml",
      toolName: "read",
      mustOmit: `sk-live-w2-omit-${id}`,
      latestValue: "version 7",
      staleValue: "version=3",
      siblingClaim: `sibling-branch:deploy-approved-${id}`,
      retainedTail: cjk ? "现在准备发布了吗" : "ready to ship?",
    };
  });
  pushFamily(cases, "temporal-update", "tu", (i, id, cjk) => {
    const hardDirective = cjk ? "改为 version 7" : "instead use version 7";
    return {
      hardDirective,
      userText: `${hardDirective}；${cjk ? "以最新值为准" : "prefer the latest value"}`,
      raw: `stale config version=3 build=${i}\n${fillerLines("// old ", 60)}\nsk-live-w2-omit-${id}`,
      path: "src/version.ts",
      toolName: "read",
      mustOmit: `sk-live-w2-omit-${id}`,
      latestValue: "version 7",
      staleValue: "version=3",
      siblingClaim: `sibling-branch:deploy-approved-${id}`,
      retainedTail: cjk ? "当前生效版本是多少" : "what version is active?",
    };
  });
  pushFamily(cases, "branch", "br", (i, id, cjk) => {
    const hardDirective = cjk ? "不要合并 sibling-branch" : "do not merge sibling-branch";
    return {
      hardDirective,
      userText: `${hardDirective}；${cjk ? "只处理当前叶" : "stay on this leaf"}`,
      raw: `main leaf work ${i}\n${fillerLines("// main ", 50)}\nsk-live-w2-omit-${id}`,
      path: "src/leaf.ts",
      toolName: "bash",
      mustOmit: `sk-live-w2-omit-${id}`,
      latestValue: "version 7",
      staleValue: "version=3",
      siblingClaim: `sibling-branch:deploy-approved-${id}`,
      retainedTail: cjk ? "可以合并旁支吗" : "merge the sibling branch?",
    };
  });
  pushFamily(cases, "overflow", "ov", (i, id, cjk) => {
    const hardDirective = cjk ? "不要部署生产" : "do not deploy prod";
    return {
      hardDirective,
      userText: `${hardDirective}；${cjk ? "历史太长先压缩" : "history overflow, compact first"}`,
      raw: `${passBlock(80)}\n${fillerLines("// hist ", 220)}\nsk-live-w2-omit-${id}`,
      path: "logs/session.txt",
      toolName: "bash",
      mustOmit: `sk-live-w2-omit-${id}`,
      latestValue: "version 7",
      staleValue: "version=3",
      siblingClaim: `sibling-branch:deploy-approved-${id}`,
      retainedTail: cjk ? "压缩后还能遵守约束吗" : "after compact, still honor the constraint?",
    };
  });
  return cases;
}

export function corpusQuota(cases: W2Case[]): {
  total: number;
  families: Record<ScenarioFamily, number>;
  cjk: number;
} {
  return {
    total: cases.length,
    families: {
      "tool-heavy": cases.filter((item) => item.family === "tool-heavy").length,
      constraint: cases.filter((item) => item.family === "constraint").length,
      "temporal-update": cases.filter((item) => item.family === "temporal-update").length,
      branch: cases.filter((item) => item.family === "branch").length,
      overflow: cases.filter((item) => item.family === "overflow").length,
    },
    cjk: cases.filter((item) => item.cjk).length,
  };
}
