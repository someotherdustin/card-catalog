source "$(dirname "${BASH_SOURCE[0]}")/../_fixtures/lib.sh"

place adrs docs/adr
commit "Add ADRs"
reindex
commit "Index ADRs"

cat > docs/adr/0006-adopt-opentelemetry.md <<'MD'
---
status: parked
---

# Adopt OpenTelemetry for tracing

Every service exports traces with the OpenTelemetry SDK to the shared collector.
MD
commit "Add ADR-0006 without reindexing"
