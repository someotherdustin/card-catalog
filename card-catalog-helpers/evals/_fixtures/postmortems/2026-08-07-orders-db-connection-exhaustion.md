# Orders database connection pool exhausted

Severity: SEV1

## Impact

Under a traffic spike the orders service exhausted its PostgreSQL connection pool and failed every request for 25 minutes.

## Follow-ups

- Put a connection pooler in front of PostgreSQL.
