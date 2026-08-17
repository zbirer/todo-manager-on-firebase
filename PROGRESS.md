# Progress

Last updated: 2026-08-17 — **Steps 1–8 implemented.** Step 9 (Trash) is next. No
signed-in browser walkthrough has been reported back for any step yet — the
click-path below is still the first thing to run.

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
| 9 | Trash | next |
| 10 | Manual reorder | planned |
| 11 | Drag-to-reparent | planned |
| 12 | Focus / pin | planned |
| 13 | Dates | planned |
| 14 | Tag colors | planned |
| 15 | Quadrant mapping | planned |
| 16 | Priority ordering | planned |
| 17 | Tag rename/delete | planned |
| 18 | Recurrence | planned |
| 19 | Search — basic | planned |
| 20 | Search — advanced | planned |
| 21 | Export / import | planned |

## Resume here — step 9 (Trash)

**Exact next action:** implement step 9, the Trash screen. What steps 3 and 8 have
already left in place for it:

- **`deletedByCascadeFrom: string | null`** (taskService.js's `normalizeTask`,
  step 8) — exactly symmetric to `closedByCascadeFrom`. Holds the id of the task
  the user actually clicked Delete on, stamped on every live descendant a cascade
  delete swept up with it; `null` on the clicked task itself and on anything
  deleted on its own. Restoring a parent from Trash means restoring it AND every
  task whose `deletedByCascadeFrom` equals its id — the same global-filter pattern
  step 7 uses for reopening, not a tree walk (see the Decisions entry below for
  why a tree walk would be wrong here too, for the same drag-to-reparent reason).
- **Every deleted document is its own write, individually stamped `deleted: true`
  + `deletedAt`.** Step 8's cascade delete never merges or batches these — each
  descendant is a separate `softDeleteTask` call — specifically so step 9 can
  count "one deleted document = one trash slot" without having to first explode
  a merged cascade record back into individual entries.
- **The 50-item cap is a count, not a time limit** (product-spec.md §3), and
  **eviction is permanent** — the oldest deleted document past the 50th falls out
  of Trash and is gone for good, no soft-un-delete of an evicted item. Sort
  candidates for eviction by `deletedAt` ascending among all `deleted: true`
  documents (root deletions and cascade-swept descendants count individually,
  per the point above). There is no code for this yet — fetchTasks currently
  fetches everything unconditionally, so a Trash view can filter client-side to
  start, but the 50-cap eviction itself still needs to be implemented and will be
  the trickiest part: it has to run somewhere (on delete? on trash view load?)
  and actually issue hard `deleteDoc` calls past the 50th, which is new — nothing
  in this codebase has called `deleteDoc` yet.
- **Restoring a subtree needs `parentId`/`ancestors` re-validated at restore
  time**, not blindly re-applied — the original parent may itself now be deleted,
  moved, or gone, and step 11 (drag-to-reparent, not yet built) will make "the
  ancestry that was true at delete time" even less reliable to just replay
  unchecked.

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

## Open items (not steps)

- `.github/workflows/firebase-hosting-merge.yml` deploys to the live site on push to
  `main` and is broken (`npm ci && npm run build`, no `package.json`). **A push to
  `main` is a production deploy.** Decide separately whether to fix or remove it.
- `FIREBASE.md`'s "Security rules — three-way mismatch" section is stale on all four
  of its claims. Tracked as a separate background task.
