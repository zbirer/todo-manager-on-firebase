// Keyed re-render of the task list. A refresh happens after every mutation
// and every 5 minutes (store.js), so rebuilding the whole <ul> from scratch
// each time would reset scroll position and drop focus constantly. Instead
// we keep a Map<taskId, entry> and update elements in place, only creating or
// removing nodes for tasks that actually appeared or disappeared.
//
// Critically, an existing <li>'s children are never torn down on an update —
// only the properties that changed are assigned. Step 2's inline-edit boxes
// (title and note) live inside a task's <li>; if this function ever rebuilt
// children on every pass, editing task A would get wiped out by an unrelated
// refresh triggered by toggling task B. Each entry keeps direct references to
// every element it owns (checkbox, label, title input, note display, note
// input, per-row buttons) so an update never has to re-query or recreate
// them, and an `editingTitle` / `editingNote` flag per entry tells
// updateTaskElement to leave that field's display/input alone while it's
// mid-edit.
//
// Step 4 (hierarchy): children render indented under their parent, but as
// flat <li> siblings in one <ul> — never nested <ul>s — because indenting
// via nested elements would mean tearing down and rebuilding whole subtrees
// on every refresh, exactly what the keyed Map above exists to avoid.
// taskTree.js (buildTree/depthOf) is the single source of truth for the tree
// shape and each row's depth; this file never re-derives depth from
// `ancestors.length` or walks `parentId` itself, so there is only ever one
// place that shape can go stale.
//
// Each <li> carries `dataset.taskId`, which is how app.js's delegated
// listeners figure out which task a click/change/keydown/focusout belongs
// to — render.js itself attaches no listeners, so nothing here needs
// re-binding on refresh. app.js owns *when* an edit starts/stops (it decides
// based on clicks and commits); render.js only owns *how* the DOM looks in
// each state, exposed through the begin/end/get/set functions below.
//
// `renderTasks` takes its tree container as an ARRAY (a shape kept from an
// earlier design where more than one tree section rendered side by side from
// ONE shared `entriesByTaskId` Map) — a task id always maps to exactly one
// <li> in that container's DOM.
//
// Step 12 (Focus/pin, D1/D2/D4): Focus is a second container rendered inside
// the SAME `renderTasks` call (never a second call — see the containers-doc
// comment below for why a second call to the shared-map version would
// corrupt it), but it deliberately does NOT share `entriesByTaskId` with the
// main list. A pinned task renders BOTH in Focus AND in its normal place at
// once (D4) — a real second <li> for one task id, which the one-id-one-<li>
// invariant above cannot support. Exactly like step 9's Trash
// (`trashEntriesByTaskId` below), Focus gets its own separate Map, so its own
// cleanup pass can never delete — or be broken by — an entry the main pass
// still needs. Focus is also flat (D2: a hand-picked set, not a subtree), so
// it never renders at any depth but 0 — Focus carries no indentation, it
// isn't a view of the tree. D3 originally ordered Focus with the same raw
// `order`-comparing `sortTasks` the main list's siblings use; issue 1's
// review superseded that (see PROGRESS.md's superseding entry and
// renderTasks's own comment below) — `order` is only comparable within one
// sibling group, so a cross-group traversal-order index built from the tree
// containers' own `flattenTree` output is what Focus now sorts by instead.

// Step 13 (Dates, D4): Overdue is a third flat, hand-picked container, exactly
// like Focus (step 12) — its own separate Map (`overdueEntriesByTaskId` below)
// so a task can render on its normal-place row AND its Overdue row at once,
// the same one-id-two-<li>s split D4 (step 12) already established for
// Focus. UNLIKE Focus, Overdue is never passed into `renderTasks` — per this
// step's own D4, Overdue is a SCREEN (a `currentView` value, following step
// 9's Trash precedent), not a section rendered inside the main view — so it
// gets its own exported render function (`renderOverdue` below, near
// `renderTrash`) called from app.js's own separate view-render path, not a
// third array/parameter on `renderTasks`.

// Step 14 (Tag colors): a row's colors are resolved per-render from the task's
// TITLE plus the user's tag settings map — never from a stored per-task field
// (the old `task.colors`, which nothing reads anymore, D3). The settings map
// itself is threaded in as a parameter rather than imported: render.js must
// not import store.js (the same module-ownership boundary that makes
// `onEditCancelled` a callback instead of a direct interaction-guard call).
//
// Step 24 (Workflowy-style restyle, THE KEY PIVOT): step 14's original rule
// painted the WHOLE ROW in the last-colored-tag's colors (`resolveTagColor`,
// tagColors.js). The target look is a light, text-first row list, so that
// row-wide paint has no home to live in anymore — colors now land on the
// individual tag PILL inside the title instead (see `renderTitleInto` and
// `.task-item__tag` below), resolved per-tag via `readTagColors` rather than
// per-row via `resolveTagColor` (which is why that import is gone: nothing
// in this file calls it any longer). `readTagColors` is still pure and lives
// in tagColors.js alongside `parseTags`, so this module never re-derives
// what counts as a tag's color, only where that color gets painted.
import { buildTree, depthOf } from "./taskTree.js";
import {
  DEFAULT_TAG_BG,
  DEFAULT_TAG_FG,
  readTagColors,
  // Step 15 (Quadrant mapping): a SEPARATE resolver from readTagColors above
  // — see tagColors.js's own comment on why these two must never be
  // conflated. describeQuadrant/quadrantBadgeText feed the task-row badge
  // (Q6). Step 16 (Priority ordering) is the first thing in this file to
  // consume `quadrantRank`/`computeQuadrantRankMap` — see compareSiblings and
  // renderTasks below.
  readTagQuadrant,
  resolveTaskQuadrant,
  describeQuadrant,
  quadrantBadgeText,
  quadrantRank,
  computeQuadrantRankMap,
  QUADRANT_OPTIONS,
} from "./tagColors.js";
// Step 18 (Recurrence): the one place a recurrence rule is turned into
// display text — shared with app.js's context-menu label/prompt default, so
// this row badge and that label can never disagree on wording. recurrence.js
// itself has no imports (see its file header on why NOT importing
// localMidnight back from here matters), so this edge is one-directional.
import { describeRecurrence } from "./recurrence.js";

const entriesByTaskId = new Map();
const focusEntriesByTaskId = new Map();
const overdueEntriesByTaskId = new Map();

// Step 16 (Priority ordering, R3): the fallback rank for a task this
// comparator's caller somehow forgot to include in its rank Map — should
// never happen (every caller below builds its Map from the exact same task
// set it's about to sort), but reads identically to a genuinely unranked
// task rather than throwing or sorting as if it were rank 0.
const UNRANKED_RANK = quadrantRank(null);

// The sibling comparator — orders tasks that share the same parent.
// Step 16 (R1/R2/R3): the sort key is now `(quadrantRank, order)` — quadrant
// rank first, `order` (step 1's fractional index) as the tie-breaker, exactly
// the formula step 1's own Decisions entry locked ahead of time. `rankMap` is
// a `Map<taskId, rank>` the CALLER built once for the whole render/drag pass
// (tagColors.js's `computeQuadrantRankMap`) — this function only ever does a
// `Map.get`, never calls `resolveTaskQuadrant`/`quadrantRank` itself, which
// would re-parse every title on every one of an O(n log n) sort's
// comparisons instead of once per task. This only ever compares tasks that
// share a parent (siblings) — the tree shape itself (which tasks even ARE
// siblings) is buildTree's job upstream and is completely untouched, so
// hierarchy always outranks priority: a rank-0 child can never sort above
// its own parent, only among its own siblings.
function compareSiblings(a, b, rankMap) {
  const rankA = rankMap.get(a.id) ?? UNRANKED_RANK;
  const rankB = rankMap.get(b.id) ?? UNRANKED_RANK;
  if (rankA !== rankB) return rankA - rankB;
  return a.order - b.order;
}

// Flat ascending sort by `(quadrantRank, order)`. Kept as a small public
// utility built on the same comparator flattenTree uses, so there is exactly
// one sibling-ordering rule regardless of which of the two callers asks for
// it. `rankMap` defaults to an empty Map (every lookup misses, so every task
// reads as UNRANKED_RANK and this degrades to a plain `order` sort) purely as
// a defensive fallback for a caller that hasn't been updated — every real
// caller in this codebase passes a Map built by computeQuadrantRankMap.
export function sortTasks(tasks, rankMap = new Map()) {
  return [...tasks].sort((a, b) => compareSiblings(a, b, rankMap));
}

// Depth-first flatten over the FULL task set (`allTasks` — everything not
// deleted, regardless of "show completed"), so structure, sibling order, and
// depth are always computed from real ancestry, never from whichever subset
// happens to be on screen. Only tasks in `visibleIds` are actually pushed
// into the result, but the walk still recurses into a hidden task's children
// — that's what lets a visible child of a hidden parent (completed and
// toggled off, say) keep its true depth and true position among its real
// siblings instead of either vanishing or being promoted to a fake root.
// taskTree.js's buildTree/depthOf stay the one depth authority regardless of
// what's currently filtered; feeding them an already-filtered list would
// make the filter a second input to depth, silently disagreeing with reality
// the moment step 11 moves a subtree.
// Step 13 review round (issue 3): the one place all three edit flags
// (editingTitle/editingNote/editingDueDate) are enumerated for the
// "entry left the rendered set while mid-edit" cleanup. Before this, each of
// renderTasks's two passes (main, focus) and renderOverdue's own pass
// hand-maintained its own three-flag list — renderOverdue's had all three,
// but main and focus were only ever updated for title/note when dueDate was
// added (step 13), leaving a due-date edit's interaction guard stuck open
// forever if its row vanished mid-edit. Routing all three passes through one
// function means a future fourth field only has to be added HERE to be safe
// everywhere, instead of being added to three call sites and forgotten in
// one — exactly the gap this fixes.
function closeAnyOpenEdits(entry, id, onEditCancelled, fieldSuffix = "") {
  if (!onEditCancelled) return;
  if (entry.editingTitle) onEditCancelled(id, "title" + fieldSuffix);
  if (entry.editingNote) onEditCancelled(id, "note" + fieldSuffix);
  if (entry.editingDueDate) onEditCancelled(id, "dueDate" + fieldSuffix);
}

// Step 16: `rankMap` threads through to compareSiblings at every level of the
// walk — a node's children are sorted by the identical (rank, order) rule
// its own siblings were, so priority ordering applies at every depth of the
// tree, not just the roots. Same empty-Map default/reasoning as sortTasks.
function flattenTree(allTasks, visibleIds, rankMap = new Map()) {
  const tree = buildTree(allTasks);
  const result = [];

  function visit(nodes) {
    for (const node of [...nodes].sort((a, b) => compareSiblings(a, b, rankMap))) {
      if (visibleIds.has(node.id)) {
        result.push({ task: node, depth: depthOf(tree, node.id) });
      }
      if (node.children.length > 0) visit(node.children);
    }
  }

  visit(tree.roots);
  return result;
}

// --- Step 13 (Dates): date/age/overdue helpers -----------------------------
// Pure, side-effect-free, and exported for direct verification — the same
// precedent as app.js's compareTrashNewestFirst/computeReorderOrder and this
// module's own sortTasks: no test runner exists in this project, so anything
// that isn't DOM has to be callable directly against synthetic data.
//
// Unwraps either a Firestore Timestamp (has `.toDate()`, what a real read
// returns) or a plain JS Date (what a freshly-constructed-but-not-yet-
// refetched value would be, though this app never optimistically renders
// one — see the "one refresh strategy" rule) into a plain Date, or null.
// Step 13 review round (issue 4): `isValidTask()` (firestore.rules) never
// constrains `dueDate`'s shape, so a raw string, a malformed value, or a
// Timestamp-shaped object with no real `.toDate()` can legitimately arrive
// from the database (a manual Firestore edit, an import, a future
// migration) — and would otherwise resolve to `null` exactly like a task
// that genuinely has no due date, silently hiding the bad data. A present
// but unparseable value is logged so it's discoverable; a genuinely
// absent/null `dueDate` is the normal case and must stay silent.
//
// Exported as of step 18 (Recurrence): recurrence.js's advance arithmetic and
// app.js's recurrence handlers both need this same unwrap for `dueDate`, and
// duplicating it would be a second place the Timestamp-vs-Date distinction
// could drift.
export function timestampToDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  console.error("Unparseable dueDate value:", value);
  return null;
}

// Local midnight of `date`'s calendar day — the one notion of "day boundary"
// every date/age/overdue computation below shares, so "today" always means
// the same instant regardless of which of these three functions asks for it.
export function localMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// D2: an <input type="date">'s value is always "YYYY-MM-DD" — timezone-free
// text naming a calendar day, not an instant. Parsing it with the STRING
// constructor form, `new Date(value)`, is the textbook bug: the ES spec
// parses a bare "YYYY-MM-DD" as UTC midnight, so `new Date("2026-08-17")` in
// any timezone WEST of Greenwich (e.g. any US timezone, a negative UTC
// offset) resolves to local time on 2026-08-16 — one whole calendar day
// before what the user actually typed. Building the Date from its numeric
// year/month/day components via the `new Date(y, m, d)` FORM instead (never
// the string form) constructs LOCAL midnight directly, which is what the
// date picker showed the user and is therefore the only correct reading.
export function parseDateInputToLocalMidnight(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// The reverse conversion, same bug mirrored: `date.toISOString().slice(0,10)`
// always renders in UTC, so formatting a local-midnight Date this way can
// print the PREVIOUS calendar day in the same negative-UTC-offset timezones
// the comment above warns about — this function reads the LOCAL
// getFullYear/getMonth/getDate components instead, making it the exact
// inverse of parseDateInputToLocalMidnight (round-trips through the same
// local frame both ways, never through UTC on either leg).
export function formatDateForInput(dueDate) {
  const date = timestampToDate(dueDate);
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Human display text for a row's due-date area. `overdue` is passed in
// (computed once by the caller via isOverdueTask) rather than recomputed here
// — this function only knows how to word two already-decided states, not
// which one applies.
function formatDueDateDisplayText(dueDate, overdue) {
  const date = timestampToDate(dueDate);
  if (!date) return "No due date";
  const label = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return overdue ? `Overdue: ${label}` : `Due: ${label}`;
}

// D3: a task is overdue iff its due date's LOCAL calendar day is strictly
// BEFORE today's local calendar day — due TODAY is its own bucket, not
// overdue (product-spec.md §6 treats them as distinct). Completed and
// deleted tasks are never overdue, whatever their stored dueDate says. `now`
// defaults to the real clock but is overridable so this can be exercised
// directly against a fixed synthetic "today" without waiting for real time
// to pass or monkey-patching the global Date.
export function isOverdueTask(task, now = new Date()) {
  if (task.completed || task.deleted) return false;
  const dueDate = timestampToDate(task.dueDate);
  if (!dueDate) return false;
  return localMidnight(dueDate).getTime() < localMidnight(now).getTime();
}

// D7: age is derived from createdAt on every render, never stored, no new
// field, no migration. Whole LOCAL calendar days, floored — deliberately the
// same calendar-day framing as isOverdueTask above (not a rolling 24-hour
// elapsed-time measure), so "today" means "created today," not "created
// less than 24 hours ago." `createdAt` can be null on a doc whose
// serverTimestamp() hasn't resolved in the local snapshot yet — that must
// render as a plain, non-alarming string, never "NaN days old".
//
// Step 18 (S18-3): this function itself is unchanged — its caller
// (updateTaskElement below) now passes `task.occurrenceStart ?? task.createdAt`
// instead of `task.createdAt` alone, so age resets each time a recurring
// task's due date advances. The `?? createdAt` fallback is what lets every
// pre-existing, never-recurring task keep byte-identical age with no
// backfill: `occurrenceStart` is null until the first advance ever stamps it.
export function computeAgeLabel(createdAt, now = new Date()) {
  const createdDate = timestampToDate(createdAt);
  if (!createdDate) return "age unknown";
  const days = Math.floor(
    (localMidnight(now).getTime() - localMidnight(createdDate).getTime()) / 86400000
  );
  if (days <= 0) return "today";
  return `${days} day${days === 1 ? "" : "s"} old`;
}

// D5: the exact ordering mechanism issue 1's Focus fix introduced (see
// PROGRESS.md's superseding Decisions entry) — a hand-picked flat set's
// order is each task's index in the REAL depth-first render position the
// tree container (the main list) produces, never a raw `order`-field
// comparison (which is only meaningful within one sibling group). Hoisted
// into its own exported function, rather than left
// inline inside renderTasks, specifically so Overdue (a separate SCREEN,
// rendered from its own call — see the file-header note above) can share the
// identical mechanism instead of a second, independently-drifting copy;
// renderTasks itself below now calls this too, so there is exactly one
// implementation regardless of caller, per this step's own D5 instruction
// not to invent a second ordering mechanism.
// Step 16 (R4): `rankMap` is a `Map<taskId, rank>` the caller built ONCE for
// its whole render pass (renderTasks below already has one; app.js's
// renderOverdueView builds its own the same way via
// computeQuadrantRankMap) — never recomputed in here, so Focus and Overdue
// inherit quadrant-first ordering automatically through the exact same
// `flattenTree` call this function already made before step 16 existed, with
// zero new ordering rule of their own (R4's "Focus/Overdue carry no ordering
// of their own to maintain").
export function computeMainListOrderIndex(nonDeletedTasks, rankMap = new Map()) {
  const orderIndex = new Map();
  const visibleIds = new Set(nonDeletedTasks.map((task) => task.id));
  for (const { task } of flattenTree(nonDeletedTasks, visibleIds, rankMap)) {
    if (!orderIndex.has(task.id)) orderIndex.set(task.id, orderIndex.size);
  }
  return orderIndex;
}

// `containers` is an array of `{ element, tasks, visibleIds }` — one entry
// per rendered TREE section (the main list is the only one today; the array
// shape is kept because renderTasks's own reconciliation logic is written
// against "every tree container", not against a single fixed one).
// `focusContainer` is `{ element, tasks }` (or `null`) for the Focus section
// (step 12) — a separate parameter, not a third array entry, because it is
// FLAT (D2) and lives in its own Map (see the file-header comment above for
// why), not because it renders in a second call: this is still the one
// single `renderTasks` invocation both sections' data flows through.
// `onEditCancelled` is called once for every open edit (title and/or note)
// that gets silently dropped below, in case anything is left with a dangling
// `beginInteraction()`; its second argument is `"title"`/`"note"` for a
// tree-container entry or `"title:focus"`/`"note:focus"` for a Focus entry,
// so a caller tracking open edits by task+field can tell the two apart (a
// pinned task can theoretically have both its main-list row AND its Focus
// row open for edit at once — they are two independent DOM nodes with two
// independent edit states). render.js must not import store.js — the
// interaction guard is app.js's concern — so this is a callback rather than
// a direct call, per the module ownership boundary.
//
// All TREE containers share ONE `entriesByTaskId` Map and go through ONE
// seen/cleanup pass before any DOM is touched. That matters: a task id must
// map to exactly one <li> among the tree containers — but if this ran as two
// independent calls to a single-container version of this function, the
// FIRST call's cleanup would delete every entry the SECOND call still needs
// (they're simply not in the first call's own seen set), destroying and
// rebuilding half the list on every render. Computing the union of "seen"
// across every tree container first, then reconciling each container's DOM
// separately, is what avoids that. Focus runs the identical seen/cleanup
// discipline against its own separate Map and its own separate seen set, so
// neither pass can ever see (or corrupt) the other's entries.
//
// Step 14: `tagSettings` (store.js's cache, `{ tags: { [tag]: { fg, bg } } }`)
// is passed in per call rather than imported, per the module boundary above —
// every row's colors are resolved from it plus the row's own title on every
// update, which is what makes "re-typing the title to reorder tags changes the
// color" (product-spec.md §4) need no special re-color step at all.
//
// Step 19: `searchContextIds` (a `Set<taskId>` of tasks visible only as
// ancestor context for a match elsewhere, not matches themselves — S19-4) is
// computed once by app.js's renderMainView, same "caller computes it once,
// this file just applies it per row" shape as `tagSettings`. Defaults to an
// empty Set so a search-inactive render (an empty box — see searchQuery.js's
// own comment on why that degrades to "everything matches") dims nothing.
export function renderTasks(containers, focusContainer, onEditCancelled, tagSettings, searchContextIds = new Set()) {
  const seenIds = new Set();

  // Step 16 (R3): exactly ONE Map<taskId, rank> for this whole render pass —
  // built once here from every task in every tree container (Focus never
  // needs its own: R4/D3's `mainListOrderIndex` below already reuses this
  // same flattened output, which was itself sorted using this Map). Threaded
  // into every flattenTree/computeMainListOrderIndex call below instead of
  // letting any of them re-derive it, which is what R3 exists to forbid.
  const rankMap = computeQuadrantRankMap(containers.flatMap(({ tasks }) => tasks), tagSettings);

  const perContainer = containers.map(({ element, tasks, visibleIds }) => {
    const flattened = flattenTree(tasks, visibleIds, rankMap);
    for (const { task } of flattened) seenIds.add(task.id);
    return { element, flattened };
  });

  // Issue 1 fix (supersedes step 12's D3 — see PROGRESS.md's superseding
  // entry): "the same order they hold in the main list" (product-spec.md
  // §7) means the actual depth-first RENDER order the tree containers above
  // just produced, not a second, cross-group-meaningless comparison on the
  // raw `order` field — `order` is a fractional index scoped per SIBLING
  // GROUP (step 1's decision), so its magnitude carries no meaning once two
  // pinned tasks come from different parents. Reusing `perContainer`'s
  // already-computed `flattened` arrays (rather than a second traversal)
  // gives every visible task's position in that same depth-first order;
  // containers are walked in the exact sequence app.js always passes them
  // in, so every pinned task still lands in one single, well-defined
  // relative order.
  const mainListOrderIndex = computeMainListOrderIndex(containers.flatMap(({ tasks }) => tasks), rankMap);
  const focusTasks = focusContainer
    ? [...focusContainer.tasks].sort(
        (a, b) =>
          (mainListOrderIndex.get(a.id) ?? Infinity) - (mainListOrderIndex.get(b.id) ?? Infinity)
      )
    : [];
  const focusSeenIds = new Set(focusTasks.map((task) => task.id));

  for (const { flattened } of perContainer) {
    for (const { task, depth } of flattened) {
      let entry = entriesByTaskId.get(task.id);
      if (!entry) {
        entry = createTaskElement(task.id);
        entriesByTaskId.set(task.id, entry);
      }
      updateTaskElement(entry, task, depth, tagSettings, searchContextIds.has(task.id));
    }
  }

  // Focus is flat (D2) — no tree, no depth. Every row renders at depth 0,
  // built/updated with the exact same createTaskElement/updateTaskElement
  // pair the tree containers use (D1: full per-row behavior inherited), just
  // keyed into the separate `focusEntriesByTaskId` Map instead. Step 19:
  // dimmed the same way — a pinned task can itself be only ancestor context
  // for a match elsewhere in its own subtree, same as any tree row.
  for (const task of focusTasks) {
    let entry = focusEntriesByTaskId.get(task.id);
    if (!entry) {
      entry = createTaskElement(task.id);
      focusEntriesByTaskId.set(task.id, entry);
    }
    updateTaskElement(entry, task, 0, tagSettings, searchContextIds.has(task.id));
  }

  // Drop entries for tasks that left every rendered tree container this pass
  // (deleted, filtered out by "show completed", a sign-out clearing the
  // store, etc.) so the Map doesn't grow forever. A dropped entry can be
  // mid-edit — its own `focusout` never fires because the element is about
  // to be discarded rather than blurred — so the interaction it opened would
  // otherwise never close and the 5-minute refresh would stay blocked
  // forever. `entry` is about to be garbage anyway, so there's nothing to
  // reset here beyond telling the caller an interaction needs closing.
  for (const id of entriesByTaskId.keys()) {
    if (!seenIds.has(id)) {
      const entry = entriesByTaskId.get(id);
      closeAnyOpenEdits(entry, id, onEditCancelled);
      entriesByTaskId.delete(id);
    }
  }

  // Same cleanup, own Map, own seen set — an unpin, a completion (which
  // always clears `pinned`, D5), or a delete removes a task from
  // `focusTasks` without touching the tree containers' pass above at all.
  for (const id of focusEntriesByTaskId.keys()) {
    if (!focusSeenIds.has(id)) {
      const entry = focusEntriesByTaskId.get(id);
      closeAnyOpenEdits(entry, id, onEditCancelled, ":focus");
      focusEntriesByTaskId.delete(id);
    }
  }

  // A task moving between tree containers would simply show up in a
  // different container's `flattened` list on the next render;
  // reconcileChildren's insertBefore relocates its <li> there directly
  // (insertBefore natively reparents across different parents, not just
  // within one), so a task id is never a child of two TREE containers at
  // once. Focus's <li> is a wholly separate node in its own Map, so a task
  // being reconciled into Focus here never competes with its own
  // reconciliation into the main list above.
  for (const { element, flattened } of perContainer) {
    reconcileChildren(element, flattened.map(({ task }) => entriesByTaskId.get(task.id).li));
  }
  if (focusContainer) {
    reconcileChildren(focusContainer.element, focusTasks.map((task) => focusEntriesByTaskId.get(task.id).li));
  }
}

// Reconciles `container`'s children to match `desiredList` in place, without
// ever calling replaceChildren/removeChild on an element that doesn't
// actually need to move. That distinction is load-bearing: removing a
// focused element from the document silently drops its focus with no
// blur/focusout event at all — a real, verified-live browser behavior, not
// theoretical — even when the very same node is reattached in the very next
// statement (which is exactly what `container.replaceChildren(...)` was
// doing here on every single refresh, blurring a mid-edit input under the
// user's fingers). Moving an already-attached node via insertBefore, by
// contrast, repositions it without ever detaching it, so an input that isn't
// changing position is never touched, and one that IS moving keeps its
// focus and caret. When `desiredList` already matches the current children,
// this loop makes zero DOM calls — the common case, since most refreshes
// don't change any row's position at all.
function reconcileChildren(container, desiredList) {
  let cursor = container.firstChild;
  for (const li of desiredList) {
    if (cursor === li) {
      cursor = cursor.nextSibling;
    } else {
      container.insertBefore(li, cursor);
    }
  }
  // Anything left over is a task that left the rendered set entirely; its
  // entry was already dropped from entriesByTaskId above, so its <li> just
  // needs physically removing here.
  while (cursor) {
    const next = cursor.nextSibling;
    container.removeChild(cursor);
    cursor = next;
  }
}

// Built exactly once per task id. Everything that can change over the task's
// lifetime (checked state, label text, colors, completed styling, note
// content, which of display/edit-input is visible) is left to
// updateTaskElement / the begin*Edit-endpoints below — this function only
// ever runs on first sight of an id.
function createTaskElement(taskId) {
  const li = document.createElement("li");
  li.dataset.taskId = taskId;

  // Step 22: the "⋯" affordance — a real <button>, FIRST child of the row
  // (ahead of the drag handle), so it opens the exact same context menu
  // step 8 built for long-press/right-click, just reachable with a plain
  // click/tap and from the keyboard too (a native <button> is focusable and
  // Enter/Space-activatable for free — no tabindex/keydown wiring needed).
  // `aria-haspopup="menu"` names what clicking it opens; index.html's
  // hover-reveal CSS is what keeps it out of the way until hovered/focused.
  // app.js's delegated click listener on #task-section wires the actual
  // click (event delegation — no per-element listener here, same rule every
  // other row control in this function follows), and its pointerdown
  // handler excludes this button from both drag-start and the long-press-
  // arms-menu timer, the same way it already excludes the drag handle just
  // below — without that exclusion a slow press on this button would race
  // its own click handler toward opening the same menu twice.
  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "task-item__menu-btn";
  menuBtn.setAttribute("aria-label", "Task actions");
  menuBtn.setAttribute("aria-haspopup", "menu");
  menuBtn.textContent = "⋯";
  li.appendChild(menuBtn);

  // Step 10: a dedicated drag handle, never the whole row. The row already
  // owns click-to-edit (step 2) and long-press-opens-menu (step 8); hijacking
  // the whole row for dragging too would fight both of those gestures, since
  // a pointerdown anywhere on the row would then have to guess which of three
  // things the user meant. app.js's pointerdown listener checks for this
  // exact class before it decides between starting a drag and arming the
  // long-press timer. `touch-action: none` (index.html) is what makes that
  // decision stick on a touch device — without it, the browser's own
  // touch-scroll gesture can steal the pointer sequence out from under our
  // pointermove handler before app.js ever sees it move.
  const dragHandle = document.createElement("span");
  dragHandle.className = "task-item__drag-handle";
  dragHandle.setAttribute("aria-label", "Drag to reorder");
  dragHandle.textContent = "⠿";
  li.appendChild(dragHandle);

  // Step 24 (Workflowy-style restyle): a small round "bullet" dot, purely
  // decorative — this app has no collapse/expand-by-bullet gesture, so it
  // carries no listener and no `aria-*` role, unlike every other control in
  // this function. It exists only to read as "this is a row" the way
  // Workflowy's own bullet does, sitting between the "⋯" menu button and the
  // checkbox per the target design. `aria-hidden` keeps it out of the
  // accessibility tree since it conveys nothing a screen reader user needs.
  const bullet = document.createElement("span");
  bullet.className = "task-item__bullet";
  bullet.setAttribute("aria-hidden", "true");
  li.appendChild(bullet);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "task-item__checkbox";
  li.appendChild(checkbox);

  // Title: a display span and an edit input both exist from the start and
  // are only ever toggled via style.display, never added/removed — that's
  // what lets an open edit survive an unrelated re-render (see file header).
  const label = document.createElement("span");
  label.className = "task-item__label";
  label.dir = "auto"; // title text is Hebrew-with-embedded-English-tags (product-spec.md §1); auto lets the browser pick RTL/LTR per string
  li.appendChild(label);

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "task-item__title-input";
  titleInput.dir = "auto";
  titleInput.maxLength = 1000; // soft UI guard mirroring firestore.rules' cap; app.js/taskService still enforce it
  titleInput.style.display = "none";
  li.appendChild(titleInput);

  // Step 24 (Workflowy-style restyle): note + due-date/age/badges used to
  // each be their own `flex-basis: 100%` row directly under `li` — title
  // row, then a full-width note row, then a full-width meta row, three
  // lines summing to the ~84px-tall rows the target design calls out by
  // name. `secondary` is the one wrapper that now forces the SINGLE extra
  // line break (it alone gets `flex-basis: 100%` in CSS); everything inside
  // it — note text, due date, age, badges — flows as one wrapped inline
  // group on that one line instead of two more forced-full-width rows. Its
  // own children (noteDisplay/noteInput/meta below) are unchanged internally
  // — only their PARENT moved from `li` to this wrapper — so nothing about
  // how they're read or updated elsewhere in this file had to change.
  const secondary = document.createElement("div");
  secondary.className = "task-item__secondary";
  li.appendChild(secondary);

  // Note: same display/edit-input pairing as the title.
  const noteDisplay = document.createElement("div");
  noteDisplay.className = "task-item__note-display";
  noteDisplay.dir = "auto";
  secondary.appendChild(noteDisplay);

  const noteInput = document.createElement("textarea");
  noteInput.className = "task-item__note-input";
  noteInput.dir = "auto";
  noteInput.maxLength = 10000;
  noteInput.style.display = "none";
  secondary.appendChild(noteInput);

  // Step 13 (Dates, D10): due date + age share one "meta" line, now nested
  // inside `secondary` above rather than forcing their own full-width row
  // directly under `li` (see that comment for why). Due date follows the
  // exact display/edit-input pairing every other editable field uses (D10:
  // "an inline editor on the row reusing step 2's inline-edit machinery") —
  // clicking the display opens the `<input type="date">`, same
  // beginInteraction/endInteraction-guarded, survives-an-unrelated-re-render
  // shape as the title/note fields above. Age has no edit state at all (D7:
  // it's never stored, so there's nothing to edit) — it's a plain span,
  // recomputed unconditionally on every updateTaskElement call.
  const meta = document.createElement("div");
  meta.className = "task-item__meta";
  secondary.appendChild(meta);

  const dueDisplay = document.createElement("span");
  dueDisplay.className = "task-item__due-display";
  dueDisplay.dir = "auto";
  meta.appendChild(dueDisplay);

  const dueInput = document.createElement("input");
  dueInput.type = "date";
  dueInput.className = "task-item__due-input";
  dueInput.style.display = "none";
  meta.appendChild(dueInput);

  const ageDisplay = document.createElement("span");
  ageDisplay.className = "task-item__age";
  meta.appendChild(ageDisplay);

  // Step 15 (Q6): the task's resolved quadrant, shown as a compact badge —
  // "see a task's resolved urgency/importance" is this step's whole point.
  // Starts hidden; updateTaskElement below only ever shows it for a task with
  // at least one configured tag (resolveTaskQuadrant !== null). Nothing is
  // ever guessed for an unranked task (§7) — hidden means genuinely absent
  // from the DOM's visible content, not an empty badge sitting there mute.
  const quadrantBadge = document.createElement("span");
  quadrantBadge.className = "task-item__quadrant-badge";
  quadrantBadge.style.display = "none";
  meta.appendChild(quadrantBadge);

  // Step 18 (Recurrence): a plain, always-recomputed badge naming the rule
  // (e.g. "Daily", "Monthly (day 31)") — same "recomputed fresh on every
  // render, hidden entirely rather than emptied-but-visible when absent"
  // shape as quadrantBadge just above. There is no edit state to guard here
  // either: the rule itself is only ever changed through the context menu's
  // prompt flow (app.js), never inline on this row.
  const recurrenceBadge = document.createElement("span");
  recurrenceBadge.className = "task-item__recurrence-badge";
  recurrenceBadge.style.display = "none";
  meta.appendChild(recurrenceBadge);

  return {
    li,
    menuBtn,
    dragHandle,
    // `bullet` and `secondary` are held here for the same reason every other
    // owned element is (so a future change never has to re-query them off
    // `li`), but neither needs any entry in updateTaskElement's update path:
    // `bullet` is static decoration with no task-dependent state at all, and
    // `secondary` is a plain layout wrapper whose own look never changes —
    // only the task-dependent CHILDREN it holds (noteDisplay, noteInput,
    // meta and everything inside meta, all already handled below) do.
    bullet,
    secondary,
    checkbox,
    label,
    titleInput,
    noteDisplay,
    noteInput,
    dueDisplay,
    dueInput,
    ageDisplay,
    quadrantBadge,
    recurrenceBadge,
    editingTitle: false,
    editingNote: false,
    editingDueDate: false,
    // Last task data this row was rendered from. Kept up to date on every
    // update — including updates that skip the DOM writes below because an
    // edit is open — so the edit-close functions have something current to
    // resync the visible text from. Without it, a save that lands while its
    // own edit box is still open would leave the pre-edit text on screen
    // (see endTitleEdit).
    task: null,
    // Step 24: the tag-settings map this row was last rendered with, kept for
    // the identical reason `task` is — endTitleEditIn (below) has to rebuild
    // the title's tag pills from scratch on every edit-close, but its own
    // exported wrapper (`endTitleEdit(taskId, context)`) takes no tagSettings
    // parameter (app.js's call sites are fixed and out of scope for this
    // restyle), so the value has to be stashed here instead of threaded
    // through as an argument.
    tagSettings: null,
  };
}

// Step 19 (S19-4): `isSearchContext` defaults to `false` so renderOverdue's
// call site (search is out of scope for the Overdue screen — S19-6) needs no
// change at all; only renderTasks below ever passes a real value.
function updateTaskElement(entry, task, depth, tagSettings, isSearchContext = false) {
  const { li, checkbox, label, titleInput, noteDisplay, noteInput } = entry;

  entry.task = task;
  // Step 24: stashed so endTitleEditIn (which has no tagSettings parameter of
  // its own — see the entry-object comment on this field) can rebuild the
  // title's tag pills after an edit closes.
  entry.tagSettings = tagSettings;

  li.className =
    "task-item" +
    (task.completed ? " task-item--completed" : "") +
    (isSearchContext ? " task-item--search-context" : "");
  // Step 24 (Workflowy-style restyle, THE KEY PIVOT): step 14 (D3) used to
  // paint the WHOLE ROW in the last-colored-tag's colors here
  // (`resolveTagColor`, tagColors.js) — that's gone. The target design keeps
  // every row light regardless of its tags; a tag's own color now paints only
  // that tag's PILL inside the title (see `renderTitleInto` below, called
  // from the `!entry.editingTitle` branch), resolved per-tag via
  // `readTagColors` rather than per-row via `resolveTagColor`. `task.colors`
  // is still not read anywhere in this codebase (it survives on old
  // documents as a dead field, deliberately not migrated) — this paragraph
  // is just no longer where its replacement lives either.
  // Indentation is CSS's job (see the `--depth` rule in index.html) — this
  // only ever supplies the number, computed by taskTree.js's depthOf, never
  // re-derived from `ancestors.length` here.
  li.style.setProperty("--depth", depth ?? 0);

  checkbox.checked = !!task.completed;

  // Title display/input only get synced from `task` while this row isn't
  // mid-edit. An open title edit holds text the user hasn't saved yet, and a
  // refresh landing mid-edit (the 5-minute timer, or toggling a sibling's
  // checkbox) must never overwrite it — that's the whole point of the
  // interaction guard in store.js.
  if (!entry.editingTitle) {
    // `task.tags` is derived FROM `task.title` (app.js's parseTags) — the
    // tag text already sits inline in the title exactly as typed, so the
    // title alone is the whole display; nothing here ever appends a second
    // `[tags]` suffix. Step 24 splits that same string into text/tag runs
    // (`renderTitleInto`) so each tag token can carry its own pill — the
    // RAW string is still the only thing ever written to `titleInput.value`,
    // which is what the inline-editable title actually reads/writes; the
    // pills are a read-only presentation of `label`, never a second copy of
    // the data.
    renderTitleInto(label, task.title, tagSettings);
    titleInput.value = task.title;
  }

  // Same rule for the note. Rebuilding the read-only display's content on
  // every non-editing update is safe even though it uses replaceChildren
  // internally — noteDisplay itself is never removed from `li`, only the
  // inert text/link nodes inside it are refreshed, which holds no focus or
  // in-progress user input.
  if (!entry.editingNote) {
    renderNoteInto(noteDisplay, task.note || "");
    noteInput.value = task.note || "";
  }

  // Step 13 (Dates): same "skip while mid-edit" rule as title/note above —
  // an open date editor holds a value the user hasn't saved yet, and a
  // refresh landing mid-edit must never overwrite it (D10's own "survives an
  // unrelated re-render" requirement). Age has no edit state to guard —
  // it's always recomputed fresh (D7: derived every render, never stored).
  const overdue = isOverdueTask(task);
  if (!entry.editingDueDate) {
    entry.dueDisplay.textContent = formatDueDateDisplayText(task.dueDate, overdue);
    entry.dueInput.value = formatDateForInput(task.dueDate);
  }
  entry.dueDisplay.classList.toggle("task-item__due-display--overdue", overdue);
  // S18-3: age reads `occurrenceStart ?? createdAt` — the fallback is what
  // keeps every task that has never recurred byte-identical (occurrenceStart
  // is null until the first advance ever stamps it), so this is the only
  // line step 18 changes here.
  entry.ageDisplay.textContent = computeAgeLabel(task.occurrenceStart ?? task.createdAt);

  // Step 15 (Q6): resolved fresh from the title on every render, exactly like
  // the tag-pill colors above and for the identical reason (D12) — never from
  // the cached `tags` array. `null` (unranked — no configured tag at all) hides
  // the badge entirely rather than showing an empty/placeholder one; a
  // resolved quadrant (including the bottom quadrant, which IS ranked) shows
  // its compact token with the full label on `title` for anyone who hovers.
  const quadrant = resolveTaskQuadrant(task.title, tagSettings);
  if (quadrant) {
    entry.quadrantBadge.textContent = quadrantBadgeText(quadrant);
    entry.quadrantBadge.title = describeQuadrant(quadrant);
    entry.quadrantBadge.style.display = "";
  } else {
    entry.quadrantBadge.textContent = "";
    entry.quadrantBadge.removeAttribute("title");
    entry.quadrantBadge.style.display = "none";
  }

  // Step 18: a recurring task's badge, recomputed fresh from `task.recurrence`
  // on every render — same "hidden entirely rather than emptied-but-visible
  // when absent" rule as the quadrant badge just above.
  if (task.recurrence) {
    entry.recurrenceBadge.textContent = `🔁 ${describeRecurrence(task.recurrence)}`;
    entry.recurrenceBadge.style.display = "";
  } else {
    entry.recurrenceBadge.textContent = "";
    entry.recurrenceBadge.style.display = "none";
  }
}

// --- Edit mode: parameterized over row-context -----------------------------
// app.js decides *when* to call these (a delegated click to begin, a
// delegated focusout to end); this module only knows *how* to swap the DOM.
//
// Issue 2 fix: a single `taskId` stopped being enough to address "the entry"
// once a pinned task can render in two independent places at once (step 12,
// D4) — its normal-place row (`entriesByTaskId`) and its Focus row
// (`focusEntriesByTaskId`) are two separate <li>s with two separate
// `editingTitle`/`editingNote` states. Step 12's own first pass handled that
// by doubling every accessor into a named `*Focus` copy (16 exports total)
// plus an `isFocusRow ? X : Y` dispatch at every app.js call site — a shape
// that does not extend to a third row-context, and step 13's Overdue screen
// is shaped exactly like Focus (flat, full task rows), so a third context
// was always coming. This collapses back to ONE parameterized function per
// accessor (8 exports total), where `context` selects which Map to address.
//
// Step 13: exactly the one-line addition this comment predicted — "overdue"
// (`overdueEntriesByTaskId`) is the third row-shaped, edit-capable context.
// Trash still isn't wired in (its rows carry no edit state); everything else
// about the reasoning above is unchanged.
const CONTEXT_MAPS = {
  main: entriesByTaskId,
  focus: focusEntriesByTaskId,
  overdue: overdueEntriesByTaskId,
};

function mapForContext(context) {
  const map = CONTEXT_MAPS[context];
  if (!map) throw new Error(`render.js: unknown row context "${context}"`);
  return map;
}

// --- Title edit mode -------------------------------------------------------

// Step 25: `selectAll` lets the caller choose the caret behavior. Every
// existing entry point (click-to-edit) wants the default `true` — the whole
// title highlighted so the first keystroke replaces it, byte-identical to
// the pre-step-25 behavior. The one caller that wants `false` is the
// Workflowy-style "Enter splits the title and opens the next task's editor"
// flow (app.js's handleCreateTaskAfter): the text handed to the new task's
// title is the tail the user already typed, carried over from the split, and
// select()-ing it would mean the very next keystroke wipes that text back
// out — the opposite of "continue typing where you left off".
function beginTitleEditIn(map, taskId, selectAll = true) {
  const entry = map.get(taskId);
  if (!entry) return;
  entry.editingTitle = true;
  entry.label.style.display = "none";
  entry.titleInput.style.display = "";
  entry.titleInput.focus();
  if (selectAll) {
    entry.titleInput.select();
  } else {
    entry.titleInput.setSelectionRange(0, 0);
  }
}

// Closing an edit must resync the text it is about to reveal. While
// `editingTitle` was true, updateTaskElement deliberately skipped writing
// `label`'s content so a refresh couldn't clobber what the user was
// typing — which means the label still holds the title (and pills) as they
// were when the edit opened. app.js commits a title by awaiting the write AND
// the refetch/re-render, and only then calls this; that re-render is exactly
// one of the passes the guard skipped, so without the resync below the row
// would reveal the pre-edit title after a perfectly successful save and look
// as though the edit had been silently discarded.
//
// `entry.task` is the row's last rendered task (updateTaskElement keeps it
// current even on the passes it skips), so it is the saved value in every
// case this runs: a committed edit, an Escape cancel, and a failed write
// that already reverted the input — all three want the last-known-saved
// title back on screen. Step 24: rebuilt through `renderTitleInto` (using
// `entry.tagSettings`, stashed by the same last update — see the entry-object
// comment) rather than a plain `textContent` write, so the pills reappear
// exactly as they would on a normal, non-edit render.
function endTitleEditIn(map, taskId) {
  const entry = map.get(taskId);
  if (!entry) return;
  entry.editingTitle = false;
  if (entry.task) {
    renderTitleInto(entry.label, entry.task.title, entry.tagSettings);
    entry.titleInput.value = entry.task.title;
  }
  entry.titleInput.style.display = "none";
  entry.label.style.display = "";
}

function getTitleInputValueIn(map, taskId) {
  return map.get(taskId)?.titleInput.value ?? "";
}

// Used to revert the input back to the last-saved title after a failed
// write, so a dismissed error doesn't leave stale unsaved text sitting in
// a box that already silently closed.
function setTitleInputValueIn(map, taskId, value) {
  const entry = map.get(taskId);
  if (entry) entry.titleInput.value = value;
}

export function beginTitleEdit(taskId, context, selectAll = true) {
  beginTitleEditIn(mapForContext(context), taskId, selectAll);
}
export function endTitleEdit(taskId, context) {
  endTitleEditIn(mapForContext(context), taskId);
}
export function getTitleInputValue(taskId, context) {
  return getTitleInputValueIn(mapForContext(context), taskId);
}
export function setTitleInputValue(taskId, context, value) {
  setTitleInputValueIn(mapForContext(context), taskId, value);
}

// --- Note edit mode ---------------------------------------------------------
// Same map-parameterized-helper / thin-wrapper shape as the title functions
// above, for the identical reason (a pinned task's Focus row and normal-place
// row are two independent <li>s with two independent note-edit states).

function beginNoteEditIn(map, taskId) {
  const entry = map.get(taskId);
  if (!entry) return;
  entry.editingNote = true;
  entry.noteDisplay.style.display = "none";
  entry.noteInput.style.display = "";
  entry.noteInput.focus();
}

// Same resync as endTitleEdit above, for the same reason — the note display
// was skipped by updateTaskElement for as long as its edit was open, so it
// still holds the pre-edit note until this rebuilds it.
function endNoteEditIn(map, taskId) {
  const entry = map.get(taskId);
  if (!entry) return;
  entry.editingNote = false;
  if (entry.task) {
    renderNoteInto(entry.noteDisplay, entry.task.note || "");
    entry.noteInput.value = entry.task.note || "";
  }
  entry.noteInput.style.display = "none";
  entry.noteDisplay.style.display = "";
}

function getNoteInputValueIn(map, taskId) {
  return map.get(taskId)?.noteInput.value ?? "";
}

function setNoteInputValueIn(map, taskId, value) {
  const entry = map.get(taskId);
  if (entry) entry.noteInput.value = value;
}

export function beginNoteEdit(taskId, context) {
  beginNoteEditIn(mapForContext(context), taskId);
}
export function endNoteEdit(taskId, context) {
  endNoteEditIn(mapForContext(context), taskId);
}
export function getNoteInputValue(taskId, context) {
  return getNoteInputValueIn(mapForContext(context), taskId);
}
export function setNoteInputValue(taskId, context, value) {
  setNoteInputValueIn(mapForContext(context), taskId, value);
}

// --- Due date edit mode (step 13, D10) --------------------------------------
// Same map-parameterized-helper / thin-wrapper shape as title/note above, for
// the identical reason: a task can render on up to three independent rows at
// once (main, Focus, Overdue), each with its own dueInput and its own
// editingDueDate flag.

function beginDueDateEditIn(map, taskId) {
  const entry = map.get(taskId);
  if (!entry) return;
  entry.editingDueDate = true;
  entry.dueDisplay.style.display = "none";
  entry.dueInput.style.display = "";
  entry.dueInput.focus();
}

// Same resync rule as endTitleEdit/endNoteEdit above: updateTaskElement
// skipped writing the display/input while editingDueDate was true, so both
// still hold whatever was on screen when the edit opened until this rebuilds
// them from `entry.task` (a committed save, an Escape cancel, and a failed
// write that already reverted the input all want the last-known-saved due
// date back on screen).
function endDueDateEditIn(map, taskId) {
  const entry = map.get(taskId);
  if (!entry) return;
  entry.editingDueDate = false;
  if (entry.task) {
    const overdue = isOverdueTask(entry.task);
    entry.dueDisplay.textContent = formatDueDateDisplayText(entry.task.dueDate, overdue);
    entry.dueDisplay.classList.toggle("task-item__due-display--overdue", overdue);
    entry.dueInput.value = formatDateForInput(entry.task.dueDate);
  }
  entry.dueInput.style.display = "none";
  entry.dueDisplay.style.display = "";
}

function getDueDateInputValueIn(map, taskId) {
  return map.get(taskId)?.dueInput.value ?? "";
}

function setDueDateInputValueIn(map, taskId, value) {
  const entry = map.get(taskId);
  if (entry) entry.dueInput.value = value;
}

export function beginDueDateEdit(taskId, context) {
  beginDueDateEditIn(mapForContext(context), taskId);
}
export function endDueDateEdit(taskId, context) {
  endDueDateEditIn(mapForContext(context), taskId);
}
export function getDueDateInputValue(taskId, context) {
  return getDueDateInputValueIn(mapForContext(context), taskId);
}
export function setDueDateInputValue(taskId, context, value) {
  setDueDateInputValueIn(mapForContext(context), taskId, value);
}

// --- Title rendering (tag pills, step 24) -----------------------------------
// THE KEY PIVOT of the Workflowy-style restyle: a tag token now renders as a
// small colored pill INLINE inside the title text, instead of the pre-step-24
// rule where the winning tag's colors painted the entire row (see the
// `li.style` comment this replaced in updateTaskElement above). Each pill
// carries its OWN resolved color pair via `readTagColors` — never
// `resolveTagColor`'s "last colored tag wins the whole row" computation,
// which has no row-wide paint left to feed now that the row itself stays
// light regardless of which tags a task carries.
//
// tagColors.js's own `TAG_PATTERN` (which `parseTags` is built on) is not
// exported — `parseTags` only returns the matched tag STRINGS, not their
// offsets in the title, and offsets are exactly what's needed here to split
// the string into alternating text/tag runs. `TITLE_TAG_PATTERN` below is
// therefore this file's own copy of that exact same `[#@]\w+` shape — not a
// second, independent decision about what counts as a tag (tagColors.js
// stays the one place that decision is made; if its shape ever changes, this
// pattern has to change with it) — used purely as a splitting tool, the same
// way `URL_PATTERN` below is `renderNoteInto`'s splitting tool for URLs.
const TITLE_TAG_PATTERN = /([#@]\w+)/g;

// Same "split on a single capturing group, odd indices are matches" idiom
// `renderNoteInto` (below) uses for URLs — one shared trick, two different
// token types. Built with createElement/textContent only, same
// no-innerHTML-on-user-text rule renderNoteInto documents, since a title is
// exactly as free-typed as a note.
function renderTitleInto(container, title, tagSettings) {
  container.replaceChildren();
  const str = String(title ?? "");
  const parts = str.split(TITLE_TAG_PATTERN);
  parts.forEach((part, index) => {
    if (!part) return;
    if (index % 2 === 1) {
      // An odd-indexed part is a matched tag token. `readTagColors` returns
      // null for a tag with no configured colors (or no settings entry at
      // all) — CSS's `.task-item__tag` default styling is what an uncolored
      // pill looks like then, the same "clear the inline override, let the
      // class own the default" split step 14 originally used for the
      // whole row.
      const colors = readTagColors(tagSettings?.tags?.[part]);
      const pill = document.createElement("span");
      pill.className = "task-item__tag";
      if (colors) {
        pill.style.color = colors.fg;
        pill.style.backgroundColor = colors.bg;
      }
      pill.textContent = part;
      container.appendChild(pill);
    } else {
      container.appendChild(document.createTextNode(part));
    }
  });
}

// --- Note rendering ---------------------------------------------------------
// Matches a bare URL so it can be split out of the surrounding sentence.
const URL_PATTERN = /(https?:\/\/[^\s]+|www\.[^\s]+)/i;
// Punctuation a sentence naturally puts right after a URL (a closing period,
// a comma, a closing paren) is peeled back into plain text so the link
// target doesn't swallow it.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

// Builds the note's read-only content as DOM nodes: line breaks in the
// source are preserved one-for-one as <br>, and any bare URL becomes a
// clickable <a>. Built with createElement/textContent/createTextNode only —
// the note is free-typed user text, and turning URLs into anchors via string
// concatenation (e.g. `innerHTML = text.replace(urlRe, '<a href=...>')`) is
// the textbook way to open an XSS hole, since the "URL" the user typed could
// just as easily be `<img src=x onerror=...>`.
function renderNoteInto(container, text) {
  container.replaceChildren();
  if (!text) {
    const placeholder = document.createElement("span");
    placeholder.className = "task-item__note-placeholder";
    placeholder.textContent = "Add a note…";
    container.appendChild(placeholder);
    return;
  }

  const lines = text.split("\n");
  lines.forEach((line, lineIndex) => {
    // URL_PATTERN has one capturing group, so String.split puts the matched
    // URLs at the odd indices of the result and the surrounding plain text
    // at the even ones — no regex .exec/.test statefulness to manage.
    const parts = line.split(URL_PATTERN);
    parts.forEach((part, partIndex) => {
      if (!part) return;
      if (partIndex % 2 === 1) {
        const trailingMatch = part.match(TRAILING_PUNCTUATION);
        const trailing = trailingMatch ? trailingMatch[0] : "";
        const url = trailing ? part.slice(0, part.length - trailing.length) : part;
        const link = document.createElement("a");
        link.href = url.startsWith("www.") ? `https://${url}` : url;
        link.textContent = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        container.appendChild(link);
        if (trailing) container.appendChild(document.createTextNode(trailing));
      } else {
        container.appendChild(document.createTextNode(part));
      }
    });
    if (lineIndex < lines.length - 1) {
      container.appendChild(document.createElement("br"));
    }
  });
}

// --- Trash rendering ---------------------------------------------------
// Step 9: the Trash is a deliberately FLAT list — never a tree — because the
// 50-item cap counts individual deleted documents (product-spec.md §3:
// "Tasks are counted individually, not per deletion"), and step 8 already
// made sure a cascade delete writes each descendant as its own document for
// exactly this reason. Rendering the Trash as a tree would visually collapse
// a cascade's several documents back into what looks like one entry, hiding
// the very count the cap acts on. app.js decides the sort order (newest
// deletion first) and hands this an already-sorted array; this function only
// turns that array into DOM, the same "app.js owns *when*, render.js owns
// *how*" split the main list uses.
//
// A separate, much simpler Map from entriesByTaskId above — trash rows carry
// no edit state to preserve across a refresh, no checkbox, no hierarchy
// depth, and no drag handle (reordering the Trash isn't a thing). Reusing
// the main list's entry shape would mean carrying a pile of fields that
// never apply here.
const trashEntriesByTaskId = new Map();

export function renderTrash(container, tasks) {
  const seenIds = new Set(tasks.map((task) => task.id));

  for (const task of tasks) {
    let entry = trashEntriesByTaskId.get(task.id);
    if (!entry) {
      entry = createTrashElement(task.id);
      trashEntriesByTaskId.set(task.id, entry);
    }
    updateTrashElement(entry, task);
  }

  // Same cleanup rule as the main list: drop entries for tasks that left the
  // rendered set (restored, or purged past the cap) so the Map doesn't grow
  // forever. Trash rows hold no open edit/interaction, so there is nothing
  // to warn a caller about on the way out, unlike renderTasks's
  // onEditCancelled above.
  for (const id of trashEntriesByTaskId.keys()) {
    if (!seenIds.has(id)) trashEntriesByTaskId.delete(id);
  }

  reconcileChildren(container, tasks.map((task) => trashEntriesByTaskId.get(task.id).li));
}

// The Restore button carries no listener of its own — same event-delegation
// rule as every other per-row button in this app (see the main list's
// menuBtn above). app.js's delegated
// click listener on #task-section recognizes `.trash-item__restore-btn` and
// dispatches to its own restore handler.
function createTrashElement(taskId) {
  const li = document.createElement("li");
  li.className = "trash-item";
  li.dataset.taskId = taskId;

  const label = document.createElement("span");
  label.className = "trash-item__label";
  label.dir = "auto"; // same mixed Hebrew/English reasoning as the main list's title (product-spec.md §1)
  li.appendChild(label);

  const restoreButton = document.createElement("button");
  restoreButton.type = "button";
  restoreButton.className = "trash-item__restore-btn";
  restoreButton.textContent = "Restore";
  restoreButton.setAttribute("aria-label", "Restore task");
  li.appendChild(restoreButton);

  return { li, label, restoreButton };
}

// Nothing here is ever mid-edit, so unlike updateTaskElement there is no
// "leave it alone while editing" branch to worry about — every field is
// always safe to re-sync from `task` on every pass.
function updateTrashElement(entry, task) {
  entry.label.textContent = task.title;
}

// --- Overdue rendering (step 13) --------------------------------------------
// D4: Overdue is a SCREEN (its own `currentView` entry in app.js, following
// step 9's Trash view-switching precedent), never a section folded into
// `renderTasks`'s single call the way Focus is — app.js calls this directly
// from its own separate view-render path. But its ROWS are exactly Focus's
// row shape (D4): full task rows (checkbox, title/note/due-date inline edit,
// drag handle, action buttons), flat, at depth 0, built with the very same
// createTaskElement/updateTaskElement pair every other row uses — never
// Trash's much simpler label-plus-button shape, since Trash rows carry no
// edit state and Overdue rows very much do (that's the whole point of this
// step's due-date editor). `overdueEntriesByTaskId` (declared at the top of
// this file) is what keeps a task's Overdue row independent of its
// normal-place and Focus rows, the same one-Map-per-container pattern
// `trashEntriesByTaskId`/`focusEntriesByTaskId` already established.
export function renderOverdue(container, tasks, onEditCancelled, tagSettings) {
  const seenIds = new Set(tasks.map((task) => task.id));

  for (const task of tasks) {
    let entry = overdueEntriesByTaskId.get(task.id);
    if (!entry) {
      entry = createTaskElement(task.id);
      overdueEntriesByTaskId.set(task.id, entry);
    }
    // Flat (D4/D2 precedent) — no tree, no depth. `tagSettings` (step 14) is
    // threaded through here for the same reason renderTasks takes it: an
    // Overdue row is the same full task row and takes the same tag colors.
    updateTaskElement(entry, task, 0, tagSettings);
  }

  // Same cleanup rule as Focus's own pass in renderTasks: a task leaving the
  // rendered set (no longer overdue, completed, deleted, restored past its
  // due date some other way) can be mid-edit on this exact row — its own
  // focusout never fires because the element is about to be discarded, not
  // blurred — so the interaction it opened has to be told to close here.
  for (const id of overdueEntriesByTaskId.keys()) {
    if (!seenIds.has(id)) {
      const entry = overdueEntriesByTaskId.get(id);
      closeAnyOpenEdits(entry, id, onEditCancelled, ":overdue");
      overdueEntriesByTaskId.delete(id);
    }
  }

  reconcileChildren(container, tasks.map((task) => overdueEntriesByTaskId.get(task.id).li));
}

// --- Tag settings rendering (step 14) ---------------------------------------
// D4: the Tag Settings page is a SCREEN — a fourth `currentView` panel in
// app.js, following step 9's Trash and step 13's Overdue precedent exactly,
// not a fourth navigation pattern. This function is its `renderTrash`
// equivalent: app.js decides WHICH tags to list (D5's union) and in what
// order; this only turns that list into DOM.
//
// Its own Map, like every other container in this file — but unlike the other
// four this one is keyed by TAG NAME, not task id, because a tag is not a
// task. It is deliberately NOT wired into CONTEXT_MAPS: those are row-shaped,
// task-addressed, edit-capable containers, and a settings row shares none of
// that (no checkbox, no title/note/due editor, no drag handle, no depth).
//
// Each row carries `dataset.tagName` the same way a task row carries
// `dataset.taskId`, which is how app.js's delegated listeners on #task-section
// tell a color change on this screen from a checkbox change on a task row.
const settingsEntriesByTagName = new Map();

// `tagNames` is already ordered and de-duplicated by app.js (tagColors.js's
// collectTagNames). `tagSettings` supplies each row's current colors, read
// through the same `readTagColors` validator every other consumer uses, so a
// malformed entry shows as "no colors assigned" here rather than pushing an
// invalid value into an `<input type="color">` (which would silently coerce it
// to black and make bad data look like a deliberate choice).
export function renderSettings(container, tagNames, tagSettings) {
  const seenNames = new Set(tagNames);

  for (const name of tagNames) {
    let entry = settingsEntriesByTagName.get(name);
    if (!entry) {
      entry = createSettingsElement(name);
      settingsEntriesByTagName.set(name, entry);
    }
    updateSettingsElement(entry, name, tagSettings);
  }

  for (const name of settingsEntriesByTagName.keys()) {
    if (!seenNames.has(name)) settingsEntriesByTagName.delete(name);
  }

  reconcileChildren(container, tagNames.map((name) => settingsEntriesByTagName.get(name).li));
}

// Built once per tag name, then only updated — the same keyed-reuse discipline
// as createTaskElement, and for a related reason: a re-render happens after
// every settings write, and rebuilding the row would tear down the very
// `<input type="color">` the user just used (dropping its focus, and on some
// platforms closing the native picker) on the change it fired itself.
//
// Neither input carries its own listener — same event-delegation rule as every
// other control in this app (see createTaskElement). app.js's delegated
// `change` listener on #task-section recognizes `.tag-setting__color` and its
// delegated `click` listener recognizes `.tag-setting__clear-btn`.
function createSettingsElement(tagName) {
  const li = document.createElement("li");
  li.className = "tag-setting";
  li.dataset.tagName = tagName;

  // The tag itself, painted in its own colors — this is the row's preview, so
  // the user sees the pair they are choosing before hunting for a task that
  // carries the tag. `dir="auto"` for the same mixed-script reason every other
  // user-text element in this file sets it.
  const preview = document.createElement("span");
  preview.className = "tag-setting__preview";
  preview.dir = "auto";
  preview.textContent = tagName;
  li.appendChild(preview);

  const fgLabel = document.createElement("label");
  fgLabel.className = "tag-setting__field";
  fgLabel.appendChild(document.createTextNode("Text "));
  const fgInput = document.createElement("input");
  fgInput.type = "color";
  fgInput.className = "tag-setting__color";
  fgInput.dataset.colorField = "fg"; // read by app.js's change handler
  fgLabel.appendChild(fgInput);
  li.appendChild(fgLabel);

  const bgLabel = document.createElement("label");
  bgLabel.className = "tag-setting__field";
  bgLabel.appendChild(document.createTextNode("Background "));
  const bgInput = document.createElement("input");
  bgInput.type = "color";
  bgInput.className = "tag-setting__color";
  bgInput.dataset.colorField = "bg";
  bgLabel.appendChild(bgInput);
  li.appendChild(bgLabel);

  // Removes the tag's colors entirely, so its tasks fall back to the default
  // row style — distinct from "picking white on blue", which is a real
  // assignment that still wins the last-colored-tag race (D2). Only shown when
  // there is actually something to clear.
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "tag-setting__clear-btn";
  clearButton.textContent = "Clear colors";
  clearButton.setAttribute("aria-label", `Clear colors for ${tagName}`);
  li.appendChild(clearButton);

  // Step 15: assigns this tag's Eisenhower quadrant — the one control this
  // step adds to the row (per PROGRESS.md's own note that this is "one more
  // child of that row plus one more field in the entry object, not a
  // rewrite"). The blank option IS "unconfigured" (Q1): selecting it writes
  // `quadrant: null` (app.js's handleTagQuadrantChange), which
  // readTagQuadrant reads back as "no quadrant" exactly like an entry that
  // never had the key at all.
  const quadrantLabel = document.createElement("label");
  quadrantLabel.className = "tag-setting__field";
  quadrantLabel.appendChild(document.createTextNode("Quadrant "));
  const quadrantSelect = document.createElement("select");
  quadrantSelect.className = "tag-setting__quadrant";

  const unsetOption = document.createElement("option");
  unsetOption.value = "";
  unsetOption.textContent = "Not set";
  quadrantSelect.appendChild(unsetOption);

  for (const quadrant of QUADRANT_OPTIONS) {
    const option = document.createElement("option");
    option.value = quadrant;
    option.textContent = describeQuadrant(quadrant);
    quadrantSelect.appendChild(option);
  }
  quadrantLabel.appendChild(quadrantSelect);
  li.appendChild(quadrantLabel);

  // Step 17: renames this tag across every task that carries it (and moves
  // its settings entry to the new name), or deletes it outright (strips the
  // token from every title AND removes the settings entry — product-
  // spec.md:226-234). Two separate buttons rather than one control, since
  // these are two different, differently-destructive actions with two
  // different results — the same reasoning D10 (step 13) already used to
  // keep "Change due date"/"Clear due date" as two menu items instead of
  // one toggle label. Neither button carries its own listener (event
  // delegation, same rule as every other control in this file); app.js's
  // delegated click listener on #task-section recognizes both classes.
  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.className = "tag-setting__rename-btn";
  renameButton.textContent = "Rename";
  renameButton.setAttribute("aria-label", `Rename tag ${tagName}`);
  li.appendChild(renameButton);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "tag-setting__delete-btn";
  deleteButton.textContent = "Delete";
  deleteButton.setAttribute("aria-label", `Delete tag ${tagName}`);
  li.appendChild(deleteButton);

  return { li, preview, fgInput, bgInput, clearButton, quadrantSelect, renameButton, deleteButton };
}

function updateSettingsElement(entry, tagName, tagSettings) {
  const colors = readTagColors(tagSettings?.tags?.[tagName]);
  const quadrant = readTagQuadrant(tagSettings?.tags?.[tagName]);

  // An unassigned tag's inputs still have to show SOME valid `#rrggbb` (the
  // control has no "unset" state), so they show the defaults a first
  // assignment would produce — what the user picks from, not a claim that the
  // tag is already colored. `clearButton`'s visibility is what actually says
  // whether this tag has colors.
  entry.fgInput.value = colors ? colors.fg : DEFAULT_TAG_FG;
  entry.bgInput.value = colors ? colors.bg : DEFAULT_TAG_BG;

  entry.preview.style.color = colors ? colors.fg : "";
  entry.preview.style.backgroundColor = colors ? colors.bg : "";
  entry.preview.classList.toggle("tag-setting__preview--unset", !colors);

  entry.clearButton.style.display = colors ? "" : "none";

  // Step 15: same "always resync from the settings map" rule as the color
  // inputs above — the blank option (value "") is what an unconfigured tag
  // (readTagQuadrant returning null) shows as, never a guessed default.
  entry.quadrantSelect.value = quadrant ?? "";
}
