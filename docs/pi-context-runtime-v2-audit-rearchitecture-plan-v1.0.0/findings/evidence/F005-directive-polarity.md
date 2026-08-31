# F005 closure evidence

Product compaction extracts clause records via `createDirectiveExtractor` and does not
rewrite polarity to `must-not/active`.

- `apps/pi-context-runtime/src/extension.ts` `directiveRecordsFromPreparation`
- `tests/tasks/t31.test.ts` "product extension does not rewrite directives to must-not"
- `tests/acceptance/product-runtime-path.test.ts` session_before_compact against live Pi session context
