# F038
Default `pnpm test` excludes *.live.ts. Live paired/compact have dedicated workspaces and nightly protected job. `pnpm test:live` is opt-in.
- vitest.workspace.ts
- package.json test:live
- .github/workflows/nightly.yml
