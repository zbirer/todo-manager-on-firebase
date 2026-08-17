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

import { buildTree, depthOf } from "./taskTree.js";

const entriesByTaskId = new Map();

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

// `onEditCancelled` is called once for every open edit (title and/or note)
// that gets silently dropped below, in case anything is left with a
// dangling `beginInteraction()`. render.js must not import store.js — the
// interaction guard is app.js's concern — so this is a callback rather than
// a direct call, per the module ownership boundary.
export function renderTasks(container, allTasks, visibleIds, onEditCancelled) {
  const flattened = flattenTree(allTasks, visibleIds);
  const seenIds = new Set();

  for (const { task, depth } of flattened) {
    seenIds.add(task.id);
    let entry = entriesByTaskId.get(task.id);
    if (!entry) {
      entry = createTaskElement(task.id);
      entriesByTaskId.set(task.id, entry);
    }
    updateTaskElement(entry, task, depth);
  }

  // Drop entries for tasks that left the rendered set (deleted, filtered
  // out by "show completed", a sign-out clearing the store, etc.) so the Map
  // doesn't grow forever. A dropped entry can be mid-edit — its own
  // `focusout` never fires because the element is about to be discarded
  // rather than blurred — so the interaction it opened would otherwise never
  // close and the 5-minute refresh would stay blocked forever. `entry` is
  // about to be garbage anyway, so there's nothing to reset here beyond
  // telling the caller an interaction needs closing.
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

  reconcileChildren(container, flattened.map(({ task }) => entriesByTaskId.get(task.id).li));
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

  // Step 4: add a subtask under this task. Same stand-in-for-the-menu
  // reasoning as the delete button (step 3) — step 8 replaces both with a
  // real long-press/right-click menu.
  const addSubtaskButton = document.createElement("button");
  addSubtaskButton.type = "button";
  addSubtaskButton.className = "task-item__add-subtask-btn";
  addSubtaskButton.textContent = "+ Subtask";
  addSubtaskButton.setAttribute("aria-label", "Add subtask");
  li.appendChild(addSubtaskButton);

  // Step 3: delete a (leaf) task. A dedicated per-row menu is step 8 — this
  // is a plain button standing in for it until then.
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "task-item__delete-btn";
  deleteButton.textContent = "Delete";
  deleteButton.setAttribute("aria-label", "Delete task");
  li.appendChild(deleteButton);

  return {
    li,
    checkbox,
    label,
    titleInput,
    noteDisplay,
    noteInput,
    addSubtaskButton,
    deleteButton,
    editingTitle: false,
    editingNote: false,
  };
}

function updateTaskElement(entry, task, depth) {
  const { li, checkbox, label, titleInput, noteDisplay, noteInput } = entry;

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

// --- Title edit mode -------------------------------------------------------
// app.js decides *when* to call these (a delegated click to begin, a
// delegated focusout to end); this module only knows *how* to swap the DOM.

export function beginTitleEdit(taskId) {
  const entry = entriesByTaskId.get(taskId);
  if (!entry) return;
  entry.editingTitle = true;
  entry.label.style.display = "none";
  entry.titleInput.style.display = "";
  entry.titleInput.focus();
  entry.titleInput.select();
}

export function endTitleEdit(taskId) {
  const entry = entriesByTaskId.get(taskId);
  if (!entry) return;
  entry.editingTitle = false;
  entry.titleInput.style.display = "none";
  entry.label.style.display = "";
}

export function getTitleInputValue(taskId) {
  return entriesByTaskId.get(taskId)?.titleInput.value ?? "";
}

// Used to revert the input back to the last-saved title after a failed
// write, so a dismissed error doesn't leave stale unsaved text sitting in
// a box that already silently closed.
export function setTitleInputValue(taskId, value) {
  const entry = entriesByTaskId.get(taskId);
  if (entry) entry.titleInput.value = value;
}

// --- Note edit mode ---------------------------------------------------------

export function beginNoteEdit(taskId) {
  const entry = entriesByTaskId.get(taskId);
  if (!entry) return;
  entry.editingNote = true;
  entry.noteDisplay.style.display = "none";
  entry.noteInput.style.display = "";
  entry.noteInput.focus();
}

export function endNoteEdit(taskId) {
  const entry = entriesByTaskId.get(taskId);
  if (!entry) return;
  entry.editingNote = false;
  entry.noteInput.style.display = "none";
  entry.noteDisplay.style.display = "";
}

export function getNoteInputValue(taskId) {
  return entriesByTaskId.get(taskId)?.noteInput.value ?? "";
}

export function setNoteInputValue(taskId, value) {
  const entry = entriesByTaskId.get(taskId);
  if (entry) entry.noteInput.value = value;
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
