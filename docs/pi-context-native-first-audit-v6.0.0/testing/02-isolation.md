# 判题与 Agent 隔离（6.1，本地栈版）

## 威胁模型变了什么

本轮没有付费 Provider，也没有 API key：模型是自己 4090 上的 `openclaw/Qwen3.8-27B-WORK`，隧道 `127.0.0.1:18343` 无鉴权。原 6.0.0 关心的"broker 泄漏真实 key"消失；剩下的风险只有一条：**模型写出的代码/命令在哪台机器、以什么权限执行**。个人项目也不该让一个 27B 本地模型在宿主 Mac 上以用户身份跑任意 `bash`——尤其是评测里会连续跑几十个 episode。

## 结构（复用 T21 镜像，不新建平台）

```text
主机（可信控制器 run-matrix / run-episode）
  ├─ SSH 隧道 127.0.0.1:18343 → 4090 现网（只读使用，不改配置）
  ├─ Agent 容器 pctx-t21-sandbox:0.85.1
  │    --read-only --tmpfs /tmp --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges
  │    -v <workdir>:/work  -v <agentDir>:/home/node/.pi/agent  -v <repo>/dist:/plugin:ro  -v <episodeDir>:/out
  │    baseUrl = http://host.docker.internal:18343/v1
  │    不挂载宿主 HOME / .env / SSH / Docker socket；auth.json 为 {}
  └─ 判题容器（同镜像）
       --network none，其余同上
       -v <candidate>:/candidate:ro  -v <trustedGrader>:/grader:ro  -v <secret>:/secret:ro（仅 H 系列）  -v <out>:/out
```

Agent 容器需要出网到主机网关。Docker Desktop for Mac 上 `host.docker.internal` 在默认 bridge 可用；若要禁止其他出网，用自定义 network + `--internal` 不可行（会同时切断网关），退而接受"Agent 容器可出网"并在 report 标注为已知限制。判题容器必须 `--network none`。

## 判题规则

- 可信 `verify.sh`/`Oracle.java`/`pom.xml`/`src/test/**` 来自 `eval/local/fixtures/<case>/`（CodexGame 夹具）或 `grader/`（v5 夹具）的只读挂载，覆盖候选同名文件。
- 候选只复制允许修改的路径（各 case `TASK.md` 中声明；一般是 `src/main/**`），拒绝 symlink、`..`、额外脚本、`pom.xml`、Maven wrapper、annotation processor 配置。
- `passed = exitCode === 0 && protectedIntact`；stdout 中 `ORACLE_PASS`、`BUILD SUCCESS` 等字符串不参与判定。
- `protectedIntact` = 候选目录内 `protectedPaths` 的 sha256 与夹具基线一致（基线取自夹具，不是 Agent 改完后再算）。
- Java 编译 `javac --release 17`（镜像 JDK17），Maven 题 `mvn --offline`（依赖预烤进镜像；缺依赖是 `blocked`，不是运行时开网）。
- H 系列 nonce：判题容器读取 `/secret/<seed>.secret`，与候选写出的文件内容比较；nonce 不进 Agent env、prompt、工作区。
- 超时 300 s、内存 2g、pids 256；超限 `timeout`。

## 必测拒绝项（E02 的 `test/security/grader-isolation.test.ts`）

1. 候选打印 pass marker 后 `exit 1` → failed。
2. 候选自带 `verify.sh exit 0` → 被可信副本覆盖 → 真实编译失败 → failed。
3. 候选改 `pom.xml`/`src/test/**` → `protectedIntact=false` → failed。
4. 候选内 symlink 指向容器外路径 → 复制阶段拒绝。
5. 判题容器内 `curl` 外网 → 失败（`--network none`）。
6. Agent 容器内读 `/home/node/.pi/agent/auth.json` 只见 `{}`；无宿主 `~/.pi`、`~/.ssh`。
7. 无限循环/子进程炸弹 → 超时/资源限制终止，记 `timeout`。

Docker 不可用时这些测试 `skip` 并记录 `blocked-environment`；**E03 前必须在有 Docker 的机器上实际绿**，skip 不算通过。

## 不声称的

- 不是防蓄意恶意评测（同 JVM 反射/篡改）。
- 不是多租户隔离。
- H03 dogfooding 在宿主直接跑你日常的 pi，属于正常使用，不在此隔离范围内。
