# Firestore rules tests

`firestore.rules` is the only thing that actually enforces the admin/scorer split —
`REACT_APP_ADMIN_EMAILS` just hides UI. So the rules get tested against the real
Firestore emulator rather than reasoned about.

`rules.test.mjs` covers, for each of signed-out / scorer / admin: reading, scoring,
editing teams and schedule, creating, deleting, switching the active tournament,
smuggling an extra field in alongside `scores`, overwriting the whole document with
`setDoc`, case-insensitive email matching, an account whose token carries no email at
all, and the empty-list fallback where every signed-in account is an admin.

## Running

Needs Java (for the emulator). From this directory:

```bash
npm init -y && npm pkg set type=module
npm i @firebase/rules-unit-testing firebase firebase-tools

# Test the real rules file with the admin list filled in, since an empty list
# deliberately means "everyone is an admin" and would not exercise the split.
sed "s|// 'you@example.com',|'boss@example.com', 'cochair@example.com',|" \
  ../firestore.rules > firestore.rules

./node_modules/.bin/firebase emulators:exec --only firestore --project demo-vb \
  "RULES_FILE=$PWD/firestore.rules node rules.test.mjs"
```

Expect `30 passed, 0 failed`. The generated `firestore.rules` here is a throwaway copy
— edit `../firestore.rules`, never this one.
