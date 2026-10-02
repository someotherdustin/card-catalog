---
status: accepted
---

# Route all client traffic through the GraphQL gateway

Web and mobile clients talk only to the GraphQL gateway. Services don't expose REST endpoints to clients, so auth, rate limiting and schema versioning stay in one place.

## Consequences

A new client-facing capability is added to the gateway schema, backed by an internal service call.
