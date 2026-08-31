# F008
Kernel no longer treats directives:'keep' as business data; it reads user messages. Product materializer passes copied user HostMessages as hard-directives.
- packages/kernel/src/materialization/materializer.ts directiveSection
- apps/pi-context-runtime/src/extension.ts
