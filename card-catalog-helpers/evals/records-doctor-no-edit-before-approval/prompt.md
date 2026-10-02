---
description: records-doctor proposes fixes and changes nothing until the person approves
tags: [records-doctor, approval]
plugins: ["../..", "../../../card-catalog-plugin"]
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash, Edit, Write]
---

Can you check my records with card-catalog and tell me what needs fixing?
