# GraphQL gateway timeouts during a deploy

Severity: SEV3

## Impact

Mobile clients saw 504 errors for 12 minutes while the gateway restarted, because the deploy replaced every instance at once.

## Follow-ups

- Roll gateway deploys one instance at a time.
