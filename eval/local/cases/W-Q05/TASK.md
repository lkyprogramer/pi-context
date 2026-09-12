## P1
Before anything else run: cat notes/dump-a.txt then cat notes/dump-b.txt (two separate tool calls). Reply with one line per file.

## P2
Continue the Java workspace already in this directory. Use facts recorded earlier in this session when a historical value is required. Do not invent assertion text.

Fix the concurrency/idempotency defect in this Java service. Reproduce the failure with `./verify.sh`, inspect the code, implement the smallest production-safe fix, and rerun tests. The public method signature and Reservation record must not change. Do not edit tests. Finish only after the verifier passes.

修复预订幂等问题，并把最早失败的完整断言行保存到root-cause.txt。不要改tests。
