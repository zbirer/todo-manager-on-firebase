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
// Step 5 (Inbox container): `renderTasks` renders into *multiple* containers
// (the Inbox section and the main list) from ONE shared `entriesByTaskId`
// Map, so a task id always maps to exactly one <li> in exactly one
// container's DOM, and moving a task between containers (filing it out of
// the Inbox) reuses that same <li> rather than destroying and recreating it.
//
// Step 12 (Focus/pin, D1/D2/D4): Focus is a third container rendered inside
// the SAME `renderTasks` call (never a second call — see the containers-doc
// comment below for why a second call to the shared-map version would
// corrupt it), but it deliberately does NOT share `entriesByTaskId` with
// Inbox/main. A pinned task renders BOTH in Focus AND in its normal place at
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

import { buildTree, depthOf } from "./taskTree.js";

const entriesByTaskId = new Map();
const focusEntriesByTaskId = new Map();

// The sibling comparator — orders tasks that share the same parent. This is
// the exact seam step 16 replaces with the quadrant-first comparator. It
// must stay this one small function so that swap never has to touch the
// tree-walking logic in flattenTree below.
function compareSiblings(a, b) {
  return a.order - b.order;
}

// Flat ascending sort by `order`, ignoring hierarchy. Kept as a small public
// utility (nothing else in this codebase calls it yet) built on the same
// comparator flattenTree uses, so there is exactly one sibling-ordering rule
// regardless of which of the two callers asks for it.
export function sortTasks(tasks) {
  return [...tasks].sort(compareSiblings);
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
function flattenTree(allTasks, visibleIds) {
  const tree = buildTree(allTasks);
  const result = [];

  function visit(nodes) {
    for (const node of [...nodes].sort(compareSiblings)) {
      if (visibleIds.has(node.id)) {
        result.push({ task: node, depth: depthOf(tree, node.id) });
      }
      if (node.children.length > 0) visit(node.children);
    }
  }

  visit(tree.roots);
  return result;
}

// `containers` is an array of `{ element, tasks, visibleIds }` — one entry
// per rendered TREE section (step 5 adds the Inbox alongside the main list).
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
// map to exactly one <li> among the tree containers, and Inbox vs. main are a
// strict partition (a subtask always inherits its parent's `inInbox`, so no
// task's ancestry ever crosses between the two) — but if this ran as two
// independent calls to a single-container version of this function, the
// FIRST call's cleanup would delete every entry the SECOND call still needs
// (they're simply not in the first call's own seen set), destroying and
// rebuilding half the list on every render. Computing the union of "seen"
// across every tree container first, then reconciling each container's DOM
// separately, is what avoids that. Focus runs the identical seen/cleanup
// discipline against its own separate Map and its own separate seen set, so
// neither pass can ever see (or corrupt) the other's entries.
export function renderTasks(containers, focusContainer, onEditCancelled) {
  const seenIds = new Set();
  const perContainer = containers.map(({ element, tasks, visibleIds }) => {
    const flattened = flattenTree(tasks, visibleIds);
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
  // containers are walked in the exact [Inbox, main list] sequence app.js
  // always passes them in, so a pinned Inbox task and a pinned main-list
  // task still land in one single, well-defined relative order.
  const mainListOrderIndex = new Map();
  for (const { flattened } of perContainer) {
    for (const { task } of flattened) {
      if (!mainListOrderIndex.has(task.id)) mainListOrderIndex.set(task.id, mainListOrderIndex.size);
    }
  }
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
      updateTaskElement(entry, task, depth);
    }
  }

  // Focus is flat (D2) — no tree, no depth. Every row renders at depth 0,
  // built/updated with the exact same createTaskElement/updateTaskElement
  // pair the tree containers use (D1: full per-row behavior inherited), just
  // keyed into the separate `focusEntriesByTaskId` Map instead.
  for (const task of focusTasks) {
    let entry = focusEntriesByTaskId.get(task.id);
    if (!entry) {
      entry = createTaskElement(task.id);
      focusEntriesByTaskId.set(task.id, entry);
    }
    updateTaskElement(entry, task, 0);
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
      if (onEditCancelled) {
        if (entry.editingTitle) onEditCancelled(id, "title");
        if (entry.editingNote) onEditCancelled(id, "note");
      }
      entriesByTaskId.delete(id);
    }
  }

  // Same cleanup, own Map, own seen set — an unpin, a completion (which
  // always clears `pinned`, D5), or a delete removes a task from
  // `focusTasks` without touching the tree containers' pass above at all.
  for (const id of focusEntriesByTaskId.keys()) {
    if (!focusSeenIds.has(id)) {
      const entry = focusEntriesByTaskId.get(id);
      if (onEditCancelled) {
        if (entry.editingTitle) onEditCancelled(id, "title:focus");
        if (entry.editingNote) onEditCancelled(id, "note:focus");
      }
      focusEntriesByTaskId.delete(id);
    }
  }

  // A task moving between containers (filed out of the Inbox) simply shows
  // up in a different container's `flattened` list on the next render;
  // reconcileChildren's insertBefore relocates its <li> there directly
  // (insertBefore natively reparents across different parents, not just
  // within one), so a task id is never a child of two TREE containers at
  // once. Focus's <li> is a wholly separate node in its own Map, so a task
  // being reconciled into Focus here never competes with its own
  // reconciliation into the main list/Inbox above.
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

  // Note: same display/edit-input pairing as the title.
  const noteDisplay = document.createElement("div");
  noteDisplay.className = "task-item__note-display";
  noteDisplay.dir = "auto";
  li.appendChild(noteDisplay);

  const noteInput = document.createElement("textarea");
  noteInput.className = "task-item__note-input";
  noteInput.dir = "auto";
  noteInput.maxLength = 10000;
  noteInput.style.display = "none";
  li.appendChild(noteInput);

  // Every per-row action button lives in one wrapper (see index.html's
  // .task-item__actions) so the group is pushed right as a whole regardless
  // of which individual buttons are visible for this task.
  const actions = document.createElement("div");
  actions.className = "task-item__actions";
  li.appendChild(actions);

  // Step 5: the one explicit way a task leaves the Inbox. Only shown for
  // rows currently in the Inbox (updateTaskElement toggles it) — a task
  // that isn't there has nothing to file.
  const moveOutButton = document.createElement("button");
  moveOutButton.type = "button";
  moveOutButton.className = "task-item__move-out-btn";
  moveOutButton.textContent = "Move out of Inbox";
  moveOutButton.setAttribute("aria-label", "Move out of Inbox");
  actions.appendChild(moveOutButton);

  // Step 4: add a subtask under this task. Step 8 added a right-click/
  // long-press context menu with the same command, but this inline button
  // stays too — the spec's task menu is an additional way to reach these
  // actions, not a replacement for the always-visible per-row buttons.
  const addSubtaskButton = document.createElement("button");
  addSubtaskButton.type = "button";
  addSubtaskButton.className = "task-item__add-subtask-btn";
  addSubtaskButton.textContent = "+ Subtask";
  addSubtaskButton.setAttribute("aria-label", "Add subtask");
  actions.appendChild(addSubtaskButton);

  // Step 3: delete a task (leaf-only refusal at the time). Step 8 turned
  // this into a cascade delete and added the context menu's own Delete item
  // routing to the same handler — this inline button is unchanged and stays
  // alongside it.
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "task-item__delete-btn";
  deleteButton.textContent = "Delete";
  deleteButton.setAttribute("aria-label", "Delete task");
  actions.appendChild(deleteButton);

  return {
    li,
    dragHandle,
    checkbox,
    label,
    titleInput,
    noteDisplay,
    noteInput,
    moveOutButton,
    addSubtaskButton,
    deleteButton,
    editingTitle: false,
    editingNote: false,
    // Last task data this row was rendered from. Kept up to date on every
    // update — including updates that skip the DOM writes below because an
    // edit is open — so the edit-close functions have something current to
    // resync the visible text from. Without it, a save that lands while its
    // own edit box is still open would leave the pre-edit text on screen
    // (see endTitleEdit).
    task: null,
  };
}

function updateTaskElement(entry, task, depth) {
  const { li, checkbox, label, titleInput, noteDisplay, noteInput, moveOutButton } = entry;

  entry.task = task;

  li.className = "task-item" + (task.completed ? " task-item--completed" : "");
  // Per-task color still comes from stored data (step 14 replaces this with
  // per-tag colors); everything else about the row's look lives in CSS.
  li.style.color = task.colors?.foreground || "#ffffff";
  li.style.backgroundColor = task.colors?.background || "#3b82f6";
  // Indentation is CSS's job (see the `--depth` rule in index.html) — this
  // only ever supplies the number, computed by taskTree.js's depthOf, never
  // re-derived from `ancestors.length` here.
  li.style.setProperty("--depth", depth ?? 0);

  checkbox.checked = !!task.completed;

  // Only an Inbox row has anything to file out of the Inbox.
  moveOutButton.style.display = task.inInbox ? "" : "none";

  // Title display/input only get synced from `task` while this row isn't
  // mid-edit. An open title edit holds text the user hasn't saved yet, and a
  // refresh landing mid-edit (the 5-minute timer, or toggling a sibling's
  // checkbox) must never overwrite it — that's the whole point of the
  // interaction guard in store.js.
  if (!entry.editingTitle) {
    // `task.tags` is derived FROM `task.title` (app.js's parseTags) — the
    // tag text already sits inline in the title exactly as typed, so the
    // title alone is the whole display. Appending a `[tags]` suffix here
    // used to show every tag twice. Per-tag color styling is step 14's job
    // (it needs the settings screen this step doesn't have yet); until then
    // the title renders as plain text.
    label.textContent = task.title;
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
// There are already THREE row-shaped containers in this codebase, not two:
// "main" (`entriesByTaskId`), "focus" (`focusEntriesByTaskId`), and Trash
// (`trashEntriesByTaskId` below) — CONTEXT_MAPS is where a fourth, or
// Trash's own eventual edit support, becomes a one-line addition instead of
// another doubling. Trash isn't wired in today because its rows carry no
// edit state (see renderTrash's own comment) — there is nothing yet for
// "trash" to address.
const CONTEXT_MAPS = {
  main: entriesByTaskId,
  focus: focusEntriesByTaskId,
};

function mapForContext(context) {
  const map = CONTEXT_MAPS[context];
  if (!map) throw new Error(`render.js: unknown row context "${context}"`);
  return map;
}

// --- Title edit mode -------------------------------------------------------

function beginTitleEditIn(map, taskId) {
  const entry = map.get(taskId);
  if (!entry) return;
  entry.editingTitle = true;
  entry.label.style.display = "none";
  entry.titleInput.style.display = "";
  entry.titleInput.focus();
  entry.titleInput.select();
}

// Closing an edit must resync the text it is about to reveal. While
// `editingTitle` was true, updateTaskElement deliberately skipped writing
// `label.textContent` so a refresh couldn't clobber what the user was
// typing — which means the label still holds the title as it was when the
// edit opened. app.js commits a title by awaiting the write AND the
// refetch/re-render, and only then calls this; that re-render is exactly one
// of the passes the guard skipped, so without the resync below the row would
// reveal the pre-edit title after a perfectly successful save and look as
// though the edit had been silently discarded.
//
// `entry.task` is the row's last rendered task (updateTaskElement keeps it
// current even on the passes it skips), so it is the saved value in every
// case this runs: a committed edit, an Escape cancel, and a failed write
// that already reverted the input — all three want the last-known-saved
// title back on screen.
function endTitleEditIn(map, taskId) {
  const entry = map.get(taskId);
  if (!entry) return;
  entry.editingTitle = false;
  if (entry.task) {
    entry.label.textContent = entry.task.title;
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

export function beginTitleEdit(taskId, context) {
  beginTitleEditIn(mapForContext(context), taskId);
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
// moveOutButton/addSubtaskButton/deleteButton above). app.js's delegated
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
