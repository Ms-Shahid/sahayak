---
name: Upload URL integrity
description: Why completing an upload does not make its signed PUT destination immutable
---

A signed App Storage PUT URL remains usable until it expires; recording upload completion does not revoke it.

**Why:** A replay check confirmed that the same signed URL could accept another PUT after completion. Serving that same object as the accepted original would let the uploader silently replace already-extracted or reviewed evidence.

**How to apply:** Keep upload destinations separate from accepted originals. Read a specific object generation with enforced size limits, then seal a separate private original that no client PUT URL can modify. Never weaken this boundary when adding retries, background extraction, or retention.
