# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Accounts and roles

Sign-in is **Google only** — there is no password form and no account creation in the
Firebase console. Anyone can sign in; signing in by itself grants nothing.

The app is **multi-tenant**. A club owns its tournaments, its schedule and its archive,
and permission is always *per club*:

| Role | Scope |
| --- | --- |
| **Super admin** | Every club, everything. |
| **Club admin** | One club: create/delete/activate tournaments, edit teams and schedules, unlock completed games, manage members — plus everything a scorer can do. |
| **Scorer** | One club: enter and adjust scores, mark games complete, record finals results. Nothing else; no Admin tab. |
| **Signed in, no membership** | Reads the public scoreboard like anyone else, and can create a club of their own. |

A club's roles come from its member documents at `clubs/{clubId}/members/{uid}`. A club
admin grants them; nobody can grant themselves one.

### Super admins

Admin of every club without holding a member document anywhere. The list lives in
**two places, which must match**:

1. `REACT_APP_SUPER_ADMIN_EMAILS` in Vercel — comma-separated. Decides what the **app
   offers**.
2. `superAdmins()` at the top of `firestore.rules` — same addresses, lowercase. This is
   what is **actually enforced**.

**Only the rules file provides security.** `REACT_APP_SUPER_ADMIN_EMAILS` is compiled
into the public JS bundle (as every `REACT_APP_*` value is), so any visitor can read it
and anyone willing to call Firestore from the browser console can ignore it. It hides UI;
it does not protect data. Never put a secret in it — that is why the Anthropic key is
`ANTHROPIC_API_KEY` and server-side only.

If the two drift apart the failure is loud, not silent: the app offers the page,
Firestore refuses the write, and the permission error is shown.

Unlike the club roles there is deliberately **no "empty list means everyone" fallback**.
An unconfigured deploy must not hand every visitor super-admin rights.

### Adding someone to a club

1. A club admin adds the person's email to the club, as **scorer** or **admin**.
2. They are emailed a link (see `api/send-invite.js` below). If `RESEND_API_KEY` is not
   set the invite is still created and still works — it just is not announced.
3. They sign in with Google using **that same address** and the invite is waiting on the
   clubs page.

Because roles are matched by email address, an invite can only be claimed by a
**verified** address, and the claim is pinned to the role the invite named — an invited
scorer cannot write themselves in as an admin. Both are enforced in the rules and
covered by tests.

### What a scorer is technically allowed to write

The rules let a scorer update **only** the `scores` and `finalsMatches` fields of an
existing tournament in their own club. They cannot create or delete a tournament, change
teams, format, name, schedule or rosters, switch which tournament is live, add or edit a
player, or touch any other club at all.

Within those two fields the rules do not inspect the contents, so a scorer determined to
use the browser console could still write a nonsense score, or re-open a game they had
marked complete. Guarding that would mean validating the whole score array in rules; the
app's own UI prevents it, and neither is destructive.

The whole model — cross-club isolation, the admin/scorer split, invite claiming, club
creation and slug squatting — is covered by tests that run against the Firestore
emulator. See [`firestore-tests/`](firestore-tests/), and re-run them after touching
`firestore.rules`.

## Tournaments

A club's tournaments live at `clubs/{clubId}/tournaments/{id}`, and `activeTournamentId`
on the club document names the one the scores page shows. Creating a tournament does
**not** make it active — tournaments are usually built days ahead, and activating on
create would swap the scoreboard out from under a tournament in progress. **Set active**
in Admin is the separate, deliberate step that puts one live.

Each tournament also carries a boolean `hidden` (absent on anything created before the
flag existed, which counts as visible). Hiding one keeps it off the public scores and
completed-tournaments pages, and a hidden tournament shows the "no games live" screen
even if it is the active one.

**`hidden` is a display preference, not access control.** `clubs/{clubId}/tournaments/*`
is world-readable in `firestore.rules` — the same rule the public scoreboard depends on —
so a hidden tournament's document is still fetchable by anyone who knows its id. Use it to
keep half-built or retired tournaments out of the way, never to keep anything secret.

## Standings and tiebreakers

Points come from **completed** games only. Every match distributes exactly 6:

| Result | Winner | Loser |
| --- | --- | --- |
| won without dropping a set | 3 + 3 bonus = **6** | **0** |
| won having dropped one | 3 + 2 bonus = **5** | **1** |

Order is: **1)** tournament points, **2)** overall point differential, **3)** head-to-head,
**4)** alphabetical, which is a deterministic fallback rather than a rule.

Tiebreak 2 counts **every set of every completed match**. It used to count only the sets
of matches a team had *won*, which meant a team that had not won one sat at exactly 0 — a
"no data" value competing on the same scale as measured ones, and placing above anyone
whose wins were scrappy enough to total negative (a 25-23, 10-25, 15-13 win is −11). Every
team now carries a figure that means something.

Two consequences worth knowing:

- A match **marked complete without a decisive result** — 1-1 in a best of three — awards
  nobody a point, and deliberately does not move the differential either. Nothing in the
  UI warns you that marking a game complete early scores it 0-0.
- PD is a **sum, not a rate**. That is fine inside a pool where everyone plays the same
  number of games, which is how the app builds them. If you ever compare *across* pools of
  different sizes — "best third place", say — the bigger pool's teams have more games to
  accumulate from.

`winMatchPointDiff` is still computed and returned. It is a real "how convincingly did you
win" statistic; it is just not the tiebreak.

## Scoring format

Sets per match and the points a set is played to are **per tournament**, set under
Admin → the tournament → **Scoring**. Pool play and knockout are configured separately,
because a pool of one-set games feeding best-of-three semifinals is an ordinary shape.

Each phase has four numbers: points to win a set, the hard cap (win by two until here,
then one point is enough), and the same pair again for the **deciding set** — the last set
of the match, which is usually shorter. Setting a phase's decider cap equal to its decider
points means no cap at all, which is what the finals default to.

These numbers were hardcoded until now, so every club that signed up played this league's
format whether or not it was theirs. **The old constants are the defaults**: a tournament
with no `scoring` field scores exactly as it did before, and `scoring.test.mjs` asserts
that against a copy of the deleted implementation rather than assuming it.

> **One behaviour did change.** The old code treated "set 3 onwards" as the deciding set,
> so a five-set match played sets 3, 4 **and** 5 to 15. The decider is now the last set
> only. Three-set tournaments — every one that exists — are unaffected, since set 3 is
> both.

A cap below the points needed to win would clamp every input below the winning score and
make the set impossible to finish. `normalizeScoring` raises it to the target instead, and
the editor says so before you save.

### Finishing a set

Once the score says a set is over — the target reached with a two-point lead, or the cap
reached with one — a **Finish set** button appears with the result beside it. Tapping it
locks that set's inputs; **Reopen set** is one tap away, because the usual reason to want
it back is a point entered against the wrong team.

The button appears only once the score justifies it, so it reads as an answer to "is that
it?" rather than an invitation to close a set at 3–1. Nothing in the standings reads the
flag: set wins and points are still counted from the scores themselves, so a tournament
scored without ever touching it comes out identical. It lives inside the `scores` array,
which is why a scorer can set it while the format itself stays admin-only.

## Players and rosters

A club keeps one player list, at `clubs/{clubId}/players/{playerId}` — separate documents,
not a field on the tournament. Players outlive tournaments: the same person turns up next
season on a different team, and a profile should not have to be retyped every time. The
**Teams** tab on a tournament shows each team with its players; club admins add and edit
them there.

Only `name` is required. `position` comes from a fixed list rather than free text, so a
roster can be read at a glance instead of containing six spellings of "Outside Hitter".

**Email addresses live in a second collection, `clubs/{clubId}/playerContacts/{playerId}`,
and this split is load-bearing.** The Teams tab is part of the public tournament page, so
names and positions are world-readable like everything else on a scoreboard. A list of
email addresses is not something a public page should hand out — it is the same reason
member documents are already withheld — and a roster would be a far easier address book to
scrape, since nobody even has to sign in. `playerContacts` is readable by club members
only. New fields go in one collection or the other on the same test: **would we print it
on a scoreboard?** A jersey number goes in `players`; a phone number does not.

Each team may have a **captain**, marked in the Teams tab by a bold name and a `C`. Bold
alone carries the meaning only for someone who already knows the convention — and on a
roster of one there is no unbolded name to compare against — so the letter is what makes
it legible cold.

Captaincy is stored on the roster entry, not on the player, because it is a property of a
team in **one tournament**: the same player captains on Saturday and not next month, and
two teams in the same draw each need their own. Tapping the current captain clears the
role. Someone who is not on the team cannot be appointed, and removing the captain from a
roster clears the captaincy rather than leaving an id pointing at nobody.

Which players are on which team is stored per tournament, as a `rosters` array of
`{ team, playerIds, captainId }` on the tournament document — that question has no answer without
naming a tournament. It is an array rather than a map keyed by team name because
`setDoc(..., { merge: true })` merges nested maps key by key, so a removed team's key
would linger forever, and team names are free text that can contain the `.` Firestore
reads as a field-path separator.

Rosters are stored **by team name**, which makes the teams editor the one place they can
be orphaned. Renaming a team there follows the rosters across and drops the ones whose
team no longer exists; without that, renaming "Black" to "Storm" would make its players
vanish from the Teams tab with nothing on screen to explain it.

## Participation waivers

Players can be asked to sign an assumption-of-risk and release agreement online. An admin
creates a one-use link from the **Teams** tab (Manage players → *Create consent link*) and
sends it to the player, or to a parent if they are under 18. The link opens
`/c/{slug}/consent/{token}`, shows the agreement in full, and records the signature.

**This waiver text is a template and has not been reviewed by a lawyer.** Have one in the
club's jurisdiction review `src/waiver.js` before relying on it. Two things in particular:
many jurisdictions will not enforce a release of ordinary negligence at all, and **a
parent's release signed on behalf of a minor is void or sharply limited in a large number
of US states**. The minor flow collects a signature a court may or may not honour; it is
not a substitute for the club's insurance.

### How the link is authorised

Almost no player has an account, and none should need one to sign a waiver — so the
**link is the authorisation**. The document id is 192 bits from the platform CSPRNG, and
holding it permits exactly one signature. That is the same model as any emailed "confirm
your booking" link, and it is why the token must never be derived from a player id, a
name, or anything else reconstructible.

Two collections, because they have two audiences:

- `clubs/{clubId}/consentRequests/{token}` — `{ playerId, playerName, status }`. Readable
  by `get` with the token, but **not listable** by the public: with `list` the collection
  could be enumerated and every outstanding link harvested. Admins may list.
- `clubs/{clubId}/consents/{token}` — the signature, including date of birth and guardian
  contact details. This is the most sensitive data in the database: club members only,
  and **not readable by the person who wrote it**.

A signed consent is **immutable** — no admin, not even a super admin, can edit one. A
record of what somebody agreed to is worthless if it can be rewritten afterwards.
Withdrawing consent deletes it, which leaves no altered document to misread later.

### What is stored, and why

Each signature keeps the `waiverVersion`, a SHA-256 `waiverHash`, and the **full text
exactly as displayed**. Editing the wording in `src/waiver.js` without bumping
`WAIVER_VERSION` would silently re-attribute new language to old signatures, so bump it
for any change at all, including typos.

The signer must scroll to the end of the agreement before the confirmation box unlocks,
and `acknowledgedFullText` records that they did. No IP address is collected — that would
mean pulling in a third party and then being responsible for the result.

The media release is a **separate, optional** checkbox, deliberately outside the
agreement. Bundling it into a liability waiver is what gets the whole thing characterised
as take-it-or-leave-it consent that was never freely given; declining it does not affect
participation.

There is deliberately no "mark as signed on paper" button. A waiver's value is the record
of what a specific person agreed to, and an admin ticking a box on someone else's behalf
produces a record that says nothing.

## Claude-powered features

Vercel Functions that call Claude, sharing one server-side key:

- **`api/send-invite.js`** — emails someone the invite a club admin just created. Not a
  Claude feature, but it shares the same shape and the same reasoning about not being an
  open relay.

  **It cannot mail an arbitrary address.** The request carries the caller's Firebase ID
  token, and the function uses *that token* to read `clubs/{clubId}/invites/{email}`
  through the Firestore REST API. Only club admins may read that document, so a 200
  means Firestore has already decided the caller is one — the permission logic is not
  duplicated here and cannot drift from `firestore.rules`. The recipient is then taken
  from the document rather than the request body, so even a real admin can only mail
  someone they have already invited. The link uses `APP_BASE_URL`, never the request's
  Host header, which would otherwise let an attacker get a genuine-looking email sent
  with a link to their own site.

  The email is a notification, not the mechanism: the invite is already saved and
  claimable, so a send failure is reported to the admin without undoing anything.
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
| `ANTHROPIC_SCHEDULE_EFFORT` | no | `low` | Effort for the schedule builder only. Raise it if a messy screenshot reads badly. |
| `RESEND_API_KEY` | for invite email | — | From [resend.com](https://resend.com). Server-side only. Without it invites still work, they just are not emailed. |
| `RESEND_EMAIL_DOMAIN` | no | — | Set by Vercel's Resend integration. The sender becomes `invites@<this domain>`, so nothing else is needed. |
| `RESEND_FROM` | no | derived from `RESEND_EMAIL_DOMAIN` | Overrides the sender when a specific mailbox or display name is wanted. Must be on a domain verified in Resend. |
| `APP_BASE_URL` | no | `https://volleyscores.app` | Base of the link in the invite email. Deliberately configuration, never the request's Host header. |
| `FIREBASE_PROJECT_ID` | no | `volleyball-score-tracker` | Project whose Firestore documents the functions read to check permissions. Server-side only; must match `projectId` in `src/firebase.js`. |
| `REACT_APP_SUPER_ADMIN_EMAILS` | no | empty | Comma-separated super-admin addresses — admin of every club, no member document needed. Public (it is in the JS bundle); mirror it in `superAdmins()` in `firestore.rules`, which is the list `isSuper()` checks against and the only one that is enforced. |
| `REACT_APP_DEFAULT_CLUB_SLUG` | no | `gvbl` | Club that `/`, `/completed` and `/archive` redirect to. |

Redeploy after adding them — env vars are read at invocation, but the deploy must
exist for the function to pick up the new configuration.

Firestore needs **both** halves published, and neither implies the other. Run these on
your own machine, **from the repository root** — `firebase.json` and `.firebaserc` there
tell the CLI which files to publish and which project to publish them to:

```bash
npm install -g firebase-tools   # once
firebase login                  # once, opens a browser
cd /path/to/volleyball-score-tracker

firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

This is a Firebase deploy, not a Vercel one — it publishes `firestore.rules` and
`firestore.indexes.json` to the `volleyball-score-tracker` Firebase project. It is
entirely separate from deploying the app itself, which Vercel does from git.

Index builds are asynchronous: `firestore:indexes` returns before the indexes are ready,
and the collection-group queries keep failing until they finish. Watch
**Firebase Console → Firestore → Indexes** for them to go from *Building* to *Enabled*.

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
