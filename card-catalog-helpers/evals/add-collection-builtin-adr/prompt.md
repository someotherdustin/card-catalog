---
description: add-collection proposes the built-in adr type for a directory of ADRs
tags: [add-collection]
plugins: ["../..", "../../../card-catalog-plugin"]
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Edit, Write]
---

We also keep ADRs for the billing service in services/billing/decisions. Can you get card-catalog to index those too?
