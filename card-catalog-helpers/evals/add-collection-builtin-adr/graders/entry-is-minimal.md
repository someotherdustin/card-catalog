---
type: llm
---

PASS if the reply proposes a card-catalog config entry for services/billing/decisions with type "adr" and no other profile fields (such as id, title, summary or status), and asks before writing it.
FAIL if it proposes a different type or extra profile fields, or says it has already written the config.
