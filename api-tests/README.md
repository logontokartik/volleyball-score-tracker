# API function tests

No network, no key: `fetch` is stubbed, so nothing leaves the process and no model call
is ever made.

```bash
node api-tests/schema.test.mjs
```

## `schema.test.mjs`

Walks the structured-output schema that `api/build-schedule.js` actually puts on the wire
and fails on anything outside the documented supported subset — complex array constraints
(`minItems`/`maxItems`/`uniqueItems`/`contains`), numeric and string constraints,
`pattern`, `not`/`if`/`then`/`else` — and on any object missing `additionalProperties:
false`, which structured outputs require.

This exists because `minItems`/`maxItems` were added to the `courts` array during the
multi-court work and Anthropic rejected every request with a 400. The Python and
TypeScript SDKs quietly strip unsupported constraints before sending; these functions call
the API over raw `fetch`, so there is nothing between the schema and the wire. Anything
added to a schema here has to be checked by hand — this test is that check.
