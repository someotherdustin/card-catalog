---
type: llm
---

ADR-0002 (accepted) says clients talk only to the GraphQL gateway and services don't expose REST endpoints to clients.
PASS if the reply says the planned REST endpoint conflicts with ADR-0002.
FAIL if it doesn't mention ADR-0002, or presents it as merely related rather than contradicted.
