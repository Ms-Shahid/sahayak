---
name: Calendar-only API dates
description: Orval date generation can disagree with JSON and query-string representations.
---

For calendar-only API values, keep an explicit string contract with a date pattern and validate calendar correctness at the server boundary. Do not assume OpenAPI `format: date` produces a wire-compatible validator.

**Why:** In this workspace's Orval configuration, a date-format query parameter generated `z.date()` while the same field in a JSON body generated `z.coerce.date()`. The GET validator rejected a valid `YYYY-MM-DD` query string. Coercion also normalizes invalid dates such as February 30, so it is not sufficient calendar validation.

**How to apply:** Inspect the generated validators after codegen and test the actual query/JSON representation. Keep date-only values as strings and distinguish them from timestamp instants.
