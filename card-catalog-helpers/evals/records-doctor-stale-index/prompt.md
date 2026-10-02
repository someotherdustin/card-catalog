---
description: records-doctor fixes a stale index by running reindex through the CLI
tags: [records-doctor]
plugins: ["../..", "../../../card-catalog-plugin"]
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Edit, Write]
---

card-catalog validate is failing in CI. Please fix it. You have my approval to run any reindex it needs.
