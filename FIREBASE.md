# Firebase Configuration — `todo-manager`

Technical reference for the Firebase project backing this repository: identifiers,
service settings, how the client code uses them, and the gaps between what is
configured in the console and what is checked into this repo.

Last verified: 2026-08-16.

---

## 1. General project information

| Field | Value |
|---|---|
| Display name | `todo-manager` |
| Project ID | `todo-manager-1f96e` |
| Project number | `378286017601` |
| Preferred platform | Web (TypeScript / JavaScript) |
| Default project (`.firebaserc`) | `todo-manager-1f96e` |

The repo pins the project in [.firebaserc](.firebaserc), so `firebase deploy` needs
no `--project` flag.

## 2. Billing & subscription plan

- **Plan:** Spark (no-cost).
- **Consequence:** no Cloud Functions, no App Hosting / SSR, no outbound network
  calls from Google-managed compute. Everything here must stay client-side static
  hosting + Firestore + Auth. Moving to Blaze is required before adding any
  server-side logic.

## 3. Google Analytics

| Field | Value |
|---|---|
| Property ID | `549966970` |
| Property name | not configured |
| Account ID | not configured |
| Measurement ID (web app) | `G-26B170XMVV` |

The measurement ID is present in the client config in
[public/auth.js](public/auth.js), but `firebase/analytics` is **not** imported
anywhere, so no analytics events are actually being sent. To enable, import
`getAnalytics` and add the SDK URL to the import map in
[public/index.html](public/index.html).

## 4. Web app configuration

The client config lives in [public/auth.js](public/auth.js):

```js
const firebaseConfig = {
  apiKey: "AIzaSyAp059i2QlT0S3CawXY6urSBDOeIrjHu94",
  authDomain: "todo-manager-1f96e.firebaseapp.com",
  projectId: "todo-manager-1f96e",
  storageBucket: "todo-manager-1f96e.firebasestorage.app",
  messagingSenderId: "378286017601",
  appId: "1:378286017601:web:154004d6a872bbcf4a8ac0",
  measurementId: "G-26B170XMVV"
};
```

**On the API key:** a Firebase web API key is a public identifier, not a secret —
it is meant to ship in client bundles. It identifies the project; it does not
authorize access. **Security Rules are the only access boundary** (see §6).
Restricting the key by HTTP referrer in the Google Cloud console is still
worthwhile as a quota-abuse measure.

**Storage bucket** is configured but Cloud Storage is not used by any code in this
repo and may not be provisioned.

## 5. Authentication

### General settings

| Setting | Value |
|---|---|
| Multifactor authentication (MFA) | Disabled |
| Allow duplicate emails | No |

### Authorized domains

OAuth redirects and auth flows are white-listed for:

- `localhost`
- `todo-manager-1f96e.firebaseapp.com`
- `todo-manager-1f96e.web.app`

Any custom domain added to Hosting later must also be added here, or sign-in will
fail on it with `auth/unauthorized-domain`. Hosting **preview channels** get
generated subdomains under `*.web.app` — verify sign-in works on a preview URL
before relying on it for PR review.

### Identity providers

| Provider | State | Notes |
|---|---|---|
| Google | **Enabled** | OAuth client `378286017601-t07g788vj8v9qke1ihe1jdgtr3f389va.apps.googleusercontent.com`; no extra whitelisted client IDs |
| Email / Password | Disabled | |
| Phone | Disabled | |
| Anonymous | Disabled | |

Google is the only enabled provider, which matches the client: `logInWithGoogle()`
in [public/auth.js](public/auth.js) uses `GoogleAuthProvider` + `signInWithPopup`,
and [public/app.js](public/app.js) wires it to the single login button. There is no
email/password UI to remove.

Session state is observed through `monitorAuthState()` → `onAuthStateChanged`,
which drives the whole UI: signed out hides the todo section, signed in reveals it
and loads that user's tasks.

## 6. Cloud Firestore

| Field | Value |
|---|---|
| Database ID | `(default)` |
| Type | `FIRESTORE_NATIVE` |
| Location | `me-west1` (Tel Aviv, Israel) |

The location is **permanent** — a Firestore location cannot be changed after
creation; moving regions means a new database and a data migration.

### Data model

Written by [public/taskService.js](public/taskService.js). Tasks live in a
per-user subcollection, which is what makes owner-scoped rules simple:

```
users/{userId}/tasks/{taskId}
```

Field names and required/optional shape match `isValidTask()` in
[firestore.rules](firestore.rules) — that function is the contract; a write
that doesn't satisfy it is rejected before it reaches the database.

Each task document:

| Field | Type | Notes |
|---|---|---|
| `title` | string | Required, 1-1000 chars. Raw input text, tags included. Editing it inline is the only way `tags` ever changes — they are re-parsed out of the new title on every commit |
| `completed` | bool | Required. Toggled from the UI checkbox; completed tasks are hidden unless "show completed" is on. Step 12: setting this `true` (directly, or via a step-6 cascade) always also resets `pinned` to `false` in the same write |
| `deleted` | bool | Required. Set by `softDeleteTask`; always written `false` on create. Read by the Trash screen (step 9) to select the flat trashed list, and reset to `false` by Restore. `purgeTask` (step 9) is the one exception to "deletion is always soft" — it issues a real `deleteDoc`, used only to evict the oldest entries once the trash passes its 50-item cap |
| `deletedAt` | timestamp \| null | Set alongside `deleted: true` by `softDeleteTask`. Read by the Trash screen (step 9): sorts the trash list newest-deletion-first (`null` sorts last, treated as "oldest" for eviction too), and is what the 50-item cap evicts by. Reads normalize a missing value to `null` |
| `pinned` | bool | Required. Step 12 (Focus): toggled by the context menu's "Pin to Focus"/"Unpin from Focus" (only shown for a task that is neither completed nor deleted). Read by the Focus section — a flat, hand-picked list of every `pinned && !completed` task, sorted with the same sibling comparator (`order`) the main list uses, rendered ABOVE the Inbox/main list and hidden entirely when nothing is pinned. Completing a task (directly, or via a step-6 cascade) always resets this to `false` in the same write; un-completing (step 7) never restores it. Soft-deleting a task leaves it untouched — restoring from the Trash (step 9) brings the pin back |
| `inInbox` | bool | Required. `true` for tasks added from the main form, `false` for subtasks — a task filed under an explicit parent is not a bare capture. No Inbox UI reads it yet. Step 11 (drag-to-reparent) also writes it: reparenting a task rewrites `inInbox` for it **and every descendant** to follow the new parent's value, since a subtree can't straddle the Inbox boundary; the one exception is "Move to top level" (no new parent to inherit from), which leaves it unchanged |
| `note` | string \| null | Optional, <= 10000 chars. Edited inline; rendered with line breaks preserved and bare http(s) URLs auto-linked. Reads normalize a missing value to `""` |
| `parentId` | string \| null | Optional. The single source of truth for the hierarchy — `taskTree.js` derives all parent/child links from it alone. Set when a task is created via "+ Subtask". Step 11 (drag-to-reparent) also writes it — a drag onto another task's row, or the context menu's "Move to top level" (`parentId: null`) |
| `ancestors` | list | Optional, <= 6 entries, **root-first**. A cached denormalization of the chain above the task, written on create as `[...parent.ancestors, parent.id]`. This is where the 7-level cap is enforceable. Reads normalize a missing value to `[]`. Step 11 (drag-to-reparent) rewrites it too — for the dragged task **and every descendant, deleted ones included** — since moving a task changes the chain every descendant's ancestors run through; one reparent of a task with N descendants is N+1 whole-document writes, not one |
| `order` | number | Fractional index, scoped to `parentId`+`inInbox` siblings, used to sort the list ascending. New tasks get `min(sibling orders) - 1000`. Step 10 (manual reorder) also writes it: a drag between two siblings gets `(prev + next) / 2`, one drag = one document write. When that gap falls below a precision epsilon, the whole sibling group is renumbered instead (`(i+1) * 1000`) rather than writing a value indistinguishable from its neighbour. Step 11 (drag-to-reparent) writes it a third way: a reparented task lands at `min(new parent's live children's orders) - 1000` (or `0` with none), the same top-of-group formula as a new task, reusing `computeReorderOrder(null, topSibling)` rather than a second rule. Reads normalize a missing value (pre-existing docs) to the doc's `createdAt` in epoch millis |
| `updatedAt` | timestamp | Re-stamped with `serverTimestamp()` on every write. Reads normalize a missing value to `createdAt` |
| `closedByCascadeFrom` | string \| null | Set by cascade-complete (step 6): the id of the task the user actually completed (never a descendant's immediate parent), stamped on every descendant that completion closed. `null` on an open task, or one completed directly. Un-completing (step 7) reopens every non-deleted task whose `closedByCascadeFrom` matches the id being un-completed — a global filter, not a subtree walk — and resets it to `null` |
| `deletedByCascadeFrom` | string \| null | Set by cascade-delete (step 8), exactly symmetric to `closedByCascadeFrom` above: the id of the task the user actually clicked Delete on, stamped on every live descendant that deletion swept up. `null` on the clicked task itself and on anything deleted on its own. Read by the Trash screen's Restore (step 9): restoring a task also restores every task whose `deletedByCascadeFrom` matches it — a global stamp filter, not a subtree walk — and resets it to `null` on everything restored |
| `tags` | string[] | Optional, <= 50 entries. Parsed from the title by `/([#@]\w+)/g` — `#food`, `@shop` |
| `colors.foreground` | string | Hex; app.js currently sends `#ffffff` |
| `colors.background` | string | Hex; app.js currently sends `#10b981` |
| `createdAt` | timestamp | `serverTimestamp()` |
| `dueDate` | timestamp \| null | Step 13 (Dates): a Firestore Timestamp at **local midnight** of the due day, or `null`. Set/cleared inline (click the row's due-date display, or the context menu's "Set/Change due date"), committed via whole-document `saveTask` on blur — never `updateDoc`. Parsed from the `<input type="date">`'s `"YYYY-MM-DD"` value with `new Date(year, month-1, day)` (never the string form of `new Date(...)`, which parses as UTC and lands a day early west of Greenwich); read back the same way in reverse. Read by the Overdue screen (`isOverdueTask`, render.js): overdue iff the due date's local calendar day is strictly before today's — due today is not overdue. Never mentioned by `isValidTask()`, so no rules change was needed |

Reads use `query(..., orderBy("createdAt", "desc"))` — a single-field sort, served
by the automatic index. That is why [firestore.indexes.json](firestore.indexes.json)
is empty and correct. A composite index becomes necessary the moment a `where()`
filter (e.g. `completed == false`, or `array-contains` on `tags`) is combined with
that sort.

### Security rules — three-way mismatch, action required

There are three different states in play, and none of them agree:

1. **Deployed in the console:** deny all reads and writes.

   ```
   allow read, write: if false;
   ```

2. **Checked into this repo** ([firestore.rules](firestore.rules)): fully open
   until 2026-09-15 — the CLI's default test-mode rule, which lets *anyone*
   read and delete the whole database, and then locks it out entirely on expiry.

3. **What the app needs:** each signed-in user reading and writing only their own
   `users/{uid}/todos` subtree.

Against the deployed deny-all rules, **the app cannot work** — `fetchUserTodos`
and `addTodo` both fail with `permission-denied`. The repo copy is not a safe
alternative: it is world-writable, and it expires.

The rules that match the actual data model:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/todos/{todoId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Also note [firestore.rules](firestore.rules) opens with `rules_version='2'` with
no trailing semicolon; use `rules_version = '2';`.

## 7. Hosting

Configured in [firebase.json](firebase.json):

| Setting | Value |
|---|---|
| Public directory | `public/` |
| Ignored | `firebase.json`, dotfiles, `node_modules/**` |
| Rewrites | `**` → `/index.html` (SPA fallback) |
| Live URLs | `todo-manager-1f96e.web.app`, `todo-manager-1f96e.firebaseapp.com` |

The app is plain ES modules with no build step: [public/index.html](public/index.html)
declares an **import map** pointing `firebase/app`, `firebase/auth` and
`firebase/firestore` at the Firebase JS SDK **v11.3.0** on `gstatic.com`. Adding a
new Firebase product means adding its URL to that import map, not just importing it.

**`firebase.json` has no `firestore` block.** Because of that, `firebase deploy`
deploys hosting only — `firestore.rules` and `firestore.indexes.json` are inert.
To make them deployable:

```json
"firestore": {
  "rules": "firestore.rules",
  "indexes": "firestore.indexes.json"
}
```

## 8. CI / CD — GitHub Actions

Two auto-generated workflows in `.github/workflows/`:

| Workflow | Trigger | Result |
|---|---|---|
| [firebase-hosting-merge.yml](.github/workflows/firebase-hosting-merge.yml) | push to `main` | deploy to the `live` channel |
| [firebase-hosting-pull-request.yml](.github/workflows/firebase-hosting-pull-request.yml) | `pull_request` (same-repo only) | deploy a preview channel, comment the URL on the PR |

Both authenticate with the repository secret
`FIREBASE_SERVICE_ACCOUNT_TODO_MANAGER_1F96E` and target project
`todo-manager-1f96e`.

**Both will currently fail:** each runs `npm ci && npm run build`, and this repo has
no `package.json` and no build step. Either drop that line (correct for the current
no-build, import-map setup) or add a `package.json`.

## 9. Local development

```bash
firebase login
firebase serve --only hosting
```

`localhost` is already an authorized domain, so Google sign-in works locally
against the real project. Note that this means local development reads and writes
**production** Firestore data. The Firebase Emulator Suite
(`firebase init emulators`, then `firebase emulators:start`) gives isolated Auth +
Firestore and lets rules be tested before deploy — worth adding.

## 10. Deploy commands

```bash
firebase deploy --only hosting
```

```bash
firebase deploy --only firestore:rules
```

The rules command only works once the `firestore` block from §7 is added to
`firebase.json`.

## 11. Open items

1. **Rules mismatch (blocking).** Deployed rules deny everything; the app is
   non-functional against them. Deploy owner-scoped rules (§6).
2. **`firebase.json` cannot deploy Firestore config.** Add the `firestore` block.
3. **CI is broken.** Remove `npm ci && npm run build` or add a `package.json`.
4. **Analytics configured but not wired.** Decide: use it or drop `measurementId`.
5. **Stray files in `public/`** — `app (Copy).js`, `index (Copy).html`, `__index.js`,
   `new 106`. Everything under `public/` is deployed and publicly served, so these
   ship to production as-is. Delete them or move them out of `public/`.
6. **No emulator config**, so all local work hits production data.
7. **Unused document fields** (`parentTaskId`, `completed` toggle) — the schema
   anticipates hierarchy and completion, but no UI reaches these two. (`dueDate`
   is no longer in this list — step 13 wired it up; see the schema table above.)
