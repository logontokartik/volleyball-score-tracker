# API function tests

No network, no key: `fetch` is stubbed, so nothing leaves the process and no model call
is ever made.

```bash
node api-tests/schema.test.mjs
node api-tests/fixtures.test.mjs
```

## `schema.test.mjs`

Walks the structured-output schemas that `api/build-schedule.js` and
`api/build-fixtures.js` actually put on the wire
and fails on anything outside the documented supported subset — complex array constraints
(`minItems`/`maxItems`/`uniqueItems`/`contains`), numeric and string constraints,
`pattern`, `not`/`if`/`then`/`else` — and on any object missing `additionalProperties:
false`, which structured outputs require.

This exists because `minItems`/`maxItems` were added to the `courts` array during the
multi-court work and Anthropic rejected every request with a 400. The Python and
TypeScript SDKs quietly strip unsupported constraints before sending; these functions call
the API over raw `fetch`, so there is nothing between the schema and the wire. Anything
added to a schema here has to be checked by hand — this test is that check.

Both functions now require a club-admin membership, so the stub answers Firestore as well
as Anthropic. A schema is only captured after that gate passes.

## `fixtures.test.mjs`

`api/build-fixtures.js` end to end with `fetch` stubbed — the stub counts outbound calls,
so "refused before any model call" is asserted rather than assumed.

Covers the gate (no token → 401 with zero outbound calls; a scorer's token and a
non-member's → 403 with no model call) and the validation of what comes back: unknown
team names dropped with a warning naming them, self-pairings dropped, cross-pool and
unknown-pool fixtures dropped when pools are supplied, the model's spelling of a team
replaced by the canonical one from the team list, ids assigned server-side as `G1..Gn`, a
pairing exceeding `meetingsPerPair` warned about but kept (a double round robin repeats
legitimately), and nothing surviving → 422 rather than an empty fixture list.
