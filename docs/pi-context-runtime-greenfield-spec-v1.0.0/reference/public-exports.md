# Public Exports

- `@pi-context-runtime/contracts`: immutable domain types, error codes, canonical encoder.
- `@pi-context-runtime/kernel`: `ContextRuntimeKernel`, reducer extension points, retrieval/action policy interfaces.
- `@pi-context-runtime/storage`: `StorageRpc`, `BlobStore`, `KeyProvider` interfaces; implementation entry.
- `@pi-context-runtime/pi-adapter`: `createPiContextRuntime`, Pi conversion/compat types.
- `@pi-context-runtime/testkit`: fake clocks/IDs/keys/Pi host/fault injection.
- `pi-context-runtime`: single Pi Extension and user-facing commands/tools.

No package exports internal SQLite tables, encryption keys, private worker protocol messages or Pi private types.
