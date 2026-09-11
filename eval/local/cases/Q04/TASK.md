Continue the Java workspace already in this directory. Use facts recorded earlier in this session when a historical value is required. Do not invent build tags.

Fix VerificationStatus.java in this directory.

isCurrentSuccess(runs, revision) must use the latest evidence for that revision only.
- an older passing run must not override a newer failure on the same revision
- latest evidence wins regardless of input order
- a different revision must not override the current revision's success
- latest unknown (passed=null) is not success
- empty evidence is not success

Use read/write/edit/bash as needed. Only modify VerificationStatus.java and the follow-up file named below.

修复当前修订的验证状态计算，并写出历史指定的build tag到build-tag.txt。
