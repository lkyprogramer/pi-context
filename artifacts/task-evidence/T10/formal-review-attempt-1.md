# T10 formal review attempt 1

- Candidate: `82f46f06af6f5f945efb51cd501d36a5cbf2a68b`
- Tree: `81974453ad9b9f13c071dca8c8ebd15b5a753122`
- Profile: `reviewer`, requested `gpt-5.6-sol/high`, exact zero-write
- Verdict: `FAIL`

Findings requiring a replacement candidate:

1. Snapshot the complete cursor before the asynchronous key-provider boundary and use one precomputed blob identity.
2. Fsync every newly created directory's parent and close the cross-process existing-object durability race.
3. Carry canonical `BlobRef` through runtime/durable evidence fields and validate it at SQLite decode boundaries.
4. Fail closed before the legacy production key-rotation protocol touches a v2 cursor-scoped envelope.
5. Seal the v2 T10 evidence under a namespace distinct from the legacy directive-capture `T10.json`.

No P0 was reported. Four P1 findings and one P2 finding were accepted for repair. The reviewer did not modify files or run write-producing validation.
