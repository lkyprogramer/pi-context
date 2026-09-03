# Repack Validation

- Repack date: 2026-09-03
- Audit HEAD: `0e684e3623f260cc0c49c6cc1d4c75cf69969f9f`
- Previous audit HEAD: `6c5c5b5ace3c14ea28535de9de2b95cc4fa40a31`
- Source archive SHA-256: `ecf97980f26640bac0333d2804346ea4c98fa35116c79acfb11011c33010ee8e`
- AI task documents: `32`
- Finding records: `40`
- Wave count: `6`
- Zero-byte files before packaging: `0`
- Declared verdict: `keep-pi-native`
- Publication claim: `false`
- Release ready: `false`

The repack process regenerates `MANIFEST.sha256`, creates a fresh ZIP under a new filename, runs ZIP CRC validation, extracts it into a clean temporary directory, and verifies every manifest entry by SHA-256.
