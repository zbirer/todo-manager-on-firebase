# Progress

Last updated: 2026-08-17 — **Steps 1–11 implemented.** Step 12 (Focus/pin)
is next. No signed-in browser walkthrough has been reported back for any step
yet — the click-path below is still the first thing to run.

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
| 12 | Focus / pin | next |
| 13 | Dates | planned |
| 14 | Tag colors | planned |
| 15 | Quadrant mapping | planned |
| 16 | Priority ordering | planned |
| 17 | Tag rename/delete | planned |
| 18 | Recurrence | planned |
| 19 | Search — basic | planned |
| 20 | Search — advanced | planned |
| 21 | Export / import | planned |

## Resume here — step 12 (Focus/pin)

**Exact next action:** implement step 12, a "Focus" section that shows every
pinned task, per product-spec.md §7:

- **No cap** on how many tasks can be pinned — pinning/unpinning is entirely
  the user's call, and the app must never block a pin or silently drop one.
- **Pinned tasks appear in Focus in the same order they hold in the main
  list** — Focus carries no ordering of its own to maintain, so it is a
  *filtered view* over the same `order` values the main list already sorts
  by, not a second list with its own sequence.
- **A pinned task that gets completed disappears from Focus** — the section
  is "what's left to do," not a record of what was. This mirrors the existing
  "completed tasks hide unless 'show completed' is on" filter (step 1); Focus
  most likely needs the exact same completed-filter applied on top of the
  pinned filter, not a separate rule.

**What already exists for this step to build on:**
- **The `pinned: bool` field is already in the schema, written on every
  task, always `false`** — see `taskService.js`'s `addTask`/`normalizeTask`
  and `firestore.rules`' `isValidTask()` (step 1's decision, confirmed still
  correct by FIREBASE.md's schema table). No migration is needed; step 12 is
  the first thing to ever write `true`.
- **The Trash and Inbox precedent for "a third rendered collection alongside
  the existing two"**: step 9 added `#trash-view`/`renderTrash` as a second
  screen (view-switch, not a third simultaneous container); step 5 added the
  Inbox as a second *simultaneous* container sharing one `entriesByTaskId`
  Map and one `renderTasks` call (see step 5's Decisions entries below). Focus
  is closer to step 5's shape than step 9's — it renders *alongside* the main
  list/Inbox (all visible at once), not as a separate screen you navigate to —
  so the likely design is a third `{ element, tasks, visibleIds }` entry in
  `renderMainView`'s `renderTasks` call, reusing the *same* `<li>` a task
  already has elsewhere (a task can be simultaneously "in Focus" and "in the
  main list" — pinning doesn't remove it from where it already lives, unlike
  filing out of the Inbox which does). That breaks step 5's "one task id maps
  to exactly one `<li>`" invariant on purpose — Focus is the first place in
  this app a task is meant to render in **two** places at once, which
  `entriesByTaskId`'s current one-entry-per-id shape does not support. This is
  the central design question step 12 has to answer before writing any code:
  either give Focus rows their own separate, second Map (parallel to
  `trashEntriesByTaskId`'s precedent, not `entriesByTaskId`'s), or find another
  way to reuse a `<li>` in two containers at once (moving it back and forth
  per render would fight the main list for ownership of the same node).
- **Toggling `pinned` is a whole-document `saveTask`, routed through
  `enqueueMutation`, exactly like every other field-level mutation** (title,
  note, `completed`, `inInbox`) — there is no reason to expect this one to
  need special handling; the interesting work is entirely on the render side.

**Files likely touched:** `public/index.html` (a `#focus-section`/`#focus-list`,
and a pin toggle control per row — a button or checkbox, TBD), `public/render.js`
(the second-Map-or-shared-node decision above, plus whatever toggles the pin
control's visual state), `public/app.js` (a `handlePinToggleClick` mirroring
`handleMoveOutOfInboxClick`'s shape, and wiring the new container into
`renderMainView`).

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

## Open items (not steps)

- `.github/workflows/firebase-hosting-merge.yml` deploys to the live site on push to
  `main` and is broken (`npm ci && npm run build`, no `package.json`). **A push to
  `main` is a production deploy.** Decide separately whether to fix or remove it.
- `FIREBASE.md`'s "Security rules — three-way mismatch" section is stale on all four
  of its claims. Tracked as a separate background task.
