---
type: llm
---

ADR-0003 (a single five-minute cache TTL) is superseded by ADR-0005, which caps inventory caching at 30 seconds because stale stock let checkout oversell.
PASS if the reply treats ADR-0005 as the decision in force and says a ten-minute inventory TTL contradicts it.
FAIL if it presents ADR-0003 as the current decision, or doesn't say the change contradicts ADR-0005.
