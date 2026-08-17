# Progress

Last updated: 2026-08-17 — **Steps 1–6 implemented and committed.** Step 7
(un-complete memory) is next. No signed-in browser walkthrough has been reported back
for any step yet — the click-path below is still the first thing to run.

## Step table

| # | Step | Status |
|---|---|---|
| 1 | Foundation + complete | done |
| 2 | Inline edit | done |
| 3 | Soft delete (leaf) | done |
| 4 | Hierarchy | done |
| 5 | Inbox container | done |
| 6 | Cascade complete | done |
| 7 | Un-complete memory | next |
| 8 | Context menu + cascade delete | planned |
| 9 | Trash | planned |
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

## Resume here — step 7 (un-complete memory)

**Exact next action:** implement step 7. Un-completing a parent must reopen *only*
what that parent's cascade closed — i.e. every task whose `closedByCascadeFrom`
equals that parent's id — and must leave a task that was completed independently
still completed. Step 6 already stamps exactly what step 7 needs; the reopen set is
a single `=== parentId` filter over the subtree, at any nesting depth.

Note that step 6's un-complete path currently only resets the clicked task's own
`closedByCascadeFrom` to `null` and deliberately does no reopening — that is the
hook step 7 replaces.

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
7. Delete a task that has children → refused. Delete a childless one → confirm dialog
   names it, then it disappears.
8. Reload the page → every change above survived.

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

**Assumed (written and reasoned about, never exercised signed-in):**
- Every path that actually reaches Firestore: create, save, soft-delete, and the
  refetch. All browser verification above ran against synthetic in-memory tasks.
- The 5-minute auto-refresh timer firing, and the interaction guard deferring it.
- The 7-level cap refusing an 8th level against real stored `ancestors`.
- `normalizeTask`'s fallbacks against the real documents already in this project's
  Firestore.
- That the mutation queue prevents the concrete edit-then-checkbox race end to end
  (the queue itself is verified; the race was reproduced only by code reading).

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

## Open items (not steps)

- `.github/workflows/firebase-hosting-merge.yml` deploys to the live site on push to
  `main` and is broken (`npm ci && npm run build`, no `package.json`). **A push to
  `main` is a production deploy.** Decide separately whether to fix or remove it.
- `FIREBASE.md`'s "Security rules — three-way mismatch" section is stale on all four
  of its claims. Tracked as a separate background task.
