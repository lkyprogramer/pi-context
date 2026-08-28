# Deterministic Reducer 架构

> 规格版本：`1.0.0`  
> 产品版本：`0.1.0-alpha.1`  
> Pi 基线：`938109e7259068ff736dbba3bed14c81af25abbe` / `@earendil-works/pi-coding-agent@0.84.3`

## 1. 目的

定义 reducer 注册、匹配、资源限制、输出 Schema、通用 fallback 与各工具类型职责。

## 2. 已冻结决策

- Reducer 无网络、无 shell、无 LLM。
- Reducer 输入为 immutable raw observation descriptor。
- 按 tool name + schema hash + matcher version 路由。
- 每个 reducer 输出 compact view、facts、artifacts、diagnostics。
- 失败回退通用 reducer，不静默丢弃。

## 3. 接口

```ts
export interface ObservationReducer<T = unknown> {
  readonly id: string;
  readonly revision: string;
  matches(input: ReducerMatchInput): boolean;
  reduce(input: ReducerInput, signal: AbortSignal): Promise<ReducerOutput<T>>;
}

export interface ReducerOutput<T = unknown> {
  visible: HostContentBlock[];
  facts: ExtractedFact[];
  artifacts: ArtifactRef[];
  details: T;
  diagnostics: ReducerDiagnostic[];
}
```

## 4. 内置 Reducer

- shell/build/test：exit code、failed tests、first primary error、changed files、warnings；
- read/file：path、range、hash、symbols、truncation；
- grep/find/ls：query、hit count、dedup paths、match lines；
- edit/write：path、operation、diff summary、result evidence；
- web/MCP：URL/tool principal、content origin、citation metadata、instruction-like spans 标记；
- generic：head + priority windows + tail + pointer。

## 5. Resource Bounds

每个 reducer 有 wall time、input bytes、output tokens、fact count、regex complexity 上限；使用安全 literal/trigram parser，不执行任意模型提供的正则。

## 6. 不变量

1. Reducer 不能修改 raw blob。
2. Reducer revision 是 Evidence identity 和 replay 的一部分。

## 7. 验证要求

- 通过与本文对应的任务、Schema、示例和发布门。

## 8. 关联资料

- `tasks/T12-reducer-registry.md`
- `tasks/T13-shell-build-test-reducers.md`
