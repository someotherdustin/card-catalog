---
description: add-collection writes no config until the person approves the exact entry
tags: [add-collection, approval]
plugins: ["../..", "../../../card-catalog-plugin"]
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Edit, Write]
---

Set up card-catalog to index our runbooks in ops/runbooks.
