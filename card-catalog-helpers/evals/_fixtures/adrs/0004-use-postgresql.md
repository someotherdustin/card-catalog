---
status: accepted
---

# Use PostgreSQL as the primary database

Every service keeps its data in one managed PostgreSQL cluster, with a schema per service. We rely on transactions across an order and its line items, which ruled out document stores.
