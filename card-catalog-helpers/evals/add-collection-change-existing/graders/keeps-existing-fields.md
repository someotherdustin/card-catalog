---
type: llm
---

The existing config entry for docs/postmortems sets id "{date}-{slug}" and summary ["section:Impact", "lead"].
PASS if the reply proposes a changed entry for docs/postmortems that adds a severity field read from the "Severity:" line and still keeps the existing id and summary settings, and asks before writing it.
FAIL if the proposed entry drops the existing id or summary settings, or the reply says it has already written the config.
