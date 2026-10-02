# Restart stuck queue workers

Use when the job queue's oldest message is more than ten minutes old.

1. Check the worker dashboard for crashed pods.
2. Run `kubectl rollout restart deployment/workers`.
