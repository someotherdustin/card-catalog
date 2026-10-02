---
status: superseded
superseded-by: ADR-0005
---

# Cache product and inventory reads for five minutes

We cache product and inventory reads in Redis with a single five-minute TTL, to take read load off PostgreSQL.
