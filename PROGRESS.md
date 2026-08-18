# Progress

Last updated: 2026-08-18 — **Steps 1–15 implemented.** Step 16 (Priority
ordering) is next. No signed-in browser walkthrough has been reported back for
any step yet — the click-path below is still the first thing to run.

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
| 16 | Priority ordering | next |
| 17 | Tag rename/delete | planned |
| 18 | Recurrence | planned |
| 19 | Search — basic | planned |
| 20 | Search — advanced | planned |
| 21 | Export / import | planned |

## Resume here — step 16 (Priority ordering)

**Exact next action:** implement step 16, per product-spec.md §3 ("List
Order", lines 97-107) and §7 ("Recommended Order", lines 214-219). Step 15
built every piece step 16 consumes — a task's quadrant is already computable
(`resolveTaskQuadrant`, tagColors.js) and already ranked
(`quadrantRank`, tagColors.js, 0 = urgent+important … 4 = unranked). Nothing
about either needs redesigning; this step is purely about wiring them into
the one seam left for it.

- **The seam is `compareSiblings` (render.js), and it is the ONLY thing this
  step changes about ordering.** Today: `(a, b) => a.order - b.order`. It
  becomes a two-key comparator: **quadrant rank first, `order` second** —
  `quadrantRank(resolveTaskQuadrant(a.title, tagSettings)) -
  quadrantRank(resolveTaskQuadrant(b.title, tagSettings))`, falling back to
  `a.order - b.order` on a tie. This is exactly what step 1's Decisions log
  already locked ahead of time: *"`order` is a fractional index scoped to
  `parentId` siblings, and is always the tie-breaker applied *after*
  quadrant rank once step 16 lands (`(quadrantRank, order)`, computed
  client-side on every render, never stored)."* Do not invent a different
  formula — that decision already picked one.
- **`compareSiblings` doesn't currently take `tagSettings`.** It's called from
  `flattenTree` (render.js), which is called from `renderTasks` (which already
  receives `tagSettings` as a parameter, step 14) — so `tagSettings` has to
  thread one level further down than it does today: `flattenTree(tree,
  tagSettings)` → `compareSiblings(a, b, tagSettings)`. Every call site of
  `flattenTree`/`compareSiblings` inside render.js needs that same parameter
  added; there should be no second, independent sibling comparator anywhere
  else (Focus and Overdue already sort via this same seam per steps 12/13's
  Decisions — issue 1's fix and D5 — so they inherit quadrant-first ordering
  automatically the moment this lands, not as separate work).
- **The overruled-drag visibility requirement is this step's UI half, not
  optional polish** (product-spec.md:104-107): *"a drag can be overruled.
  Dragging a low-priority task above a high-priority one will not hold,
  because priority is applied first... the interface should make that
  visible rather than letting a drag appear to work and then snap back."*
  Step 10's own Decisions entry already applied this exact principle to a
  same-drag invalid target (no indicator at all, rather than indicator-then-
  revert) — step 16 needs the equivalent for a *priority*-overruled drop: if
  a manual reorder would place a task on the wrong side of a quadrant-rank
  boundary, the drop must not silently snap back with no explanation. Decide
  the concrete mechanism when building this (a disabled/refused drop
  indicator segment at a rank boundary is the most direct reading of "make it
  visible," but this is not yet locked — record whatever is chosen as a new
  Decision, don't leave it implicit).
- **Manual order still survives — it's the tie-breaker, not overridden.**
  Step 10/11's drag machinery, `computeReorderOrder`, and the fractional-index
  precision-renumber guard are all unchanged; this step only changes what
  *sorts before* comparing `order`, never how `order` itself is computed or
  written.
- **Nothing about step 15's storage or resolution changes.** `quadrantRank`
  and `resolveTaskQuadrant` (tagColors.js) are already exported specifically
  so this step only imports them — do not re-derive urgency/importance here.

**Files likely touched:** `public/render.js` (`compareSiblings` grows a
`tagSettings` parameter and the two-key comparison; `flattenTree` and every
caller thread it through), `public/app.js` (the drag-target validity check
gains a priority-boundary case if that's the chosen visibility mechanism).
No change expected to `public/tagColors.js` (step 15 already exports
everything this step needs), `firestore.rules`, or
`firestore.indexes.json`.

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

## Open items (not steps)

- `.github/workflows/firebase-hosting-merge.yml` deploys to the live site on push to
  `main` and is broken (`npm ci && npm run build`, no `package.json`). **A push to
  `main` is a production deploy.** Decide separately whether to fix or remove it.
- `FIREBASE.md`'s "Security rules — three-way mismatch" section is stale on all four
  of its claims. Tracked as a separate background task.
