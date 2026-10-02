---
description: precedent-finder finds the indexes by their header when it isn't given their paths
tags: [precedent-finder]
plugins: ["../.."]
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Agent]
---

Use the precedent-finder agent to check whether moving the orders service from PostgreSQL to MongoDB contradicts anything recorded in this repo.
