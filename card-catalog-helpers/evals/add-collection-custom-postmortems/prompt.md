---
description: add-collection proposes a custom entry for postmortems that the generic defaults read wrongly
tags: [add-collection]
plugins: ["../..", "../../../card-catalog-plugin"]
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Edit, Write]
---

Our incident postmortems live in docs/postmortems. Set card-catalog up to index them.
