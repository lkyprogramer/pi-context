Continue the Java workspace already in this directory. Use facts recorded earlier in this session when a historical value is required. Do not invent timing constants.

Investigate the reconnect regression. First run `./verify.sh`. Then inspect `logs/reconnect.log`, `docs/runtime-design-notes.md`, and the production classes under `src/main/java`. There are two interacting production defects: one in time/expiry semantics and one in state transition/reconnect behavior. Fix them without changing public APIs or tests. Run the verifier until it passes, then summarize the root cause briefly.

继续之前的重连修复，采用历史中最后有效的时间协议。把该协议中的 grace 毫秒数写入 grace-ms.txt，一行、无其它文字。
