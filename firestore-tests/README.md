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

## Running

Needs Java (for the emulator). From this directory:

```bash
npm init -y && npm pkg set type=module
npm i @firebase/rules-unit-testing firebase firebase-tools

./node_modules/.bin/firebase emulators:exec --only firestore --project demo-clubs \
  "RULES_FILE=$PWD/../firestore.rules node rules.test.mjs"
```

The rules file is tested as-is — the super admin is hardcoded in `superAdmins()`, so
there is nothing to substitute in first (older revisions `sed`-ed an admin email list
into a throwaway copy; that no longer applies).

Expect `51 passed, 0 failed`.

## Indexes

The two collection-group queries (`members` by `uid`, `invites` by `email`) need
collection-group-scoped single-field indexes, declared as `fieldOverrides` in
`../firestore.indexes.json`. The emulator does not enforce indexes, so deploy them
before the UI relies on those queries:

```bash
firebase deploy --only firestore:indexes
```
