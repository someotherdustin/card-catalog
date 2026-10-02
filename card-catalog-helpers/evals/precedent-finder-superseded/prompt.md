---
description: precedent-finder follows a superseded ADR to the one that replaced it
tags: [precedent-finder]
plugins: ["../..", "../../../card-catalog-plugin"]
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Agent]
---

I want to raise the inventory cache TTL to ten minutes to cut Redis load. Has anything been decided or learned that I should know about first?
