# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Accounts and roles

Accounts are Firebase Auth email/password users, created by hand in
**Firebase Console → Authentication → Users**. There is no sign-up flow in the app.

Every account is one of two roles:

| Role | Can do |
| --- | --- |
| **Admin** | Everything — create, delete and activate tournaments, edit teams and schedules, unlock completed games, plus everything a scorer can do. |
| **Scorer** | Enter and adjust scores, mark games complete, record finals results. Nothing else. The Admin tab is not shown. |

Roles are per club: they come from the member document at
`clubs/{clubId}/members/{uid}`, granted by a club admin. On top of that there is a
**super admin** list — admin of every club without a member document — which lives in
**two places, which must match**:

1. `REACT_APP_SUPER_ADMIN_EMAILS` in Vercel — comma-separated, e.g.
   `you@example.com,cochair@example.com`. This decides what the **app offers**.
2. The `isSuper()` function at the top of `firestore.rules` — the same addresses,
   lowercase. This is what is **actually enforced**.

Anyone who signs in with no member document and is not a super admin is a spectator.

**Only the rules file provides security.** `REACT_APP_SUPER_ADMIN_EMAILS` is compiled
into the public JS bundle (as every `REACT_APP_*` value is), so it is readable by any
visitor and can be bypassed by anyone willing to call Firestore from the browser
console. It is there to hide UI, not to protect data. Never put a secret in it —
that is why the Anthropic key is `ANTHROPIC_API_KEY` and server-side only.

If the two lists drift apart, the failure is loud rather than silent: the app offers
Admin, Firestore refuses the write, and the page shows the permission error.

### Adding a scorer

1. Firebase Console → Authentication → **Add user**, with an email and password.
2. Give the credentials to the person scoring. Nothing else — being absent from the
   admin list is what makes them a scorer.

### Rolling this out

While both lists are empty, **every signed-in account is an admin** — exactly how the
app behaved before roles existed. So the safe order is:

1. Deploy the code (no behaviour change).
2. Publish `firestore.rules` with `adminEmails()` still empty (no behaviour change).
3. Fill in the same addresses in both places, then redeploy and re-publish.

Step 3 is the one that takes effect. Check you can still reach Admin before handing
out any scorer accounts — if you leave yourself off the list, the only way back is the
Firebase Console, which ignores rules.

### What a scorer is technically allowed to write

The rules let a scorer update **only** the `scores` and `finalsMatches` fields of an
existing tournament, and nothing on `settings`. They cannot create or delete a
tournament, or change teams, format, name or schedule.

Within those two fields the rules do not inspect the contents, so a scorer determined
to use the browser console could still write a nonsense score, or re-open a game they
had marked complete. Guarding that would mean validating the whole score array in
rules; the app's own UI prevents it, and neither is destructive.

The split is covered by tests that run against the Firestore emulator — see
[`firestore-tests/`](firestore-tests/). Re-run them after touching `firestore.rules`.

## Claude-powered features

Two Vercel Functions call Claude, both using the same server-side key:

- **`api/ask-archive.js`** — the Archive page's *Ask the archive* panel, per club. The
  browser posts `{ question, clubId }`; the function reads `archiveSheetId` off
  `clubs/{clubId}` itself, pulls that spreadsheet server-side, hands Claude the rosters,
  career stats, champions and rules, and returns a `{ title, body }` answer.

  **The client never sends a spreadsheet id.** If it could, anyone could POST an
  arbitrary sheet and spend the project's Anthropic credits summarising it, and the
  function would double as an open fetch proxy. Resolving the id from the club document
  means the only sheets reachable are ones a club admin has already attached to a club.
  `clubs/{clubId}` is world-readable, so the lookup uses the Firestore REST API with **no
  service-account key and no new dependency**; the club id is validated against
  `/^[A-Za-z0-9_-]{1,128}$/` before it is interpolated into that URL. A club that does
  not exist and a club with no `archiveSheetId` both return 404 with distinct messages.
  Sheet id and archive are cached separately, each keyed by id, since one warm function
  instance serves every club.
- **`api/build-schedule.js`** — Admin → Schedule → *Build with AI*. Takes a screenshot
  of a schedule (or a typed description) and returns schedule rows. The tournament's
  game list is sent along so Claude maps "Black v Yellow" onto the real game id; any id
  it returns that isn't in that list, or that it uses twice, is dropped server-side and
  reported as a warning rather than trusted.

### Setup

Add the key in **Vercel → Project → Settings → Environment Variables**:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | — | From [console.anthropic.com](https://console.anthropic.com). Server-side only. |
| `ANTHROPIC_MODEL` | no | `claude-opus-5` | Set to `claude-sonnet-5` or `claude-haiku-4-5` to cut cost and latency. |
| `ANTHROPIC_EFFORT` | no | `medium` | `low` is faster/cheaper; `high` reasons harder. |
| `ANTHROPIC_SCHEDULE_EFFORT` | no | `low` | Effort for the schedule builder only. Raise it if a messy screenshot reads badly. |
| `FIREBASE_PROJECT_ID` | no | `volleyball-score-tracker` | Project whose Firestore `clubs/{clubId}` documents `ask-archive` reads to resolve `archiveSheetId`. Server-side only; must match `projectId` in `src/firebase.js`. |
| `REACT_APP_SUPER_ADMIN_EMAILS` | no | empty | Comma-separated super-admin addresses — admin of every club, no member document needed. Public (it is in the JS bundle); mirror it in `isSuper()` in `firestore.rules`. |
| `REACT_APP_DEFAULT_CLUB_SLUG` | no | `gvbl` | Club that `/`, `/completed` and `/archive` redirect to. |

Redeploy after adding them — env vars are read at invocation, but the deploy must
exist for the function to pick up the new configuration.

Firestore needs **both** halves published, and neither implies the other:

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

Without the indexes the club-scoped queries fail at runtime with a "requires an index"
error; without the rules the writes are refused.

**The key never reaches the browser.** It is only read inside the function, which is
why it is `ANTHROPIC_API_KEY` and *not* `REACT_APP_ANTHROPIC_API_KEY` — anything
prefixed `REACT_APP_` is compiled into the public JS bundle and would be readable by
any visitor.

### Local development

`npm start` alone does **not** run the functions; CRA's dev server returns `index.html`
for `/api/*`. Ask the archive detects this and falls back to the offline pattern-matching
answers in `src/archiveInsights.js`; Build with AI reports that it needs `vercel dev`.

To exercise the real Claude path locally:

```bash
npm i -g vercel
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env.local   # already gitignored
vercel dev
```

### Notes

- Answers are grounded in the **club's live spreadsheet**, not the bundled
  `src/data/archiveData.json` snapshot — the function re-fetches every 10 minutes.
- That bundled snapshot is one club's history (the club seeded with
  `GVBL_ARCHIVE_SHEET_ID` from `src/archiveRefreshUtils.js`). `ArchiveHub` renders it,
  and the bundled champion photos and video, **only** for the club whose
  `archiveSheetId` matches it; every other club shows its Firestore snapshot or nothing.
  The offline pattern-matching fallback is skipped rather than answered from the wrong
  club's data.
- A club with no `archiveSheetId` has no archive: the page says so instead of rendering
  empty tables and a link to nothing.
- Precomputed totals are passed alongside the raw data, and Claude is instructed to use
  those figures rather than recount, so stat answers stay exact.
- The archive prefix is sent with `cache_control`, so repeat questions bill the ~16k
  tokens of context at roughly 10% of list price.
- Requests are capped at 10/minute per IP and 500 characters per question.
- `directory[].appearances` is **deliberately excluded** from the AI context — see the
  comment in `api/ask-archive.js`; that field is populated from the wrong spreadsheet
  columns and contains other players' names.
- **Keep these files `.js`, not `.mjs`.** Vercel's zero-config detection for the `/api`
  directory does not pick up `.mjs`; such a file is silently not deployed, and requests
  to it fall through to the SPA and return `index.html`. ESM syntax works fine in
  `api/*.js` without `"type": "module"` — the root `package.json` must *not* set that,
  since `postcss.config.js` and `tailwind.config.js` are CommonJS.

### If a call times out (504)

A 504 means the function ran but exceeded its duration. `vercel.json` pins
`maxDuration` to 300s — the Hobby maximum — because the default drops to 10s on
projects without fluid compute enabled, which no model call will fit inside.

If it still times out, reduce the work rather than the limit: screenshots are
downscaled to 1568px on the long edge before upload, so crop to just the schedule
table, or set `ANTHROPIC_SCHEDULE_EFFORT=low` / `ANTHROPIC_MODEL=claude-sonnet-5`.
Each call logs its model, effort, duration and token counts to the function logs.

### Checking the functions are deployed

```bash
curl -i https://<your-app>/api/build-schedule      # 405 "Use POST" = deployed
                                                   # HTML          = not deployed
```

They should also be listed under the deployment's **Functions** tab in Vercel.

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
