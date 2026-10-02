---
description: precedent-finder answers Nothing relevant when no record bears on the change
tags: [precedent-finder]
plugins: ["../..", "../../../card-catalog-plugin"]
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Agent]
---

I'm changing the login page's primary button from blue to green. Use the precedent-finder agent to check whether anything recorded in this repo bears on that.
