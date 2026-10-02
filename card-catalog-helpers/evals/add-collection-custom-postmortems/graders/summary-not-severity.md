---
type: llm
---

Each postmortem starts with a title, then a "Severity: SEVn" line, then an "## Impact" section describing what happened.
PASS if the reply proposes a config entry for docs/postmortems whose index lines (as shown in the reply) summarize each incident's impact rather than showing "Severity: SEVn" as the summary, and asks before writing it.
FAIL if the proposed summaries are the severity lines, or the reply says it has already written the config.
