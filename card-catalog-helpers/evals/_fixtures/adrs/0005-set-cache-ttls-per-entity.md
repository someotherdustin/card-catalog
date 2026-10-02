---
status: accepted
supersedes: ADR-0003
---

# Set cache TTLs per entity

Replaces the single five-minute TTL: product data is cached for one hour, and inventory for at most 30 seconds, because stale stock levels let checkout oversell.
