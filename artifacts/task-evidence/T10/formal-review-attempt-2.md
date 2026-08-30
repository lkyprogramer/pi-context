# T10 formal review attempt 2

- Candidate: `0b5326f010f3cfcbccfb51cda96ef5d4a47b55db`
- Tree: `831cf1568c926e6291b6639183b12858dc0743c3`
- Profile: `reviewer`, requested `gpt-5.6-sol/high`, exact zero-write
- Verdict: `FAIL`

The replacement closed every attempt-1 finding, but the reviewer found one remaining P1 and two P2 issues:

1. A directory-creation survivor must fsync the parent even when `mkdir` returns `EEXIST`.
2. Legacy rotation must fully preflight every envelope and reject malformed/non-legacy data before writing rotation state.
3. `ByteRange` must be copied and frozen before the asynchronous key-provider boundary.

The reviewer reported no workspace drift and performed no writes.
