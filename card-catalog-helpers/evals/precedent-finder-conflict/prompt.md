---
description: precedent-finder reports a conflict with an accepted ADR
tags: [precedent-finder]
plugins: ["../..", "../../../card-catalog-plugin"]
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Agent]
---

I'm about to add a REST endpoint to the orders service so the mobile app can fetch order history directly. Before I start, does anything this repo has recorded bear on it?
