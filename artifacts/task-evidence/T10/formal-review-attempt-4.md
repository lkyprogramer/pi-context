# T10 formal review attempt 4

- Candidate: `7c0f34f0797e00a7dbd54986398082fb5a195fb2`
- Tree: `00fb765786340eb3a0886dc2ecfd31695312f44b`
- Profile: `reviewer`, requested `gpt-5.6-sol/high`, exact zero-write
- Verdict: `FAIL`

No storage correctness regression remained. Two P2 integration limits were accepted:

1. T07 was another typed v2 port fixture still using non-canonical string refs and was outside the real typecheck target.
2. The 1 GiB configuration ceiling exceeded Node 22.19.0's `MAX_STRING_LENGTH` once ciphertext was encoded as base64 JSON.

Resolution: migrate and compile T07 in the runtime gate, and derive the maximum accepted plaintext size from Node's string limit with reserved envelope overhead until a streaming/binary envelope replaces JSON.
