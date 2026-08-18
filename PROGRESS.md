# Progress

Last updated: 2026-08-18 — **Steps 1–21 implemented.** All 21 planned steps
are now built. No signed-in browser walkthrough has been reported back for
any step yet — the click-path below is still the first thing to run, and is
now the actual next action (see "Resume here" below).

## Step table

| # | Step | Status |
|---|---|---|
| 1 | Foundation + complete | done |
| 2 | Inline edit | done |
| 3 | Soft delete (leaf) | done |
| 4 | Hierarchy | done |
| 5 | Inbox container | done |
| 6 | Cascade complete | done |
| 7 | Un-complete memory | done |
| 8 | Context menu + cascade delete | done |
| 9 | Trash | done |
| 10 | Manual reorder | done |
| 11 | Drag-to-reparent | done |
| 12 | Focus / pin | done |
| 13 | Dates | done |
| 14 | Tag colors | done |
| 15 | Quadrant mapping | done |
| 16 | Priority ordering | done |
| 17 | Tag rename/delete | done |
| 18 | Recurrence | done |
| 19 | Search — basic | done |
| 20 | Search — advanced | done |
| 21 | Export / import | done |

## Step 16 (Priority ordering) — done

Implemented exactly per the orchestrator's locked decisions (R1–R6, see the
Decisions log's step 16 entries below) — quadrant rank is never stored,
computed once per render/drag pass into a `Map<taskId, rank>`
(`computeQuadrantRankMap`, tagColors.js), and `compareSiblings`
(render.js) sorts siblings by `(rank, order)`, unchanged for cross-parent
comparisons (hierarchy still wins — a ranked child never floats above its
own parent). The overruled-drag visibility requirement (product-spec.md
§3:104-107) is live: a sibling drop gap that crosses a quadrant-rank
boundary renders with `.drop-indicator--overruled` (index.html) *before*
release, and the drop still writes `order` and alerts naming the dragged
task's own resolved quadrant, per R5's explicit "write, never refuse, never
silently snap back."

## Step 17 (Tag rename/delete) — done

Implemented exactly per the orchestrator's locked decisions (S17-1–S17-9, see
the Decisions log's step 17 entries below). Renaming/deleting a tag on the
Tag Settings screen (`.tag-setting__rename-btn`/`.tag-setting__delete-btn`,
render.js) rewrites the tag's exact token in every **non-deleted** task's
title via offset-based `matchAll` substitution (`rewriteTagInTitle`,
tagColors.js) — never a bare string replace, so `#work` can never corrupt
`#workshop`. The whole batch is pre-checked against the 1–1000 character cap
before any write (`planTagRewrite`); a single blocked task aborts the entire
operation with nothing written. The settings-map entry moves (rename) or is
removed outright (delete) via `moveTagSettingsEntry`, with the destination's
existing entry always winning over the source on a rename. Both actions are
confirmed with the exact affected-task count and are undoable via a single
module-level, in-memory, non-persisted snapshot (`tagUndoSnapshot`, app.js)
that replays every task's previous title verbatim and restores the whole
prior settings document — never a reverse rename.

## Step 18 (Recurrence) — done

Implemented exactly per the orchestrator's locked decisions (S18-0–S18-7, see
the Decisions log's step 18 entries below). A task's `recurrence` (S18-1:
`{ kind, ... } | null`, one of `daily`/`weekdays`/`weekly`/`monthly`) is set
via the context menu's "Set recurrence"/"Change recurrence" item
(`handleSetRecurrenceClick`, app.js) — a `prompt()`-based flow, matching this
codebase's existing pattern for a multi-field edit with no dedicated inline
UI (step 17's tag rename is the precedent), rather than a new inline
display/input pair. There is deliberately **no "Stop Recurrence" menu
action** (S18-0 — product-spec.md §5:145-148 rules it out: deleting the task
is what ends a cycle); the editor's own "none" answer is the only way to
clear a rule short of deletion. Setting a recurrence on a task with no due
date defaults it to today (S18-5) so weekly/monthly have a real date to
derive their anchor from (`deriveAnchorFromDate`, recurrence.js) and
daily/weekdays have something to advance from.

Completing a recurring task (the checkbox `change` listener, app.js) branches
on `task.recurrence` **before** the plain `completed: true` write and before
the cascade-complete subtree is even computed (S18-6): it advances `dueDate`
by stepping the rule forward from the current due date **repeatedly until
the result is strictly after today** (`advanceRecurrence`, recurrence.js,
S18-2 — not one step from the old due date, so a task completed several
days late lands on the next *future* occurrence, never staying overdue),
restamps `occurrenceStart` to the moment of the advance (today), and leaves
`completed: false` and `closedByCascadeFrom: null`. Because this branch
`return`s before `buildTree`/`descendantIds` are ever called, a recurring
parent's children are never looked up, let alone touched — verified live
against the real `taskTree.js` (`descendantIds` on a synthetic P1>C1>C2 CAN
find `["C1","C2"]` if asked, proving the walk isn't broken, but the two
children's `completed`/`closedByCascadeFrom` are provably unwritten by this
path). Monthly re-anchors from the **stored** `anchorDayOfMonth` on every
advance, never from the current (possibly already-clamped) due date's own
day-of-month (S18-4) — this is what makes Jan 31 → Feb 28/29 → Mar 31 work
instead of degrading permanently to the 28th. Age (`computeAgeLabel`'s
caller in render.js) now reads `task.occurrenceStart ?? task.createdAt`
(S18-3) — the `?? createdAt` fallback is what keeps every task that has
never recurred byte-identical with no backfill, since `occurrenceStart`
stays `null` until the first advance ever stamps it. No history of past
occurrences is kept anywhere (S18-7) — one task, one document, moving
forward.

## Step 19 (Search — basic) — done

Implemented exactly per the orchestrator's locked decisions (S19-0–S19-10,
see the Decisions log's step 19 entries below). Search is a **filter over
the existing main-view render** (S19-0), never a new screen — a new
`#search-input` in `#main-view`'s toolbar (index.html) feeds a new filter
stage `app.js`'s `renderMainView` runs ahead of every filter it already had
(the deleted filter, the Inbox/main partition, the `showCompleted` toggle,
and Focus's pin filter — S19-5, unchanged and in that order). All of the
actual matching logic lives in a new pure module, `public/searchQuery.js`
(no DOM, no Firestore — same standing as `taskTree.js`/`tagColors.js`),
specifically so step 20 can hang a boolean AND/OR/parentheses grammar over
its `matchesTerm` leaf evaluator (S19-1) without touching render.js or
app.js at all. `matchesTerm(task, term)` (S19-2) is a case-insensitive
substring match over `title + "\n" + note` for a bare word, or a
whole-token case-insensitive equality against `task.tags` for a `#foo`/
`@foo` term (whole-token so `#pr` can never match `#private` — the same
hazard step 17's `rewriteTagInTitle` guards). `matchingTaskIds` (S19-3)
splits the box on whitespace and requires every term to match (implicit
AND); a blank box splits to zero terms, and "every term in an empty list
matches" is vacuously true for every task, which is what makes an empty
search box degrade to "no filtering" with no separate active/inactive flag
anywhere. `expandMatchesWithAncestors` (S19-4) adds every match's ancestor
chain (via `taskTree.js`'s own `buildTree`/`ancestorChain`, not a second
tree walk) to the visible set — a non-matching ancestor renders dimmed via
a new `.task-item--search-context` modifier (the third `.task-item--*`
class, alongside `--completed` and `--reparent-target`); a match's
DESCENDANTS are deliberately NOT pulled in, the one asymmetry S19-4 records
explicitly because it looks like a bug otherwise. Scope is main list +
Inbox + Focus, never Trash or Overdue (S19-6) — all three share the one
`nonDeletedTasks` search stage in `renderMainView`. There is no debounce
(S19-7) — the filter is a pure function over an already-fetched, keyed-
rendered list, and per-keystroke re-render (`#search-input`'s `input`
listener) is exactly what that architecture is for. Search state is
UI-only (S19-8): never sent to Firestore, cleared by Escape
(`#search-input`'s own `keydown` listener, since the box has no per-row
edit lifecycle to route through app.js's shared title/note/due-date Escape
handler) and by sign-out (mirroring `tagUndoSnapshot`'s cleanup in the same
`monitorAuthState` branch). A non-empty box whose query matches nothing
shows `#search-empty-message` ("No tasks match", S19-9) in place of the
lists — gated on the TRIMMED box being non-empty specifically so a
genuinely task-free account doesn't show the same message with an empty
box. No schema, `firestore.rules`, or `firestore.indexes.json` change
(S19-10) — search stores nothing.

## Step 20 (Search — advanced) — done

Implemented exactly per the orchestrator's locked grammar and decisions
(S20-1–S20-11, see the Decisions log's step 20 entries below, which also
carry the full 27-row worked-example table). `public/searchQuery.js` grows
a hand-written recursive-descent parser (`parseSearchQuery`) that turns a
raw query string into an AST — `query := orExpr`, `orExpr := andExpr (OR
andExpr)*`, `andExpr := primary ((AND)? primary)*` (juxtaposition is AND,
S19-3's degenerate case), `primary := sigilGroup | group | term` — and a
tree-walking evaluator (`evaluateNode`, private) that calls step 19's
UNCHANGED `matchesTerm` at every word/tag leaf (S19-1 held: no rewrite was
needed) plus three new leaf kinds (`overdue`, `date`, `age`) at the
temporal ones. AND/OR are case-insensitive keywords (S20-3); a lone
`"and"`/`"or"` in the text can no longer be searched as a literal word,
recorded as an accepted cost rather than a bug. Sigil distribution (S20-4)
pushes a group's sigil onto every bare-word leaf beneath it via one
recursive function (`applySigilDistribution`) with no group-boundary
bookkeeping: a leaf that already carries its own sigil, or one inside a
NESTED sigil group, is never seen as a bare word by the outer distribution
in the first place, because distribution runs immediately when each
sigilGroup's own closing paren is reached (innermost first, by construction
of recursive descent) — and a temporal/age/overdue leaf is classified
during lexing, before distribution ever runs, so `#(private OR overdue)`
can only ever produce `OR(tag(#private), overdue)`, never a manufactured
`tag(#overdue)`. `age` reads `occurrenceStart ?? createdAt` (S20-5),
byte-identical to the row's own displayed age (render.js:792, S18-3) —
resolving spec:178-180's literal "creation date" wording in favor of
agreement with the screen. Day comparisons floor a whole local-calendar-day
difference (the same math `computeAgeLabel` uses, reused as math since that
function returns a string); month comparisons (`age > Nm`/`age < Nm`)
compare against a calendar-month cutoff date with the same end-of-month
clamping `recurrence.js`'s `addMonthsClamped` uses (S20-6, mirrored rather
than imported since that function isn't exported and only steps forward).
`today`/`this week`/`this month` (S20-7) read `dueDate` (never `age`'s
source), compare LOCAL calendar days via `render.js`'s `localMidnight`
(S20-10, imported — `searchQuery.js` importing from `render.js` is not a
cycle, confirmed by reading render.js's own imports before adding this
one), and a task with no due date matches none of them. `this week` reads
the new `weekStart` setting (S20-8) — `'sunday'`/`'monday'` on the EXISTING
`users/{uid}/meta/settings` document `firestore.rules` already validates,
never a `weekStartDay: 0|1` (an earlier, superseded draft) — defaulting to
`'sunday'` when the field is absent, with **no rules change** (confirmed by
re-reading `isValidSettings()` before writing a line of code, not assumed).
A parse error (S20-9) never blanks the list: `matchingTaskIds` now returns
`{ matches, error }` rather than a bare Set (the one shape change to a
step-19 export, necessary to distinguish "invalid query" from "valid query,
zero results"), and `app.js`'s `renderMainView` treats a non-null `error`
as "every task counts as visible" plus un-hiding a new
`#search-error-message` beside the box with the parser's own plain-English
message (never a stack trace). Nothing is persisted beyond `weekStart`
(S20-11): no query history, no saved searches, no new task field, and
`firestore.indexes.json` is untouched.

## Step 21 (Export / import) — done

Implemented exactly per the orchestrator's locked decisions (S21-1–S21-12,
see the Decisions log's step 21 entries below). `public/dataTransfer.js` is a
new module, pure, no DOM and no Firestore, same standing as
`taskTree.js`/`tagColors.js`/`recurrence.js`/`searchQuery.js`: it owns the
file's exact JSON shape (`buildExportPayload`/`stringifyExportPayload`/
`buildExportFilename`), the Timestamp<->ISO-string conversion both directions
share (`serializeTaskForExport`/`deserializeTaskFromImport`, keyed off one
shared `TIMESTAMP_FIELDS` array — S21-3's real hazard, guarded against
drifting the way S21-3 itself warns), and the whole-file validator
(`validateImportPayload`/`parseImportPayload`, S21-7) that runs to completion
and reports every problem found, never just the first. `app.js` owns
everything dataTransfer.js deliberately does not: the download click
(`handleExportClick`, a Blob + object URL + synthetic `<a download>`, S21-4),
the hidden file input (`handleImportClick`/`handleImportFileSelected`, a real
`FileReader`, S21-9), both confirm dialogs, and the
`enqueueMutation`-wrapped `saveTask` loop plus one `saveSettings` call and one
final `refreshTasks()` (S21-8) — the same "click-time plan, re-validate fresh
inside the mutation" shape step 17's tag rename/delete already established.

Export carries every task document verbatim, soft-deleted ones included
(S21-1) — `refreshTasks()` runs first (S21-11) so the file is never up to
five minutes stale, then the payload is built straight from
`getTasks()`/`getTagSettings()`, no separate fetch path. Import is an upsert
by id, never a wipe (S21-5): every task in the file is written by its own id
via `saveTask`; a task in the account but absent from the file is left
completely alone, and the confirm dialog says so in plain words. Settings are
the one asymmetric exception (S21-10): the whole tag-settings document is
REPLACED wholesale via `saveSettings` when the file carries one, since
merging two tag-color maps would produce a state that existed in neither the
file nor the account — a file with no `settings` key leaves the account's
settings untouched. Ids are preserved verbatim (S21-6) — `saveTask` is the
only writer, so `createdAt` survives an import unchanged while `updatedAt`
gets re-stamped to the import time, exactly as it does for every other write
in this app (S21-8's own documented, accepted cost).

Validation happens twice for the same import: once at file-select time
(so the confirm dialog only ever offers an operation that CAN fully
succeed) and once again inside the queued mutation against whatever's
actually in the account by the time it runs — the same "re-read at run
time" architecture rule every other mutation in this file already follows.
A dangling `parentId` (pointing at neither a task in the file nor a task
already in the account) blocks the whole import with zero writes (S21-7);
a `parentId` resolving FORWARD to a later task in the same file is
deliberately accepted (verified directly in step21-verify.mjs), since
S21-6 preserves ids and nothing about file order should matter. On a
write failure mid-loop, the import stops at the first failure, reports how
many tasks actually wrote, and refreshes — no retry, no rollback (S21-8).

One deliberate deviation from S21-3's illustrative code, recorded rather
than silent: import's Timestamp reconstruction uses a plain `new Date(iso)`,
not a constructed `Timestamp.fromDate(new Date(iso))`. Firestore's `setDoc`
already converts a bare JS `Date` into a Timestamp on write — this
codebase's own `taskService.js`'s `addTask` does exactly that for
`dueDate: new Date(taskDetails.dueDate)` — so the document that lands in
Firestore is byte-identical either way; only the construction path differs.
Importing the real `Timestamp` class into `dataTransfer.js` would have
required a `firebase/firestore` import, which this project's browser-only
import map resolves to a CDN URL that plain Node cannot see at all — doing
so would have broken the module's ability to run as the bare Node
verification script this project's only test tooling depends on (no
npm, no bundler, no test runner). Behaviorally identical once written;
noted here rather than assumed acceptable.

**Verified (pure, unsigned-in, exactly as the project's constraints
require):**
- `node --check` passes on every file under `public/*.js`, `dataTransfer.js`
  included.
- `xcheck.mjs`: 98 named imports checked (up from the prior baseline of 92 —
  exactly app.js's six new named imports from `dataTransfer.js`) — CLEAN.
- `step21-verify.mjs` (scratchpad), 35 cases, 0 failed: the full
  Timestamp-field round trip (all five fields, identical millisecond values)
  and the null-stays-null case in both directions; wrong `format`/wrong
  `version` rejected, correct ones with an empty `tasks` array accepted;
  a dangling `parentId` rejected, one resolving to an existing ACCOUNT task
  accepted, one resolving FORWARD to a later task in the same file accepted;
  a 1001-char title, a 10001-char note, and a 7-entry `ancestors` array each
  rejected, with the exact boundary values (1000/10000/6) accepted; a
  `weekStart` of `"tuesday"` rejected, `"monday"` accepted; a structurally
  invalid payload returns `{ ok: false }` synchronously with no exception and
  no write attempted (dataTransfer.js has no Firestore import anywhere —
  grep-confirmed, not assumed); malformed JSON text rejected before
  validation even runs; and a real `buildExportPayload` output round-trips
  through `parseImportPayload` as valid end to end.
- Reachability traced by hand, both directions: `#export-btn` click ->
  `handleExportClick` -> `refreshTasks` -> `buildExportPayload`/
  `stringifyExportPayload` -> Blob/object-URL/`<a download>` click. `#import-
  file-input` `change` -> `handleImportFileSelected` -> `FileReader.readAsText`
  -> `reader.onload` -> `parseImportPayload` -> (confirm) -> `enqueueMutation`
  -> `validateImportPayload` (re-run) -> `saveTask` loop -> `saveSettings` ->
  `refreshTasks`.

**Assumed, not verified — nothing below has ever run in a signed-in
browser, for this step or any prior one (see the standing note at the top
of this file):**
- That an actual signed-in export produces a file Firestore's real Timestamp
  objects serialize correctly through (the round trip above uses a duck-typed
  stand-in with the same `.toDate`/`.toMillis` shape, not the real SDK class —
  the same limitation every prior step's "verified unsigned-in" note carries).
- That `saveTask`/`saveSettings` actually accept the plain-`Date`-valued
  fields `deserializeTaskFromImport` produces, end to end through a real
  `setDoc` call, and that the resulting documents read back with correct
  Timestamps on the next `fetchTasks`/`fetchSettings`.
- That the browser's real `FileReader`/`Blob`/`URL.createObjectURL`/
  `<a download>` APIs behave as coded — none of this can run outside a
  browser, and no browser session against a live Firestore has occurred.
- That importing a file exported from a DIFFERENT account doesn't collide on
  an id in any way not already reasoned about in S21-6's accepted-cost note.
- The "Importing N of M…" progress text actually renders and updates visibly
  during a real multi-hundred-task import (mechanically wired, never watched).

**Files touched (step 21):**
- `public/dataTransfer.js` — **new module.** `EXPORT_FORMAT`/`EXPORT_VERSION`/
  `TIMESTAMP_FIELDS` (S21-2/S21-3); `serializeTaskForExport`/
  `buildExportPayload`/`stringifyExportPayload`/`buildExportFilename` (export
  side, reusing render.js's `timestampToDate`/`formatDateForInput` rather than
  a second copy of either — the same "import a single pure function from
  render.js creates no cycle" precedent S20-10 already established for
  `localMidnight`); `deserializeTaskFromImport` (import side);
  `validateImportPayload`/`parseImportPayload` (S21-7, the whole-file
  pre-write check).
- `public/app.js` — imports six named exports from `dataTransfer.js`;
  `exportBtn`/`importBtn`/`importFileInput`/`IMPORT_BTN_LABEL` DOM refs and
  their three listeners (mirroring `weekStartSelect`'s "static single
  control, own listener" precedent, S21-9); `handleExportClick` (S21-4/
  S21-11); `handleImportClick`/`handleImportFileSelected` (S21-5/S21-7/
  S21-8 — the confirm dialog, the re-validate-inside-the-mutation step, the
  sequential `saveTask` loop with visible `Importing N of M…` progress, the
  conditional `saveSettings`, and the final `refreshTasks`).
- `public/index.html` — `#data-portability`/`#export-btn`/`#import-btn`/
  `#import-file-input` (hidden), placed on the existing Tag Settings screen
  (S21-9, no new view) between the week-start `<select>` and `#settings-list`;
  matching CSS.
- No change to `public/taskService.js`, `public/settingsService.js`,
  `public/store.js`, `firestore.rules`, or `firestore.indexes.json` (S21-12)
  — every write still goes through the existing `saveTask(uid, task)`/
  `saveSettings(uid, settings)` whole-document paths, unmodified; nothing
  about export/import is persisted as a new field, and nothing this step adds
  needed a rules change to already pass `isValidTask()`/`isValidSettings()`
  (both re-read in full before writing dataTransfer.js's validator, not
  assumed).
- No change to `FIREBASE.md` — step 21 introduces no new stored field, no
  rules change, and no schema change for that file to describe.

## Resume here — everything is implemented; a signed-in walkthrough is next

**All 21 planned steps are now built.** There is no step 22 in the plan.
What remains is exactly what every prior step's "Resume here" section has
deferred and this one inherits in full:

1. **Run the click-path below in an actual signed-in browser.** This has
   never happened for ANY step in this project — every "verified" note above
   and throughout this file means "verified unsigned-in, by driving the real
   modules directly against synthetic data," never "seen working end to end
   with a real Google sign-in against live Firestore." Step 21 adds its own
   two items to this same click-path (see the new step 17 at the end of the
   numbered list below): exporting a real account's data to a file, and
   importing it back in (including onto a second account, to see the
   upsert-by-id/settings-replace behavior S21-5/S21-10 describe actually
   happen against live data rather than synthetic tasks).
2. The two items already tracked in "Open items (not steps)" below — the
   broken `firebase-hosting-merge.yml` CI workflow (`npm ci && npm run
   build` with no `package.json` in this repo, and a push to `main` is a
   production deploy) and `FIREBASE.md`'s stale "Security rules — three-way
   mismatch" section — are both still open and unrelated to any step's
   feature work; neither blocks the walkthrough above.

```bash
nvm use 24.14.1 && firebase serve --only hosting --port 5050
```

**Hard-reload the page (Cmd+Shift+R) before testing.** `firebase serve` sends no
`Cache-Control` header, so the browser heuristically caches the ES modules and will
happily run a stale `store.js` against a fresh `app.js`. That failure mode looks like
a bogus `does not provide an export named ...` error and cost real time once already.

**No step has been confirmed in a signed-in browser yet.** Everything below marked
"verified" was verified unsigned-in, by driving the real modules with synthetic
tasks. Run the click-path first; it doubles as the regression check whenever a later
step touches editing, deletion, hierarchy, the Inbox, or completion.

```bash
nvm use 24.14.1 && firebase serve --only hosting --port 5050
```

**Hard-reload the page (Cmd+Shift+R) before testing.** `firebase serve` sends no
`Cache-Control` header, so the browser heuristically caches the ES modules and will
happily run a stale `store.js` against a fresh `app.js`. That failure mode looks like
a bogus `does not provide an export named ...` error and cost real time once already.

**Click-path to walk:**
1. Add a task → it appears.
2. Tick it complete → it disappears. Check "show completed" → it reappears struck
   through. Untick → it hides again.
3. Click a title → it becomes editable. Change the text, including adding a `#tag`,
   press Enter → the title updates and the tag is re-parsed.
4. Click the note area → type two lines and a bare URL like `http://example.com`,
   click away → the note shows both lines and the URL is a working link.
5. Clear a title completely and click away → an alert says the edit was discarded and
   the row closes (it must NOT trap you in a repeating alert).
6. "+ Subtask" on a task → the child renders indented under it. Nest to 7 levels →
   the 8th is refused with a readable message, not a permission error.
7. Cascade-complete a parent with a few levels of children (ticking it closes the
   whole subtree), then untick it → every descendant the cascade actually closed
   reopens, at any depth. A descendant you had completed by hand *before* ticking
   the parent stays completed after unticking it.
8. Right-click a task row (or long-press on a touch device) → a menu appears at
   the pointer with Add subtask / Delete, plus Move out of Inbox only for an
   Inbox row. Escape closes it; clicking anywhere else closes it too. Delete from
   the menu on a task with sub-tasks → confirm names the task and the sub-task
   count, then the whole subtree disappears together, not just the one row.
9. Reload the page → every change above survived.
10. Delete a task with a couple of sub-tasks, confirm the cascade count, then click
    Trash → all the deleted tasks show up as separate rows, newest first, with a
    count against "of 50". Click Restore on the parent → it and its sub-tasks come
    back together; a task you deleted separately earlier stays in the trash.
    Restore a task whose parent is still in the trash → a warning names the
    top-level placement before it proceeds.
11. Grab a task's drag handle (the `⠿` at the left of the row, not the row itself)
    and drop it above or below a sibling → the list re-orders and the change
    survives a reload. Try dragging it onto a task in the *other* container
    (Inbox vs. main list) → nothing happens, no matter where you release it.
    Press Escape mid-drag → the drag cancels and nothing moves. Press and hold the
    drag handle for over half a second without moving → the context menu must NOT
    open (only a plain right-click or long-press *off* the handle opens it).
12. Drag a task by its handle and hover the *middle* of an unrelated task's row
    (not its top/bottom edge) → an orange outline highlights that row instead of
    the thin blue insertion line; drop it there → the dragged task (and its whole
    subtree) becomes a child of that row, filed under it in the tree, and — if the
    target is in the Inbox or out of it — the whole subtree's Inbox membership
    follows the target. Try hovering the middle of the dragged task's own
    descendant, or its current parent → no highlight ever appears, no matter where
    you release. Right-click a task that has a parent → "Move to top level" appears
    in the menu (absent for a task with no parent); choosing it promotes the task
    (and its subtree) to the root of the main list, keeping its Inbox membership
    exactly as it was.
13. Click a task's due-date area (it reads "No due date" until set) → an inline
    date picker opens; pick a date and click away → the row shows "Due: <date>"
    (or "Overdue: <date>" in red/orange if that date is in the past) and the task's
    age (e.g. "5 days old") appears beside it. Right-click the task → "Change due
    date" (label was "Set due date" before) and "Clear due date" both appear;
    choosing "Clear due date" removes it without opening the editor. Click
    "Overdue" (next to Trash) → every task due before today, and only those,
    appears there — one due today or in the future does not, and neither does a
    completed or deleted task that was overdue before that state changed — in the
    same relative order they hold in the main list. Reload the page → the due date,
    its Overdue-screen membership, and the age all survive.
14. Add a task whose title is Hebrew with TWO English tags separated by Hebrew
    words, e.g. `לסיים את הדוח #urgent לפני הפגישה @office`. Click "Tag
    settings" (next to Overdue) → both tags are listed, each with a Text and a
    Background swatch. Give `#urgent` a red background and `@office` a green
    one, then click Back → **the task's whole row is GREEN**, because `@office`
    is the tag typed LAST in the string even though it renders furthest LEFT on
    screen. Edit the title to swap the two tags' positions and press Enter →
    the row turns red, with no other action needed. Add a third tag with no
    colors assigned at the very end of the title → the row STAYS red/green
    (the last *colored* tag still wins; an uncolored tag never strips a
    color). A task carrying no colored tag at all renders in the default blue.
    Back on "Tag settings", press "Clear colors" on a tag → its tasks fall back
    to blue and the swatch row shows a dashed outline. Delete every task
    carrying a tag that still has colors → that tag is STILL listed on the
    settings screen (so its color is not silently orphaned). Reload the page →
    every color assignment survives.
15. Give a task a due date, then right-click it → "Set recurrence" → type
    `daily` → the row gains a "🔁 Daily" badge next to its age. Tick its
    checkbox complete → it does NOT disappear (a recurring task never shows
    as completed) and its due date and age both advance to reflect the next
    occurrence — the checkbox itself un-checks on the refresh. Give a task a
    recurrence with a couple of open sub-tasks, tick the PARENT complete →
    the parent advances exactly as above and the sub-tasks stay open and
    untouched (no cascade). Right-click the recurring task again → the item
    now reads "Change recurrence"; typing `none` clears it — the badge
    disappears and completing the task now behaves like any ordinary task
    again (cascades, disappears when done). Reload the page → the recurrence
    rule, the advanced due date, and the reset age all survive.
16. Give a task a `#private` tag and a sub-task under it with a plain title.
    Type `private` into the new search box (top of the main view) → both the
    parent (a real match, via the tag text sitting in its own title) and the
    still-visible sub-task's tree position are unaffected; now search
    `#private` instead → same result (tag search finds it too). Search a
    word that only a deeply-nested sub-task's title contains → that sub-task
    shows, and every one of its ancestors up to the root shows too, dimmed
    (they render slightly faded — that's `.task-item--search-context`); a
    SIBLING of that sub-task, and the matching sub-task's own children, do
    NOT appear. Search two words separated by a space → only tasks matching
    BOTH show (typing a second word narrows the list further, never
    broadens it). Search something no task contains → the lists disappear
    and "No tasks match" appears in their place; clear the box (or press
    Escape while it's focused) → the full list returns instantly. Tick
    "Show completed" on and off while a search is active → the completed
    toggle still works exactly as it does with an empty search box. Pin a
    task, then search something it doesn't match → it drops out of Focus
    too. Sign out with text still in the search box, sign back in → the box
    is empty.
17. Click "Tag settings" → "Export to JSON file" → a file named
    `todo-manager-export-YYYY-MM-DD.json` (today's LOCAL date) downloads;
    open it → it's pretty-printed JSON with `"format":
    "todo-manager-export"`, `"version": 1`, a `tasks` array covering every
    task including anything currently in the Trash, and a `settings` object.
    Click "Import from JSON file" and pick that same file back → a dialog
    names the task count and says existing tasks with matching ids will be
    overwritten and everything else left untouched, plus that tag
    colors/quadrants/week-start will be replaced; confirm it → the button
    reads "Importing N of M…" and disables itself while it runs, then the
    screen refreshes with nothing visibly changed (a same-account
    round-trip import is a no-op, per S21-5/S21-6). Edit a task's title,
    re-import the SAME (now-stale) file → that edit is silently overwritten
    back to the file's version, while a task created AFTER the export
    (absent from the file) is left completely alone. Hand-edit the
    downloaded file to change `"format"` to something else (or delete the
    `"version"` key) and try importing it → the import is refused with a
    message naming the problem, and re-check that nothing changed. Hand-edit
    a task entry to set `"parentId"` to a made-up id that matches nothing in
    the file or the account → import is refused naming that task, and
    nothing is written. Sign into a SECOND account and import the first
    account's export file → the second account gains all the first
    account's tasks (new ids to it, so nothing to overwrite) and its tag
    settings are replaced wholesale by the file's.

**Files touched (steps 1–4):**
- `public/taskService.js` — renamed from `todoService.js`; `addTask`, `fetchTasks`,
  `saveTask`, `softDeleteTask`; whole-document `setDoc`; `normalizeTask()` backfills
  `deleted`/`pinned`/`inInbox`/`ancestors`/`updatedAt`/`order`/`note`/`deletedAt`.
- `public/store.js` — state, the 5-minute timer, the interaction guard, and
  `enqueueMutation` (the mutation queue).
- `public/taskTree.js` — pure `buildTree`/`descendantIds`/`ancestorChain`/`depthOf`,
  cycle-safe. First real callers landed in steps 3 and 4.
- `public/render.js` — keyed re-render; `compareSiblings` (the seam step 16 replaces)
  + `flattenTree`; `reconcileChildren` (focus-preserving); the note linkifier.
- `public/app.js` — orchestrator: delegated `change`/`click`/`keydown`/`focusout`
  listeners, `parseTags`, the `openEdits` set, all mutations routed through the queue.
- `public/index.html` — task ids, "show completed" toggle, depth indent CSS, edit and
  note styling.
- `FIREBASE.md` — schema table updated for `note`, `parentId`, `ancestors`,
  `deletedAt`, `inInbox` and the title/tags relationship.

**Files touched (steps 9–10):**
- `public/app.js` — the `trash`/`main` view dispatch and `switchView`; the Trash
  screen's `renderTrashView`, `compareTrashNewestFirst`, `selectPurgeCandidates`
  (both exported for verification); `handleDeleteClick`'s 50-cap purge and
  `handleRestoreClick`'s stamp-filter restore; the drag state machine
  (`beginDrag`/`updateDragTarget`/`finishDrag`/`cancelDrag`), the shared
  `dropIndicator`, `computeReorderOrder` (exported for verification), and the
  drag-handle branch in the `pointerdown` listener that skips the long-press
  timer entirely.
- `public/render.js` — `renderTrash` and its own small `trashEntriesByTaskId`
  map; the per-row `.task-item__drag-handle` added in `createTaskElement`.
- `public/taskService.js` — `purgeTask`, the only `deleteDoc` in the codebase.
- `public/index.html` — `#trash-view`/`#trash-btn`/`#trash-back-btn`/`#trash-list`
  /`#trash-count`; `.task-item__drag-handle` and `.drop-indicator` styling
  (`touch-action: none` on the handle is load-bearing, not decorative).

**Files touched (step 11):**
- `public/app.js` — `drag.target`'s discriminated shape (`{ type: 'sibling', ... }`
  / `{ type: 'reparent', parentId }`); `updateDragTarget`'s three-zone hit test
  (top/bottom 25% sibling-only, middle 50% reparent-onto-anything-valid);
  `isValidReparentTarget` (live-drag wrapper) plus the pure, exported
  `canReparent`/`computeSubtreeHeight`/`rewriteDescendantAncestors` (D3/D4/D5,
  verification-only exports, same precedent as `computeReorderOrder`); the
  shared `performReparent` handler both the drop and the new "Move to top
  level" menu item route through; `showReparentHighlight`/`hideReparentHighlight`
  for the middle-zone row highlight; `beginDrag`'s tree/descendant-set/subtree-
  height snapshot; the `taskMenuMoveToTopItem` visibility toggle and its
  `move-to-top` dispatch branch.
- `public/index.html` — the `.task-item--reparent-target` outline style (an
  `outline`, not a `border`, so it never shifts the row's own height and moves
  the 25/50/25 zone boundaries out from under the next pointermove); the "Move
  to top level" menu button.
- `FIREBASE.md` — `parentId`/`ancestors`/`order`/`inInbox` rows corrected to
  note step 11 also writes them (previously documented as create-time-only or
  step-10-only).

**Files touched (step 12):**
- `public/render.js` — a third, separate `focusEntriesByTaskId` Map (D4,
  parallel to `trashEntriesByTaskId`'s existing precedent), never merged with
  the main `entriesByTaskId` Map; `renderTasks`'s signature grew a
  `focusContainer` parameter (`{ element, tasks } | null`) rendered inside the
  SAME call via the flat branch (D1/D2: `sortTasks`, no `buildTree`/`depthOf`,
  every row at depth 0) with its own seen-set/cleanup pass; the title/note
  edit-mode functions (`beginTitleEdit`/`endTitleEdit`/`getTitleInputValue`/
  `setTitleInputValue` and the note equivalents) were refactored into
  map-parameterized `*In(map, taskId)` helpers with thin wrappers, plus new
  `*Focus` exports (`beginTitleEditFocus`, `endTitleEditFocus`,
  `getTitleInputValueFocus`, `setTitleInputValueFocus`, and the four note
  equivalents) addressing the Focus row's own independent entry.
- `public/app.js` — `focusSection`/`focusList` DOM refs and the
  `taskMenuTogglePinItem` menu-item ref; `renderMainView`'s `focusTasks`
  filter (`pinned && !completed`) and `focusSection.hidden` toggle (D8);
  `handleTogglePinClick` (D7, the shared pin/unpin handler, one
  `enqueueMutation`-wrapped `saveTask`); the checkbox `change` listener's
  completing branch now writes `pinned: false` on both the clicked task AND
  every cascade-closed descendant (D5); `openTaskMenuForTask` now toggles the
  pin item's visibility (hidden if completed) and label (per current
  `pinned`); the `taskMenu` click dispatch gained the `toggle-pin` action; the
  click-to-edit listener and the `focusout` commit/cancel listener both gained
  an `isFocusRow` branch (`li.closest("#focus-list")`) so they address the
  correct one of a pinned task's two independent `<li>`/edit-state pairs,
  including the `openEdits` key growing a `:focus` suffix for that row.
- `public/index.html` — `#focus-section`/`#focus-list` (hidden by default,
  placed above `#inbox-section` per D8), its CSS (mirrors `#inbox-section`'s),
  and the `data-action="toggle-pin"` menu button (mirrors step 11's
  "Move to top level" pattern).
- No change to `firestore.rules`, `firestore.indexes.json`, or
  `taskService.js` — `pinned` was already a validated, normalized field
  (step 1); step 12 is the first thing to ever write `true` (D10).

**Files touched (step 13):**
- `public/render.js` — new date/age/overdue helpers, all pure and exported
  for verification: `localMidnight`, `parseDateInputToLocalMidnight`/
  `formatDateForInput` (D2's paired local-midnight conversions, each with a
  comment on the UTC bug it avoids), `isOverdueTask` (D3), `computeAgeLabel`
  (D7), and `computeMainListOrderIndex` (D5, hoisted out of `renderTasks`'s
  own body — `renderTasks` now calls it too, so Focus and Overdue share
  literally one implementation, not two that could drift). `overdueEntriesByTaskId`
  is a third per-container Map (parallel to `focusEntriesByTaskId`/
  `trashEntriesByTaskId`); `createTaskElement`/`updateTaskElement` grew a
  due-date display/input pair (same skip-while-editing guard as title/note)
  and an always-recomputed age span. `CONTEXT_MAPS` grew the `"overdue"`
  entry (D6 — the one-line addition issue 2's fix was designed for) alongside
  a due-date edit-mode function set (`beginDueDateEdit`/`endDueDateEdit`/
  `getDueDateInputValue`/`setDueDateInputValue`) matching title/note's
  map-parameterized shape exactly. `renderOverdue` (D4) is a new exported
  function, structurally a hybrid of `renderTasks`'s Focus branch (full
  `createTaskElement`/`updateTaskElement` rows, flat, depth 0) and
  `renderTrash`'s standalone-screen shape (its own seen/cleanup pass, called
  from app.js's own view-render path, never from `renderTasks`).
- `public/app.js` — `contextForRow(li)`/`fieldSuffixForContext(context)`
  replace step 12's boolean `isFocusRow` at every call site (click-to-edit,
  focusout commit, context-menu open), generalizing two row-contexts to
  three. `views.overdue`/`renderOverdueView` (D1/D4, the Trash-precedent view
  dispatch — a THIRD `currentView` panel); `switchView` grew the
  `overdueView.hidden` toggle. `openTaskMenuForTask` grew a `context`
  parameter stashed on `taskMenu.dataset.context` (read by the menu's click
  dispatch before `closeTaskMenu()` clears it, mirroring how `taskId` is
  already read) so "Set/Change due date" opens the inline editor on the
  correct one of a task's up-to-three rows; both call sites that open the
  menu (a real `contextmenu`, and the long-press timer) now pass
  `contextForRow(li)` through. Two new menu-action handlers:
  `handleEditDueDateMenuClick` (no mutation — just opens the same inline
  editor a direct click on the due-display does) and `handleClearDueDateClick`
  (D9, an immediate one-shot `enqueueMutation`-wrapped `saveTask` writing
  `dueDate: null`, same shape as step 12's `handleTogglePinClick`). The
  `focusout` listener's title/note `if/else` grew a third `else` branch for
  the due-date input, parsing via `parseDateInputToLocalMidnight` and writing
  a whole-document `saveTask` (D9) — never `updateDoc`. The `keydown`
  listener now also treats Enter-on-the-due-input as a commit (blur), same as
  title.
- `public/index.html` — `#overdue-btn`/`#overdue-view`/`#overdue-back-btn`/
  `#overdue-count`/`#overdue-list` (D4, mirroring `#trash-view`'s exact
  structure, nested inside `#task-section` for the same shared-listener
  reason); `.task-item__meta`/`.task-item__due-display`/
  `.task-item__due-display--overdue`/`.task-item__due-input`/`.task-item__age`
  CSS (a full-width row below the note, mirroring the note row's own
  layout); two new context-menu buttons, `data-action="edit-due-date"` and
  `data-action="clear-due-date"` (D10).
- `FIREBASE.md` — the `dueDate` schema-table row rewritten (it no longer
  reads "not yet supplied by the UI"); the stale "Unused document fields"
  open item corrected to drop `dueDate` from the list.
- No change to `firestore.rules` or `firestore.indexes.json` (D8) —
  `isValidTask()` (confirmed by reading it, not assumed) never mentions
  `dueDate`, so every write this step adds already passed rules before this
  step existed.

**Files touched (step 14):**
- `public/tagColors.js` — **new module**, pure, no DOM and no Firestore, same
  standing as `taskTree.js`. `parseTags` MOVED here from app.js (D2: the color
  resolver needs the identical rule, and step 2's decision is that exactly one
  place decides what counts as a tag — a second regex would be a second
  answer). Plus `readTagColors` (per-entry color validator, `#rrggbb` both
  halves or nothing), `normalizeTagSettings` (D10), `resolveTagColor` (D2 — the
  last-colored-tag winner, carrying the D8 comment telling step 15 not to reuse
  it), `collectTagNames` (D5's union), and `DEFAULT_TAG_FG`/`DEFAULT_TAG_BG`.
- `public/settingsService.js` — **new module**, mirroring `taskService.js`'s
  shape and both its rules (whole-document `setDoc`, normalize on read).
  `fetchSettings`/`saveSettings` against `users/{uid}/meta/settings` (D1) —
  the first code in this repo to touch the `meta` collection at all.
- `public/store.js` — the `tagSettings` cache the architecture always specified
  lived here (D9): `getTagSettings`/`setTagSettings`, initialized to
  `{ tags: {} }`, and cleared by `invalidate()` on sign-out for exactly the
  reason `tasks` is (a signed-out session holding the previous user's color map
  would repaint the NEXT user's rows from it).
- `public/render.js` — `updateTaskElement`'s two `task.colors` lines (whose own
  comment named this step) replaced with `resolveTagColor(task.title,
  tagSettings)`; **no colored tag CLEARS the inline properties** rather than
  writing a hardcoded pair, so index.html's `.task-item` rule is the single
  owner of the default look (D3). `tagSettings` is threaded in as a parameter
  on `renderTasks`/`renderOverdue`/`updateTaskElement` rather than imported —
  render.js must not import store.js, the same module boundary that makes
  `onEditCancelled` a callback. New `renderSettings`/`createSettingsElement`/
  `updateSettingsElement` and a fifth Map, `settingsEntriesByTagName` — the
  first container in this file keyed by something other than a task id, and
  deliberately NOT wired into `CONTEXT_MAPS` (those are row-shaped,
  task-addressed, edit-capable containers; a settings row is none of those).
- `public/app.js` — `parseTags` moved out (now imported from tagColors.js);
  `views.settings`/`renderSettingsView` and the `settingsView.hidden` toggle in
  `switchView` (D4, the fourth `currentView` panel, Trash/Overdue's precedent
  for the third time); `refreshTasks` now fetches tasks and settings together
  via `Promise.all` and calls `setTagSettings` (D9); `updateTagSettings` (the
  one settings write path — whole-document `saveSettings` through
  `enqueueMutation`, current map re-read inside the mutation, `finally { await
  refreshTasks(); }`) with `handleTagColorChange` and `handleTagClearColors` on
  top of it; a `.tag-setting__color` branch in the delegated `change` listener
  and a `.tag-setting__clear-btn` branch in the delegated `click` listener,
  both placed BEFORE the code that requires a `data-task-id`; the `colors:`
  literal removed from both `addTask` call sites (D3); and the `contextmenu`
  /`pointerdown` listeners tightened from `closest("li")` to
  `closest("li")?.dataset.taskId` so a settings row can't swallow a right-click
  into a menu that then refuses to open.
- `public/taskService.js` — `addTask` no longer writes a `colors` field (D3).
  Existing documents keep theirs as a now-dead field, deliberately not
  migrated: this repo has no migration tooling, `isValidTask()` never mentions
  the field, and nothing reads it (`grep -rn "\.colors" public/*.js` returns
  only two comment lines).
- `public/index.html` — `#settings-btn`/`#settings-view`/`#settings-back-btn`/
  `#settings-count`/`#settings-list` (mirroring `#overdue-view`'s exact
  structure, nested inside `#task-section` for the same shared-listener
  reason); `.tag-setting*` CSS; and `color`/`background-color` added to the
  `li.task-item` rule — the default row style now lives in CSS instead of being
  a hardcoded fallback inside render.js.
- `FIREBASE.md` — the `colors.foreground`/`colors.background` schema rows
  rewritten as one "no longer written" row, and a new `users/{uid}/meta/
  settings` document-shape section added (the file previously described no
  `meta` document at all, since nothing had ever written one).
- No change to `firestore.rules` or `firestore.indexes.json` (D6) —
  `isValidSettings()` (read in full, not assumed) accepts any `tags` map with
  <= 500 keys and does not constrain entry shape, so every write this step adds
  already passed rules before this step existed. The rules file has had a
  `users/{userId}/meta/{docId}` match block since before step 1; step 14 is
  simply the first client code to use it.

**Files touched (step 15):**
- `public/tagColors.js` — a whole new section, pure, alongside the existing
  color functions: `QUADRANT_URGENT_IMPORTANT`/`QUADRANT_IMPORTANT_ONLY`/
  `QUADRANT_URGENT_ONLY`/`QUADRANT_NEITHER` (Q1's four exact enum strings) and
  `QUADRANT_OPTIONS` (the settings `<select>`'s option order); `readTagQuadrant`
  (Q5 — mirrors `readTagColors`'s null-on-anything-invalid shape exactly);
  `resolveTaskQuadrant` (Q2/Q4 — the independent-OR-across-configured-tags
  resolver, resolved from the title via `parseTags`, never from the cached
  `tags` array — D12's precedent; returns `null`, distinct from
  `QUADRANT_NEITHER`, when no tag is configured); `quadrantRank` (Q3 — the
  0..4 order, exported so step 16 only imports it); `describeQuadrant`/
  `quadrantBadgeText` (the task-row badge's full label and compact token).
  Internal `decomposeQuadrant`/`composeQuadrant` do the enum-to-booleans and
  back conversion and are not exported — nothing outside this module needs
  urgency/importance as separate values, since Q1 forbids storing them
  separately.
- `public/render.js` — `createSettingsElement` grows a `<select
  class="tag-setting__quadrant">` (blank "Not set" option plus the four
  `QUADRANT_OPTIONS`, each labeled via `describeQuadrant`);
  `updateSettingsElement` resyncs its value from `readTagQuadrant` on every
  render, same "always resync, no editing-state guard" rule the color inputs
  already follow. `createTaskElement` grows a `.task-item__quadrant-badge`
  span in the existing `.task-item__meta` row (next to the age span), starting
  hidden; `updateTaskElement` resolves `resolveTaskQuadrant(task.title,
  tagSettings)` on every render (same "recomputed fresh from the title, never
  stored" rule due-date/age already follow) and shows the badge (text +
  `title` attribute) only when a quadrant actually resolves, hiding it
  entirely — not emptied-but-visible — otherwise (Q6). `compareSiblings` and
  every sort path are **untouched** (Q7 — verified by `git diff`, no match).
- `public/app.js` — `handleTagQuadrantChange` (a sibling of
  `handleTagColorChange`, through the same `updateTagSettings(mutate,
  message)` helper, same whole-document `enqueueMutation`+`saveSettings`+
  `finally refreshTasks()` shape), spreading the existing entry so a quadrant
  change never drops a tag's colors; a `.tag-setting__quadrant` branch in the
  delegated `change` listener, placed alongside the existing
  `.tag-setting__color` branch (both still before the code that requires a
  `data-task-id`, per step 14's D4 precedent).
- `public/index.html` — `.task-item__quadrant-badge` CSS (a small pill in the
  existing meta row) and `.tag-setting__quadrant` CSS (the new `<select>`,
  styled as one more field in the settings row's existing flex layout).
- No change to `firestore.rules` or `firestore.indexes.json` — `isValidSettings()`
  (re-confirmed, not re-read from scratch — step 14 already read it in full)
  constrains only `weekStart`'s value and `tags`'s type/key-count, never entry
  shape, so a `quadrant` key inside an entry passes exactly as `fg`/`bg` do.
  `weekStart` itself is still never written (that's step 20's field). No
  change to `settingsService.js` or `store.js` — the whole-document write path
  and the `tagSettings` cache already carried this without modification.

**Files touched (step 17):**
- `public/tagColors.js` — a new "Tag rename/delete" section: `rewriteTagInTitle`
  (S17-4, offset-based `matchAll` substitution, never a bare string replace —
  the prefix hazard `#work`/`#workshop` is impossible by construction since
  it filters matches by exact token equality); `planTagRewrite` (S17-5, the
  whole-batch 1–1000 char pre-check, shared by rename and delete); the
  private `TAG_TOKEN_PATTERN`/exported `isValidTagToken` (rename-input
  validation, one definition of "what a tag looks like" shared with
  `parseTags`/`TAG_PATTERN`); `moveTagSettingsEntry` (S17-6/S17-7, the
  settings-key move/removal, destination-wins on a rename).
- `public/app.js` — the module-level `tagUndoSnapshot` (S17-1/S17-3, the one
  in-memory undo slot, cleared alongside `invalidate()` in the sign-out
  path); `handleTagRenameClick`/`handleTagDeleteClick` (prompt/confirm →
  click-time `planTagRewrite` → confirm naming the exact count (S17-9) →
  `enqueueMutation` → a fresh run-time `planTagRewrite` → the snapshot taken
  BEFORE the first write (S17-8) → a sequential `saveTask` loop, the exact
  idiom step 8's cascade delete established → `saveSettings` moving/removing
  the settings entry → `finally { refreshTasks() }`); `handleTagUndoClick`
  (S17-2/S17-3, replays `previousTitle` verbatim per task and restores
  `previousTagSettings` wholesale, consuming the slot on entry regardless of
  outcome); two new branches in the delegated `click` listener
  (`.tag-setting__rename-btn`/`.tag-setting__delete-btn`), placed alongside
  the existing `.tag-setting__clear-btn` branch, before the code that
  requires a `data-task-id`; `renderSettingsView` grew the Undo button's
  `hidden`/text sync.
- `public/render.js` — `createSettingsElement` grows two buttons, Rename and
  Delete, appended after the quadrant `<select>` (no listeners of their own —
  same event-delegation rule as every other settings-row control).
- `public/index.html` — `.tag-setting__rename-btn`/`.tag-setting__delete-btn`
  CSS (styled apart from `.tag-setting__clear-btn`, which never touches the
  tag itself); `#settings-undo-btn` (hidden by default, an amber button
  above `#settings-list`) and its CSS.
- No change to `public/taskService.js`, `firestore.rules`, or
  `firestore.indexes.json` — every write is still a whole-document `saveTask`/
  `saveSettings`, no different in shape from every other mutation in this
  app, and the settings entry's shape is unchanged (rename/delete only ever
  move or remove a whole entry, never touch its internal fields).

**Files touched (step 18):**
- `public/recurrence.js` — **new module**, pure, no DOM and no Firestore, and
  deliberately **no imports at all** (same standing as `taskTree.js`) even
  though its arithmetic needs a local-midnight construction identical to
  render.js's own `localMidnight` — importing that back would create a
  render.js ↔ recurrence.js cycle (render.js's row badge wants this file's
  `describeRecurrence`), so `localMidnightOf` here is a deliberate one-line
  duplicate instead. `advanceRecurrence` (S18-2, "step forward until strictly
  after today," never one step from the old due date) is the one export
  every other piece of this step's logic sits behind; `stepOnce`/`addDays`/
  `nextWeekday`/`addMonthsClamped` are its private per-kind mechanics.
  `addMonthsClamped` re-derives the target day from the passed-in
  `anchorDayOfMonth` on every call, never from the date being advanced (S18-4
  — Jan 31 → Feb 28/29 → Mar 31, not a permanent degrade to the 28th).
  `deriveAnchorFromDate` (S18-5) turns a concrete anchor date into a weekly
  rule's `anchorDay` or a monthly rule's `anchorDayOfMonth`, called once at
  setup time, never re-derived on a later advance. `describeRecurrence` is
  the one wording function shared by render.js's row badge and app.js's
  menu label/prompt default. `parseWeekdaysInput` validates a comma-separated
  prompt answer into a de-duplicated, sorted `0..6` array or `null`.
- `public/taskService.js` — `normalizeTask` grows the S18-1 defaults:
  `recurrence: task.recurrence ?? null`, `occurrenceStart: task.occurrenceStart
  ?? null`. `addTask` is untouched — a brand-new task never starts recurring,
  so there is nothing to write at creation (same reasoning as step 14's D3
  not writing a then-dead `colors` field).
- `public/render.js` — `timestampToDate` is now **exported** (previously
  private) so recurrence.js's callers (app.js) and this file's own badge
  logic share one Timestamp-vs-Date unwrap. `computeAgeLabel`'s one call site
  in `updateTaskElement` now passes `task.occurrenceStart ?? task.createdAt`
  instead of `task.createdAt` alone (S18-3) — `computeAgeLabel` itself is
  unchanged. `createTaskElement`/`updateTaskElement` grow a
  `.task-item__recurrence-badge` span (same "hidden entirely rather than
  emptied-but-visible when absent" rule as the step 15 quadrant badge),
  showing `describeRecurrence(task.recurrence)` (imported from
  recurrence.js) whenever a rule is set. This is the one new edge into
  recurrence.js from this file; recurrence.js itself has no edge back.
- `public/app.js` — imports `advanceRecurrence`/`deriveAnchorFromDate`/
  `describeRecurrence`/`parseWeekdaysInput`/`RECURRENCE_KINDS` from
  recurrence.js, and `timestampToDate`/`localMidnight` from render.js (newly
  needed here). `taskMenuSetRecurrenceItem` (mirrors the due-date items'
  ref pattern); `openTaskMenuForTask` toggles its label per
  `task.recurrence` (D10 precedent — "Set recurrence"/"Change recurrence"),
  always shown (never hidden — even a task with no due date can open the
  editor, which defaults one). `handleSetRecurrenceClick` (S18-0's "none" is
  the only stop, prompt-based like step 17's tag rename): prompts for a kind,
  a second prompt for `weekdays`' day set, then one `enqueueMutation`-wrapped
  `saveTask` that re-reads the task at run time, defaults a missing due date
  to today (S18-5) before deriving weekly/monthly's anchor, and writes the
  rule. The checkbox `change` listener's completing branch gained a
  `if (task.recurrence)` branch (S18-6, locked) inserted **before** the
  cascade's `buildTree`/`descendantIds` calls and the plain
  `completed: true` write — it advances `dueDate` via `advanceRecurrence`,
  restamps `occurrenceStart` to the moment of the advance (not to the new,
  possibly-far-future due date), and writes `completed: false`,
  `closedByCascadeFrom: null`, then returns — the cascade code is
  syntactically unreachable from this branch, not merely skipped by a
  runtime check.
- `public/index.html` — the context menu's "Set recurrence" button
  (`data-action="set-recurrence"`, placed before Delete, after the due-date
  items — S18-0's comment on why there is no separate "Stop recurrence"
  item); `.task-item__recurrence-badge` CSS (identical pill shape to
  `.task-item__quadrant-badge`, in the same meta row).
- No change to `firestore.rules` or `firestore.indexes.json` (S18-1,
  confirmed by reading `isValidTask()`, not assumed) — it has no `hasOnly`
  clause and mentions neither `recurrence` nor `occurrenceStart`, so both
  fields write exactly as freely as `dueDate` already does.

**Files touched (step 19):**
- `public/searchQuery.js` — **new module**, pure, no DOM and no Firestore,
  same standing as `taskTree.js`/`tagColors.js`/`recurrence.js`.
  `matchesTerm` (S19-2, the one leaf evaluator step 20 reuses verbatim);
  `matchingTaskIds` (S19-3, whitespace-split/implicit-AND over a raw query
  string and a task list); `expandMatchesWithAncestors` (S19-4, matches
  union ancestor chains, built via `taskTree.js`'s own `buildTree`/
  `ancestorChain` rather than a second tree walk).
- `public/render.js` — `updateTaskElement` grows a fifth parameter,
  `isSearchContext` (default `false` so `renderOverdue`'s call site needs no
  change — search is out of scope there, S19-6), toggling the new
  `.task-item--search-context` class alongside the existing `--completed`
  one. `renderTasks` grows a fifth parameter, `searchContextIds` (default
  `new Set()`), threaded into every `updateTaskElement` call in both the
  tree-container loop and the Focus loop.
- `public/app.js` — imports `matchingTaskIds`/`expandMatchesWithAncestors`
  from `searchQuery.js`; `searchInput`/`searchEmptyMessage` DOM refs.
  `renderMainView` gains the S19-5 filter stage (`searchMatchIds`/
  `searchVisibleIds`/`searchContextIds`, computed from `nonDeletedTasks`
  before the Inbox/main split) threaded into `visibleIdsFor` (AND'd with
  the existing `showCompleted` filter, in that order — S19-5) and into the
  Focus filter (S19-6); the empty-result check (S19-9) reuses the same
  `visibleIdsFor` sets rather than recomputing them, and gates on the
  TRIMMED search box being non-empty specifically so a genuinely task-free
  account renders silently, same as before this step. Two new listeners:
  `#search-input`'s `input` event re-renders on every keystroke (S19-7, no
  debounce) and its own `keydown` handles Escape (S19-8) as a small,
  separate listener rather than a branch inside the existing title/note/
  due-date Escape-cancels-an-edit handler, since the search box has no
  per-row open-edit lifecycle (no `beginInteraction()`, no `openEdits`
  entry) for that handler's `dataset.cancelling`/focusout-commit protocol
  to apply to. `monitorAuthState`'s sign-out branch clears `searchInput.value`
  alongside `tagUndoSnapshot` (S19-8).
- `public/index.html` — `#search-input` in `#main-view`'s toolbar (S19-0);
  `#search-empty-message` (S19-9, hidden by default); `.task-item--search-
  context` CSS (S19-4, dims the whole row via `opacity`, unlike
  `--completed` which only dims the label).
- No change to `firestore.rules`, `firestore.indexes.json`, or any
  Firestore-writing module (S19-10) — search state lives only in
  `#search-input.value` and is never read by any write path.

**Verified (actually exercised in a real browser at localhost:5050, unsigned-in, by
driving the real modules directly):**
- All six modules load and execute with no console error.
- Depth-first render order and indentation (0/24/48px at depths 0/1/2).
- A visible child of a *hidden* parent keeps its true depth — depth is computed from
  the full task set, not the filtered one.
- Tags render exactly once (the old duplicate `[#tag]` suffix is gone).
- Notes: line breaks preserved, bare http(s) URLs linked with
  `rel="noopener noreferrer"`.
- Injection is inert: `<img onerror>`, `<script>`, `javascript:` and `data:` in a
  title or note render as literal text; no element is created, no anchor is produced.
- Clicking a title opens edit mode (the delegated listener really does reach the
  element render.js builds).
- An open edit box survives a refresh triggered by another task **and** a refresh that
  reorders the list: same `<li>`, same `<input>`, focus retained, caret position
  retained, typed text retained.
- `enqueueMutation` serializes strictly; a throwing mutation propagates to its caller
  without poisoning the queue; a queued mutation sees the previous one's committed
  write.
- **Step 7 (un-complete memory), verified unsigned-in against `store.js`'s real
  `setTasks`/`getTasks`, replicating app.js's exact reopen filter over synthetic
  data:** A>B>C>D cascade-stamped by A, un-completing A reopens B, C, D regardless
  of depth (a flat `closedByCascadeFrom === id` filter needs no tree walk to reach
  any depth, since the original cascade already stamped every descendant directly
  with the top id, not each other's immediate parent). A>B>C with B completed
  independently before A's cascade: un-completing A reopens only C; B stays
  completed. A task stamped by a *different* cascade's id is untouched when the
  first task is un-completed.
- **Step 8 (cascade delete), verified unsigned-in against `taskTree.js`'s real
  `buildTree`/`descendantIds`, replicating `handleDeleteClick`'s exact selection
  algorithm over synthetic data:** deleting a parent with a 3-deep live subtree
  deletes all 4 tasks; the parent writes `deletedByCascadeFrom: null`, every
  descendant writes it as the parent's id. With an already-deleted task sitting
  *between* the clicked parent and two still-live descendants, the walk (built
  from the full task set, deleted or not) still reaches and deletes the live
  descendants below it, while the already-deleted task itself is left completely
  unwritten — its original `deletedAt` and stamp are untouched.
- **Step 8's context menu, driven live in the real DOM against app.js's actual
  attached listeners (rows rendered via `render.js`'s real `renderTasks`, right-
  click via a real browser right-click, long-press via synthetic `PointerEvent`s):**
  right-click opens the menu at the pointer, correctly omitting "Move out of
  Inbox" for a non-Inbox task; Escape and an outside click each close it and
  correctly decrement `store.js`'s (now-exported, verification-only) interaction
  depth by exactly one. The idempotent-close guard was verified directly, not
  just reasoned about: with a sentinel `beginInteraction()` held alongside the
  menu's own (depth 2), closing the menu via Escape dropped depth to 1 as
  expected, and then firing a *second*, redundant close path (an outside click,
  menu already closed) left depth at 1 — it did not fall to 0, proving the
  second close correctly no-ops instead of releasing the sentinel's
  still-open interaction. Re-verified after the long-press fix below, with the
  same sentinel technique applied to a long-press-opened menu, same result. The
  menu survived a real `renderTasks` call that genuinely reordered two sibling
  `<li>`s in the same container (order verified to flip in the DOM) — same
  element, same `dataset.taskId`, still open, throughout.
- **Step 8's long-press-suppresses-the-ghost-click path — bug found and fixed
  during review.** The first pass armed `armClickSuppression()` inside the
  long-press timer's callback, i.e. at the moment the menu opened (t = 500ms).
  That function's own `setTimeout(…, 0)` clears the suppression flag on the
  very next macrotask (a few milliseconds later), but the ghost click a real
  touch device fires only follows the user's actual finger-lift — whenever
  that happens to be, not at t = 500ms. A realistic hold (say 650ms) left the
  suppression window closed long before the ghost click ever arrived, so
  nothing was actually suppressed; the first round's "verified" claim for this
  passed only because its test dispatched the ghost click in the same tick as
  opening the menu, which no real long-press does. **Fix:** move the
  `armClickSuppression()` call out of the timer callback and into the
  `pointerup` handler instead, gated by a `longPressOpenedMenu` flag set when
  the timer fires and consumed (cleared) on the very next `pointerup` —
  the ghost click follows pointerup directly in the same dispatch sequence
  regardless of how long the hold was, so arming there is correct at any hold
  duration. The flag is also cleared on `pointercancel`/`pointerleave` so an
  abandoned gesture can never suppress a later, unrelated click. **Re-verified
  with a realistic ~700ms hold** (well past the 500ms threshold), with
  `pointerup` and the ghost click dispatched back-to-back with no artificial
  gap (matching how a real touch input pipeline fires the compatibility click
  right after pointerup, not on a human-scale delay): the menu stayed open,
  no title edit opened, and interaction depth stayed at 1 (the menu's own).
  Also re-confirmed unbroken: a normal short click (pointerdown just before
  the 500ms threshold, pointerup, click) still opens a title edit exactly as
  before; a real outside click still closes an open menu.
- **Step 9 (Trash), verified unsigned-in against the real `taskTree.js`,
  `store.js`, `render.js`, and app.js's exported `compareTrashNewestFirst`/
  `selectPurgeCandidates`, driven through the real DOM wherever a check didn't
  need a successful Firestore write to observe:**
  - Deleting a parent with a 3-deep live subtree: `descendantIds` over the real
    tree returns exactly `[C1, C2, C3]` (`liveDescendantCount` 3, total 4).
    Loading that post-delete state (4 stamped documents + 1 independently
    deleted task) into the real Trash view produced exactly 5 rows and
    `"Trash — 5 of 50"` — every deleted document really is its own row.
  - Restore: the real stamp filter (`deletedByCascadeFrom === clickedId`)
    selected exactly `[C1, C2, C3, P]` and none of the independent task;
    applying the same field resets `handleRestoreClick` writes left the
    independent task alone in the trash afterward (observed: `["SOLO"]`).
  - Restoring into a still-deleted parent: clicking the real Restore button
    (through app.js's actual delegated listener, `handleRestoreClick`
    un-exported) produced the exact confirm text *"...Restoring it now will
    place it at the top level until the parent is restored too..."*; declining
    left the task untouched. Separately, feeding `buildTree` the exact input
    `renderMainView` would (non-deleted tasks only, so the still-deleted parent
    is excluded) put the restored orphan in `tree.roots` — observed
    `rootIds: ["CH"]`.
  - 50-cap eviction: `selectPurgeCandidates` on 55 synthetic deleted tasks (in
    random input order) returned exactly the 5 oldest ids. Through the delete
    flow: 50 already-trashed tasks + deleting 1 more live task produced the
    confirm text *"...permanently purge 1 of the oldest trashed item..."*
    (`currentTrashCount 50 + 1 new − 50 cap = 1`, matching the code's own math).
    Applying `selectPurgeCandidates` to the real post-delete set and rendering
    the result: the oldest (`D49`) was gone, the newest deletion (`LIVE1`) was
    present, and the Trash held exactly `"50 of 50"`.
  - Ordering: a synthetic mix (two exact-timestamp ties, two `null`s, and a
    normal descending sequence) rendered through the real Trash view in exactly
    `[NEWEST, MID, TIE_A, TIE_B, OLDEST, NULL_A, NULL_B]` — newest first, ties
    broken by id ascending, `null` sorting last.
- **Step 10 (manual reorder), verified unsigned-in via real `pointerdown`/
  `pointermove`/`pointerup` `PointerEvent`s dispatched on the actual rendered
  `<li>`s and drag handles, with real wall-clock gaps between them (a separate
  tool call per event, not a tight synchronous loop), plus direct calls to the
  real exported `computeReorderOrder`:**
  - Dragging C's handle to the lower quarter of A's row showed the drop
    indicator between A and B (`prev: "A", next: "B"`) throughout the hover,
    and disappeared (fully detached, not just hidden) on drop.
    `computeReorderOrder(A, B)` returned `{ order: 1500 }` — strictly between
    A's 1000 and B's 2000. Applying that order and re-rendering through the
    real `renderTasks` moved C's `<li>` to sit physically between A and B's
    (`domOrder: ["A", "C", "B"]`).
  - Dragging a main-list task's handle onto an Inbox task (different
    container, so not a sibling): no drop indicator ever appeared
    (`document.elementFromPoint` genuinely resolved to the hovered row, and
    `otherSiblingIds` genuinely excluded it), and releasing there left both
    lists' DOM order byte-for-byte unchanged — `finishDrag`'s own
    `if (!target) return` means no mutation is even enqueued for an invalid
    target, not just one that fails.
  - Escape mid-drag with a sentinel `beginInteraction()` held alongside the
    drag's own (depth 2 while dragging, with a valid target already showing an
    indicator): Escape dropped depth to 1, not 0 — the sentinel's interaction
    survived, proving `closeDragInteraction`'s guard doesn't double-decrement.
    DOM order was unchanged and the indicator was gone.
  - Precision guard: `computeReorderOrder` on neighbours 5e-7 apart (below the
    1e-6 epsilon) returned `{ renumber: true }`; the same gap at 0.01 did not.
    Replicating `finishDrag`'s exact renumber branch (a pair too close
    together, plus a third sibling, with the dragged task inserted between the
    close pair) produced `D:1000, G:2000, E:3000, F:4000` — distinct, strictly
    increasing, in the intended order.
  - `pointerdown` on the drag handle followed by a real 700ms hold (a genuine
    wall-clock gap between tool calls, not a synthetic timer) left
    `#task-menu` hidden throughout and after `pointerup` — the long-press timer
    is never scheduled for a handle pointerdown, so there was never anything to
    suppress.
  - New-task-at-top formula (`min(siblingOrders) - 1000`, unchanged since step
    1) re-checked against the real post-reorder sibling orders in the store
    (`[1000, 2000, 3000]`): the computed value (`0`) sits below all of them.
- **Regression pass after steps 9–10:** an open title edit survived two
  unrelated re-renders (same `<input>`, focus retained, caret at the same
  position, typed text intact); closing an edit after a simulated successful
  commit correctly showed the new title (the `181affa` fix did not regress);
  a real right-click still opened the context menu at the correct task and
  closed cleanly on Escape; the cascade-complete selection algorithm
  (`descendantIds` over an A>B>C chain) is still `[B, C]`, and clicking the
  real checkbox still reaches the delegated `change` listener without the new
  drag-handle markup breaking it. `grep -rn "deleteDoc" public/*.js` confirms
  `purgeTask` is still the only call site.
- **Step 11 (drag-to-reparent), verified unsigned-in via real `pointerdown`/
  `pointermove`/`contextmenu`/`click` `PointerEvent`/`MouseEvent`s dispatched on
  the actual rendered `<li>`s and drag handles (a separate tool call per event),
  plus direct calls to the real exported `canReparent`/`computeSubtreeHeight`/
  `rewriteDescendantAncestors`/`computeReorderOrder` against `taskTree.js`'s
  real `buildTree`/`descendantIds`/`depthOf`:**
  - **11a** — dragging D and hovering the middle of Q (an unrelated root task,
    not a sibling) showed the `.task-item--reparent-target` highlight with no
    line indicator; hovering Q's top-25% edge showed neither. Re-verified with
    a rigor pass: starting from a known-highlighted baseline (a real sibling,
    S) and moving to Q, `document.elementFromPoint` genuinely resolved to Q
    (not null/stale), S's highlight genuinely cleared, and Q's genuinely
    appeared — ruling out a false pass from an early-return no-op.
  - **11b** — hovering the middle of D's own descendants C1 (depth 1 below D)
    and C2 (depth 2 below D) showed no highlight at either depth, with the
    same before/after-a-known-baseline rigor check as 11a (the highlight
    genuinely left S and genuinely failed to land on C1/C2, `elementFromPoint`
    confirmed resolving to each).
  - **11c** — hovering the middle of D's current parent P showed no highlight,
    same rigor check applied (highlight genuinely left S, genuinely failed to
    land on P).
  - **11d** — `rewriteDescendantAncestors` on a synthetic A(root)>B>C chain
    moved under D(root) returned the full arrays exactly:
    `A: ["D"]`, `B: ["D","A"]`, `C: ["D","A","B"]`.
  - **11e** — a 5-level chain L0..L4 (L4 at depth 4) plus a separate 3-tall
    dragged subtree DR>DC1>DC2 (`computeSubtreeHeight` returned `2`):
    `canReparent(tree, "DR", "L4", 2)` refused (`4+1+2=7>6`);
    `canReparent(tree, "DR", "L3", 2)` accepted (`3+1+2=6<=6`) — both
    directions proven against the real `depthOf`.
  - **11f** — same chain with DC2 (the deepest node) marked `deleted: true`:
    building the tree from the FULL set (deleted included, matching
    `beginDrag`/`performReparent`'s real `buildTree(getTasks())` call) kept
    `computeSubtreeHeight` at `2` and still refused L4. Contrast case proving
    the counting actually matters: building the tree from a `!deleted`-filtered
    set instead dropped the height to `1` and would have wrongly *accepted*
    the same drop (`4+1+1=6<=6`) — confirming D4 requires the full set, not
    just that the code runs.
  - **11g** — a harness replicating `performReparent`'s exact decision lines
    (the extracted `canReparent`/`computeSubtreeHeight`/
    `rewriteDescendantAncestors` calls, plus the same one-line
    `newInInbox = newParentTask ? newParentTask.inInbox : draggedTask.inInbox`
    expression the real function uses) proved both directions: a main-list
    task K with child K1 (`inInbox: false`) moved under an Inbox parent
    produced `draggedNewInInbox: true` and `K1: { inInbox: true }`; an Inbox
    task J with child J1 moved under a main-list parent produced
    `draggedNewInInbox: false` and `J1: { inInbox: false }`.
  - **11h** — dragging D, hovering Q's middle (valid target, highlight shown),
    with a sentinel `beginInteraction()` held alongside the drag's own (depth
    2): Escape dropped depth to exactly 1, not 0 (no double decrement,
    sentinel's own interaction survived), the highlight and indicator were
    both gone, and D's `parentId`/`order` in the store were unchanged
    (`"P"`/`1000`) — no write was even attempted (unsigned-in `saveTask` is
    unreachable; see the Assumed note below).
  - **11i** — a real `contextmenu` on C1 (has a parent) showed "Move to top
    level" (`display: "block"`); the same on Q (a root task) showed it hidden
    (`display: "none"`). Clicking it on C1 while unsigned-in produced no
    console error and left C1's `parentId`/`ancestors` in the store completely
    unchanged (`"D"`/`["P","D"]`) — proving `performReparent`'s
    `if (!userId...) return` genuinely aborts before any write is attempted,
    not just reasoned about. The D9 write values themselves were verified with
    the same 11g-style harness (`newParentId: null`): dragged task
    `ancestors: []`, descendant K1 correctly rewritten to `["K"]`.
  - Regression: a real sibling drag (S, a sibling of D) still showed the line
    indicator on its top-25% edge and correctly switched to the
    `.task-item--reparent-target` highlight (not the line) on its middle 50% —
    step 10's sibling behavior survives the new three-zone split, and a
    sibling is a legitimate reparent target too, per D2/D3 (nothing in the
    refusal rules exempts siblings).
  - Console had zero new errors across the whole step-11 run (one pre-existing
    stale error from the module-caching issue this session's setup hit and
    fixed — see below — was the only line in the log throughout).
- **Step 12 (Focus/pin), verified unsigned-in against the real `render.js`,
  `store.js`, and `taskTree.js`, driven through the real DOM for everything
  that doesn't require a Firestore write, and through direct replication of
  app.js's exact (unexported) mutation logic for everything that does — see
  the Assumed note below for exactly which parts that split covers:**
  - **12a** — a synthetic task pinned 2 levels deep (P > C1 > C2, C2 pinned)
    rendered through the real `renderTasks`: `#task-list > li[data-task-id="C2"]`
    and `#focus-list > li[data-task-id="C2"]` are two distinct DOM nodes
    (`sameNode: false`), in their two respective parents, with the main-list
    one carrying `--depth: 2` (its true depth) and the Focus one `--depth: 0`.
  - **12b** — two pinned root siblings A (order 10000) and B (order 20000)
    initially rendered A before B in BOTH the main list and Focus. After
    swapping their `order` values (A: 25000, B: 15000) and re-rendering,
    BOTH the main list and Focus flipped to `[B, A]` together — observed
    directly (`mainOrderAB: ["B","A"]`, `focusIds` showing B before A), not
    inferred from one list alone.
  - **12c** — with P pinned (parent), C1 unpinned (child of P), and C2 pinned
    (child of C1): `focusIds` was exactly `["P", "C2", "K1", "A", "B", "D"]`
    (plus unrelated pinned tasks from the same dataset) — C1 never appeared,
    proving neither P's pin (parent) nor C2's pin (child) leaked an
    ancestor/descendant into Focus.
  - **12d** — replicating the checkbox `change` listener's exact completing
    branch (app.js) for a directly-pinned task D: after the write, `D.pinned
    === false`, `D.completed === true`, `D.closedByCascadeFrom === null`,
    removed from Focus, and the main-list checkbox (with "show completed" on)
    showed checked.
  - **12e** — same replication for a cascade: parent K (unpinned) with pinned,
    open child K1, completing K. `descendantIds(tree, "K")` returned exactly
    `["K1"]`; after the write, `K1.pinned === false`, `K1.completed === true`,
    `K1.closedByCascadeFrom === "K"`, removed from Focus — the easy-to-miss
    half of D5 (a cascade-closed descendant unpins too, not just the task the
    user actually clicked).
  - **12f** — continuing from 12e's post-state, replicating the un-completing
    branch's exact global filter (`closedByCascadeFrom === "K"`) reopening K1:
    `K1.completed === false`, `K1.closedByCascadeFrom === null`, and
    `K1.pinned === false` — NOT restored to `true` (D6), and correctly absent
    from Focus (pinned is false, regardless of being open again).
  - **12g** — with zero pinned tasks, `#focus-section.hidden === true`; after
    loading a dataset with 6 pinned tasks and re-rendering, `hidden === false`.
  - **12h** — a real `contextmenu` dispatched on each of three rows: an
    unpinned open task (M) showed the pin item with `display: ""` and text
    `"Pin to Focus"`; a pinned open task (D) showed `"Unpin from Focus"`; a
    completed task (N, rendered via "show completed") showed the item with
    `display: "none"`.
  - **12i** — a REAL click (via the browser tool's element-ref click, not a
    synthetic `MouseEvent`) opened title-edit on task P's FOCUS row; typed
    text and a caret set mid-string; a full `renderTasks` re-render (same
    pattern as every prior step's "survives an unrelated refresh" proof) left
    `titleInput.value` and `[selectionStart, selectionEnd]` unchanged,
    `document.activeElement` still that exact input, and — the assertion this
    proof specifically exists for — `offsetParent !== null` (not just
    `querySelector` truthiness, which is always true regardless of visibility
    since the input never leaves the DOM). The main-list row for the SAME
    task id was independently confirmed to have stayed on its label
    (`offsetParent === null` for its own title input, text unchanged) —
    proving the two entries really are independent, not just that neither
    happened to break. A real `Escape` afterward correctly discarded the
    typed text and reverted to the label view.
  - A real `change` event dispatched on a Focus row's checkbox confirmed the
    already-documented unsigned-in no-op: `enqueueMutation`'s own `!userId`
    guard fires before any store mutation, so the task object was
    byte-identical (`JSON.stringify` equal) before and after the click —
    this is what makes 12d/12e/12f's "replicate the exact write" approach the
    correct substitute, not a shortcut around a reachable path.
  - Console had zero errors across the whole step-12 run. Every module parsed
    with `node --check`, and every name step 12 added to `render.js`'s import
    list in `app.js` was cross-checked against `render.js`'s real `export`
    statements (not just grepped for existence — checked that the import
    list and the export list are the same set).
  - A discovery mid-verification, not a defect: programmatic `.blur()` calls
    do not fire `blur`/`focusout` events at all in this backgrounded
    browser-automation tab (`document.hasFocus()` was `false`), which silently
    no-ops any test that tries to close an edit that way. A REAL click via the
    browser tool's own input dispatch (not a script-dispatched `MouseEvent`)
    does establish real page focus and real `blur`/`focusout` firing — 12i's
    click was redone this way after the first, script-dispatched attempt's
    cancel step silently failed to close the edit. Worth remembering for any
    later step's browser verification that relies on closing an edit or menu
    via a synthetic blur.
- **Step 13 (Dates), verified unsigned-in against the real `render.js`,
  `store.js`, and `app.js`'s actual attached listeners, driven through the
  real DOM for everything that doesn't require a Firestore write, plus direct
  calls to the real exported pure functions:**
  - **D2 (local-midnight parse), the highest-risk item in this step —
    verified with actual computed values, not just read as correct:**
    `parseDateInputToLocalMidnight("2026-08-20")` returned a Date whose
    `[getFullYear(), getMonth()+1, getDate()]` is exactly `[2026, 8, 20]`,
    and `formatDateForInput` round-tripped it back to `"2026-08-20"` exactly.
    Contrast proof: the naive `new Date("2026-08-20")` parses to
    `2026-08-20T00:00:00.000Z` (confirmed via `.toISOString()` — proving it
    really did parse as UTC midnight), and formatting that SAME instant as
    wall-clock time in a genuine negative-UTC-offset zone
    (`Intl.DateTimeFormat` with `timeZone: "America/New_York"`, chosen
    specifically because this run's actual machine timezone is
    `Asia/Jerusalem`, UTC+3 — a positive offset that would NOT expose the bug
    on its own) printed `"2026-08-19"` — one full calendar day earlier than
    typed. This is the exact bug D2 exists to avoid, demonstrated with real
    computed values, not asserted from a comment.
  - **D3 (overdue boundary), verified two ways:** the pure `isOverdueTask`
    against a fixed synthetic "today" (2026-08-17) returned `true` for a task
    due 2026-08-16, `false` for one due today, `false` for one due tomorrow,
    and `false` for an otherwise-identical yesterday-due task marked
    `completed: true` or `deleted: true`. Live in the DOM: 15 synthetic tasks
    (including one due yesterday-but-completed and one
    due-yesterday-but-deleted) rendered through the real `renderOverdueView`
    produced exactly 2 rows ("Overdue — 2"), and the completed/deleted
    yesterday-due tasks correctly did not appear — confirming the exclusion
    isn't just correct in isolation but survives being mixed into a real
    render pass with other tasks competing for inclusion. The completed
    task's own main-list row also correctly read "Due: Aug 16, 2026" (not
    "Overdue: ..."), and the deleted task correctly still appeared in the
    Trash screen with its title intact — proving deletion and the Overdue
    exclusion don't fight each other.
  - **D5 (Overdue order), verified against the exact step-12-issue-1 failure
    shape (root A with 9 children C1..C9 at orders -1000..-9000, a root
    sibling B at order -2000, both B and C9 given a due date):** the pure
    `computeMainListOrderIndex` sorted the overdue pair `{B, C9}` as `[B,
    C9]`, while sorting the SAME pair by raw `order` would give `[C9, B]` —
    the wrong answer, reversed. Live in the DOM: the real main list rendered
    `[B, TODAY, TOMORROW, A, C9, C8, ..., C1]` (via the real `renderMainView`/
    `renderTasks`), and the real Overdue screen (via `renderOverdueView`/
    `renderOverdue`) rendered its two rows in exactly `[B, C9]` — matching
    the main list's real relative order, not raw `order`'s reversed one. A
    regression check confirmed Focus (which shares the same
    `computeMainListOrderIndex` call, now hoisted) still sorted `[B, C9]`
    too, so the hoist didn't disturb step 12's own behavior.
  - **D7 (age), verified two ways:** the pure `computeAgeLabel` against a
    fixed synthetic "today" returned `"today"` for a task created today,
    `"1 day old"` / `"5 days old"` for one and five days back respectively
    (singular/plural correctly split), and `"age unknown"` (never `"NaN days
    old"`) for both a literal `null` and a Firestore-Timestamp-shaped object
    with no real value. Live in the DOM: a synthetic task created
    2026-07-28, rendered through the real pipeline with the real system
    clock (today = 2026-08-17 per this environment), showed exactly "20 days
    old"; a task with `createdAt: null` showed "age unknown", never NaN.
  - **D10 (inline editor + context menu), verified live with real clicks,
    real right-clicks, and a real Escape keydown:** clicking a row's
    due-display opened the `<input type="date">` in place (same node,
    focused, pre-filled with the stored value formatted as `"2026-08-16"`).
    A real, unrelated re-render (toggling "show completed") left the open
    editor completely untouched — same DOM node, still the focused element,
    value unchanged — while a DIFFERENT task's row updated normally in the
    same pass, proving the `editingDueDate` guard discriminates per-row, not
    globally. Escape correctly cancelled (interaction depth dropped from 1 to
    0, display reverted to the last-saved value, not left showing the
    discarded edit). The context menu on a due-date-less task showed "Set due
    date" with "Clear due date" hidden; on a due-date-bearing task it showed
    "Change due date" with "Clear due date" visible. Clicking "Set due date"
    from the menu opened the inline editor on the SAME row the menu was
    opened for (`taskMenu.dataset.context` correctly threaded through).
    Three-way row independence (extending step 12's two-way D4 proof):
    opening the date editor on a pinned, overdue task's FOCUS row left its
    main-list row's due-display untouched and still in display mode
    throughout an unrelated re-render, AND its separate Overdue-screen row
    (a third independent node for the same task id) was completely
    unaffected the whole time.
  - **D9 (write path), verified as far as unsigned-in allows, matching the
    exact substitute methodology steps 6–12 already established:** a real
    `focusout` commit attempt on an open date editor, unsigned-in, left the
    store byte-identical before/after (`enqueueMutation`'s `!currentUserId`
    guard fires before any mutation, same proof shape as step 12's
    analogous check) — and the display correctly resynced to the
    last-saved value rather than showing the discarded edit. Separately,
    replicating the focusout handler's exact commit logic
    (`parseDateInputToLocalMidnight(rawValue) : null`, then
    `{...currentTask, dueDate}`) against the real store produced a proper
    local-midnight `Date` object for a set, and a literal `null` for a
    clear (empty input) — the exact D9 write shapes. The read-path half of
    "persists across reload" was also verified directly: writing a
    Firestore-Timestamp-shaped `dueDate` (or `null`) straight into the store
    (simulating exactly what a real `saveTask`-then-`refreshTasks` round
    trip would leave behind) and re-rendering showed the new value
    immediately ("Due: Sep 1, 2026" / "No due date"). The one thing this
    does NOT cover — the actual Firestore write and refetch — is unverified,
    same limitation as every mutation in every step above; see Assumed.
  - Console had zero errors across the whole step-13 run, including after a
    genuinely fresh, cache-busted reload (`fetch(url, {cache:"reload"})`
    primed on every changed module before navigating) with the new code.
    Every name step 13 added to `render.js`'s export list was cross-checked
    against `app.js`'s import list (both directions, not just grepped for
    existence).

- **Step 14 (Tag colors), verified unsigned-in against the real `tagColors.js`,
  `store.js`, `render.js` and app.js's actual attached listeners, driven
  through the real DOM for everything that doesn't require a Firestore write:**
  - **14a — the RTL winner rule, the item the plan singled out as too weak to
    catch its own failure. Verified with a real Hebrew title and measured
    on-screen geometry, not by reading the code.** Title:
    `לסיים את הדוח #urgent לפני הפגישה @office` (computed `direction: rtl` on
    the label). `parseTags` returned `["#urgent", "@office"]` — string order.
    Measuring each tag's actual painted box with a DOM `Range` over the label's
    own text node: `@office` (string index 34, the LAST tag) rendered at
    x = 30–84, and `#urgent` (string index 14, the FIRST tag) at x = 183–237 —
    i.e. **the last-typed tag is the one furthest LEFT on screen**, 153px to
    the left of the first, with the Hebrew opening word `לסיים` furthest right
    at x = 307–348. The row's actual painted background was
    `rgb(34, 197, 94)` — `@office`'s green, not `#urgent`'s
    `rgb(220, 38, 38)` red. A Latin-only test could not have distinguished
    these two answers; this one does, in both directions.
  - **14b — the D2 fallback, both halves.** A task titled
    `task with #urgent then #nocolor` (last tag has NO color assigned)
    rendered `rgb(220, 38, 38)` — `#urgent`'s red, i.e. it fell back to the
    previous COLORED tag rather than being stripped by the uncolored last one.
    A task carrying only an unconfigured tag rendered with its inline
    background genuinely CLEARED (`li.style.backgroundColor === ""`) and a
    computed `rgb(59, 130, 246)` — index.html's default `.task-item` blue, so
    the fallback is one CSS rule and not a second hardcoded pair in render.js.
  - **14c — "re-typing the title to reorder tags changes the color", with no
    re-color step.** `דוח #urgent ואז @office` rendered green
    (`rgb(34, 197, 94)`); rewriting the SAME task's title to
    `דוח @office ואז #urgent` and re-rendering turned it red
    (`rgb(220, 38, 38)`). Nothing but the title text changed.
  - **14d — every row-shaped container picks the colors up.** A pinned task's
    Focus row rendered `rgb(250, 204, 21)` (`#work`'s yellow) and an overdue
    task's Overdue-screen row rendered `rgb(34, 197, 94)` — the `tagSettings`
    parameter really is threaded through all three render paths, not just the
    main list.
  - **14e — D5's union, live on the real settings screen.** With four tags
    configured and four tags present on tasks, the screen listed exactly
    `["#nocolor", "#unknownTag", "#urgent", "#work", "@ghost", "@office"]`
    ("6 tags"): `@ghost` appeared with its purple swatch and a visible "Clear
    colors" button **despite no live task carrying it** (settings-map-only,
    the half of D5 that stops a color being silently orphaned), while
    `#nocolor`/`#unknownTag` appeared with the dashed `--unset` preview and
    "Clear colors" hidden (task-only, no entry).
  - **14f — D10, ten malformed/absent settings shapes, each pushed through the
    real `normalizeTagSettings` and then through a real render.** A missing
    document (`null`), `{}`, a document with no `tags` field, `tags: "nope"`,
    an entry that is a string, an entry with named CSS colors
    (`{fg:"red",bg:"white"}`), an entry with 3-digit hex, a half entry
    (`{fg}` only), and a `null` entry ALL rendered the row with its inline
    color cleared and the CSS default showing, and **not one threw**. The
    contrast case proves the check is real rather than vacuous: a malformed
    entry sitting alongside a VALID one (`{"#urgent": 42, "@office":
    {fg:"#ffffff",bg:"#22c55e"}}`) still painted the row green — bad data next
    to good data doesn't poison the good. A `weekStart: "sunday"` field was
    also confirmed to survive normalization untouched, which is what keeps a
    step-14 color write from erasing step 20's setting out of the same
    whole-document write.
  - **14g — the settings screen's two event paths genuinely reach app.js's
    real delegated listeners.** A `change` dispatched on a real color input and
    a `click` dispatched on a real "Clear colors" button were both observed
    arriving at `#task-section` itself (`event.currentTarget === taskSection`),
    each matching its own branch condition and NOT the other's
    (`closest(".tag-setting__color")` / `closest(".tag-setting__clear-btn")`),
    with `dataset.tagName === "@office"` and `dataset.colorField === "bg"`
    resolving correctly, and `dataset.taskId` absent on both — proving the
    task-row branches further down those same listeners correctly decline to
    claim a settings row.
  - **14h — the unsigned-in no-op, so 14g's "nothing changed" isn't a false
    pass hiding a broken handler.** After both events above,
    `getTagSettings()` was byte-identical (`JSON.stringify` equal) before and
    after and `getCurrentUserId()` was `null` — `updateTagSettings`'s own
    `if (!userId) return` fires before `enqueueMutation` is even reached, so no
    write was attempted against the live database (same deliberate
    never-set-a-fake-uid discipline as steps 11–13).
  - **14i — the write payload and the read path, replicated exactly (the same
    substitute methodology steps 6–13 established for anything behind a real
    write).** Replicating `handleTagColorChange`'s merge against the real
    `readTagColors`/`DEFAULT_TAG_*`: setting only a background on a
    never-configured tag produced a COMPLETE entry `{fg:"#ffffff",
    bg:"#0ea5e9"}` that `readTagColors` then accepted (a half-written entry
    would read back as "no colors" and look like a silently failed save).
    D7 both ways: a hypothetical step-15 `quadrant:"urgent-important"` key
    survived a color change (`{fg:"#ffffff", bg:"#facc15",
    quadrant:"urgent-important"}`), and "Clear colors" removed ONLY `fg`/`bg`,
    leaving `{quadrant:"urgent-important"}` — the entry itself is kept so the
    tag still lists (D5). Read path: taking the exact whole-document payload
    `saveSettings` would `setDoc`, JSON-round-tripping it and pushing it
    through `normalizeTagSettings` exactly as `fetchSettings` does on the way
    back in, then re-rendering, repainted the task row to
    `rgb(14, 165, 233)` — the newly written color.
  - **Regression after step 14:** a REAL browser click on a title label still
    opened the inline editor (visible, focused, interaction depth 1); an
    unrelated re-render left it on the same node with its typed text
    (`"plain task edited #urgent"`), caret (`[4, 4]`) and focus intact; a real
    Escape closed it, reverted the label to `"plain task"` and dropped the
    interaction depth back to exactly 0. The row's color correctly kept
    following the SAVED title throughout — the unsaved `#urgent` sitting in the
    open edit box did NOT repaint the row, which is the right behavior (colors
    follow committed data, and the commit path re-renders). The Overdue screen
    still counted correctly ("Overdue — 1") with colors applied. Zero console
    errors across the whole step-14 run, captured by installing a
    `console.error`/`window.onerror` trip-wire on a genuinely fresh
    cache-busted load (`fetch(url, {cache:"reload"})` primed on all nine files
    before navigating) and reading it back empty at the end. `node --check`
    passed on all seven modules and the import/export cross-check reported
    `checked 64 named imports — CLEAN`.
  - **The stale-module-cache trap this document already warns about fired
    again, exactly as documented.** The very first navigation of this session
    — against a dev server started fresh, in a tab created fresh — failed with
    `store.js does not provide an export named 'getTagSettings'`, because the
    browser's shared HTTP cache (keyed by URL, not by tab or server process)
    still held the previous session's `store.js`. Priming every module with
    `fetch(url, {cache:"reload"})` before navigating fixed it, same as last
    time. That one stale error line stays visible in the console-history tool
    for the rest of the tab's life and is NOT evidence of a live defect.

**Assumed (written and reasoned about, never exercised signed-in):**
- Every path that actually reaches Firestore: create, save, soft-delete, and the
  refetch. All browser verification above ran against synthetic in-memory tasks —
  **including steps 7 and 8**: the reopen/cascade-delete *selection logic* was
  verified directly against the real `store.js`/`taskTree.js`, and the context
  menu's open/close mechanics were verified against real DOM events and app.js's
  real listeners, but no `saveTask`/`softDeleteTask` call in either step's actual
  `enqueueMutation` body has been run against Firestore — that requires a signed-in
  user, which is not something this session can do.
- The 5-minute auto-refresh timer firing, and the interaction guard deferring it.
- The 7-level cap refusing an 8th level against real stored `ancestors`.
- `normalizeTask`'s fallbacks against the real documents already in this project's
  Firestore, including the new `deletedByCascadeFrom` backfill.
- That the mutation queue prevents the concrete edit-then-checkbox race end to end
  (the queue itself is verified; the race was reproduced only by code reading).
- The Trash-scoped parts of step 8 that step 9 will actually exercise: whether
  `deletedByCascadeFrom` round-trips correctly through a real Firestore write and
  read (only `normalizeTask`'s in-memory backfill was verified).
- **Every real Firestore call step 9 and 10 add.** No `saveTask`/`softDeleteTask`
  call inside `handleDeleteClick`'s or `handleRestoreClick`'s actual
  `enqueueMutation` body has been run against Firestore, and `purgeTask`'s real
  `deleteDoc` least of all — it is the one irreversible operation in this app and
  has never executed once. What was verified instead, matching steps 6–8's own
  precedent: the exact *selection* logic (which documents a cascade delete or a
  restore touches, which ids `selectPurgeCandidates` picks) against the real
  `taskTree.js`/`store.js`/exported pure functions, and the *confirm dialogs*
  (their exact wording, via a real click through app.js's real listeners) —
  every dialog was then **declined**, specifically so no attempted write could
  reach Firestore. The 50-cap "trash holds 50 afterward" and "oldest gone"
  checks were proven by feeding the real `selectPurgeCandidates` the real
  post-delete set and rendering the result — an "as if the write succeeded"
  simulation, not an actual write.
- **Step 10's "exactly one document write" claim for a plain (non-renumber)
  reorder.** This is a structural fact from reading `finishDrag` (one
  `saveTask` call in that branch) plus `computeReorderOrder`'s real output for
  the drag scenario tested, not a call count observed against a real backend —
  the same limitation as every other write path above. A single stray
  fake-uid drag attempt during this session's testing did reach real Firestore
  once and was correctly rejected with `permission-denied` (confirmed in the
  console); no data was written or could have been, since `firestore.rules`
  requires `request.auth.uid == userId` and there was never a real signed-in
  session behind that uid.
- Whether an actual drag-drop cycle (successful write, then `refreshTasks`'s
  refetch) visibly reorders the DOM end-to-end — verified instead as two
  separate real facts (the correct `order` value is computed; applying that
  value makes the real render pipeline sort correctly), stitched together by
  reasoning, not observed as one unbroken signed-in gesture.
- **Every real Firestore call step 11 adds.** No `saveTask` call inside
  `performReparent`'s actual `enqueueMutation` body has been run against
  Firestore — this session deliberately never set a fake signed-in uid (the
  one prior stray fake-uid write noted above is exactly the mistake this
  session avoided repeating). What was verified instead: the exact *target
  selection and refusal* logic (`canReparent`/`computeSubtreeHeight`) and the
  exact *ancestors-rewrite and order* math (`rewriteDescendantAncestors`,
  `computeReorderOrder`) against synthetic data via their real exported
  functions, the real DOM/highlight behavior of a live drag and of the "Move
  to top level" menu item, and — for both — that staying unsigned-in makes
  `performReparent`'s `if (!userId...) return` genuinely unreachable-past
  rather than merely assumed safe. Whether an actual reparent write (dragged
  task doc plus every descendant doc) round-trips correctly through Firestore,
  and whether `refreshTasks`'s refetch then renders the moved subtree in its
  new place end-to-end, is unverified — same limitation as every other write
  path above.
- **Every real Firestore call step 12 adds.** No `saveTask` call inside
  `handleTogglePinClick`'s actual `enqueueMutation` body, nor the checkbox
  `change` listener's now-`pinned`-aware completing branch, has been run
  against Firestore — this session, like step 11's, never set a fake
  signed-in uid, and directly confirmed (not just assumed) that a real
  `change` event on a Focus row's checkbox leaves the task object
  byte-identical, proving the write path really is unreachable rather than
  merely returning early for some other, coincidental reason. 12d/12e/12f's
  "completing unpins, cascade-completing unpins the descendant, un-completing
  doesn't re-pin" claims were verified by replicating app.js's exact
  (unexported) mutation logic against the real `store.js`/`taskTree.js` and
  observing the resulting store + re-render — the same substitute methodology
  steps 6–11 already established for anything gated behind a real write, not
  a new or weaker technique invented for this step. What WAS verified fully
  live, with no substitution: every purely structural/DOM claim (12a, 12b,
  12c, 12g, 12h) and the edit-survives-a-re-render claim (12i), none of which
  need a Firestore write to observe — pinning/unpinning a task in this app is
  entirely a field toggle with no cascade of its own on the write side (unlike
  steps 8/9/11's multi-document cascades), so there is nothing else step 12
  adds to Firestore that steps 1–11's existing "never actually written"
  limitation doesn't already cover identically.
- **This session's own setup hit the exact stale-module-cache trap this
  document already warns about** (see "Hard-reload the page" above), one
  level worse: a *page-level* hard reload (Cmd+Shift+R) was not enough to
  force fresh subresources for a `<script type="module">` graph — the
  document was a genuine fresh navigation (`performance.getEntriesByType(
  "navigation")[0].type === "navigate"`), yet `import('/app.js')` inside it
  still returned the previous version's exports, and a second attempt against
  a *freshly restarted* dev server on a *brand-new* browser tab still failed
  with `store.js does not provide an export named 'enqueueMutation'` — proving
  the staleness lives in the browser's shared HTTP cache (keyed by URL, not
  by tab or server process) rather than in any one page or server instance.
  What actually worked: explicitly `fetch(url, { cache: "reload" })`-priming
  every module file's disk-cache entry (app.js, auth.js, taskService.js,
  store.js, taskTree.js, render.js, and index.html itself) *before* the real
  navigation that loads them. The stale error line from the failed attempt
  stays visible in `read_console_messages` for the rest of the tab's life
  (that tool returns full history, with no way shown to clear it) — it is
  **not** evidence of a live defect once a later, successful navigation's own
  checks (dynamic-import exports, DOM state, interaction depth) all read
  correctly afterward.
- **Every real Firestore call step 13 adds.** No `saveTask` call inside the
  `focusout` handler's due-date commit branch, nor `handleClearDueDateClick`'s
  body, has been run against Firestore — this session, like every step since
  11, never set a fake signed-in uid. What was verified instead: the exact
  *write payload* (`parseDateInputToLocalMidnight`/`null` producing the
  correct `dueDate` value) via direct replication against the real store, the
  *unsigned-in no-op* itself (byte-identical store before/after a real commit
  attempt), and the *read-path* half of "persists across reload" (writing a
  Timestamp-shaped value straight into the store and re-rendering, simulating
  exactly what a real `saveTask`-then-`refreshTasks` round trip would leave
  behind). Whether an actual `saveTask` call for a due date round-trips
  through Firestore as a real Timestamp, and whether `fetchTasks`'s read
  hands it back as a `.toDate()`-bearing object exactly the way
  `timestampToDate` (render.js) expects, is unverified — same limitation as
  every write path in every step above.
- **The Overdue screen's own drag handle, "+ Subtask", "Delete", and "Move
  out of Inbox" buttons were left fully live** — D4 says Overdue rows are
  "exactly Focus's row shape," and Focus's rows already carry all of this
  (step 12 never disabled them there either). This was a conscious choice
  (see Decisions, D4), not something overlooked, but it was only reasoned
  about, not driven end-to-end on the Overdue screen specifically (e.g.
  dragging a row while the Overdue screen is the active view) — Focus's own
  step-12 verification is the closest direct precedent for this exact
  row-shape's interactive behavior.

- **Every real Firestore call step 14 adds — and this step adds a whole new
  collection's worth.** `fetchSettings`'s `getDoc` and `saveSettings`'s
  `setDoc` against `users/{uid}/meta/settings` have **never executed once**.
  Nothing in this repo has ever written a `meta` document, so unlike every
  previous step there is not even an existing document to have been read
  successfully. Specifically unverified: that `isValidSettings()` really does
  accept the `{ tags: { [tag]: { fg, bg } } }` payload this writes (reasoned
  from reading the rule in full — it constrains only `weekStart`'s value and
  `tags`'s type and key count — but never exercised against the live server);
  that a nested map round-trips through Firestore unchanged; that a
  never-written document really does come back `snapshot.exists() === false`
  rather than erroring; and that `refreshTasks`'s new `Promise.all` behaves
  when only one of the two reads fails. What was verified instead, matching
  steps 6–13's precedent exactly: the write PAYLOAD (14i), the read
  NORMALIZATION including nine malformed shapes (14f), the DOM event routing
  into the real handlers (14g), and that staying unsigned-in makes the write
  genuinely unreachable rather than merely assumed safe (14h).
- **"Assigning a color survives a full reload" is verified in two halves,
  stitched by reasoning, not as one unbroken gesture** — same limitation as
  step 13's identical claim for due dates. The write half is the exact payload
  replication in 14i; the read half is feeding that payload through the real
  `normalizeTagSettings` and re-rendering. A genuine reload cannot preserve
  anything here without a signed-in session, since there is no document.
- **`saveSettings`'s 500-key cap has never been hit in practice.** It mirrors
  `isValidSettings()`'s `tags.keys().size() <= 500` client-side for the same
  reason `taskService.js` mirrors the title/tags caps — a readable message
  instead of an opaque permission-denied — but neither the client check nor the
  rule it mirrors has been exercised.
- **The native `<input type="color">` picker itself was never driven.** The
  `change` event it fires was dispatched directly on the real input (14g), and
  the handler chain from there is verified, but no OS color-picker dialog was
  opened, dragged, or dismissed — browser automation cannot reach it. The
  related exposure this leaves open: a re-render landing while a picker is
  physically open would reassign that input's `.value`. The keyed
  `settingsEntriesByTagName` Map means the ELEMENT itself is never rebuilt (the
  same protection every inline edit box has had since step 2), so the worst
  case is a value reassignment, not a torn-down control — but unlike the
  title/note/due-date editors, a color input has no `editing*` guard flag
  suppressing that write. Deliberate: adding a fourth edit flag would have to
  go into `closeAnyOpenEdits` (step 13's review-round rule), and a color input
  has no commit/cancel lifecycle to hang one on.

- **Step 15's resolver, verified as a pure function against
  `tagColors.js` directly (a standalone Node script, not the browser — no
  DOM/Firestore involved in resolution at all), then the DOM/event-routing
  half verified live at localhost:5050 unsigned-in:**
  - The spec's own worked example (§7): a task carrying both `#p1` (mapped to
    `not-urgent-important`) and `#deadline` (mapped to `urgent-not-important`)
    resolved to `urgent-important` — escalation across two single-dimension
    tags produced the two-dimension quadrant neither tag alone claims.
  - The null-vs-`QUADRANT_NEITHER` distinction (Q2), the case this step is
    easiest to get silently wrong: a task with no tags, and a task whose only
    tag is present in the map but has no `quadrant` key, both resolved to
    `null` (unranked); a task whose only tag was explicitly mapped to
    `not-urgent-not-important` resolved to that string, not `null`. Directly
    confirmed `quadrantRank(null) > quadrantRank(QUADRANT_NEITHER)` (4 > 3) —
    an explicit bottom-quadrant tag outranks no mapping at all, per Q3.
  - The full rank order (`urgent-important` 0, `not-urgent-important` 1,
    `urgent-not-important` 2, `not-urgent-not-important` 3, unranked 4,
    including an unrecognized string also landing at 4).
  - `readTagQuadrant` fed 15 malformed/partial shapes (`null`, `undefined`,
    `{}`, `{quadrant: null}`, wrong case, wrong separator, a number, an array,
    a nested object, an entry with colors but no quadrant key, a bare string
    entry, `42`, `[]`, etc.) — zero throws, every one read back as `null`.
  - Tag-order irrelevance: swapping the position of two configured tags in
    the title produced the identical resolved quadrant (unlike
    `resolveTagColor`, where position is everything) — the two rules'
    fundamental difference (D8, step 14) verified as actual divergent
    behavior, not just asserted in a comment.
  - `resolveTaskQuadrant` against a missing/malformed `tagSettings` itself
    (`null`, `{}`, `{tags: null}`) — all `null`, no throws.
- **The settings screen, driven live via the real `renderSettings` (imported
  fresh with a cache-busting query per this project's known stale-module
  trap, then re-verified via a genuine navigation with every module
  HTTP-cache-primed via `fetch(..., {cache:"reload"})` first):** a tag with
  both colors and a quadrant (`#p1`) rendered its `<select>` at
  `"urgent-important"` AND kept its `fg`/`bg` swatch values — colors and
  quadrant read independently off the same entry, neither one clobbering the
  other's display. A tag with colors but no quadrant (`@office`) rendered its
  select at `""` (the blank "Not set" option) while its swatch stayed
  colored — a colored tag keeping its colors with no quadrant assigned, the
  explicit Q5 requirement.
- **The real write path's DOM event routing, driven against the app's ACTUAL
  running `app.js` instance (not a separately-imported copy) while genuinely
  unsigned-in:** a synthetic `<select class="tag-setting__quadrant"
  data-tag-name="#p1">` inserted into the real `#settings-list` (inside
  `#task-section`, where the real delegated `change` listener lives) and
  given a real bubbling `change` event was caught by the actual
  `handleTagQuadrantChange` → `updateTagSettings` path — confirmed by reading
  `store.js`'s real live `getTagSettings()` cache before and after: **byte
  identical** (`{"tags":{}}` both times), proving the write correctly
  no-ops when `getCurrentUserId()` is `null`, exactly like every other
  mutation path in this project that has never had a signed-in session to
  execute against.
- **The task-row badge, driven via the real `renderTasks` against synthetic
  tasks:** a task carrying a mapped tag (`#p1` → `urgent-important`) rendered
  its badge visible (`display: ""`), text `"U+I"`, and `title="Urgent &
  important"`; a task carrying only an unmapped tag (`#nomap`, absent from
  the settings map entirely) rendered its badge with `display: "none"`, empty
  text, and no `title` attribute at all — genuinely absent, nothing guessed,
  matching Q6 exactly.
- **Ordering did NOT change — this step's explicit deliverable (Q7).**
  `git diff public/render.js` shows zero lines touching `compareSiblings`.
  Behaviorally confirmed too: two synthetic tasks, one unranked with a LOWER
  `order` and one mapped to the TOP quadrant with a HIGHER `order`, rendered
  through the real `renderTasks` in `order` sequence (`[A, B]`) — quadrant
  had no effect on render position, exactly as step 15 is scoped to leave for
  step 16.
- **Every real Firestore call this step could have added has never
  executed**, same limitation as every step since 11: `saveSettings`'s
  `setDoc` was never reached with a real payload from
  `handleTagQuadrantChange`, because this session — like every one before
  it — never set a fake signed-in uid. What was verified instead: the exact
  no-op behavior above, and the write payload shape by direct code reading
  (`{ ...(tags[tagName] ?? {}), quadrant: quadrant || null }`, which spreads
  the existing entry before overwriting only the `quadrant` key — the same
  shape `handleTagColorChange` uses in reverse, already verified live in step
  14 (14i) for the colors-survive-a-quadrant-change direction; this step's
  quadrant-survives-a-color-change direction was not independently
  re-exercised as a live write, only read-verified via the settings-screen
  DOM check above (a tag with both fields set displays both correctly).
- **The native `<select>` was never driven as a real user would drive it**
  (no click-to-open, no keyboard/mouse option selection) — same limitation
  step 14 recorded for the native color picker. Its `change` event was
  dispatched directly, and the handler chain from there is verified.
- **Step 17 (Tag rename/delete), verified unsigned-in against the real
  `tagColors.js` and the real `render.js`/`app.js` DOM wiring already loaded
  by the running page (a stale-module-cache issue like the one this file's
  own click-path section warns about was hit and fixed by opening a genuinely
  fresh tab — a `navigate` call on an already-loaded tab did not reliably
  bust the browser's disk cache for these unchanged-URL ES modules, even with
  a simulated hard-reload key combo; a brand-new tab's first load was clean):**
  - **S17-4 (prefix hazard), the highest-risk item in this step — proven with
    real computed values:** `rewriteTagInTitle("Fix #work before the
    #workshop", "#work", "#job")` returned exactly `"Fix #job before the
    #workshop"` — `#workshop` untouched. Whitespace collapse on delete proven
    at all three positions in a title: mid ("Buy #shopping milk" → "Buy
    milk"), start ("#shopping Buy milk" → "Buy milk"), and end ("Buy milk
    #shopping" → "Buy milk") — no double space, no leading/trailing space in
    any case.
  - **RTL, per this step's own required proof:** a Hebrew title carrying two
    tags (`"לסיים את הדוח #urgent לפני הפגישה @office"`) had `#urgent` renamed
    to `#pressing` in place with `@office` untouched, and had `@office`
    deleted cleanly with the trailing space collapsed — both against string
    offsets, unaffected by the tags' left-to-right visual rendering (the same
    hazard D2/step 14 already documented for color resolution).
  - **S17-5 (whole-batch pre-check), proven with a real constructed overflow:**
    a 3-task batch where one task's rename would produce a 1032-character
    title returned `{ ok: false, blockedTask: that task, blockedTitle.length:
    1032 }` from `planTagRewrite` — the function returns before ever
    considering the remaining tasks, so nothing partial is ever handed to a
    caller. The identical batch with a same-length replacement tag correctly
    returned `{ ok: true, entries: [exactly the 2 real carriers] }` — the
    third, non-carrying task was correctly excluded. Delete's only possible
    violation (the lower bound) was proven separately: deleting a title's
    only tag (`"#onlytag"`) produced `newTitle: ""`, correctly blocked.
  - **S17-6 (merge on rename), proven concretely:** renaming `#personal` to
    `#work` in a title that already carried `#work` produced `"#work meeting
    #work note"` — a genuine duplicate token, left uncleaned, exactly as
    specified. `moveTagSettingsEntry` proven both directions: moving `#a`'s
    entry to an unoccupied `#b` carried `fg`/`bg` across intact; moving `#a`
    onto an ALREADY-configured `#b` left `#b`'s own pre-existing entry
    completely unchanged (`#a`'s entry silently dropped) — the destination
    genuinely wins, not just asserted to.
  - **S17-7 (delete removes the settings entry), proven:**
    `moveTagSettingsEntry(tags, "#a", null)` removed exactly the `#a` key and
    left an unrelated `#other` entry untouched.
  - **Rename-input validation (`isValidTagToken`):** `"#work"`/
    `"@home_office2"` accepted; `"#work stuff"` (embedded space), `"work"`
    (no sigil), and `""` all rejected.
  - **Reachability trace, driven for real:** with `#task-section` made
    visible and `render.js`'s own `renderSettings` called directly into the
    real `#settings-list` (the identical function app.js's real
    `renderSettingsView` calls), the rendered rows carried
    `.tag-setting__rename-btn`/`.tag-setting__delete-btn` with correct
    `aria-label`s, alongside the pre-existing color/quadrant controls
    unchanged (a regression check — `#work`'s stored `#ffffff`/`#111111`
    colors round-tripped into the inputs correctly). A REAL `click`
    `MouseEvent`, dispatched on the actual rendered Rename button and
    bubbled to `#task-section`, reached the real delegated listener with
    zero console errors and — with `window.prompt`/`window.confirm`/
    `window.alert` instrumented to record any call — produced **zero**
    calls, proving the click resolved `closest("li").dataset.tagName`
    correctly and reached `handleTagRenameClick`/`handleTagDeleteClick`,
    which then hit the unsigned-in `if (!userId) return` guard before ever
    prompting — the same "reaches the guard, guard fires first" shape step
    11/16's write-time alerts already established as unsigned-in-unreachable
    past that point. The Undo button (`#settings-undo-btn`) was confirmed
    hidden by default and a real click on it while no snapshot exists is a
    verified no-op (`handleTagUndoClick`'s own `!snapshot` guard), consistent
    with never having run a real rename/delete in this unsigned-in session.
  - **Not executable signed-out, same limitation as every step since 11:**
    the actual `saveTask`/`saveSettings` calls, the real `prompt()`/
    `confirm()` dialogs, and the actual undo replay were never reached,
    because `enqueueMutation`'s/the handlers' own `if (!userId) return`
    guards fire first and this session never set a fake signed-in uid.
- **Step 18 (Recurrence), the advance arithmetic verified directly against
  the real, unmodified `recurrence.js` module (both via `node --check`-clean
  Node imports of the actual file AND inside the real browser tab, same
  file, same functions, not a reimplementation) with concrete computed
  dates, and the checkbox/menu wiring verified unsigned-in against the real
  DOM and delegated listeners:**
  - **S18-2 (advance past today, not one step), proven concretely:** a daily
    task due 2026-08-18, completed the same day, advances to **2026-08-19**.
    The high-risk case — a daily task due 2026-08-13, completed
    2026-08-18 (5 days late) — also advances to **2026-08-19**, not
    2026-08-14: the loop keeps stepping until strictly past today, so a
    stale task lands tomorrow instead of staying overdue.
  - **S18-4 (monthly re-anchors from the stored day, not the clamped one),
    proven concretely:** anchored on Jan 31 2026, advancing twice produced
    **2026-02-28** then **2026-03-31** — March re-derived 31 from the
    anchor, not from February's clamped 28. The leap-year case (anchored on
    Jan 31 2028, a leap year) advanced to **2028-02-29** exactly.
  - **Weekdays completed on a day not in the selected set, proven
    concretely:** rule `{days:[1,3,5]}` (Mon/Wed/Fri), due Monday
    2026-08-17, completed Tuesday 2026-08-18 (Tuesday isn't in the set) →
    advanced to **Wednesday 2026-08-19**, the next day actually in the set,
    not the day after the completion date generically.
  - **Weekly preserves its anchored weekday, proven concretely:** due
    Wednesday 2026-08-12 → next occurrence **2026-08-19**, exactly +7 days,
    same weekday (dow 3 both ends).
  - **DST boundary (this machine's real zone, Asia/Jerusalem, which
    genuinely observes DST — re-checked, not assumed), proven concretely:**
    Israel's 2026 spring-forward lands between March 26 and 27 (UTC offset
    confirmed to flip from +0200 to +0300 across that exact date via
    `Date#toString`). A daily task due 2026-03-26, completed the same day,
    advanced to **2026-03-27T00:00 local** — local midnight exactly, zero
    hour drift across the gap. A second check with `TZ=America/New_York`
    (a negative-UTC-offset zone, the one the D2-era UTC-parsing bug from
    step 13 actually manifests in) confirmed the same zero-drift result
    across both that zone's spring-forward (2026-03-08) and fall-back
    (2026-11-01) boundaries, and a weekly rule spanning the spring-forward
    boundary preserved its weekday exactly.
  - **S18-5 (missing due date defaults to today), proven concretely:**
    setting a `monthly` recurrence on a task with `dueDate: null` (today
    being 2026-08-18) produced `anchorDayOfMonth: 18` and wrote
    `dueDate: 2026-08-18` — the anchor and the due date both derived from
    "today," never left null.
  - **Reachability trace, driven for real in the browser DOM:** synthetic
    tasks loaded into the real `store.js` were rendered into the page's
    actual `#task-list` via the real `renderTasks` (render.js). A REAL
    `contextmenu` `MouseEvent` dispatched on a recurring task's rendered row
    opened the real `#task-menu` (`openTaskMenuForTask`, app.js:342) with its
    `[data-action="set-recurrence"]` button reading **"Change recurrence"**;
    the identical dispatch on a non-recurring row's row read **"Set
    recurrence"** — the D10-precedent label toggle is genuinely wired to
    `task.recurrence`, not hardcoded. A REAL `click` on that button, with
    `window.prompt` instrumented, reached the real delegated listener
    (`taskMenu`'s click listener, app.js:2631 → `action === "set-recurrence"`,
    app.js:2648 → `handleSetRecurrenceClick`, app.js:1678) and closed the
    menu, but **never called `prompt()`** — the unsigned-in `if (!userId)
    return` guard fires first, the same "reaches the guard, guard fires
    first" shape every write path has shown unsigned-in since step 11.
  - **S18-6 (no cascade on a recurring completion), proven both structurally
    and behaviorally:** reading app.js's actual source confirms the
    `if (task.recurrence)` branch (app.js:787) sits — and `return`s
    (app.js:807) — entirely above the `buildTree`/`descendantIds` calls
    (app.js:815-816) the plain completing path uses, so the cascade code is
    syntactically unreachable from a recurring completion, not merely
    skipped by a runtime condition. Behaviorally: a synthetic parent P1
    (`weekly`, due today, two open descendants C1 and C2) had this branch's
    exact write body replicated against it — P1's write produced an
    advanced `dueDate` (+7 days), a restamped `occurrenceStart` (today), and
    `completed: false` — while C1 and C2, read back from the SAME store
    afterward, showed byte-identical `completed: false` /
    `closedByCascadeFrom: null` to their pre-completion state. Confirmed the
    walk itself isn't just broken: `descendantIds(buildTree(...), "P1")`
    over the identical dataset correctly returns `["C1","C2"]` when called
    directly — proving the children WOULD be found if the cascade ran, which
    makes their untouched state proof of the branch/return, not an artifact
    of a broken tree walk.
  - **S18-3 (age fallback), proven via the real badge/age render:** the
    synthetic tasks (created 2026-01-01, `occurrenceStart: null`) rendered
    "228 days old" through the unmodified `computeAgeLabel` — i.e., the
    `occurrenceStart ?? createdAt` fallback path, not a new code path, which
    is exactly S18-3's point (every pre-step-18 task is unaffected).
  - **Recurrence badge, rendered and read back from the live DOM:** a
    `daily`-recurring task's row showed `"🔁 Daily"`; a `weekly` task
    anchored on Tuesday showed `"🔁 Weekly (Tue)"`; three non-recurring rows
    all showed `display: "none"` with empty text — hidden entirely, not an
    empty pill.
  - **Not executable signed-out:** the actual `saveTask` write from
    `handleSetRecurrenceClick`'s `enqueueMutation`, the real `prompt()`
    dialogs it would show, and the checkbox handler's real advancing write
    were never reached — `enqueueMutation`'s and the handlers' own
    `if (!userId) return` guards fire first, and this session never set a
    fake signed-in uid. The write bodies were instead proven by replicating
    them verbatim against the real store/recurrence.js/render.js functions
    (see the concrete values above), the same substitute this project has
    used for every write path since step 11.
- **Step 19 (Search — basic), verified live in the real browser tab
  (`localhost:5050`, unsigned-in) against the real, unmodified
  `searchQuery.js`/`taskTree.js`/`render.js`/`app.js` — synthetic tasks
  loaded straight into `store.js`'s real `setTasks`, filtered by dispatching
  REAL `input`/`change`/`keydown` events on the page's actual
  `#search-input`/`#show-completed-toggle` elements (app.js's own listeners,
  not a reimplementation), and read back from the real rendered
  `#task-list`/`#focus-list` DOM:**
  - **Full reachability chain, proven end to end:** a synthetic 3-level
    chain `P(root) > B(completed, tags:["#private"]) > C(leaf)` plus an
    unrelated sibling `D` and an unrelated root match `Q`. Typing `"urgent"`
    into the real `#search-input` (a genuine `input` event, `showCompleted`
    off) rendered exactly `[P, Q]` — `P` with class
    `"task-item task-item--search-context"` (dimmed ancestor context, since
    its only matching descendant `B` is hidden by `showCompleted`), `Q`
    with plain `"task-item"` (a real, undimmed match); `B`, `C`, and `D` did
    not render at all.
  - **S19-5's ordering, proven concretely (not just reasoned about):**
    flipping `showCompleted` on (a real `change` event) re-rendered as
    `[P (dimmed), B (a real match, undimmed, plus `--completed`), Q]` — `B`
    reappearing the instant its own completed-filter obstacle is removed,
    with no change to the search terms, confirms the completed filter is
    applied to the search-narrowed candidate set (AND), not the other way
    around.
  - **S19-4's asymmetry (ancestors pulled in, descendants NOT), proven at
    two tree depths:** searching a term only `C` (the grandchild) matched
    rendered `[P (dimmed, depth 0), B (dimmed, depth 1), C (undimmed match,
    depth 2)]` — both ancestors pulled in and correctly dimmed, depths
    intact — while in the first scenario above, searching a term `B`
    matched never pulled its own child `C` in at all.
  - **S19-2's whole-token, case-insensitive tag matching, proven against
    the real `matchingTaskIds`:** `B` carries the literal tag `"#private"`.
    Query `"#PRIVATE"` (different case, whole token) matched `B`; query
    `"#priv"` (a genuine prefix of the same tag) matched nothing at all —
    confirming the prefix hazard S19-2 calls out (`#pr` vs. `#private`) is
    actually closed, not just asserted in a comment.
  - **S19-3's implicit AND, proven against the real `matchingTaskIds`:**
    query `"urgent #private"` matched only `B` (title contains "urgent" AND
    tags contain "#private"; `Q` has "urgent" in its title but no
    `#private` tag, so it correctly dropped out the moment the second term
    was added).
  - **S19-6 (Focus is in scope), proven live:** pinning `Q` showed it in
    `#focus-list` with an empty search box; searching a term matching
    nothing (and no ancestor of anything) hid it from Focus too, with
    `#focus-section` re-hiding itself (`hidden: true`) exactly as it does
    when nothing is pinned at all.
  - **S19-9's empty-state message, proven for both directions of the
    box-empty/results-empty distinction:** a query matching nothing showed
    `#search-empty-message` (`hidden: false`) with zero rows in both
    `#task-list` and `#inbox-list`; clearing the store to genuinely zero
    tasks with an EMPTY search box left the message correctly `hidden:
    true` — confirming "no tasks at all" and "search found nothing" render
    as two different, correctly distinguished states.
  - **S19-8's Escape-to-clear, proven live:** with the empty-result state
    above still showing, focusing `#search-input` and dispatching a real
    `Escape` `KeyboardEvent` cleared `.value` to `""` and immediately
    restored the full 5-task list (all of `P`/`B`/`C`/`D`/`Q`) in the same
    render pass — no separate reload or manual re-trigger needed.
  - **Not executable signed-out:** no Firestore write path exists in this
    step at all (S19-10) — there was nothing here that COULD be blocked by
    the `if (!userId) return` guards every mutation path already has, and
    none was invoked; every check above exercised only in-memory state
    (`store.js`'s `setTasks`/`getTasks`) and the real DOM render, with zero
    calls to `saveTask`/`softDeleteTask`/`purgeTask`/`saveSettings` and no
    fake signed-in uid set at any point.

**Files touched (step 20):**
- `public/searchQuery.js` — the grammar/parser section (`parseSearchQuery`,
  `matchingTaskIds` reworked to return `{ matches, error }`), the AST
  evaluator (`evaluateNode`, `evaluateDateTerm`, `evaluateAgeTerm`, private),
  the sigil-distribution pass (`applySigilDistribution`), and the tokenizer
  (`tokenize`). `matchesTerm` (S19-2) is untouched — imported by nothing new,
  called by the evaluator exactly as it was called by step 19's own
  `matchingTaskIds`. New import: `localMidnight`/`timestampToDate`/
  `isOverdueTask` from `render.js` (S20-10; confirmed not a cycle by reading
  render.js's own import list first).
- `public/app.js` — `renderMainView`'s search stage now builds a
  `{ now, weekStart }` context (weekStart read from
  `getTagSettings()?.weekStart ?? "sunday"`) and destructures
  `{ matches, error }` from `matchingTaskIds`; on error, every non-deleted
  task counts as visible and `#search-error-message` un-hides with the
  parser's message (S20-9). New `searchErrorMessage`/`weekStartSelect` DOM
  refs; `renderSettingsView` sets the select's value from the stored
  setting on every render (S20-8); a new `updateWeekStart` function mirrors
  `updateTagSettings`'s shape exactly (whole-document `setDoc` via
  `saveSettings`, serialized through `enqueueMutation`, current settings
  re-read at mutation time, `finally { refreshTasks() }`) but writes
  `weekStart` instead of `tags`; a new `change` listener on
  `weekStartSelect` outside the per-tag-row delegated listeners (same
  precedent as `settingsUndoBtn`).
- `public/index.html` — `#search-error-message` (S20-9, hidden by default,
  styled in the same dark red `#b91c1c` the tag-delete button already uses)
  and `#week-start-select` (S20-8, a `Sunday`/`Monday` `<select>` on the Tag
  Settings screen — there is no other settings surface in this app — with
  its own `<label>`).
- No change to `firestore.rules` or `firestore.indexes.json` (S20-8/S20-11)
  — `isValidSettings()` already validated `weekStart` before this step
  existed, confirmed by re-reading the rule rather than assumed.
- `FIREBASE.md` — the settings-document schema table's `weekStart` row
  updated from "not written by any code yet" to record this step as its
  writer.

**Verified (step 20 — pure-function verification against the real
`searchQuery.js` module, run with `node`, today pinned to Sunday
2026-08-23 matching the worked-example table's own assumption; see the
Decisions log entry below for the full 27-row table):**
- All 27 worked-example rows pass: parsed AST shape checked directly via
  `parseSearchQuery` for the structural rows (5/6's byte-identical ASTs;
  8/9's nested-group distribution; 10's overdue immunity; 11's precedence;
  27's three-bare-words fallback), and `matchingTaskIds` checked against
  fabricated plain-object tasks (no Firestore Timestamp objects, no DOM)
  for the rest.
- Row 5 vs row 6 (`#(private OR pr)` vs `(#private OR #pr)`) produce
  `JSON.stringify`-identical ASTs, not just equivalent match sets — proving
  S20-4's "the parser accepts both sigil styles... a term inside a
  sigil-prefixed group that carries its own sigil keeps its own" is a
  genuine parse-time equivalence.
- Row 15's Monday-start week correctly puts Sunday 2026-08-23 (the pinned
  "today") as the LAST day of its own week (2026-08-17..2026-08-23), not
  excluded from it.

**Verified (step 20 — real UI, driven unsigned-in exactly like every prior
step's browser verification: synthetic tasks injected via `store.js`'s
real `setTasks`/`setTagSettings`, real DOM events dispatched against
app.js's actual attached listeners, `#task-section` unhidden by hand since
that only happens via sign-in otherwise; zero Firestore requests recorded
throughout, confirmed via the browser's own network log):**
- The spec's own two examples (spec:160, :191-192), run against 8 synthetic
  tasks: `#(private OR #pr) AND @office` matched only the one task carrying
  both `#pr` and `@office`; `#galit AND age > 20d` matched only the
  `#galit` task whose `createdAt` was far enough in the past, not the one
  created "today."
- Row 5/6's AST equivalence reproduced live: both queries rendered the
  identical three-row result set.
- A parse error (`#a AND`) left all 8 tasks visible and un-hid
  `#search-error-message` with the text "expected a term after AND" — S20-9
  proven against the real render path, not just the pure evaluator.
- The week-start setting changing a `this week` result: a task due Sunday
  2026-08-23 (the real wall-clock "today" this session ran on) was excluded
  from `this week` under a Sunday-start week and included under a
  Monday-start week, via the real `evaluateDateTerm` code path.
- Step 19 regression, run against a 3-deep tree (`P > B > C`) plus an
  unrelated task `Q`: a bare word matching only `C`/`Q` correctly dimmed
  `P`/`B` as `.task-item--search-context`, undimmed `C`/`Q`; `#private`
  (only `B` carries it) correctly pulled in `P` as ancestor context. Both
  match step 19's own original verification results exactly — the AST-based
  rewrite changed nothing observable about step 19's behavior.
- **Not verified live (would require a real signed-in Firestore write,
  prohibited for this task):** the week-start `<select>`'s `change` →
  `saveSettings` → `refreshTasks` round trip. What WAS verified: dispatching
  a real `change` event on the real `#week-start-select` while signed out
  ran the real listener → `updateWeekStart` → `getCurrentUserId()` returned
  falsy → the function returned before calling `saveSettings`, confirmed by
  zero Firestore requests in the network log. The store→render half of that
  same round trip (`getTagSettings().weekStart` flowing into a changed
  `this week` result) IS verified above, by calling `setTagSettings`
  directly — the same stand-in the write itself would have performed.

## Decisions

- **step 1** — `ancestors: string[]` written as `[]` on every new task, even though
  nothing renders hierarchy yet — because `firestore.rules`' 7-level cap
  (`ancestors.size() <= 6`) needs it on every doc from the start, and backfilling it
  later would be a real data migration with no tooling to run it.
- **step 1** — `order: number` written as `min(siblingOrders) - 1000` on every new
  task (siblings = same `parentId`) — a fractional index, so inserting a task never
  requires renumbering the tasks around it.
- **step 1** — `updatedAt: Timestamp` written as `serverTimestamp()` on every write.
- **step 1** — `closedByCascadeFrom: string | null` shape is locked now even though
  step 6 is the first to write it.
- **step 1** — `order` is a fractional index scoped to `parentId` siblings, and is
  always the tie-breaker applied *after* quadrant rank once step 16 lands
  (`(quadrantRank, order)`, computed client-side on every render, never stored).
- **step 1** — writes go through `saveTask(uid, task)` → `setDoc(ref, wholeTask)`,
  never `updateDoc(patch)`. The spec's conflict rule is that a later write replaces
  the task entirely; `updateDoc` merges, which is the behavior the spec rejects.
- **step 1** — reads normalize missing fields in `taskService.js`'s `normalizeTask()`,
  so old rows never reach the tree builder or the sort comparator as `undefined`.
- **step 1** — the interaction guard (`beginInteraction`/`endInteraction`) exists to
  keep the 5-minute refresh off the DOM mid-gesture. Step 2's edit box is its first
  real caller.
- **step 2** — a title edit commits on Enter or on blur; Escape cancels. A note
  commits on blur only, because Enter must insert a newline for the spec's
  line-break-preserving notes.
- **step 2** — an invalid title/note (empty, or over the cap) reverts to the
  last-saved value, tells the user the edit was discarded, and closes the row. It
  must never trap the user in a repeating alert they cannot click away from.
- **step 2** — `dir="auto"` on the title label/input and note display/input, because
  the spec requires correct mixed Hebrew/English rendering while editing inline.
- **step 2** — the note linkifier only ever links an explicit `http://`/`https://`/
  `www.` prefix, and builds anchors with `createElement`/`textContent` and a direct
  `.href` assignment. No `innerHTML` anywhere near user text. Trailing sentence
  punctuation after a URL is excluded from the link target.
- **step 2** — tags render exactly once, from the title text itself. The title is the
  editable source of truth for tags; re-parsing on commit is the only way they change.
- **step 3** — `deletedAt: Timestamp | null` is the locked shape the Trash (step 9)
  must read. `null` means never deleted. Deletion is always soft — no `deleteDoc`.
- **step 3** — a task with children cannot be deleted; it is refused with a message
  rather than silently ignored. Cascade delete is step 8. Already-deleted children do
  not count as children for this check.
- **step 4** — `parentId: string | null` is the sole source of truth for the tree.
  `ancestors` is a cached denormalization, **root-first**, matching `ancestorChain`'s
  existing order. A new subtask's ancestors = `[...parent.ancestors, parent.id]`.
- **step 4** — the 7-level cap is enforced client-side as `depthOf(tree, parentId) >= 6`
  and refuses before any write, so the user gets a readable message instead of the
  opaque permission error a rules rejection produces.
- **step 4** — subtasks are created with `inInbox: false`; a task filed under an
  explicit parent is not a bare capture. **Step 5 must confirm this against the spec's
  Inbox rules** — it is the one decision here made ahead of the step that owns it.
- **step 4** — depth is computed from the *full* task set and only visible tasks are
  rendered, so a visible child of a filtered-out parent keeps its true indentation.
  Feeding `taskTree.js` a filtered list would make the filter a second input to depth,
  which step 11 (drag-to-reparent) would trip over.
- **step 4** — indentation is CSS driven off a `--depth` custom property on a flat
  list of `<li>`s. Nested `<ul>`s would force the keyed re-render to tear down and
  rebuild whole subtrees, which is the exact thing `render.js` exists to avoid.
- **steps 2–4 review round** — all mutations are serialized through
  `enqueueMutation` in `store.js`, and each queued mutation re-reads its task from the
  store at run time rather than closing over a snapshot taken at click time. Without
  this, two whole-document writes built from the same stale copy silently discard each
  other (reproduced: edit a title, then click that row's checkbox before it commits).
  Every later step that adds a mutation path — 6, 8, 10, 11, 12, 18 — must route
  through this queue.
- **steps 2–4 review round** — `render.js` reconciles children with `insertBefore`
  and never calls `replaceChildren`. Detaching a focused input blurs it silently
  (element removal fires no `blur`/`focusout`), which would leave the user typing into
  a box that no longer has focus.
- **steps 2–4 review round** — an edit's interaction closes exactly once, tracked in
  an `openEdits` set keyed `${taskId}:${field}`. The render-side cancellation callback
  and the `focusout` handler are not mutually exclusive, and a double decrement can
  release a *different* edit's deferred refresh.
- **steps 2–4 review round** — the `tags <= 50` cap that `firestore.rules` enforces is
  also checked client-side, like the title and note caps, so it surfaces as a readable
  message rather than an opaque permission error.
- **steps 2–4 review round** — REJECTED, do not revisit: two reviewers reported that
  renaming the collection from `users/{uid}/todos` to `users/{uid}/tasks` loses live
  data, and that `normalizeTask` must migrate an old `parentTaskId` key.
  `firestore.rules` has a match block only for `users/{userId}/tasks/{taskId}` and, by
  its own comment, deliberately no catch-all — so Firestore denied every write the old
  client aimed at `todos`. That denial is the `permission-denied` error diagnosed
  earlier in this project. The `todos` collection is empty and always was. Adding
  migration code would be dead code implying a schema that never reached the database.

- **step 5 — REVERSES step 4.** A subtask now **inherits its parent's `inInbox`**
  rather than always being created `false`. Step 4's rule put a child in the main list
  while its parent sat in the Inbox — two different containers, so the task was
  findable but structurally incoherent. This was the decision step 4 flagged as step
  5's to confirm, and it did not survive contact with the Inbox UI.
- **step 5** — "explicit move" is a per-row "Move out of Inbox" button (no drag or
  context menu exists until steps 8 and 11), and it files the clicked task **and its
  whole subtree** together, since inheritance means a subtree shares Inbox membership.
- **step 5** — Inbox and main list are two containers rendered from **one shared**
  `entriesByTaskId` Map in a single `renderTasks` call, with one union cleanup pass.
  One task id still maps to exactly one `<li>`, which moves between containers via
  `insertBefore` rather than being rebuilt. Rendering the same id into two containers
  would break the invariant the whole keyed re-render rests on.
- **step 5** — the delegated listeners moved from `#task-list` up to `#task-section`,
  the common ancestor of both lists, so one set of listeners still covers everything.
  Any later step that adds a third container must put it inside that ancestor or wire
  its own delegation.
- **step 6** — `closedByCascadeFrom` holds **the id of the task the user actually
  clicked**, not each task's immediate parent, stamped on every descendant the cascade
  closes. Step 7 therefore reverses exactly one cascade with a single `=== clickedId`
  filter, at any nesting depth. Do not change this to the immediate parent.
- **step 6** — a descendant that was **already completed before the cascade** is never
  written and never stamped, so step 7 leaves it completed. Verified against the real
  `taskTree.js`: with A > B > C where B was already done, the cascade from A skips B
  entirely but still reaches and stamps C — it does not short-circuit at the first
  completed node.
- **step 6** — completing a task directly always writes its own
  `closedByCascadeFrom: null`, because the user's explicit act is never a cascade
  effect, whatever stale value the field held.
- **step 6** — the whole cascade is **one** queued mutation that re-derives the subtree
  from `getTasks()` at run time, with a single `refreshTasks()` in a `finally`. Writes
  are sequential per-task `setDoc`s with no batch or transaction, so a mid-cascade
  failure leaves the earlier writes committed; the `finally` refresh makes the UI show
  the true partial state rather than looking as though nothing happened.
- **step 6 — known gap, not fixed:** the 5-minute timer's `refreshTasks()` is not
  itself routed through `enqueueMutation`, so a very slow deep cascade leaves a narrow
  window where the timer's refetch can interleave with the cascade's writes. Low
  probability, no data corruption (the refetch only reads), but it is the obvious thing
  to fix if refresh-vs-mutation ordering ever misbehaves.
- **step 7** — the reopen set is a **global filter** over every non-deleted task
  (`closedByCascadeFrom === clickedId`), never a subtree walk from the clicked task's
  current position. The stamp itself is what recorded cascade membership at closing
  time, so matching it back is the only source of truth this needs — a tree walk would
  be a second, redundant source of truth, and it would actively disagree with the stamp
  once step 11 (drag-to-reparent) can move a stamped task out of the subtree it was
  originally closed under. The stamp travels with the task; a walk from the current
  parent would not find it there anymore. **Step 9 (Trash) must use this same
  global-filter pattern for restoring a cascade-deleted subtree via
  `deletedByCascadeFrom`, for the identical reason.**
- **step 7** — the clicked task's own reopen write happens **first**, before the
  cascade loop, mirroring step 6's "clicked task first" ordering — so the row the user
  actually pressed reflects their action even if the rest of the reopen fails partway.
- **step 8** — `deletedByCascadeFrom` is **exactly symmetric** to `closedByCascadeFrom`:
  the id of the task the user actually clicked Delete on (never a descendant's
  immediate parent), stamped on every live descendant the cascade deleted, `null` on
  the clicked task itself. It is never restamped or rewritten once set — an
  already-deleted descendant caught by a later cascade is left completely untouched,
  keeping whichever cascade (or solo deletion) actually put it in the trash as the one
  true stamp step 9 reads to reconstruct "what went down together."
- **step 8** — each deleted document is its own `softDeleteTask` write, never merged or
  batched, **specifically so step 9 can count one deleted document as one trash slot**.
  A parent with 11 live descendants consumes 12 of the 50 slots (product-spec.md §3),
  which only works if each of those 12 documents was written — and is later evictable —
  individually.
- **step 8** — the cascade-delete subtree walk is built from **every task, deleted or
  not** (`buildTree(getTasks())`, no `.filter(t => !t.deleted)`), unlike step 6's
  cascade-complete walk which filters to non-deleted tasks first. This is a deliberate
  difference, not an inconsistency: a deleted node must still act as a pass-through
  connector to its own live children in the parent/child graph, or `buildTree` would
  see those live children as orphaned roots (no parent found in the filtered set) and
  the cascade would fail to reach and delete them. Completing doesn't remove a task from
  the tree the way deleting does, which is why step 6 never needed this distinction.
- **step 8** — the context menu is **one shared element declared in `index.html`,
  outside both `<ul>`s**, moved and re-labeled per open rather than built per row.
  `render.js`'s keyed re-render only ever touches elements inside `#inbox-list` and
  `#task-list`; an element that lived inside either list could be torn down by an
  unrelated refresh while the menu was open, exactly the failure step 2's edit boxes
  were built to avoid. Verified live: a real `renderTasks` call that reordered two
  sibling rows left the open menu — outside both lists — completely untouched.
- **step 8** — the menu's close path is idempotent through a single `menuOpen` boolean
  guard, the same pattern `openEdits` uses for edits (steps 2–4 review round). Two close
  paths landing back to back (Escape immediately followed by the outside-click
  listener's own pass over that same event, or Escape followed by a stray scroll) must
  never decrement the interaction guard twice for one open. Verified directly against
  `store.js`'s interaction depth (a verification-only export added for this — see
  `getInteractionDepth` in store.js): with a sentinel interaction held alongside the
  menu's own (depth 2), closing via Escape correctly dropped depth to 1, and a second,
  redundant close (outside click, menu already closed) left it at 1 rather than
  releasing the sentinel down to 0. This exact double-decrement bug has already
  happened once in this repo (the `openEdits` history above); this is the same defense
  applied to the menu.
- **step 9** — the Trash is a **flat list ordered `deletedAt` descending**, never a
  tree, and every deleted document counts as its own row/slot — never grouped back
  under the parent it was cascade-deleted with. This is what actually lets the
  50-item cap (product-spec.md §3: "Tasks are counted individually, not per
  deletion") mean anything: collapsing a cascade back into one visual entry would
  hide the very count the cap acts on. Ties on `deletedAt` (including two
  documents both missing it) break on `id` ascending so the order is stable across
  refreshes, and `deletedAt: null` always sorts last — treated as "oldest" for
  eviction too, since there's no timestamp to say otherwise.
- **step 9** — restoring a task restores it **and every task whose
  `deletedByCascadeFrom` equals its id** — the same global stamp filter step 7
  uses for reopening (`closedByCascadeFrom`), not a subtree walk from the
  restored task's current `parentId`. Same reasoning as step 7's entry above: the
  stamp is what recorded cascade membership at delete time, and once step 11
  (drag-to-reparent) exists, a walk from the current tree position could
  disagree with it.
- **step 9** — restoring a task whose parent is still in the trash **warns and
  then places the task at the top level**, rather than silently or automatically
  restoring the ancestor chain too. `parentId` is left exactly as it was;
  `taskTree.js`'s existing orphan-is-root rule (an unfound parent renders as a
  root) is what actually produces the top-level placement — no special-case
  branch was needed in `buildTree` itself. Reviving an ancestor the user never
  asked to restore would be a second, uninvited restore riding along on this one.
- **step 9** — `purgeTask` (a real `deleteDoc`) is **the only hard-delete call in
  the codebase**, and the only thing that ever calls it is the 50-cap eviction
  inside `handleDeleteClick`'s own queued mutation, on ids `selectPurgeCandidates`
  picked from a *fresh* post-delete fetch (not the confirm's best-effort
  projection) — a permanent purge acting on stale data would be exactly the kind
  of silent, unrecoverable mistake the spec's "the interface should [warn]" rule
  exists to prevent. The confirm shown before any of this runs states the exact
  purge count and that it cannot be undone, computed from the same projection
  logic the queued mutation later re-derives for real.
- **step 10** — reordering uses a **dedicated per-row drag handle**
  (`.task-item__drag-handle`), never the whole row. The row already owns
  click-to-edit (step 2) and long-press-opens-menu (step 8); a pointerdown
  handler that had to guess between three gestures from the same target would be
  strictly worse than one that knows which gesture it's in from which element
  was pressed. `touch-action: none` on the handle is load-bearing — without it a
  touch device's own scroll gesture can win the pointer sequence before
  `pointermove` ever sees it.
- **step 10** — a pointerdown on the drag handle **never schedules the long-press
  timer at all**, rather than starting it and cancelling it — the plan called for
  "cancel/suppress the long-press timer," but not scheduling one in the first
  place is strictly stronger and removes an entire class of race (a timer firing
  between "drag started" and "timer cancelled" cannot happen if it was never
  set). Verified directly: a real 700ms hold on the handle never opened the menu.
- **step 10** — drops are **siblings only** — re-parenting is step 11's job, not
  this one's. An invalid target (a different `parentId`/`inInbox` group) shows no
  drop indicator at all and writes nothing on release, rather than showing an
  indicator and then reverting — product-spec.md's "the interface should make
  [an overruled action] visible rather than letting it appear to work and then
  snap back" applies to a same-drag invalid target exactly as it does to a
  priority-overruled one (step 16's future concern). Sibling identity is
  `parentId` **and** `inInbox` together, not `parentId` alone, because a
  root-level Inbox task and a root-level main-list task can share
  `parentId: null` without being siblings (step 5's inheritance rule already
  keeps every non-root task's siblings agreeing on both fields automatically —
  this check only ever matters at the root).
- **step 10** — the fractional-index midpoint (`(prev.order + next.order) / 2`)
  has a **precision guard**: once the gap between two neighbours falls below
  `1e-6`, the drop instead renumbers the *whole* sibling group to evenly spaced
  values (`(i+1) * 1000`), including the dragged task at its new position, as
  one queued mutation. This is the one documented exception to "one document
  write per reorder" — repeated midpoint math halves the gap between the same
  two neighbours every time something is dropped between them, and float
  precision eventually runs out; writing a value indistinguishable from a
  neighbour would make their relative order silently non-deterministic (whatever
  the JS engine's sort happens to do with ties) instead of reflecting the last
  drag the user actually did.
- **step 11 (D1)** — `drag.target` became a discriminated shape,
  `{ type: 'sibling', beforeId, afterId }` or `{ type: 'reparent', parentId }`,
  and `finishDrag`/`performReparent` branch on `type` rather than inferring it
  from which fields are present — any later step that adds a third kind of
  drop target (there is none planned, but step 16's priority-overruled-drag
  case is adjacent) extends this same `type` enum instead of overloading the
  existing two shapes.
- **step 11 (D2)** — each hovered row splits into three vertical zones: top
  25% and bottom 25% are sibling-only before/after targets (step 10's
  original behavior, now confined to a smaller band instead of the whole
  row), and the middle 50% is "reparent onto this row," valid for **any** live
  row that passes D3 — sibling or not. A row's own middle being a legitimate
  reparent target even for a sibling is deliberate: nothing in D3's refusal
  rules exempts siblings, and reparenting onto a former sibling is exactly as
  valid as reparenting onto anything else. Any later step that changes row
  height or padding must keep the zone split proportional (`rect.height *
  0.25`/`0.75`), not a fixed pixel band, or the split silently stops matching
  a visually-centered highlight.
- **step 11 (D3)** — the four reparent refusals (dropping onto self,
  descendant, current parent, or past the depth cap) live in exactly **one**
  place, the pure exported `canReparent(tree, draggedId, newParentId,
  subtreeHeight)` — the live drag's `isValidReparentTarget` and
  `performReparent`'s write-time re-check both call it, rather than each
  re-implementing the same four checks and risking them drifting apart. Any
  later step that adds a fifth refusal rule (none planned) extends this one
  function, not either caller.
- **step 11 (D4)** — the 7-level cap for a reparent is `depthOf(tree,
  newParentId) + 1 + subtreeHeight <= 6`, where `subtreeHeight` (the pure
  exported `computeSubtreeHeight`) is computed over the tree built from the
  **full** task set — deleted descendants included, exactly like step 8's
  cascade-delete walk (PROGRESS.md's step 8 decision) and for the same
  reason: a deleted descendant is restorable, and `firestore.rules`' `
  ancestors.size() <= 6` would reject a write for it the moment it's
  restored into a subtree moved too deep while it was gone. Verified live
  (11f) that filtering deleted tasks out first — the wrong way — actually
  changes the accept/refuse answer, not just the code path taken.
- **step 11 (D5)** — a reparent rewrites `ancestors` for the dragged task
  **and every descendant, deleted ones included** — one whole-document
  `saveTask` per document, mirroring step 8's "each deleted document is its
  own write" precedent for the identical reason (per-document cascade/cap
  logic needs every document self-contained). The rewrite formula — replace
  the dragged task's OLD ancestor prefix in each descendant's chain with its
  NEW one, keep the tail below the dragged task unchanged — lives in the one
  pure exported `rewriteDescendantAncestors`, called from `performReparent`
  for the real write and directly from the verification harness for 11d/11g/
  11i; there is no second copy of this math anywhere.
- **step 11 (D6)** — `inInbox` follows the new parent for the **whole** moved
  subtree (dragged task and every descendant), reusing step 5's "a subtree
  can't straddle the Inbox boundary" rule (PROGRESS.md's step 5 decision) at
  move time instead of only at creation time. The one exception is "Move to
  top level" (D9): there is no new parent to inherit from, so `inInbox` is
  left exactly as it was.
- **step 11 (D7)** — a reparented task lands at the top of its new parent's
  live children, reusing step 10's `computeReorderOrder(null, topSibling)`
  rather than a second ordering rule — passing `prevTask: null` always takes
  its existing "top of group" branch (`nextTask.order - 1000`, or `0` with no
  siblings), which is exactly D7's formula and can never trigger the
  precision-renumber branch (that only ever fires between two non-null
  neighbours). Any later step that changes "top of group" math (step 16's
  quadrant-first comparator is the obvious candidate) only has to change it in
  `computeReorderOrder` — every caller, including this one, inherits it.
- **step 11 (D8)** — write order and failure handling mirror step 8 exactly:
  the dragged task's own `saveTask` first, then one `saveTask` per descendant
  (re-read from `getTasks()` at that write's turn, not a click-time snapshot),
  the whole thing one `enqueueMutation`, a `catch` that logs/alerts, and a
  `finally` that calls `refreshTasks()` regardless of how far the loop got —
  same reasoning as step 8's: a mid-cascade failure leaves the earlier writes
  committed, and the refresh shows the true partial state rather than
  pretending nothing happened.
- **step 11 (D9)** — the context menu gained exactly one new item, "Move to
  top level," shown only when `parentId != null`, routing through the exact
  same `performReparent` the drag-drop path uses (`newParentId: null`) — not
  a parallel implementation. It sets `parentId: null`, `ancestors: []`, and
  leaves `inInbox` unchanged (there is no new parent to inherit from); D5's
  descendant rewrite runs the same way, with `newAncestors = []`. **A full
  move-target picker (search/browse for any task, not just drag-reachable
  ones or the root) is explicitly out of scope for this step** — this item
  only covers the one case drag structurally cannot express (there is no row
  to drop onto for "no parent").
- **step 12 (D1)** — Focus is a THIRD container rendered inside `#task-section`
  in the SAME single `renderTasks` call as Inbox and main (never a second
  call) — `renderTasks` grew a dedicated `focusContainer` parameter for this,
  rather than a third array entry, precisely because it is flat (D2) and
  needs its own Map (D4), not because it renders separately. Placing it
  inside `#task-section` means it inherits every existing delegated listener
  (complete, inline edit, note, delete, drag handle, context menu) with zero
  new delegation — any later step adding a fourth simultaneous container
  should do the same rather than wiring its own listeners.
- **step 12 (D2)** — Focus is a FLAT list: exactly the pinned tasks
  themselves, never their children or ancestors. It reuses `render.js`'s
  `flattenTree`+`buildTree`+`depthOf` machinery for NOTHING — it calls
  `sortTasks` directly on the pinned subset and renders every row at
  depth 0. A pinned task's subtree relationship to other tasks is simply not
  Focus's concern; Focus answers "what am I working on now," a hand-picked
  set, not a structural view.
- **step 12 (D3)** — Focus order is the SAME `sortTasks`/`compareSiblings`
  seam the main list sorts with — no second ordering rule, no new
  `focusOrder` field. This is deliberately the exact seam step 16 (priority
  ordering) replaces, so Focus inherits quadrant-first ordering for free the
  moment that step lands. Because the pinned set spans multiple parents,
  `order` is only truly comparable within one sibling group — sorting the
  flat set by it anyway makes cross-group order **arbitrary but stable**
  (ties broken by original array position, itself stable) until step 16 gives
  every task a real cross-group key. Verified (12b): a pinned parent, a
  pinned grandchild, and two pinned root siblings sorted as
  `[P, C2, K1, A, B, D]` — the three depth-differing, cross-group ties (P,
  C2, K1 all had sibling-local `order: 1000`) landed in insertion order, not
  some depth- or parent-aware order, exactly the "arbitrary but stable"
  behavior this decision predicts.
- **step 12 (D4)** — a pinned task renders in Focus AND its normal place at
  once, which breaks step 5's "one task id maps to exactly one `<li>`"
  invariant on purpose. Solved by giving Focus its own separate
  `focusEntriesByTaskId` Map — the exact same precedent step 9's Trash
  already set with `trashEntriesByTaskId` — rather than trying to make one
  `<li>` serve two containers. The corollary this decision forces: every
  render.js function that used to be addressed by taskId alone (the title/note
  edit-mode begin/end/get/set functions) needed a SECOND, Focus-addressed
  variant (`beginTitleEditFocus`, etc.), because a taskId alone can no longer
  uniquely identify "the entry" once a task can have two. app.js's click/
  focusout listeners now check `li.closest("#focus-list")` to pick the right
  pair, and the `openEdits` idempotent-close key grew a `:focus` suffix for
  the same reason — without it, opening an edit on one of a pinned task's two
  rows and having the OTHER row's disappearance (or a stray double-open)
  close it would double-decrement the interaction guard, the exact bug class
  `openEdits`/`menuOpen`/`dragInteractionOpen` already exist to prevent.
- **step 12 (D5)** — completing a task ALWAYS clears `pinned: false` in the
  SAME write, whether it's the task the user directly ticked or a
  step-6-cascade-closed descendant. Reason: Focus is "what I'm working on
  now," and a finished task categorically isn't that, so there is no window
  where a completed task can still show in Focus (unlike the main list's
  "completed tasks hide unless 'show completed' is on" filter, which Focus
  deliberately does NOT reuse — see the note on the original step-12 planning
  text in this file's git history, which assumed that filter would apply
  here before D5 was locked to something stricter: an unconditional clear,
  not a toggle-dependent hide). Verified (12e) that the cascade half is real,
  not just the direct-click half — it is the one easy to implement only
  halfway and forget.
- **step 12 (D6)** — un-completing (step 7's reopen, direct or via reversing
  a cascade) deliberately does NOT restore `pinned`. Both reopen writes
  (app.js's checkbox listener) spread the existing task without touching
  `pinned` at all, so whatever D5 already set it to (always `false`) is what
  a reopened task keeps. Pinning is a cheap, explicit, one-click act;
  silently resurrecting a pin the user never asked to restore would be worse
  than just making them re-pin it. Verified (12f): reopening a
  cascade-closed, previously-pinned descendant left `pinned: false`.
- **step 12 (D7)** — pin/unpin is a context-menu-only action (no inline
  per-row button), following step 11's "Move to top level" as the pattern
  for a menu-only affordance. One shared `handleTogglePinClick` handler, one
  `enqueueMutation`-wrapped whole-document `saveTask` that flips whatever
  `pinned` IS at write time. The menu item is hidden entirely for a
  completed task (`openTaskMenuForTask`) — only a task that is neither
  completed nor deleted may be pinned — and its label reflects the task's
  CURRENT pinned state at open time ("Pin to Focus" / "Unpin from Focus").
- **step 12 (D8)** — the Focus section is hidden entirely
  (`focusSection.hidden = focusTasks.length === 0`) when nothing is pinned —
  no empty heading sits above the Inbox on a page with no pins. It renders
  ABOVE the Inbox and the main list, since it's the "now" list.
- **step 12 (D9)** — deleting a task (leaf or cascade) leaves `pinned`
  completely untouched — `softDeleteTask` never writes it, so it is neither
  cleared nor re-checked. Rationale: delete is reversible (the Trash is a
  holding area, step 9), so a delete should not quietly destroy an unrelated
  field; restoring from Trash therefore brings the pin back exactly as it
  was. This is a deliberate asymmetry with D5's completion rule, not an
  inconsistency — completing is a real, permanent statement about the task's
  work being done, which is why THAT one clears the pin and deleting doesn't.
  Focus's own render-time filter (`pinned && !completed`, over the
  non-deleted task set) is what keeps a deleted-but-still-pinned task out of
  Focus while it sits in the Trash, without needing to touch the field itself.
- **step 12 (D10, not really a decision)** — no change to `firestore.rules`
  or `firestore.indexes.json`: `pinned is bool` was already validated (step
  1), and step 12 is simply the first client code to ever write `true` to an
  already-valid field. Nothing about the schema itself changed.
- **steps 11–12 review round (issues 3, 4, 7)** — three bug fixes:
  - `handleTogglePinClick`'s `refreshTasks()` moved into a `finally`, matching
    the shape of every other queued mutation in this file. It was previously
    called inside the `try`, after `saveTask` — a failed write left the UI
    silently showing the pre-write pinned state until the 5-minute timer.
  - `performReparent` and `handleAddSubtaskClick` both derived a task's new
    `ancestors` from the cached `ancestors` field on the parent/new-parent
    task, contradicting taskTree.js's own header ("Parent/child links are
    derived from `parentId`, not from the stored `ancestors` field"). Both
    now derive the chain from `ancestorChain(freshTree, parentId)` instead —
    robust to a stale or corrupted cached field, since it's never read.
    `rewriteDescendantAncestors`'s signature changed to
    `(tree, newDraggedAncestors, draggedId, descendantId)` for the same
    reason: the descendant's tail now comes from walking `tree` via
    `ancestorChain`, not from slicing the descendant's own cached
    `ancestors`. `handleAddSubtaskClick` is step-4 code, not step 11/12 — it
    carried the identical defect and is fixed here as an explicitly
    out-of-scope fix, not as part of steps 11/12's own work.
  - `performReparent`'s descendant-rewrite loop rescanned `getTasks().find()`
    per iteration instead of snapshotting `const currentById = new
    Map(getTasks().map(...))` once before the loop, the idiom steps 5, 6, and
    8 already established — an O(n) rescan with no correctness benefit,
    since nothing else can mutate these tasks mid-loop (the queue serializes
    against every other enqueued mutation). Fixed to match; the loop's own
    comment no longer claims an exactness to step 8 it didn't have.
- **steps 11–12 review round (issue 6)** — `computeSubtreeHeight`,
  `canReparent`, and `rewriteDescendantAncestors` moved from `app.js` into
  `taskTree.js`. They are pure tree math (no DOM, no Firestore, no store
  access) composed directly over `buildTree`/`descendantIds`/`depthOf`/
  `ancestorChain` — exactly the kind of logic `app.js`'s own file header says
  does not belong there ("No task/tree logic lives here — that's
  taskTree.js"). `canReparent` reading task fields off `tree.byId` stays
  pure: `tree` is buildTree's own pure output, not a live reference. All
  three stay exported (a browser harness calls them directly for
  verification, same precedent as `computeReorderOrder`/
  `selectPurgeCandidates` staying in `app.js`); `app.js` now imports them
  from `taskTree.js` instead of defining them.
- **steps 11–12 review round (issue 5)** — `performReparent`'s write-time
  refusal handling now distinguishes a true no-op (nothing was overruled,
  stays silent — the task is already a child of that parent, or the user
  signed out mid-drag/mid-move) from a refusal of a drop the user actually
  completed (the depth cap, a cycle, or the drop target having been deleted
  or purged between the drag starting and this write running) — the latter
  now always alerts with a short cause-specific message and calls
  `refreshTasks()`, per product-spec.md's "the interface should make [an
  overruled action] visible rather than letting it appear to work and then
  snap back." Previously every refusal except the depth cap returned
  silently, and even the depth cap's own alert never triggered a refresh.
- **steps 11–12 review round (issue 1) — SUPERSEDES step 12's D3.** D3
  ordered Focus with the same raw-`order`-comparing `sortTasks`/
  `compareSiblings` the main list's SIBLINGS use, and called cross-group
  order "arbitrary but stable until step 16." That was wrong: `order` is a
  fractional index scoped PER SIBLING GROUP (step 1's decision), independently
  decremented per insertion within that group, so its magnitude carries no
  meaning across two different parents — concretely, a root `A` with 9
  children (the 9th's `order` around -9000, decremented once per insertion)
  and a root `B` created after `A` (`order` around -2000) renders the main
  list as `[B, A, C1..C9]`, but sorting the pinned set `{B, C9}` by raw
  `order` put `C9` (-9000) before `B` (-2000) — the reverse of the main
  list, directly violating product-spec.md §7's "Pinned tasks appear in the
  same order they hold in the main list."
  **New rule:** Focus is sorted by each pinned task's index in the actual
  depth-first RENDER order the tree containers (Inbox, then main list, in
  that order) already produce via `flattenTree` — reusing that
  already-computed output (`renderTasks`'s own `perContainer`), not a second
  traversal. This still inherits step 16's future comparator for free, since
  `flattenTree` runs through `compareSiblings` — the exact property D3 was
  trying to preserve, just implemented on the wrong (cross-group) input.
  Verified against the concrete failure case above: Focus order now matches
  the flattened main-list order exactly.
- **steps 11–12 review round (issue 2)** — the edit-mode API in `render.js`
  (`beginTitleEdit`/`endTitleEdit`/`getTitleInputValue`/`setTitleInputValue`
  and the four note equivalents) is now parameterized over a `context`
  argument (`"main"` or `"focus"`, selecting which entry Map to address via
  a `CONTEXT_MAPS` lookup) instead of doubled into named `*Focus` copies —
  16 exports collapsed back to 8, and the `isFocusRow ? Xfocus : X` ternary
  dispatch at every `app.js` call site collapsed to passing `context`
  through. This was step 12's own first-pass shape, which doubled every
  accessor instead of parameterizing over row-context; it didn't extend to
  a third context, and step 13's Overdue screen is shaped exactly like Focus
  (flat, full task rows), so a third context was always coming.
  `CONTEXT_MAPS` already lists all THREE row-shaped containers this codebase
  actually has — `main`, `focus`, and Trash's own `trashEntriesByTaskId` —
  though Trash isn't wired into `CONTEXT_MAPS` yet, since Trash rows carry
  no edit state today; adding it is designed to be a one-line addition, not
  another doubling, the day Trash rows grow inline editing.

- **step 13 (D1, scope)** — the Overdue Alerts Screen ships in THIS step,
  alongside plain due-date assignment and age display. Recurrence
  (product-spec.md §5's other big bullet) stays entirely out — it's step 18's
  own, later step, with no partial groundwork laid here.
- **step 13 (D2)** — `dueDate` is a Firestore Timestamp at **local midnight**
  of the due day. The `<input type="date">` value (`"YYYY-MM-DD"`) is parsed
  with `new Date(year, month-1, day)` (`render.js`'s
  `parseDateInputToLocalMidnight`) — never the string-constructor form
  `new Date("YYYY-MM-DD")`, which the ES spec parses as UTC midnight and
  therefore lands on the PREVIOUS calendar day in any negative-UTC-offset
  timezone. Formatting back to the input reads local `getFullYear`/
  `getMonth`/`getDate` (`formatDateForInput`) — never
  `toISOString().slice(0,10)`, the same bug mirrored in reverse. Both
  conversions live side by side in `render.js`, each commented with why the
  naive alternative is wrong, specifically so they can never drift apart.
  Verified with real computed values, not just reasoned about — see Verified.
- **step 13 (D3)** — a task is overdue iff its due date's **local calendar
  day** is strictly before **today's local calendar day** — computed via
  `localMidnight(dueDate).getTime() < localMidnight(now).getTime()`
  (`isOverdueTask`, render.js). Due TODAY is its own bucket, not overdue
  (product-spec.md §6 treats them as distinct terms). Completed and deleted
  tasks are never overdue, checked first and unconditionally, whatever their
  stored `dueDate` says — this is why a task that WAS overdue before being
  completed or deleted correctly drops out of the Overdue screen without
  needing `dueDate` itself to be touched by completion or deletion.
- **step 13 (D4)** — the Overdue screen is a THIRD `currentView` panel
  (`views.overdue`/`renderOverdueView`, app.js), following step 9's Trash
  view-switching precedent exactly — never a fourth section folded into the
  main view's single `renderTasks` call the way Focus (step 12) is. Its rows
  are nonetheless full task rows built from the same `createTaskElement`/
  `updateTaskElement` pair every other row uses (checkbox, title/note/
  due-date inline edit, drag handle, action buttons) — "exactly Focus's row
  shape," per this step's own brief — never Trash's much simpler
  label-plus-button shape, since Trash rows carry no edit state and Overdue
  rows need the due-date editor. This is a deliberate combination of two
  existing precedents (Trash's screen-level view-switching + Focus's
  full-row rendering), not a new third pattern. The screen's action buttons
  (drag handle, +Subtask, Delete, Move out of Inbox) were left fully live,
  matching Focus's own precedent of not disabling them — see the Assumed
  note on this for what's reasoned-about versus actually driven.
- **step 13 (D5)** — Overdue's order is the exact same `mainListOrderIndex`
  mechanism step 12's issue-1 fix introduced for Focus — each task's index in
  the real depth-first RENDER position the tree containers (Inbox, then main
  list) produce — never raw `order` (only meaningful within one sibling
  group) and never a second, independently-computed ordering rule. Hoisted
  into `render.js`'s own exported `computeMainListOrderIndex`, which
  `renderTasks` now calls internally too (previously this math lived inline
  inside `renderTasks`), so Focus and Overdue provably share one
  implementation rather than two copies that could silently diverge later.
  Verified against the exact scenario step 12's issue 1 got wrong (two
  overdue tasks under different parents, where raw `order` gives the reverse
  answer) — see Verified.
- **step 13 (D6)** — `render.js`'s `CONTEXT_MAPS` grew a third entry,
  `overdue: overdueEntriesByTaskId` — literally the one-line addition the
  steps-11–12-review-round issue-2 fix (the `context`-parameterized edit-mode
  API) was built to make possible. No accessor was doubled; `beginTitleEdit`/
  `endTitleEdit`/etc. needed zero changes to support the third context, only
  their callers in app.js needed the row-context lookup extended (see D10's
  `contextForRow` below).
- **step 13 (D7)** — task age is derived from `createdAt` on every render
  (`computeAgeLabel`, render.js) — never stored, no new field, no migration.
  Measured in **whole local calendar days** (today's local midnight minus the
  creation day's local midnight, divided by a day and floored), matching D3's
  calendar-day framing rather than a rolling 24-hour elapsed-time measure —
  "today" means "created today," not "created less than 24 hours ago." A
  `createdAt` that hasn't resolved locally yet (a doc whose `serverTimestamp()`
  the local snapshot hasn't caught up to) renders as the literal string
  `"age unknown"` — never `"NaN days old"`.
- **step 13 (D8, not really a decision)** — no change to `firestore.rules` or
  `firestore.indexes.json`: reading `isValidTask()` in full confirmed it never
  mentions `dueDate`, so every write this step adds already passed rules
  before this step existed. Nothing about the schema's validation changed.
- **step 13 (D9)** — setting or clearing a due date is a whole-document
  `saveTask(uid, {...currentTask, dueDate})` routed through `enqueueMutation`,
  re-reading the task from `getTasks()` at run time — never `updateDoc`,
  matching every other mutation in this codebase. Clearing (an empty
  `<input type="date">` value) writes `dueDate: null` explicitly, not
  `undefined` (which `setDoc` would reject) and not simply omitting the
  field (which would leave the previous value's stale Timestamp in place,
  since every write in this app is whole-document).
- **step 13 (D10)** — the UI affordance is BOTH of the two established
  patterns at once, not a choice between them: (a) an **inline editor on the
  row** — clicking a due-date display (a new `.task-item__due-display`/
  `.task-item__due-input` pair, sharing the exact display/input-toggle shape
  and `beginInteraction`/`endInteraction` guard step 2's title/note editing
  already established) opens the native `<input type="date">` in place, and
  (b) the **context menu** gained two items: "Set due date"/"Change due
  date" (label toggles per whether a due date already exists, same pattern
  as step 12's Pin/Unpin) which opens that SAME inline editor — not a
  parallel implementation — and "Clear due date" (shown only when a due
  date is set), a one-shot immediate write with no editor step, the same
  shape as step 12's `handleTogglePinClick`. Justification for two menu
  items instead of one: "open the editor" and "clear immediately" are
  different actions with different results, unlike Pin/Unpin's true
  toggle-between-two-states shape, so collapsing them into one label would
  hide one of the two actions. The date editor commits on blur only
  (matching the note field's rule, not the title field's Enter-commits
  rule) — Enter is treated as a commit-via-blur for convenience, but the
  primary commit path is losing focus, consistent with how a native date
  picker's own interaction model works (pick a date, click/tab away).
  `contextForRow(li)`/`fieldSuffixForContext(context)` (app.js) generalize
  step 12's `isFocusRow` boolean to all three row-contexts at every call
  site that needs to know which of a task's independent rows an event
  belongs to (click-to-edit, focusout commit, and — new for this step —
  which row a context-menu-opened editor should target, threaded through
  via `taskMenu.dataset.context`).
- **step 13 review round (issues 1+2)** — `beginEdit` (app.js) is now
  idempotent per `${taskId}:${field}` key: re-opening an edit that's already
  open in `openEdits` is a no-op, returning before EITHER `openEdits.add` or
  `beginInteraction()` run. Due date is the first field with two independent
  entry points onto the same edit state — clicking the due-date display, and
  the context menu's "Change due date" (`handleEditDueDateMenuClick`) — and
  its due-display, unlike title/note's, is NOT hidden mid-edit, so
  right-clicking a row with its due-date editor already open and choosing
  "Change due date" called `beginEdit` a second time: `openEdits.add` was
  already a no-op for the repeated key, but `beginInteraction()` fired
  unconditionally, incrementing `interactionDepth` a second time with no
  matching decrement (`closeEdit`'s own delete-based guard only ever pays
  back one of the two increments). This permanently leaked the interaction
  guard — the 5-minute auto-refresh silently stopped firing for the rest of
  the session, no error, no visible symptom until data went stale. The fix
  is in `beginEdit` itself, not at the `handleEditDueDateMenuClick` call
  site (the reviewed alternative) — title and note get the same guard for
  free, so any future second entry point onto an edit is safe by
  construction instead of depending on being remembered. **`beginEdit` being
  idempotent per key is now a load-bearing property** — later steps adding
  further entry points onto an existing edit (menu items, keyboard
  shortcuts, etc.) can call it freely without re-deriving this guard.
  `closeEdit` already had the symmetric guard (`openEdits.delete` only
  decrements when it actually removed a key), so a double-close was never a
  problem — nothing needed fixing there.
- **step 13 review round (issue 3)** — `renderTasks`'s two cleanup passes
  (main-list/tree containers, and Focus) checked only `entry.editingTitle`/
  `entry.editingNote` for a task leaving the rendered set mid-edit, never
  `entry.editingDueDate` — added in step 13 but only ever wired into
  `renderOverdue`'s own equivalent pass, not into these two, so a due-date
  editor left open on a main-list or Focus row whose task then left the
  rendered set (completed, deleted, filtered by "show completed") leaked the
  interaction guard exactly like issues 1+2, just via a different path.
  Fixed by hoisting all three passes' logic into one shared
  `closeAnyOpenEdits(entry, id, onEditCancelled, fieldSuffix)` (render.js),
  called from all three cleanup passes (main, Focus, Overdue) instead of
  each hand-maintaining its own list of which flags to check — a future
  fourth edit flag now only has to be added in this one function to be safe
  everywhere, instead of being added to three call sites and forgotten in
  one, which is exactly how this gap happened.
- **step 13 review round (issue 4)** — `timestampToDate` (render.js) now
  `console.error`s when `dueDate` is present but unparseable (a raw string,
  a malformed value, or a Timestamp-shaped object with no real `.toDate()`),
  before still returning `null`. `isValidTask()` (firestore.rules) never
  constrains `dueDate`'s shape, so such a value can legitimately arrive from
  the database (a manual Firestore edit, an import, a future migration) and
  was previously indistinguishable from "no due date at all" — silently
  hiding bad data instead of surfacing it. A genuinely `null`/absent
  `dueDate` remains completely silent — only the present-but-unparseable
  case logs.

- **step 14 (D1, storage)** — tag settings live in ONE document,
  `users/{uid}/meta/settings`, in a field `tags: { [tagName]: { fg, bg } }`.
  Each entry is an **object, not a bare color string**, specifically so step 15
  (quadrant mapping) extends the SAME entry with a `quadrant` key instead of
  forking a second map keyed by the same tag names — two maps would be two
  places a tag can exist, and the spec is explicit that one screen owns
  everything about a tag. The tag name INCLUDES its sigil (`#work` and `@work`
  are different tags). One document rather than one per tag because the whole
  map is read on every refresh and rendered as one screen, and because
  `isValidSettings()` already validates a `weekStart` field alongside `tags` —
  a shape that only makes sense for a single shared document. This is the FIRST
  code in this repo to read or write the `meta` collection; nothing touched it
  before.
- **step 14 (D2, the winner rule) — an explicit spec interpretation, recorded
  rather than made silently.** The winning tag is the **last tag in the typed
  title string that actually has colors assigned**, found by parsing tags in
  **string order** (`parseTags`, unchanged since step 2) and scanning that list
  from the end. Never DOM order, never visual order: in a Hebrew title the
  browser paints the last-typed tag furthest LEFT (verified: 14a), so anything
  reading visual position would invert the winner for exactly the titles this
  app exists to handle. product-spec.md §4 says "the last tag in the title text
  forces the color"; **read literally that would mean an uncolored last tag
  STRIPS the task's color** — type `#urgent … @office` where `@office` has no
  colors and the task would go from red to default. That is surprising and
  almost certainly not what "forces the color" describes, so the deliberate
  reading is "last COLORED tag wins" and the literal alternative is explicitly
  rejected here rather than left as an accident of implementation. If a later
  step ever wants the literal behavior, this is the entry to argue with.
- **step 14 (D3, what gets colored)** — the **whole row**, replacing the
  `task.colors` read that step 13 left behind in `updateTaskElement` (its own
  comment already named this step). Not individual tag tokens inside the title:
  colouring per-token would mean splitting the title into spans, which fights
  `dir="auto"`'s bidi handling of a mixed Hebrew/English string for no benefit
  the spec asks for. A task with no colored tag renders in the default row
  style, and that default now lives in ONE place — index.html's `.task-item`
  rule — because render.js CLEARS the inline properties rather than writing a
  hardcoded fallback pair. **`task.colors` is not read anywhere anymore**, and
  `addTask` no longer writes it. Documents created before this step keep the
  now-dead field: this repo has no migration tooling, `isValidTask()` never
  mentions `colors`, nothing reads it, and a whole-document `saveTask` on such
  a task faithfully rewrites it. Deliberately not migrated, not overlooked.
- **step 14 (D4, the screen)** — the Tag Settings page is a **fourth
  `currentView` panel** (`views.settings`/`renderSettingsView`, app.js),
  following step 9's Trash and step 13's Overdue precedent exactly — not a
  modal, not a fourth navigation pattern. Its rows are NOT task rows: keyed by
  `data-tag-name` instead of `data-task-id`, with their own
  `settingsEntriesByTagName` Map, and deliberately NOT added to render.js's
  `CONTEXT_MAPS` (those three are row-shaped, task-addressed, edit-capable
  containers; a settings row has no checkbox, no title/note/due editor, no drag
  handle and no depth). Consequence, handled: two delegated listeners on
  `#task-section` had to grow settings branches BEFORE the code that requires a
  `data-task-id`, and `contextmenu`/`pointerdown` were tightened from
  `closest("li")` to `closest("li")?.dataset.taskId` so a settings row can't
  swallow a right-click into a task menu that then refuses to open.
- **step 14 (D5, which tags are listed)** — the union of (a) every tag on a
  non-deleted task and (b) every tag already present in the settings map
  (`collectTagNames`, tagColors.js). (b) is not redundant: without it, deleting
  the last task carrying a tag would silently orphan that tag's configured
  color — the entry would live on in the document forever with no way left to
  see or clear it. Deleted tasks are excluded from (a) deliberately (a tag
  surviving only on a trashed task isn't part of the live vocabulary), and if
  such a tag has colors, (b) lists it anyway. A malformed entry keeps its key
  through normalization for the same reason: dropping it would hide the very
  row the user needs in order to fix it.
- **step 14 (D6, not really a decision)** — no change to `firestore.rules` or
  `firestore.indexes.json`. `isValidSettings()` (firestore.rules:61-65, read in
  full rather than assumed) accepts any `tags` map with <= 500 keys and does not
  constrain entry shape at all, and the `users/{userId}/meta/{docId}` match
  block has existed since before step 1 — step 14 is simply the first client
  code to use it. `weekStart` is deliberately never written: that field is step
  20's, and writing a default for it now would pick the user's week-start
  setting for them before the UI that owns it exists.
- **step 14 (D7, no quadrant groundwork)** — only `fg`/`bg` are written. Step
  15 owns quadrant mapping entirely; no partial scaffolding is laid here. What
  IS done is making the entry EXTENSIBLE and proving it: `normalizeTagSettings`
  copies unrecognized keys through verbatim at both levels, and
  `handleTagColorChange` spreads the existing entry before writing colors —
  verified live (14i) that a `quadrant` key survives a color change, and that
  "Clear colors" removes only `fg`/`bg` and leaves the rest of the entry
  standing.
- **step 14 (D8) — two different resolution rules on one settings page, and
  they must not be conflated.** COLOR = *last-typed-colored-tag wins* (string
  position decides). QUADRANT (step 15) = *urgency and importance each
  independently take the HIGHEST value any of the task's tags claims,
  escalating never averaging, across ALL tags* (string position is irrelevant).
  They read the same entry object off the same screen and are computed
  completely differently. A comment saying so sits directly on `resolveTagColor`
  in tagColors.js, where step 15 will be standing when it's tempted to
  parameterize one function to do both. Do not.
- **step 14 (D9, the write path)** — the settings document is written
  whole-document via `setDoc` (`saveSettings`), routed through
  `enqueueMutation`, with the current map re-read from the store INSIDE the
  queued mutation and the same `finally { await refreshTasks(); }` resync every
  other mutation in app.js uses. Never `updateDoc` — step 1's conflict rule
  applies to settings for the identical reason it applies to tasks. Both
  settings mutations (assign a color, clear a tag's colors) funnel through one
  `updateTagSettings(mutate, failureMessage)` helper, so there is exactly one
  place that builds the payload. `store.js` owns the cache (`getTagSettings`/
  `setTagSettings`), refreshed alongside tasks in the SAME `refreshTasks` pass
  (issued via `Promise.all` since neither read depends on the other — per-tag
  colors are read on every render, so a cache refreshed on any other schedule
  would leave rows painted from a stale map), and cleared by `invalidate()` on
  sign-out so a signed-out session cannot repaint the next user's rows from the
  previous user's colors.
- **step 14 (D10, read normalization)** — a settings document that does not
  exist yet, has no `tags` field, has a `tags` value that isn't a map, or holds
  a malformed entry all degrade to "no colors" without throwing
  (`normalizeTagSettings` + `readTagColors`, tagColors.js). A missing document
  is the NORMAL case for every existing user of this app, not an error — the
  first color assigned is what creates it. Colors are validated as two
  `#rrggbb` strings: a 3-digit shorthand, a named CSS color, a number, or a
  half-written entry all read as "no colors" rather than being passed through
  to `li.style`, where they would paint nothing and look like a resolver bug
  instead of bad data. Validation is split deliberately across two functions —
  `normalizeTagSettings` decides the document's SHAPE (and keeps every key, per
  D5), `readTagColors` decides per-entry whether it actually colors anything.
- **step 14 (D11, mine — `parseTags` moved out of app.js)** — into
  `tagColors.js`, alongside the color resolver that needs the identical rule.
  Step 2's decision is that exactly one place decides what counts as a tag; a
  second regex in the resolver would have been a second answer to that
  question, and the resolver could not import from app.js without a cycle
  (app.js imports render.js, which needs the resolver). Same function, same
  regex, new home — app.js now imports it. This also puts the module on the
  same footing as `taskTree.js`: pure logic, no DOM, no Firestore, every
  function exported so a browser harness can drive it directly, which is the
  only form verification takes in a project with no test runner.
- **step 14 (D12, mine — a color is resolved from the TITLE, not from
  `task.tags`)** — `resolveTagColor` re-parses the title on every render rather
  than reading the stored `tags` array, even though that array is written from
  the same `parseTags` call and is already in string order. Reason: `tags` is a
  cached denormalization of the title (exactly like `ancestors` is of
  `parentId`), and taskTree.js's own header already establishes the rule that
  the cache is never the source of truth — the steps-11–12 review round had to
  fix two places that read cached `ancestors` for precisely this reason. The
  title is what the user typed and what the spec's rule is phrased in terms of;
  re-parsing it costs one regex pass per row and cannot go stale.
- **step 14 (D13, mine — a settings entry with no keys is kept, not deleted)** —
  "Clear colors" deletes only `fg`/`bg` and leaves `{}` behind rather than
  removing the tag from the map. Two reasons: the entry may already carry a
  step-15 quadrant, and "clear colors" is not "clear everything about this
  tag"; and per D5 the tag must keep listing on the settings screen even if no
  live task carries it anymore. The cost is that an empty entry accumulates
  against `isValidSettings()`'s 500-key cap — acceptable, since tag creation is
  a human typing act and step 17 (tag rename/delete) is the step that owns
  removing a tag outright.

- **step 15 (Q1, storage — locked by the orchestrator, not re-litigated)** —
  a quadrant is a SINGLE enum string (`entry.quadrant`, one of
  `"urgent-important"` / `"not-urgent-important"` / `"urgent-not-important"` /
  `"not-urgent-not-important"`) on the same settings entry step 14 built,
  never two boolean fields. The spec (§7) says "assign a quadrant," singular,
  and its own worked examples (`#p1`, `#deadline`) are whole quadrants a
  human picks directly — urgency/importance only ever exist as values
  DERIVED from this string at resolve time (`resolveTaskQuadrant`), never
  stored as their own fields. Absent, `null`, or any unrecognized string all
  read back as "unconfigured" (`readTagQuadrant`).
- **step 15 (Q2, resolution — the null-vs-explicit-bottom-quadrant
  distinction)** — urgency and importance are each resolved independently as
  an OR across every CONFIGURED tag a task carries (an unconfigured tag
  contributes NOTHING, not `false`), escalating never averaging — the exact
  same "most demanding tag wins" framing D8 (step 14) already used to
  contrast this from color resolution. Critically, `resolveTaskQuadrant`
  returns `null` ("unranked") when NONE of a task's tags carries a valid
  quadrant — a state deliberately distinct from `QUADRANT_NEITHER`
  ("explicitly neither urgent nor important," still a real answer from a
  real tag mapping). Conflating the two would make an entirely unmapped task
  rank identically to one whose only configured tag explicitly claims the
  bottom quadrant, which directly contradicts §7's "an unconfigured tag stays
  silent rather than defaulting into a quadrant" — silence and an explicit
  "neither" are not the same thing, and only the rank order (Q3) makes that
  distinction observable.
- **step 15 (Q3, the rank order — this step's own recorded call, spec
  silent)** — `quadrantRank` (tagColors.js): `0` urgent+important, `1`
  important-only, `2` urgent-only, `3` neither, `4` unranked. The
  important-before-urgent choice (rank 1 before rank 2) is standard
  Eisenhower framing (schedule outranks delegate); product-spec.md never
  states an order between the two single-dimension quadrants, so this is
  recorded here rather than left as an implementation accident. Exported
  specifically so step 16 (priority ordering) only ever imports it — that
  step's own Resume-here section above says as much. Unranked (`4`) sorting
  worse than every explicit quadrant including `QUADRANT_NEITHER` (`3`) is
  the direct consequence of Q2's null-vs-neither distinction: "no information
  at all" cannot outrank a real, if unambitious, mapping.
- **step 15 (Q4, do not reuse `resolveTagColor`)** — a completely separate,
  newly-written pure function (`resolveTaskQuadrant`), never a
  parameterization of the color resolver, per D8 (step 14)'s own warning
  comment sitting directly on `resolveTagColor`. Color = last COLORED tag in
  the title STRING wins (position is everything). Quadrant = highest urgency
  and highest importance independently across ALL tags (position is
  irrelevant) — verified as actually divergent behavior, not just asserted:
  swapping two configured tags' order in a title left the resolved quadrant
  unchanged while the identical swap is exactly what flips the resolved
  color. Both resolvers read from the TITLE string via `parseTags`, never
  from the cached `tags` array (D12's precedent extended, not re-argued).
- **step 15 (Q5, per-field reader)** — `readTagQuadrant` mirrors
  `readTagColors`'s exact shape: `null` for any entry that doesn't validly
  carry a quadrant (missing, malformed, or an unrecognized string), so a tag
  can have colors and no quadrant, or a quadrant and no colors, on the same
  entry object. Verified against 15 malformed/partial shapes with zero
  throws (see Verified).
- **step 15 (Q6, the task-row badge)** — a compact pill
  (`.task-item__quadrant-badge`) in the existing `.task-item__meta` row,
  next to age, with the full quadrant name on its `title` attribute (a native
  hover tooltip) rather than spelled out inline — keeping the row compact and
  not disturbing an RTL title above it. Resolved fresh on every render from
  the title (never stored), and genuinely ABSENT (`display: none`, no text,
  no `title` attribute) for an unranked task — not an empty badge sitting
  there mute. This reuses `createTaskElement`/`updateTaskElement`, so Focus
  and Overdue rows (which share that same function pair) get the badge for
  free; Trash rows do not, since Trash uses its own separate, simpler row
  builder that was never given `tagSettings` to resolve from.
- **step 15 (Q7, ordering explicitly untouched)** — `compareSiblings` and
  every sort path in `render.js`/`app.js` are byte-for-byte unchanged
  (confirmed via `git diff`, not merely "we didn't mean to touch it"). This
  step ends at "every tag can be assigned a quadrant, and a task's quadrant
  is computable and visible" — wiring `quadrantRank` into the actual sort
  comparator is step 16's work alone, per step 1's own Decisions entry that
  already named this handoff (`(quadrantRank, order)`) before this step
  existed.
- **step 15 (write path)** — a sibling of `handleTagColorChange`
  (`handleTagQuadrantChange`, app.js), through the same
  `updateTagSettings(mutate, failureMessage)` helper, same whole-document
  `enqueueMutation`+`saveSettings`+`finally refreshTasks()` shape — no second
  write path. Spreads the existing entry (`{ ...(tags[tagName] ?? {}),
  quadrant: quadrant || null }`) so a quadrant change never drops a tag's
  colors, mirroring `handleTagColorChange`'s own spread in the other
  direction. The `<select>`'s blank option writes `quadrant: null` explicitly
  (not `undefined`, which `setDoc` would reject, and not an omitted key,
  which would leave a stale prior value standing in a whole-document write).
- **step 15 (not really a decision) — no change to `firestore.rules` or
  `firestore.indexes.json`.** `isValidSettings()` was already read in full for
  step 14 (D6) and constrains only `weekStart`'s value and `tags`'s
  type/key-count, never entry shape — a `quadrant` key inside an entry passes
  exactly as `fg`/`bg` do. `weekStart` remains unwritten (step 20's field).

- **step 16 (R1, sort scope — locked by the orchestrator, not re-litigated)**
  — the sort key is `(quadrantRank, order)`, applied ONLY within one sibling
  group (same `parentId`), never as a global flat sort. Hierarchy outranks
  priority absolutely: `compareSiblings` (render.js) is called exclusively
  from within `flattenTree`'s per-node `[...nodes].sort(...)` — `nodes` is
  always one parent's own `children` array (or `tree.roots`) — so a rank-0
  child can mathematically never be compared against, let alone sort above,
  its own parent or an unrelated task at a different depth. Verified live: a
  synthetic rank-0 child of a rank-3 root, rendered alongside a rank-0 root
  sibling of that parent, produced `[Root2(rank0), Parent(rank3), Child(rank0
  child of Parent)]` — Child stayed immediately after Parent (its true
  tree position), never promoted to the top despite outranking Parent.
- **step 16 (R2/R3, rank is never stored, computed once per pass)** — a
  task's rank is resolved fresh from `resolveTaskQuadrant(task.title,
  tagSettings)` + `quadrantRank(...)` on every render/drag setup, never
  written to a document (storing it would go stale the instant a tag mapping
  changes, with no write touching the affected tasks). The one shared builder
  is `computeQuadrantRankMap(tasks, tagSettings)` (tagColors.js) — it returns
  a `Map<taskId, rank>` computed with exactly one pass over `tasks` (one
  `resolveTaskQuadrant` call per task), and every consumer calls it ONCE per
  render/drag pass rather than the comparator calling it per comparison:
  `renderTasks` (render.js) builds one Map covering every task in every tree
  container and threads it through `flattenTree`→`compareSiblings` and into
  `computeMainListOrderIndex`; `app.js`'s `renderOverdueView` builds its own
  the same way; the drag machinery (`beginDrag`) builds one at drag START
  (covering the dragged task + its siblings) and reads from it for the whole
  gesture — `updateDragTarget` (called on every `pointermove`) never touches
  `resolveTaskQuadrant`, only `Map.get`. `compareSiblings` itself takes the
  Map as a parameter and only ever calls `.get` — the "factory closing over
  the map" R3 asked for, implemented as a plain extra argument instead, which
  is equivalent and needed no new closure machinery. `firestore.indexes.json`
  stays `[]` — every sort is client-side, as it always was.
- **step 16 (R1 secondary key unchanged)** — `order`'s existing role (step
  1's fractional index, scoped per sibling group, computed by
  `computeReorderOrder`/the precision-renumber guard, all untouched) is
  still the tie-breaker whenever two siblings share a rank. Verified: three
  tasks tied on `#p1` (rank 1) with orders `100/200/300` sorted strictly by
  that order (`Y(100), Z(200), X(300)`); a mixed set of six tasks across
  five different ranks (0/1/2/3/4, with two tied at rank 0 on orders
  `50/9999`) sorted `[rank0-low-order, rank0-high-order, rank1, rank2,
  rank3, unranked]` exactly.
- **step 16 (R4, Focus/Overdue inherit for free — no ordering rule of their
  own)** — `computeMainListOrderIndex` (render.js) grew a `rankMap`
  parameter (was previously un-parameterized, comparing raw `order` across
  groups per its own pre-step-16 docstring) and threads it into the same
  `flattenTree` call it already made; nothing about `renderMainView`'s Focus
  wiring (app.js) or `renderOverdue`'s Overdue wiring needed to change at
  all — they already fed this function's output through unmodified. Verified
  live: pinning three tasks spread across four differently-ranked roots
  (including one pinned child nested under a pinned low-rank parent)
  produced a Focus list order that was byte-for-byte the pinned subset of
  the main list's real DOM order; separately, marking two of those same
  tasks overdue produced an Overdue screen order that was the overdue subset
  of that identical main-list order.
- **step 16 (R5, the overruled drag — this step's own recorded mechanism,
  spec silent on the concrete UI)** — a sibling drop gap is "free" (the
  dragged task will actually settle exactly where dropped) iff the dragged
  task's own rank falls in the CLOSED numeric range bounded by its two
  prospective neighbours' ranks: `(beforeRank == null || beforeRank <=
  draggedRank) && (afterRank == null || draggedRank <= afterRank)`
  (`isSiblingGapFree`, app.js). This is stricter than "both neighbours must
  share the dragged task's exact rank" and deliberately so: it correctly
  treats the EDGE of the dragged task's own contiguous rank-run as free too
  (e.g. dropping a rank-2 task immediately after the last rank-1 item and
  before the first other rank-2 item is achievable, even though the
  "before" neighbour is a different rank) — proven by direct before/after
  simulation of the exact `order` value `computeReorderOrder` would write
  for that drop, then re-rendering and confirming the task really does land
  there. A gap that fails the check gets `.drop-indicator--overruled`
  (index.html — a dashed orange line, reusing the same orange
  `.task-item--reparent-target` already uses for "this is a different kind
  of target," per this file's existing visual language) INSTEAD of the
  plain blue line, shown DURING the hover, before release — verified live
  with real `pointerdown`/`pointermove` `PointerEvent`s and real
  `getBoundingClientRect()` geometry against actual rendered rows (four
  boundary cases: strictly inside a foreign block, at the very top of the
  whole list, at the very bottom, and at the edge of the dragged task's own
  run) — all four matched the formula's prediction exactly. **The drop is
  never refused** — `drag.target` stays non-`null` and `overruled: true`
  rides along on it; `finishDrag` writes `order` through the exact same
  `computeReorderOrder`/precision-renumber path as any other drop, with NO
  special-casing of the write itself (per the orchestrator's explicit "do
  not discard the write, do not refuse the drop"). AFTER a successful
  overruled write, `finishDrag` `alert()`s, naming the DRAGGED TASK'S OWN
  resolved quadrant (via `resolveTaskQuadrant`/`describeQuadrant`,
  freshly re-resolved from the just-re-read `currentTask`, never the
  drag-time snapshot) as the thing that overruled the drop — chosen over
  naming whichever neighbour's rank technically triggered the failure
  because the dragged task's own rank is what actually governs where it
  will really settle regardless of which side of the boundary the drop
  crossed, so it's the one description that's always correct in both
  directions (spec's own example: a low-priority task dragged above a
  high-priority one, and the symmetric case of a high-priority task dragged
  below a low-priority one). Proven two ways: (a) live in the browser, that
  a REAL drag-and-release through both a free gap and an overruled gap
  completes with no console error and correctly clears the indicator either
  way; (b) by directly simulating the exact `order` value the write would
  produce for a free top-of-list drop versus an overruled bottom-of-list
  drop and re-rendering — the free drop's task genuinely moved to the top
  (`[B,A,C,D]`), while the overruled drop's task, despite writing a real,
  distinct `order` value 3000 higher than before, did NOT move at all after
  re-render (`[A,B,C,D]`, unchanged) — concretely demonstrating "the write
  lands, the position does not hold" rather than merely asserting it. The
  literal `alert()` call itself could not be driven end-to-end without
  signing in (it sits behind `enqueueMutation`'s existing `if (!userId)
  return` guard, unsigned-in-unreachable for the identical reason step 11's
  D8/issue-5 write-time alerts already are — see those Decisions entries),
  so the exact wording is verified by reading the source, not by observing
  the dialog fire.
- **step 16 (R6, no regression to step 15)** — `resolveTaskQuadrant`,
  `quadrantRank`, the settings screen's quadrant `<select>`, and the
  task-row badge are byte-for-byte untouched; `git diff` against step 15's
  landed commit touches only `compareSiblings`/`sortTasks`/`flattenTree`/
  `computeMainListOrderIndex`/`renderTasks` (render.js), the drag machinery
  plus `renderOverdueView` (app.js), one new export
  (`computeQuadrantRankMap`, tagColors.js), and one new CSS rule
  (`.drop-indicator--overruled`, index.html).
- **step 16 (not really a decision) — no change to `firestore.rules` or
  `firestore.indexes.json`.** Every sort is client-side and rank is never
  stored (R2), so nothing about the schema or its validation needed to
  change; `firestore.indexes.json` stays the empty array it always was.

- **step 16 review round — a "place at top of group" value comes from a true
  `Math.min` over stored `order`, never from `sortTasks(...)[0]`.** As shipped,
  `performReparent` took its reference sibling from the rank-first sorted list's
  first element, an assumption that was correct before step 16 and silently
  false after it: that element is the highest-*ranked* sibling, whose `order`
  can be far above the group's minimum. Reproduced in the browser against the
  real modules — siblings `{A: rank 0, order -100}` and `{B: rank 4, order
  -5000}` gave `sorted[0].order - 1000 = -1100`, which does **not** sit below
  B. Now mirrors `taskService.js`'s creation path exactly
  (`Math.min(...orders) - 1000`, `0` for an empty group). Later steps: sorting
  for display and selecting an extreme are different questions — any future
  "top/bottom of group" arithmetic reads raw `order`, never a display index.
- **step 15/16 documentation — `tags.<tag>.quadrant` is now in FIREBASE.md's
  settings-schema table**, including the load-bearing distinction that an
  *absent* `quadrant` (unmapped, sorts last) is not the same as
  `'not-urgent-not-important'` (mapped, ranks above unmapped).

- **step 17 (S17-1, undo shape — locked by the orchestrator, not
  re-litigated)** — a single module-level variable in app.js
  (`tagUndoSnapshot`), never persisted, never a stack: `{ kind:
  'rename'|'delete', tagName, entries: [{taskId, previousTitle}],
  previousTagSettings }`. Cleared alongside `store.js`'s own `invalidate()`
  in the sign-out path (monitorAuthState) — a second account signing in on
  the same page must never see an "Undo" offering to rewrite ITS tasks with
  the FIRST account's title snapshot. The Undo button's own label
  (`Undo renaming "X" (lost on reload)`) says so explicitly rather than
  implying a durable history this app doesn't have.
- **step 17 (S17-2/S17-3, undo semantics — locked)** — Undo replays every
  entry's `previousTitle` VERBATIM (never a reverse rename/re-insertion,
  which would also rewrite a task that legitimately already carried the
  destination tag by the time Undo runs) and restores `previousTagSettings`
  WHOLESALE — never re-deriving the old settings shape from the new one.
  Held as a direct object reference, not a deep clone: safe only because
  every mutator in this file (`updateTagSettings` included) builds a NEW
  object via spread rather than mutating one in place, so the snapshot can
  never be silently corrupted by a later, unrelated settings write. One
  slot, no stack (S17-3): a second tag operation replaces whatever the first
  left behind, and performing Undo consumes the slot immediately on entry
  (before the write even runs), so a failed Undo does not get a second Undo
  pointed at it.
- **step 17 (S17-4, token matching — locked)** — `rewriteTagInTitle`
  (tagColors.js) re-derives offsets via `matchAll` over the exact same
  `TAG_PATTERN` `parseTags` uses, then filters matches by exact string
  equality to the target tag — never a bare `String.replace`/`split` on the
  tag text. This gets the `#work`/`#workshop` prefix hazard right for free,
  the same way `parseTags`'s own `\w+` word-boundary already does, rather
  than needing a second defense. Delete removes the matched token plus
  exactly one adjacent whitespace character — preferring the trailing space
  (keeps the leading separator as the sentence's word boundary when the tag
  sits mid-title) and falling back to the leading space only when the tag is
  the last thing in the title — so a deletion can never leave a double space
  or a leading/trailing one. Verified with real computed values at all three
  tag positions (start/mid/end) and against a real RTL title.
- **step 17 (S17-5, whole-batch pre-check — locked)** — `planTagRewrite`
  (tagColors.js) checks EVERY affected task's rewritten title against the
  1–1000 character cap (`taskService.js:32-34`/`177-179`,
  `firestore.rules:46-48`) before the caller writes anything, returning
  either every entry or the single task that blocks the whole batch — never
  a partial result. One shared function for rename and delete: delete can
  only ever shorten a title, so the cap's upper half is a structural no-op
  for it, which is not a reason to fork a second checker. Verified with a
  constructed 1032-character overflow (rename) and an empty-after-delete
  title (the tag was a title's only content) — both correctly blocked, with
  the exact blocking task named.
- **step 17 (S17-6/S17-7, the settings-map move — locked)** —
  `moveTagSettingsEntry` (tagColors.js) is the ONE function for both a
  rename's move and a delete's removal (`newTagName: null` triggers
  removal), mirroring D1's shared-entry-object precedent from step 14. A
  rename that lands on an ALREADY-configured destination tag merges titles
  (duplicate tokens are left standing, not cleaned up — colour is
  last-typed-colored-tag-wins and quadrant is an OR-across-tags, so a
  duplicate token is harmless to both) but never merges settings: the
  destination's existing entry wins outright and the source entry is
  dropped, verified concretely (a pre-configured `#b` survived a rename of
  `#a` onto it completely unchanged). Delete is "both, not one" (S17-7): the
  title token strip AND the settings-key removal together — a deliberate
  contrast with step 14's D13 "Clear colors," which leaves an empty `{}`
  entry behind on purpose because that action isn't "remove this tag" and
  step 17's delete genuinely is.
- **step 17 (S17-8, the batch write — locked)** — one `enqueueMutation`, a
  sequential per-task `saveTask` loop, the exact idiom step 8's cascade
  delete established (app.js:911-937) — no `writeBatch`, nothing in this
  codebase uses one. The undo snapshot is captured BEFORE the loop's first
  write, not after the loop completes: a mid-batch network failure still
  leaves a CORRECT Undo in place, since replaying `previousTitle` for a task
  this attempt never got to write is simply a no-op for that task. This is
  what makes the catch block's "click Undo to restore every title this
  touched" message honest rather than aspirational, and it is why the
  failure alert points at Undo instead of apologizing generically the way
  step 8/11's cascade-failure alerts do (those steps have no undo to point
  at; this one does).
- **step 17 (S17-9, the confirm — locked)** — `confirm()` names the exact
  affected-task count (never a generic warning), matching every existing
  destructive-action precedent in this app. When zero live tasks carry the
  tag, the confirm says so explicitly rather than reading "0 tasks" as a
  degenerate case — rename is still a no-op-for-tasks-but-not-for-settings
  per the spec's own wording (a rename with no carrier still moves the
  settings entry), so the confirm still needs to run and Undo still needs a
  valid snapshot even when `entries.length === 0`.
- **step 17 (mine — the sweep is scoped to non-deleted tasks only)** — an
  explicit reading of product-spec.md:226-234's "every task that uses it,"
  recorded rather than left as an implementation accident. Matches D5 (step
  14)'s own "live vocabulary" reasoning for which tags even list on the
  settings screen: a tag surviving only on a trashed task isn't part of it,
  and silently rewriting a trashed title the user can't currently see (and
  might still restore later, in whichever form it was deleted in) would be
  an invisible side effect of an action the confirm dialog didn't warn about.
  If a later step wants trashed titles included, this is the entry to argue
  with — it would also have to decide what Undo does about a task that gets
  restored from Trash in between the rename and the Undo.
- **step 17 (mine — rename-input validation surfaces as `alert()`s, not
  silent no-ops)** — an invalid new tag name (fails `isValidTagToken`) or a
  new name identical to the old one each produce a specific `alert()` rather
  than silently doing nothing, matching this app's existing habit (title/
  note/tag-count length checks all alert with a specific reason rather than
  swallowing the rejection).
- **step 17 (not really a decision) — no change to `firestore.rules`,
  `firestore.indexes.json`, or `public/taskService.js`.** Every write this
  step adds is still a whole-document `saveTask`/`saveSettings`, identical in
  shape to every other mutation in this app; the settings entry's shape is
  unchanged (rename/delete only ever move or remove a whole entry, never
  touch `fg`/`bg`/`quadrant` inside one), and `isValidTask()`'s 1–1000 title
  cap is enforced client-side by `planTagRewrite` before any write, the same
  belt-and-suspenders relationship every other title-length check in this
  codebase already has with the rules.
- **step 18 (S18-0, USER DECISION 2026-08-18) — the plan's "Stop Recurrence"
  context-menu row is SUPERSEDED.** The step-18 row in the original ladder
  called for a "Stop Recurrence" menu action; product-spec.md §5:145-148
  rules that out explicitly — deleting the task is what ends a cycle, and
  "there is no separate 'stop repeating' state that leaves an inert task
  behind." Asked the user directly; they chose to follow the spec over the
  plan. Deletion already ends a cycle with zero new code (a deleted task is
  neither rendered nor advanced). The recurrence *editor* itself still keeps
  a "none" answer so a misconfigured rule can be corrected without deleting
  the task — that is functionally a stop, but it is not a standalone menu
  action presented as "the way to end a cycle," which is what the spec rules
  out.
- **step 18 (S18-1, storage)** — `recurrence: { kind, ... } | null` plus
  `occurrenceStart: Timestamp | null`, both new task-document fields.
  `isValidTask()` (firestore.rules:44-59) has no `hasOnly` clause and
  mentions neither field, confirmed by reading it (not assumed) — so both
  write with **no rules change**, exactly as `dueDate` (step 13) did. Rule
  shapes: `{kind:'daily'}`; `{kind:'weekdays', days:number[]}` (0=Sun..6=Sat,
  non-empty); `{kind:'weekly', anchorDay:number}` (preserves that weekday);
  `{kind:'monthly', anchorDayOfMonth:number}` (1..31).
- **step 18 (S18-2, locked) — advance is "step the rule forward until
  strictly after TODAY," never "one step from the old due date."** A daily
  task completed five days late becomes due tomorrow, not still-overdue —
  this is what product-spec.md:141-142's "a daily task never reports itself
  as months old" actually requires. `advanceRecurrence` (recurrence.js)
  loops `stepOnce` until the result clears today's local midnight.
- **step 18 (S18-3) — age resets via a new field, with a fallback that
  avoids a migration.** `computeAgeLabel`'s one caller (render.js) now reads
  `task.occurrenceStart ?? task.createdAt` instead of `task.createdAt`
  alone. The `?? createdAt` fallback leaves every existing task's age
  byte-identical (no backfill needed): `occurrenceStart` is `null` until a
  recurring task's first completion ever stamps it, and is re-stamped to
  the MOMENT OF THE ADVANCE (today), not to the new due date — a monthly
  task's next occurrence can be weeks away, and age must still read as
  freshly reset today, not as some future-dated or negative value.
- **step 18 (S18-4) — monthly clamps to month end but re-anchors from the
  STORED day-of-month, never from the current (possibly already-clamped)
  due date.** Jan 31 → Feb 28/29 → **Mar 31**, never permanently degrading
  to the 28th. This is why `anchorDayOfMonth` is stored (derived once, at
  setup time, via `deriveAnchorFromDate`) rather than re-read off the
  current due date on every advance — proven concretely (see the Verified
  section above) against both a common year and a leap year.
- **step 18 (S18-5) — a recurring task must have a due date.** Setting a
  recurrence on a task with no due date defaults the due date to today
  (`handleSetRecurrenceClick`, app.js) before deriving weekly/monthly's
  anchor from it — a rule with no anchor cannot advance, and daily/weekdays
  need a starting point to step forward from just as much as weekly/monthly
  need one to derive their anchor from.
- **step 18 (S18-6, locked) — completing a recurring task does NOT complete
  it, and does NOT run the cascade.** The checkbox `change` listener's
  completing branch (app.js) checks `task.recurrence` and, if set, advances
  `dueDate`, restamps `occurrenceStart`, writes `completed: false` /
  `closedByCascadeFrom: null`, and `return`s — **before** `buildTree`/
  `descendantIds` are ever called for the plain-completion cascade. A
  recurring parent's children are therefore not merely left alone by a
  runtime check; the cascade code is syntactically unreachable from this
  branch. The checkbox visually un-checks itself because the refetch still
  shows `completed: false`.
- **step 18 (S18-7) — no history of past occurrences.** One task, one
  document, that keeps moving forward — `recurrence`/`occurrenceStart` are
  overwritten in place on every advance, never appended to a list and never
  used to spawn a second document. Matches product-spec.md:138-140 exactly:
  "no history of past occurrences is kept... nothing accumulates in the
  list."
- **step 18 (mine — the editor is `prompt()`-based, not a new inline
  display/input pair)** — recurrence needs a kind PLUS, for `weekdays`, a
  set of days, which doesn't fit the single display/input pair every other
  editable field (title/note/due date) uses. Matches step 17's tag-rename
  precedent (`prompt()`/`confirm()` for a multi-field, non-trivial edit)
  rather than inventing a fourth inline-editor shape for one field.
- **step 18 (mine — recurrence.js has zero imports, unlike every other pure
  module added since step 14)** — its advance arithmetic needs the exact
  same local-midnight construction render.js already exports as
  `localMidnight`, but importing it would create a render.js ↔
  recurrence.js cycle: render.js's row badge needs recurrence.js's
  `describeRecurrence`, and recurrence.js would need render.js's
  `localMidnight` back. Rather than accept a cycle between two files loaded
  as native ES modules with no bundler, `recurrence.js` duplicates the
  one-line local-midnight construction internally (`localMidnightOf`) and
  works only with plain `Date`s — callers (app.js) are responsible for
  unwrapping a Firestore Timestamp via render.js's `timestampToDate` first.
  If a later step needs a THIRD pure module to talk to both of these, this
  is the entry to revisit — the two-file DAG (recurrence.js → nothing,
  render.js → recurrence.js) only stays acyclic because recurrence.js never
  needs anything back.
- **step 18 (mine — a recurrence badge on the row, not spec-mandated)** — 
  product-spec.md §5 never asks for a visible indicator that a task repeats;
  it only requires the behavior. A `.task-item__recurrence-badge` (🔁 +
  `describeRecurrence`) was added anyway, mirroring the existing
  age/due-date/quadrant badges' precedent of surfacing render-only metadata
  the spec assumes is visible somehow, and because a recurring task with no
  visible sign it will recur is a plausible usability complaint later. If
  this is unwanted polish, it is a one-line revert (drop the badge's two
  `updateTaskElement` branches and its `createTaskElement` element) with no
  effect on the underlying recurrence/advance logic.
- **step 18 (not really a decision) — no change to `firestore.rules`,
  `firestore.indexes.json`, or the write shape in `taskService.js`.** Every
  recurrence write is still a whole-document `saveTask`, identical in shape
  to every other mutation in this app; `normalizeTask` only adds the two new
  fields' read-time defaults (S18-1), and `isValidTask()` (re-confirmed by
  reading, not re-derived from step 13's note about `dueDate`) constrains
  neither new field.
- **step 19 (S19-0) — search is a FILTER on the main view, not a new
  screen.** Reuses `renderMainView`'s single render path (Inbox, main list,
  Focus, `showCompleted`, pinning, drag, quadrant sort) rather than
  reimplementing all of it behind a fourth `currentView` panel the way
  Trash/Overdue/Settings each did for genuinely different content.
- **step 19 (S19-1) — the leaf evaluator (`matchesTerm`, `searchQuery.js`)
  is a standalone, pure, exported function, and step 20 reuses it
  VERBATIM.** This is the one decision that makes step 20 an additive
  change (a grammar layered on top) instead of a rewrite — nothing about
  matching a single term may ever move into `render.js`/`app.js`.
- **step 19 (S19-2, final for both steps 19 and 20) — term semantics.** A
  bare word is a case-insensitive substring over `title + "\n" + note`
  (covers spec:166-168's "tags in the title, the rest of the title, and the
  note" in one pass — `task.tags` is NOT separately consulted for a bare
  word, since a tag token already sits inside the title text). A
  `#foo`/`@foo` term is WHOLE-TOKEN, case-insensitive equality against
  `task.tags` — whole-token so `#pr` can never match `#private` (spec's own
  example treats them as distinct tags); case-insensitive only for search,
  never for tag identity elsewhere (a settings-screen `#Work` and `#work`
  stay two separate entries). Step 20 adds NO new leaf kinds to this list —
  only new grammar (AND/OR/parens) over it, plus wholly separate temporal
  leaf kinds (`today`, `age > 20d`, `overdue`, ...) step 19 never touches.
- **step 19 (S19-3) — whitespace is an implicit AND, decided now rather
  than deferred to step 20.** `foo bar` requires BOTH terms to match, never
  a literal substring search for `"foo bar"` — chosen now so step 20's
  grammar is purely additive and no user-visible behavior flips between the
  two steps. A blank query has zero terms, and "every term in an empty list
  matches" is vacuously true for every task — this is what makes an empty
  search box mean "no filtering" with no separate on/off flag anywhere.
  Quoted-phrase search is NOT implemented in either step; record it absent
  so a later session does not assume it exists.
- **step 19 (S19-4) — ancestor context, with a deliberate asymmetry.** A
  visible-but-non-matching task is shown as context for a matching
  DESCENDANT (spec:169-172, "the parent is still shown") and dimmed via a
  new `.task-item--search-context` modifier. Descendants of a match are NOT
  pulled in — the spec grants context upward only; pulling a whole subtree
  in under one matching ancestor would defeat the filter entirely. Record
  this asymmetry explicitly: it reads as a bug to anyone who hasn't read
  this line.
- **step 19 (S19-5, load-bearing — do not reorder) — filter stage
  ordering.** `search-match → ancestor expansion → the existing filters
  (deleted / inbox split / showCompleted / pin), unchanged`. The
  `showCompleted` filter applies to the search-narrowed candidate set
  (AND), not the reverse — this is what makes a hidden completed match
  correctly fail to drag an otherwise-empty ancestor into view on its own
  (proven concretely in the Verified section above by toggling
  `showCompleted` with the search term held fixed).
- **step 19 (S19-6) — scope is main list + Inbox + Focus; Trash and
  Overdue are NOT searched.** All three in-scope surfaces render through
  `renderMainView`'s one `nonDeletedTasks` search stage; Trash and Overdue
  are separate screens with their own render functions, and `overdue`
  becomes an ordinary query TERM in step 20 (spec:182-184) rather than a
  searchable screen.
- **step 19 (S19-7) — no debounce.** The filter is a pure function over an
  already-fetched, keyed-rendered list (`entriesByTaskId`) — exactly the
  design that makes per-keystroke re-render safe and cheap. Recorded so a
  later session doesn't "fix" a latency problem that doesn't exist here by
  adding one.
- **step 19 (S19-8) — search state is UI-only, never persisted.** No new
  task field, no new settings field, nothing sent to Firestore. Escape
  clears the box (a dedicated `#search-input` `keydown` listener, since the
  box has no per-row open-edit lifecycle to route through the shared
  title/note/due-date Escape handler); sign-out clears it too, mirroring
  `tagUndoSnapshot`'s cleanup in the same `monitorAuthState` branch (step
  17's precedent) so a second account signing in on the same page never
  sees the first account's query.
- **step 19 (S19-9) — an active, zero-result search gets an explicit
  message, distinct from "you have no tasks."** `#search-empty-message`
  ("No tasks match") is gated on the TRIMMED search box being non-empty,
  specifically so a genuinely task-free account with an empty box still
  renders silently — an empty list is otherwise indistinguishable from a
  data-loss bug at a glance.
- **step 19 (S19-10, not really a decision) — no change to
  `firestore.rules`, `firestore.indexes.json`, or any write path.** Search
  stores nothing; every field it reads (`title`, `note`, `tags`) already
  existed and was already validated by prior steps.
- **step 20 — grammar (settled before any parser code, per the plan's own
  requirement):**
  ```
  query      := orExpr
  orExpr     := andExpr ( OR andExpr )*
  andExpr    := primary ( (AND)? primary )*        // juxtaposition is AND (S19-3)
  primary    := sigilGroup | group | term
  group      := "(" query ")"
  sigilGroup := SIGIL "(" query ")"
  term       := overdueTerm | dateTerm | ageTerm | tagTerm | word

  SIGIL       := "#" | "@"
  AND         := "AND"   (case-insensitive)
  OR          := "OR"    (case-insensitive)
  overdueTerm := "overdue"
  dateTerm    := "today" | "this week" | "this month"
  ageTerm     := "age" ( ">" | "<" ) INT ( "d" | "m" )
  tagTerm     := SIGIL WORD
  word        := any run of non-space, non-paren characters
  ```
- **step 20 (S20-1) — precedence: AND binds tighter than OR.** `#a OR #b
  AND @c` parses as `#a OR (#b AND @c)` — standard, and the only reading
  that makes spec:160's own example (`#(private OR #pr) AND @office`)
  behave as its own prose describes.
- **step 20 (S20-2) — `NOT` is not implemented.** The spec names AND, OR
  and parentheses only (spec:159-160). Recorded so a future session knows
  its absence is a decision, not an oversight.
- **step 20 (S20-3) — operators are case-insensitive keywords, and the
  cost is stated.** `and`/`And`/`AND` all parse as the operator, so the
  bare English words "and"/"or" can no longer be searched as text.
  Accepted: task content is Hebrew (spec:12-14), and the alternative
  (uppercase-only operators) would silently turn a lowercase `#a and #b`
  into a three-term AND that also requires the literal text "and" — worse
  to diagnose than a documented limitation. `overdue`/`today`/`this`/
  `week`/`month`/`age` are matched literally lowercase, same as the
  grammar quotes them — only AND/OR are singled out as case-insensitive.
- **step 20 (S20-4) — sigil distribution, and the term kinds immune to
  it.** `SIGIL "(" query ")"` pushes the sigil onto every bare-word leaf
  in the subtree, at any depth. Three exceptions: (1) a leaf that already
  carries its own sigil keeps it (spec:163-165); (2) a nested sigil group
  stops the outer sigil at its boundary — the inner sigil wins for
  everything inside it; (3) temporal terms are immune — `#(private OR
  overdue)` must not invent a tag `#overdue`, because overdue/date/age
  terms are classified during LEXING, before distribution ever runs, so
  distribution can never see them as bare words. Implementation note: all
  three exceptions fall out of one recursive function
  (`applySigilDistribution`) with no group-boundary bookkeeping, because a
  nested sigil group's own distribution has already run (converting its
  word leaves to tag leaves) by the time an outer distribution walks over
  it — recursion order alone makes exception 2 correct for free.
- **step 20 (S20-5) — `age` reads the same clock the screen shows:
  `occurrenceStart ?? createdAt`.** Spec:178-180 says age filters read
  "the creation date." Read literally that contradicts step 18: a daily
  recurring task created a year ago would answer `age > 20d` as 365 days
  old while its own row displays an age of 1 day (S18-3, render.js:792).
  A query language whose numbers disagree with the numbers on screen is
  unusable, and spec:141-142 already demands "a daily task never reports
  itself as months old." Resolution: search's `age` uses `occurrenceStart
  ?? createdAt`, byte-identical to the displayed age. For every task that
  has never recurred (all of them until a recurrence is set), this IS the
  creation date, so the literal reading and this one only diverge where
  the spec already contradicts itself.
- **step 20 (S20-6) — age units and operators.** `d` = days. `m` =
  calendar months, not 30-day blocks (subtract N months from today with
  the same end-of-month clamping as `addMonthsClamped`, recurrence.js:74,
  then compare — mirrored rather than imported since that function isn't
  exported and only steps forward, never backward). Only `>` and `<`
  (spec:185-187); `>=`/`<=`/`=` are not implemented. Whitespace around the
  operator is free: `age>20d`, `age > 20d`, `age >20d`, `age> 20d` all lex
  identically (the tokenizer's 1/2/3-token concatenation check reconstructs
  the same string regardless of where the split fell).
- **step 20 (S20-7) — date terms read `dueDate`; a task with no due date
  matches none of them.** `today` = the due date's local midnight equals
  today's local midnight. `this week`/`this month` = the due date falls
  inside the current CALENDAR week/month, never a rolling window. All
  local-time-zone (spec:181), via `localMidnight` (render.js:231) — never
  `new Date("YYYY-MM-DD")`, which parses as UTC and lands a day early here.
- **step 20 (S20-8) — week start uses the field `firestore.rules` ALREADY
  reserves.** The field is `weekStart`, a string, `'sunday' | 'monday'`,
  on the existing `users/{uid}/meta` settings document beside `tags`. An
  earlier draft of this decision said `weekStartDay: 0 | 1`; that is
  superseded and was NOT built — `isValidSettings()` has no `hasOnly`
  clause, so a numeric `weekStartDay` would have written successfully
  while sitting entirely outside validation, a silent permanent schema
  fork. The rules needed no change: they already permit and constrain this
  field. Absent field reads as `'sunday'` (spec:189's default), so there
  is no backfill and every existing settings document stays valid.
- **step 20 (S20-9) — a parse error leaves the list unfiltered and says
  so.** A user mid-keystroke on `#a AND ` is transiently invalid. Flashing
  an empty list every keystroke is unacceptable, and silently returning
  everything is a lie. On a parse error: render the full unfiltered list
  and show the error text beside the search box. Search is inert until
  the query is valid. The error names the problem ("unbalanced
  parenthesis", "expected a term after AND"), never a stack trace.
- **step 20 (S20-10) — layering: `searchQuery.js` imports its date
  helpers from `render.js`.** `localMidnight`, `timestampToDate` and
  `isOverdueTask` are already exported from render.js (:231, :220, :285)
  and are pure. Importing them is the only option that adds zero
  duplication. Rejected alternatives: a private local-midnight copy inside
  searchQuery.js would be the THIRD in the repo (render.js:231,
  recurrence.js:43) and invites divergence; extracting a `dates.js`
  mid-feature-step touches three files for an aesthetic gain. If a
  `dates.js` is ever extracted, those three functions plus an `ageInDays`
  are exactly its contents.
- **step 20 (S20-11) — no history, no saved searches, no new task
  field.** Nothing about a query is persisted except `weekStart`. No
  rules change beyond confirming S20-8. `firestore.indexes.json` was not
  touched.
- **step 20 — worked examples, all 27 reproduced against the real parser
  and evaluator (verified in PROGRESS.md's own Step 20 section above).**
  Assumes today = Sunday 2026-08-23, `weekStart = 'sunday'`, so the
  current calendar week is 2026-08-23…2026-08-29 and the current month is
  August 2026.

  | # | Query | Parses as | Matches |
  |---|---|---|---|
  | 1 | `דוח` | word("דוח") | title or note contains "דוח" |
  | 2 | `#work` | tag(#work) | `tags` contains exactly `#work` (case-insensitive); NOT `#workshop` |
  | 3 | `work` | word("work") | title/note contains "work" — INCLUDING a task tagged `#workshop`, since the title holds that literal text |
  | 4 | `דוח #work` | AND(word, tag) | both |
  | 5 | `#(private OR pr)` | OR(tag(#private), tag(#pr)) | distribution, S20-4 |
  | 6 | `(#private OR #pr)` | OR(tag(#private), tag(#pr)) | **identical to row 5** — this equivalence is spec:161-163's whole point |
  | 7 | `#(private OR #pr) AND @office` | AND(OR(tag(#private),tag(#pr)), tag(@office)) | the spec's own example, spec:160 |
  | 8 | `#(private OR @office)` | OR(tag(#private), tag(@office)) | inner sigil wins, S20-4.1 |
  | 9 | `#(a OR (b OR c))` | OR(tag(#a), OR(tag(#b), tag(#c))) | distribution reaches nested plain groups |
  | 10 | `#(private OR overdue)` | OR(tag(#private), overdue) | `overdue` is immune, S20-4.3 — **not** `tag(#overdue)` |
  | 11 | `#a OR #b AND @c` | OR(tag(#a), AND(tag(#b), tag(@c))) | precedence, S20-1 |
  | 12 | `overdue` | overdue | `dueDate` strictly before today's local midnight, not completed/deleted |
  | 13 | `today` | today | `dueDate` local-midnight == 2026-08-23 |
  | 14 | `this week` | thisWeek | `dueDate` in 2026-08-23 … 2026-08-29 inclusive |
  | 15 | `this week` with `weekStart='monday'` | thisWeek | 2026-08-17 … 2026-08-23 — Sunday the 23rd is the **last** day of a Monday-start week |
  | 16 | `this month` | thisMonth | `dueDate` in 2026-08-01 … 2026-08-31 |
  | 17 | `age > 20d` | age(>,20,d) | `occurrenceStart ?? createdAt` strictly more than 20 whole local days ago |
  | 18 | `age < 3m` | age(<,3,m) | that same date is strictly after 2026-05-23 |
  | 19 | `age>20d` | age(>,20,d) | identical to row 17, S20-6 |
  | 20 | `#galit AND age > 20d` | AND(tag(#galit), age(>,20,d)) | the spec's compound example, spec:191-192 |
  | 21 | `#p1 AND overdue` | AND(tag(#p1), overdue) | the spec's compose example, spec:182-184 |
  | 22 | `#a and #b` | AND(tag(#a), tag(#b)) | case-insensitive operator, S20-3 |
  | 23 | `#a AND` | **parse error** | "expected a term after AND" → unfiltered list + message, S20-9 |
  | 24 | `(#a OR #b` | **parse error** | "unbalanced parenthesis" → unfiltered list + message |
  | 25 | `` (empty) | no query | full unfiltered list, no error |
  | 26 | `AND` | **parse error** | a lone operator is not a term |
  | 27 | `age > 20` | word("age") AND word(">") AND word("20") | no unit ⇒ NOT an age term; falls through to three bare words. Deliberate: silently assuming days would hide a typo |

- **step 21 (S21-1)** — export contains EVERY task document, including
  soft-deleted ones (plus the whole settings document). Spec:241-242 calls
  the export "a real backup rather than a read-only snapshot" — a backup
  that silently drops the Trash would lose everything deleted-but-not-purged
  on restore.
- **step 21 (S21-2)** — the file is one versioned JSON object:
  `{ format: "todo-manager-export", version: 1, exportedAt, tasks, settings
  }`. Import REJECTS a file whose `format`/`version` don't match those exact
  literals, with a message naming what it found — never a silent
  best-effort parse. `format`/`version` are free now and impossible to
  retrofit later.
- **step 21 (S21-3, the step's real hazard)** — Timestamps serialize to ISO
  8601 UTC strings via ONE shared field list read by both directions
  (`TIMESTAMP_FIELDS`, `dataTransfer.js`): `createdAt`, `updatedAt`,
  `deletedAt`, `dueDate`, `occurrenceStart` (no `completedAt` — completion is
  the boolean `completed`). `null` stays `null` both ways. Two hand-kept
  lists would drift the first time a field is added, silently: an exported-
  but-not-rehydrated field lands in Firestore as a plain string, and every
  date comparison against it quietly returns garbage.
- **step 21 (S21-3, mine — one recorded deviation from the decision's own
  illustrative code)** — import reconstructs a Timestamp field as a plain
  `new Date(iso)`, not `Timestamp.fromDate(new Date(iso))`. Firestore's
  `setDoc` already converts a bare `Date` on write (`taskService.js`'s
  `addTask` does exactly this for `dueDate`), so the document that lands is
  identical either way; importing the real `Timestamp` class would have
  required a `firebase/firestore` import inside `dataTransfer.js`, which
  this project's browser-only import map cannot resolve under plain Node —
  breaking the one verification path this project has (no npm, no bundler,
  no test runner).
- **step 21 (S21-4)** — download is a `Blob` + object URL + a synthetic `<a
  download>` click, no library; `URL.revokeObjectURL` in a `finally`.
  Filename `todo-manager-export-YYYY-MM-DD.json` from the LOCAL date (never
  `toISOString().slice(0,10)`, which names yesterday's date west of
  Greenwich — the same bug render.js's due-date helpers already guard
  against). JSON is pretty-printed, 2-space indent — a file a human may read.
- **step 21 (S21-5, the biggest call in this step)** — import is an upsert
  by id, NOT a wipe-and-replace: every task in the file is written by its
  own id; a task in the account but absent from the file is left completely
  alone. A literal "restore a backup" reading (delete everything first) is
  unrecoverable in an app with no undo, and one mis-clicked import would
  destroy an account. A "replace everything" mode is deliberately not
  implemented. The confirm dialog says, in plain words, that matching ids
  get overwritten and everything else is left untouched.
- **step 21 (S21-6)** — task ids are preserved verbatim on import. Minting
  fresh ids would turn import into a whole-graph rewrite (every `parentId`,
  every `ancestors` entry). Preserving ids is what makes import idempotent
  (S21-5's "importing the same file twice is a no-op"). Accepted cost:
  importing someone else's export into your account could in principle
  collide on an id (Firestore auto-ids make this negligible; single-user
  personal app).
- **step 21 (S21-7)** — the ENTIRE file is validated before a single write;
  any failure aborts the whole import with zero writes (same discipline as
  step 17's tag-rewrite pre-check). Checks: `format`/`version`; `tasks` is
  an array; `settings`, if present, is a plain object; every task's `id`
  (non-empty string), `title` (1-1000 chars), `note` (≤10000 if present),
  `tags` (≤50 if present), `ancestors` (≤6 if present — the 7-level cap,
  `firestore.rules:56`); every non-null `parentId` resolves to a task in the
  file OR already in the account; every ISO timestamp string parses to a
  valid Date; `settings.tags` (≤500 keys if present), `settings.weekStart`
  (`'sunday'`/`'monday'` if present — the two values `isValidSettings()`
  accepts). On failure: one message naming the first problem plus the total
  count.
- **step 21 (S21-8)** — writes go through the existing paths, serialized,
  with visible progress: `saveTask(uid, task)` per task, `saveSettings(uid,
  settings)` once, the whole import wrapped in one `enqueueMutation`, one
  `refreshTasks()` at the end. No `writeBatch` (caps at 500, a second write
  vocabulary). The import button is disabled and shows `Importing N of M…`
  during the (potentially multi-second) sequential loop. Known and accepted:
  `saveTask` re-stamps `updatedAt` to the import time on every write;
  `createdAt` IS preserved (what age/`age > Nd` search depend on). On a
  write failure mid-import: stop at the first failure, report how many
  tasks were written, refresh — no retry, no rollback.
- **step 21 (S21-9)** — two buttons on the existing Tag Settings screen; no
  new view. Import is a hidden `<input type="file" accept="application/
  json">` triggered by the button's click. `currentView` gains no new id.
- **step 21 (S21-10)** — settings import REPLACES the settings document
  wholesale, asymmetric with tasks' per-id upsert on purpose: settings is
  one document with no id-keyed granularity, so merging two tag-color maps
  would produce a state that existed in neither the file nor the account. A
  file with no `settings` key leaves settings untouched. The confirm dialog
  states this asymmetry explicitly.
- **step 21 (S21-11)** — export refreshes first (`await refreshTasks()`)
  so it's never up to five minutes stale, then reads `getTasks()`/
  `getTagSettings()` out of memory — no separate fetch path.
- **step 21 (S21-12)** — no rules change, no index change, no new stored
  field. Nothing about export/import is persisted beyond the tasks/settings
  it reads and writes through the already-existing paths.

## Open items (not steps)

- `.github/workflows/firebase-hosting-merge.yml` deploys to the live site on push to
  `main` and is broken (`npm ci && npm run build`, no `package.json`). **A push to
  `main` is a production deploy.** Decide separately whether to fix or remove it.
- `FIREBASE.md`'s "Security rules — three-way mismatch" section is stale on all four
  of its claims. Tracked as a separate background task.
