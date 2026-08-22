# Firestore rules tests

`firestore.rules` is the only thing that actually enforces the multi-tenant model —
club membership, the admin/scorer split, and the super-admin list. The React app's
`REACT_APP_SUPER_ADMIN_EMAILS` just hides UI. So the rules get tested against the real
Firestore emulator rather than reasoned about.

`rules.test.mjs` covers: the public scoreboard staying public while member emails do
not; cross-club isolation (a club admin reaching into another club); club admin and
scorer powers inside their own club; outsiders letting themselves in; claiming an
invite (verified email only, pinned to the invited role); creating a club as a batched
club + slug + founding-admin write, and the slug-squatting attempts that must fail;
super-admin reach; the `users/{uid}` sign-in profile upsert; and the two
collection-group queries the UI depends on.

It also covers the player database, where the interesting rule is the split: a player's
name and position are world-readable (the Teams tab is a public page) while their email
address, in the parallel `playerContacts` collection, is club-members-only. Both are
admin-write, as is the `rosters` field on the tournament — the test that a scorer cannot
write `rosters` is the one that fails if `scorerFieldsOnly()` is ever widened.

> A scorer's roster-write attempts deliberately store a **different** value from the one
> the admin just wrote. `affectedKeys()` reports what actually changed, so re-writing an
> identical value affects no keys and passes `hasOnly()` — a test that reused the same
> value would report a pass without ever exercising the rule. It did, until it didn't.

It also covers participation waivers, which are the only place an **anonymous** visitor
may write: the consent link's token is the authorisation. The load-bearing cases are that
the public can `get` a request but never `list` the collection (listing it would harvest
every outstanding link), that a signature cannot be created without a matching *pending*
request, that the signer cannot read their own signature back afterwards (it holds a date
of birth and a guardian's address), and that **nobody — admin or super admin — can edit a
signed consent**. The real signing writeBatch is tested as a batch, because batched writes
evaluate against pre-batch state, and replaying it is refused.

It also covers scoring-access requests: who may file one (yourself only, verified address
only), who may read them (club admins and the requester — they are a list of email
addresses), and approval. The load-bearing case is that **an admin cannot add a member who
never asked** — an admin creating a membership for someone else is allowed *only* when
that person's request document exists, and only they can create it.

`rest-auth.test.mjs` covers the assumption `api/send-invite.js` is built on: that a
Firebase ID token passed as a Bearer to the Firestore REST API is evaluated against these
rules. A club admin's token can read an invite; a scorer's cannot; an anonymous request
cannot; and the public club document is readable with no token at all.

## Running

Needs Java (for the emulator). Run from the **repository root** — the emulator reads
`firebase.json` there, which is the same config used for deploys, so the rules under test
are the rules that ship:

```bash
cd firestore-tests && npm init -y && npm pkg set type=module \
  && npm i @firebase/rules-unit-testing firebase firebase-tools && cd ..

E=./firestore-tests/node_modules/.bin/firebase

# Rules — 138 tests
$E emulators:exec --only firestore --project demo-clubs \
  "RULES_FILE=$PWD/firestore.rules node firestore-tests/rules.test.mjs"

# REST + ID-token authorisation — 4 tests
$E emulators:exec --only firestore --project demo-rest \
  "node firestore-tests/rest-auth.test.mjs"

# Migration — 50 tests (needs the resolution hook, so run from this directory)
cd firestore-tests && ./node_modules/.bin/firebase emulators:exec --only firestore \
  --project demo-migration --config ../firebase.json \
  "RULES_FILE=$PWD/../firestore.rules node --import ./register-hooks.mjs migration.test.mjs"
```

`rules.test.mjs` and `migration.test.mjs` load the rules themselves via `RULES_FILE`.
`rest-auth.test.mjs` does not — it talks to the emulator's REST endpoint directly, so it
depends on the emulator having loaded them from `firebase.json`.

> **This bit once bit us.** `firestore-tests/firebase.json` used to point at a generated
> copy of the rules in this directory. When that generation step was removed the path
> resolved to nothing, and the emulator started with rules **wide open** — which silently
> passes any test asserting a denial. The two programmatic suites were unaffected, which
> is exactly why nobody noticed. There is now one `firebase.json`, at the repo root,
> shared by the emulator and `firebase deploy`.

## Indexes

The two collection-group queries (`members` by `uid`, `invites` by `email`) need
collection-group-scoped single-field indexes, declared as `fieldOverrides` in
`../firestore.indexes.json`. The emulator does not enforce indexes, so deploy them
before the UI relies on those queries:

```bash
firebase deploy --only firestore:indexes
```
