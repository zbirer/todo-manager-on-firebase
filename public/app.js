// Thin orchestrator: wires auth state to the store, holds the (currently
// one-entry) view dispatch table, and owns the top-level delegated event
// listeners. No task/tree logic lives here — that's taskService.js,
// store.js, taskTree.js and render.js; this file just connects them to the
// DOM.

import { logInWithGoogle, logOut, monitorAuthState } from "./auth.js";
import { addTask, fetchTasks, saveTask, softDeleteTask } from "./taskService.js";
import { buildTree, depthOf, descendantIds } from "./taskTree.js";
import {
  getTasks,
  setTasks,
  getCurrentUserId,
  setCurrentUserId,
  invalidate,
  startAutoRefresh,
  stopAutoRefresh,
  beginInteraction,
  endInteraction,
  enqueueMutation,
} from "./store.js";
import {
  renderTasks,
  beginTitleEdit,
  endTitleEdit,
  getTitleInputValue,
  setTitleInputValue,
  beginNoteEdit,
  endNoteEdit,
  getNoteInputValue,
  setNoteInputValue,
} from "./render.js";

// Mirrors firestore.rules' isValidTask() caps. Checked here, client-side,
// before ever calling saveTask, so an over-long edit fails visibly and
// locally instead of bouncing off a permission-denied from the server.
const TITLE_MAX_LENGTH = 1000;
const NOTE_MAX_LENGTH = 10000;
const TAGS_MAX_COUNT = 50;

// Extracts #tag / @context tokens from a title string, in the order they
// appear. Shared by the add-task submit handler and the title-edit commit
// handler below so both derive tags from the exact same rule — per the
// spec, editing the title is the *only* way a task's tags change, so there
// must be exactly one place that decides what counts as a tag.
function parseTags(title) {
  return title.match(/([#@]\w+)/g) || [];
}

// Tracks which edits currently hold an open interaction, keyed by
// `${taskId}:${field}`. Two independent paths can each try to close the
// same edit — a normal commit/cancel via focusout, and renderTasks's
// onEditCancelled firing because the row disappeared out from under an
// open edit (e.g. a concurrent delete lands while the title is still being
// typed) — and they are demonstrably not mutually exclusive. This set makes
// closing idempotent per edit: whichever path gets there first wins, the
// other becomes a no-op, so closing one edit can never also decrement a
// different, still-open edit's interaction out from under it.
const openEdits = new Set();

function beginEdit(taskId, field) {
  openEdits.add(`${taskId}:${field}`);
  beginInteraction();
}

function closeEdit(taskId, field) {
  if (!openEdits.delete(`${taskId}:${field}`)) return; // already closed via the other path
  endInteraction();
}

// 1. DOM elements
const statusText = document.getElementById("user-status");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const taskSection = document.getElementById("task-section");
const taskForm = document.getElementById("task-form");
const taskInput = document.getElementById("task-input");
const taskList = document.getElementById("task-list");
const inboxList = document.getElementById("inbox-list");
const showCompletedToggle = document.getElementById("show-completed-toggle");
const taskMenu = document.getElementById("task-menu");
const taskMenuMoveOutItem = taskMenu.querySelector('[data-action="move-out"]');

// 1b. Task context menu (step 8) — right-click or long-press on a row.
// `taskMenu` is one shared element (declared in index.html, outside both
// <ul>s) that app.js moves and re-labels per open, rather than one menu
// built per row; render.js never touches it, so a refresh mid-open can't
// tear it down out from under the user (see the .task-menu CSS comment).
//
// Closing is idempotent the same way step 2's edits are (see `closeEdit`
// above): `menuOpen` is the single guard, checked and cleared together, so
// two close paths landing back to back (Escape immediately followed by the
// outside-click listener's own handling of that same Escape-triggered blur,
// or a scroll firing while an outside click is still being processed) can
// never decrement the interaction guard twice for the same open. That bug —
// a double decrement releasing a DIFFERENT, still-open interaction's
// deferred refresh — has already happened once in this repo (see openEdits'
// history above); this menu only ever holds one interaction at a time, but
// the guard is built the same defensive way regardless.
let menuOpen = false;

// Set true for exactly one tick after a long-press opens the menu (and,
// harmlessly, after a right-click too). On touch devices a "ghost" click
// event fires after the pointerup that ended a long press, even though the
// user's intent was to open the menu, not to click through to whatever is
// under their finger. Left unsuppressed, that ghost click would both (a)
// start a title edit via the delegated click listener below, and (b) look
// like an "outside click" to the menu's own close listener and immediately
// close the menu that same click just opened. A `setTimeout(…, 0)` clears
// this after the current synchronous event dispatch finishes, so every
// listener that runs on that one click (bubbling through taskSection and up
// to document) sees it as true, and it's back to false for the next real
// click regardless of whether a ghost click actually materializes.
let suppressNextClick = false;
function armClickSuppression() {
  suppressNextClick = true;
  setTimeout(() => {
    suppressNextClick = false;
  }, 0);
}

function closeTaskMenu() {
  if (!menuOpen) return; // already closed via the other path
  menuOpen = false;
  taskMenu.hidden = true;
  delete taskMenu.dataset.taskId;
  endInteraction();
}

// Opens (or re-targets) the menu at viewport coordinates `x, y`, clamped so
// it never renders partly off-screen. Closes any menu already open first —
// idempotent-safe and it means there is only ever one open interaction to
// account for, never two stacked from a stray second open.
function openTaskMenuForTask(taskId, x, y) {
  const task = getTasks().find((t) => t.id === taskId);
  if (!task || task.deleted) return;

  closeTaskMenu();

  // Only an Inbox row has anything to file out of the Inbox — same rule
  // updateTaskElement (render.js) uses for the inline per-row button.
  taskMenuMoveOutItem.style.display = task.inInbox ? "" : "none";
  taskMenu.dataset.taskId = taskId;
  taskMenu.hidden = false;

  // Measured AFTER un-hiding — a `hidden` element has no box to measure.
  // `position: fixed` (index.html) means these coordinates are already
  // viewport-relative, matching event.clientX/clientY directly.
  const rect = taskMenu.getBoundingClientRect();
  const maxLeft = Math.max(0, window.innerWidth - rect.width);
  const maxTop = Math.max(0, window.innerHeight - rect.height);
  taskMenu.style.left = `${Math.min(Math.max(0, x), maxLeft)}px`;
  taskMenu.style.top = `${Math.min(Math.max(0, y), maxTop)}px`;

  menuOpen = true;
  beginInteraction(); // holds off the 5-minute refresh while the menu is open
}

// 2. View dispatch table. Only `main` exists in step 1 — this is the
// scaffold later steps (trash, settings) register into, not a router yet.
const views = {
  main: renderMainView,
};

function renderMainView() {
  const showCompleted = showCompletedToggle.checked;
  // Structure and depth always come from every non-deleted task, never from
  // the "show completed" filter — otherwise the filter becomes a second
  // input to depth, which taskTree.js is supposed to be the only source of.
  // `visibleIds` is what actually narrows each container's render; a task
  // can still be hidden while its non-completed children render (indented
  // at their true depth) via render.js's flattenTree.
  const nonDeletedTasks = getTasks().filter((task) => !task.deleted);

  // Inbox vs. main is a strict partition: a subtask always inherits its
  // parent's `inInbox` at creation time (handleAddSubtaskClick below), so no
  // task's ancestry ever crosses between the two — each side is a complete,
  // self-contained forest on its own.
  const inboxTasks = nonDeletedTasks.filter((task) => task.inInbox);
  const mainTasks = nonDeletedTasks.filter((task) => !task.inInbox);
  const visibleIdsFor = (tasks) =>
    new Set(tasks.filter((task) => showCompleted || !task.completed).map((task) => task.id));

  renderTasks(
    [
      { element: inboxList, tasks: inboxTasks, visibleIds: visibleIdsFor(inboxTasks) },
      { element: taskList, tasks: mainTasks, visibleIds: visibleIdsFor(mainTasks) },
    ],
    (id, field) => closeEdit(id, field)
  );
}

// 3. Refetch-and-render: the single refresh path every mutation and the
// 5-minute timer both funnel through (see store.js's "one refresh strategy").
async function refreshTasks() {
  const userId = getCurrentUserId();
  if (!userId) return;
  try {
    const tasks = await fetchTasks(userId);
    setTasks(tasks);
    views.main();
    // Step 8: an open menu belongs to one specific task. If that task is no
    // longer live in the freshly-fetched set — deleted from elsewhere, or by
    // this very refresh's own cascade — the menu it was opened for no longer
    // means anything, so close it rather than leave it pointing at a row
    // that has vanished (or worse, been silently reassigned if this id is
    // ever reused, which Firestore auto-ids never do, but the check is cheap
    // either way).
    if (menuOpen) {
      const menuTask = tasks.find((t) => t.id === taskMenu.dataset.taskId);
      if (!menuTask || menuTask.deleted) closeTaskMenu();
    }
  } catch (error) {
    console.error("Failed to refresh tasks:", error);
  }
}

// 4. Add a task. The actual write is queued (enqueueMutation, store.js) like
// every other mutation below, so it can never race a concurrent edit/delete
// and land out of order.
taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const rawTitle = taskInput.value.trim();
  if (!rawTitle) return;

  const tags = parseTags(rawTitle);
  if (tags.length > TAGS_MAX_COUNT) {
    alert(`A task can have at most ${TAGS_MAX_COUNT} tags.`);
    return;
  }

  enqueueMutation(async () => {
    const userId = getCurrentUserId();
    if (!userId) return;
    try {
      await addTask(
        userId,
        {
          title: rawTitle,
          tags,
          colors: { foreground: "#ffffff", background: "#10b981" }, // green styling
        },
        getTasks() // read fresh at execution time, not at submit time
      );
      taskInput.value = "";
      await refreshTasks();
    } catch (error) {
      console.error("Failed to add task:", error);
      alert("Could not add task.");
    }
  });
});

// 5. Delegated listener for the complete checkbox — one listener on the
// container instead of one per <li>, so render.js never has to rebind
// anything when it reuses an element across a refresh. `nextCompleted` is
// the user's actual intent (the checkbox's own new value) and is captured
// now; task state is re-read fresh inside the queued mutation rather than
// closed over here, so a concurrent edit/delete is never silently
// overwritten by this write's stale copy.
//
// Step 6 (cascade complete): completing a task closes every open descendant
// too, in the SAME queued mutation (one refetch settles the whole cascade,
// not one per task). Each closed descendant is stamped
// `closedByCascadeFrom` with the id of the task the user actually clicked —
// never a descendant's own immediate parent — so step 7 can reverse exactly
// this one cascade later by matching that single id, however deep the
// subtree nests. A descendant that is ALREADY completed is left completely
// untouched: it was closed by the user directly (or by some earlier,
// different cascade), not by this one, and restamping it would make step 7
// reopen something this cascade never actually closed.
//
// Un-completing (nextCompleted === false) is step 7's "un-complete memory":
// it reopens every non-deleted task whose `closedByCascadeFrom` equals the
// CLICKED task's id — a single global filter over the whole task set, not a
// subtree walk. The stamp itself is what recorded cascade membership at
// closing time, so matching it back is the only source of truth this needs;
// re-deriving via descendantIds would be a second, redundant source of truth
// that would actively disagree with the stamp once step 11 (drag-to-reparent)
// can move a task out of the subtree it was originally closed under — the
// stamp travels with the task, a tree walk from the current parent would not.
// It also resets the clicked task's OWN `closedByCascadeFrom` to null: a task
// that isn't completed can't still be "closed by" anything, so leaving a
// stale stamp there would misrepresent an open task as cascade-closed the
// next time this same filter goes looking for it.
taskSection.addEventListener("change", (event) => {
  const checkbox = event.target.closest(".task-item__checkbox");
  if (!checkbox) return;

  const taskId = checkbox.closest("li")?.dataset.taskId;
  const nextCompleted = checkbox.checked;

  enqueueMutation(async () => {
    const userId = getCurrentUserId();
    const task = getTasks().find((t) => t.id === taskId);
    if (!userId || !task) return; // abandon cleanly — task is gone or user signed out

    if (!nextCompleted) {
      try {
        // The clicked task first, so the row the user actually pressed
        // reflects their action even if the reopen below fails partway.
        await saveTask(userId, { ...task, completed: false, closedByCascadeFrom: null });

        // Snapshotted once before the loop, same reasoning as the completing
        // branch below: the mutation queue serializes against every other
        // enqueued mutation, so nothing else can change these tasks mid-loop.
        // Global filter, not a subtree walk — see the comment block above
        // this listener for why.
        const toReopen = getTasks().filter(
          (t) => !t.deleted && t.closedByCascadeFrom === taskId
        );
        for (const current of toReopen) {
          await saveTask(userId, { ...current, completed: false, closedByCascadeFrom: null });
        }
      } catch (error) {
        console.error("Failed to reopen task:", error);
        alert("Could not reopen the whole cascade. The list has been refreshed to show what actually saved.");
      } finally {
        // Always resync with Firestore's real state, same as the completing
        // branch — the checkbox's own checked state comes back from this
        // refresh, so there's nothing to manually revert here on failure.
        await refreshTasks();
      }
      return;
    }

    // Completing: re-derive the subtree fresh, from the full non-deleted
    // set, at the moment this actually runs — not from whatever was true at
    // click time (architecture rule: re-read at run time).
    const tree = buildTree(getTasks().filter((t) => !t.deleted));
    const descendantsToClose = descendantIds(tree, taskId);

    try {
      // The clicked task first, so if the cascade below fails partway, the
      // one row the user actually pressed still reflects their action.
      // closedByCascadeFrom is forced to null here regardless of any stale
      // prior value — this completion is the user's own explicit act, never
      // a cascade effect.
      await saveTask(userId, { ...task, completed: true, closedByCascadeFrom: null });

      // Snapshotted once before the loop: nothing else can change these
      // tasks mid-loop (the mutation queue serializes against every other
      // enqueued mutation), so re-reading getTasks() per iteration would
      // only ever see this same snapshot anyway.
      const currentById = new Map(getTasks().map((t) => [t.id, t]));
      for (const id of descendantsToClose) {
        const current = currentById.get(id);
        if (!current || current.completed) continue; // core rule: never restamp an already-completed descendant
        await saveTask(userId, { ...current, completed: true, closedByCascadeFrom: taskId });
      }
    } catch (error) {
      console.error("Failed to complete task:", error);
      alert("Could not complete the whole cascade. The list has been refreshed to show what actually saved.");
    } finally {
      // Always resync with Firestore's real state — whether the cascade
      // fully succeeded, partially succeeded, or failed on the very first
      // write — so the view never keeps showing "nothing happened" once
      // some writes have actually landed.
      await refreshTasks();
    }
  });
});

// 5b. Click-to-edit: clicking a title or a note opens it for inline editing.
// Delegated on the container per the per-row-listener ban — render.js owns
// the actual DOM swap (it knows which task's elements to toggle); this just
// figures out which task and which field was clicked, then opens the
// interaction guard (via beginEdit, which also tracks the edit so it can be
// closed exactly once — see openEdits above) so the 5-minute refresh can't
// clobber the edit box that is about to appear.
taskSection.addEventListener("click", async (event) => {
  // The ghost click that follows a long-press (see armClickSuppression
  // above) must not also open a title/note edit on the row the menu just
  // opened for.
  if (suppressNextClick) return;

  // A link inside a note (built by render.js's linkifier) should behave like
  // a link — opening it must not also drop the note into edit mode.
  if (event.target.closest("a")) return;

  const taskId = event.target.closest("li")?.dataset.taskId;
  if (!taskId) return;

  if (event.target.closest(".task-item__move-out-btn")) {
    await handleMoveOutOfInboxClick(taskId);
    return;
  }

  if (event.target.closest(".task-item__add-subtask-btn")) {
    await handleAddSubtaskClick(taskId);
    return;
  }

  if (event.target.closest(".task-item__delete-btn")) {
    await handleDeleteClick(taskId);
    return;
  }

  if (event.target.closest(".task-item__label")) {
    beginEdit(taskId, "title");
    beginTitleEdit(taskId);
  } else if (event.target.closest(".task-item__note-display")) {
    beginEdit(taskId, "note");
    beginNoteEdit(taskId);
  }
});

// Step 8: cascade-delete a task and its whole live subtree, replacing step
// 3's leaf-only refusal — the spec never allows orphaning children, so a
// parent with sub-tasks is no longer refused, it takes them with it
// (product-spec.md §3: "Deleting a parent deletes its entire sub-tree").
// Every descendant this cascade actually deletes is stamped
// `deletedByCascadeFrom` with the id of the task the USER clicked — never a
// descendant's own immediate parent, the same convention step 6 established
// for `closedByCascadeFrom` — so step 9 (Trash) can restore the exact
// subtree that went down together. The clicked task itself always writes
// `deletedByCascadeFrom: null`: the user's explicit act is never a cascade
// effect.
//
// An already-deleted descendant is left completely untouched (not restamped,
// not given a new `deletedAt`) — it went down in some earlier, unrelated act.
// But the cascade does not stop there: a still-live child underneath an
// already-deleted node must still be reached and deleted. That's why the
// tree below is built from EVERY task, deleted or not — a deleted node still
// has to act as a pass-through connector to its live descendants in the
// parent/child walk, or `buildTree` would treat that live child as an
// orphaned root (no parent found in the tree) and it would escape the
// cascade entirely.
//
// `buildTree`/`descendantIds` (taskTree.js) stay the single source of truth
// for parent/child links, same as every other step. The confirm-gated checks
// below run against state at click time, for fast honest feedback before
// even asking to confirm; the actual writes re-derive the subtree fresh
// inside the queued mutation, since an earlier queued mutation could have
// changed this very subtree between the click and its turn. Each deletion is
// its own document write via `softDeleteTask` — never a merged/batched
// write — because step 9 counts every deleted document as its own trash
// slot.
async function handleDeleteClick(taskId) {
  const userId = getCurrentUserId();
  const task = getTasks().find((t) => t.id === taskId);
  if (!userId || !task || task.deleted) return;

  const tree = buildTree(getTasks()); // full set — deleted nodes still connect their live children
  const liveDescendantCount = descendantIds(tree, taskId).filter(
    (id) => !tree.byId.get(id).deleted
  ).length;

  const confirmMessage =
    liveDescendantCount === 0
      ? `Delete "${task.title}"?`
      : `Delete "${task.title}" and its ${liveDescendantCount} sub-task${liveDescendantCount === 1 ? "" : "s"}?`;
  if (!confirm(confirmMessage)) return;

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    const currentTask = getTasks().find((t) => t.id === taskId);
    if (!currentUserId || !currentTask || currentTask.deleted) return; // already gone — nothing to do

    // Re-derive fresh, from the FULL task set (not just non-deleted) — see
    // the file-level reasoning above for why a deleted node must still be
    // walked through to reach its live children.
    const freshTree = buildTree(getTasks());
    const idsToDelete = [taskId, ...descendantIds(freshTree, taskId)];
    const currentById = new Map(getTasks().map((t) => [t.id, t]));

    try {
      // The clicked task first, so the row the user actually pressed
      // reflects their action even if the cascade below fails partway.
      await softDeleteTask(currentUserId, currentTask, null);

      for (const id of idsToDelete.slice(1)) {
        const current = currentById.get(id);
        // Already deleted: leave it completely untouched. Its own live
        // children are still in `idsToDelete` regardless — `freshTree` was
        // built from every task, so the walk already passed through this
        // node to find them — this `continue` only skips RE-writing the
        // already-deleted node itself, it does not stop the cascade.
        if (!current || current.deleted) continue;
        await softDeleteTask(currentUserId, current, taskId);
      }
    } catch (error) {
      console.error("Failed to delete task:", error);
      alert("Could not delete the whole cascade. The list has been refreshed to show what actually saved.");
    } finally {
      await refreshTasks();
    }
  });
}

// Step 4: add a subtask under `parentId`, up to the spec's 7-level limit.
// A plain per-row button plus a prompt() for the title — the simplest thing
// that lets the title still go through the same tag-parsing and length
// rules as every other title. Step 8's context menu also reaches this same
// function; this inline button is not superseded by it, they're two entry
// points into the same handler. Same re-check-inside-the-queue pattern as
// delete: the depth/parent checks below are for fast feedback before
// prompting; the queued mutation re-derives everything it needs from a
// fresh read so it never acts on a stale parent.
//
// Step 5 correction: the new subtask's `inInbox` is inherited from its
// parent, not hardcoded false. Step 4 reasoned "a task filed under an
// explicit parent is not a bare capture" — true when the parent is already
// organized (inInbox: false), so that case is unchanged. But when the
// parent is itself still sitting in the Inbox (broken down into subtasks
// before being filed anywhere), a hardcoded false would render the child in
// the *main* list while its structural parent stays in the *Inbox* section —
// two different containers, so the child would show up as a detached,
// unindented "root" nowhere near the task it actually belongs to. Inheriting
// keeps the whole not-yet-filed subtree together in the Inbox, matching the
// spec's "a task carries its whole sub-tree with it" rule for Move, applied
// here at creation time instead of at move time.

async function handleAddSubtaskClick(parentId) {
  const userId = getCurrentUserId();
  const parentTask = getTasks().find((t) => t.id === parentId);
  if (!userId || !parentTask) return;

  // The 7-level cap is `ancestors.size() <= 6` (firestore.rules:56): a task
  // at depth 6 already has 6 ancestors, so any child of it would need 7 and
  // get rejected server-side. taskTree.js's depthOf is the tree authority —
  // checking it here refuses the action before a doomed write ever reaches
  // Firestore, with a message the user can actually understand.
  const tree = buildTree(getTasks());
  if (depthOf(tree, parentId) >= 6) {
    alert("This task is already 7 levels deep — subtasks can't go any further.");
    return;
  }

  const rawTitle = (prompt("Subtask title:") || "").trim();
  if (!rawTitle) return;
  if (rawTitle.length > TITLE_MAX_LENGTH) {
    alert(`Title must be ${TITLE_MAX_LENGTH} characters or fewer.`);
    return;
  }
  const tags = parseTags(rawTitle);
  if (tags.length > TAGS_MAX_COUNT) {
    alert(`A task can have at most ${TAGS_MAX_COUNT} tags.`);
    return;
  }

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    const currentParent = getTasks().find((t) => t.id === parentId);
    if (!currentUserId || !currentParent || currentParent.deleted) return; // parent's gone — abandon

    const freshTree = buildTree(getTasks());
    if (depthOf(freshTree, parentId) >= 6) {
      alert("This task is now too deep for a subtask — try again from a shallower task.");
      return;
    }

    try {
      // Cheap and exact: the parent's own `ancestors` (already in memory,
      // cached root-first — see taskTree.js's ancestorChain) plus the
      // parent's own id is precisely what ancestorChain(newTaskId) would
      // compute, with no extra Firestore round trip to re-derive it.
      const ancestors = [...(currentParent.ancestors || []), currentParent.id];
      await addTask(
        currentUserId,
        {
          title: rawTitle,
          tags,
          parentId,
          ancestors,
          inInbox: currentParent.inInbox, // see the step 5 correction above
          colors: { foreground: "#ffffff", background: "#10b981" },
        },
        getTasks()
      );
      await refreshTasks();
    } catch (error) {
      console.error("Failed to add subtask:", error);
      alert("Could not add subtask.");
    }
  });
}

// Step 5: file an Inbox item (and its whole subtree) into the main list —
// the one explicit way a task ever leaves the Inbox. Nothing else does:
// completing it, editing its title/note, and the 5-minute refresh all leave
// `inInbox` untouched. "A task carries its whole sub-tree with it"
// (product-spec.md's Move bullet) applies here too — every descendant that
// inherited this task's Inbox membership (handleAddSubtaskClick above) gets
// filed in the same action, so the group that has always rendered together
// in the Inbox keeps rendering together afterward, just in the main list.
async function handleMoveOutOfInboxClick(taskId) {
  const userId = getCurrentUserId();
  const task = getTasks().find((t) => t.id === taskId);
  if (!userId || !task || !task.inInbox) return;

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    const currentTask = getTasks().find((t) => t.id === taskId);
    if (!currentUserId || !currentTask || currentTask.deleted || !currentTask.inInbox) {
      return; // already filed, gone, or user signed out — nothing to do
    }

    // Re-derive the subtree fresh, from the full non-deleted set, at the
    // moment this actually runs — not from whatever was true at click time.
    const tree = buildTree(getTasks().filter((t) => !t.deleted));
    const idsToFile = [taskId, ...descendantIds(tree, taskId)];
    const currentById = new Map(getTasks().map((t) => [t.id, t]));

    try {
      for (const id of idsToFile) {
        const current = currentById.get(id);
        if (!current || !current.inInbox) continue; // already filed or gone
        await saveTask(currentUserId, { ...current, inInbox: false });
      }
      // One refetch for the whole subtree, not one per document — this is
      // still a single logical mutation (architecture rule 1), just one
      // that happens to touch more than one task at a time.
      await refreshTasks();
    } catch (error) {
      console.error("Failed to move task out of Inbox:", error);
      alert("Could not move task out of Inbox.");
    }
  });
}

// 5c. Enter commits a title edit (titles are single-line). Escape cancels
// either edit without saving. Notes are multi-line, so Enter is left alone
// there — it types a newline — and a note edit only ever commits on blur
// (the focusout handler below).
taskSection.addEventListener("keydown", (event) => {
  const isTitleInput = event.target.classList?.contains("task-item__title-input");
  const isNoteInput = event.target.classList?.contains("task-item__note-input");
  if (!isTitleInput && !isNoteInput) return;

  if (event.key === "Enter" && isTitleInput) {
    event.preventDefault();
    event.target.blur(); // falls through to the focusout handler, which commits
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.target.dataset.cancelling = "true"; // read (and cleared) by the focusout handler
    event.target.blur();
  }
});

// 5d. Commits (or cancels) whichever edit box just lost focus. This is the
// single place that writes the task and closes the interaction guard
// (via closeEdit, exactly once per edit regardless of who else already
// closed it — see openEdits above). An invalid value never re-traps the
// row: it reverts to the last-saved value and closes, telling the user the
// edit was discarded, rather than re-alerting every time focus tries to
// leave.
taskSection.addEventListener("focusout", async (event) => {
  const target = event.target;
  const isTitleInput = target.classList?.contains("task-item__title-input");
  const isNoteInput = target.classList?.contains("task-item__note-input");
  if (!isTitleInput && !isNoteInput) return;

  const field = isTitleInput ? "title" : "note";
  const taskId = target.closest("li")?.dataset.taskId;
  const userId = getCurrentUserId();
  const task = getTasks().find((t) => t.id === taskId);

  const cancelling = target.dataset.cancelling === "true";
  delete target.dataset.cancelling;

  if (cancelling || !userId || !task) {
    if (isTitleInput) endTitleEdit(taskId);
    else endNoteEdit(taskId);
    closeEdit(taskId, field);
    return;
  }

  if (isTitleInput) {
    const newTitle = getTitleInputValue(taskId).trim();
    const tags = parseTags(newTitle);
    if (!newTitle || newTitle.length > TITLE_MAX_LENGTH) {
      alert(`Title must be between 1 and ${TITLE_MAX_LENGTH} characters. Edit discarded.`);
      setTitleInputValue(taskId, task.title); // revert — don't trap the row on an invalid value
      endTitleEdit(taskId);
      closeEdit(taskId, field);
      return;
    }
    if (tags.length > TAGS_MAX_COUNT) {
      alert(`A task can have at most ${TAGS_MAX_COUNT} tags. Edit discarded.`);
      setTitleInputValue(taskId, task.title);
      endTitleEdit(taskId);
      closeEdit(taskId, field);
      return;
    }
    await enqueueMutation(async () => {
      const currentUserId = getCurrentUserId();
      const currentTask = getTasks().find((t) => t.id === taskId);
      if (!currentUserId || !currentTask) return; // abandon cleanly — task is gone
      try {
        // Whole-document write, then refetch — re-parsing tags out of the new
        // title text is the only way tags ever change (architecture rule 2).
        await saveTask(currentUserId, { ...currentTask, title: newTitle, tags });
        await refreshTasks();
      } catch (error) {
        console.error("Failed to save title:", error);
        alert("Could not save title.");
        setTitleInputValue(taskId, currentTask.title); // revert to the last-saved value
      }
    });
    endTitleEdit(taskId);
    closeEdit(taskId, field);
  } else {
    const newNote = getNoteInputValue(taskId);
    if (newNote.length > NOTE_MAX_LENGTH) {
      alert(`Note must be ${NOTE_MAX_LENGTH} characters or fewer. Edit discarded.`);
      setNoteInputValue(taskId, task.note || "");
      endNoteEdit(taskId);
      closeEdit(taskId, field);
      return;
    }
    await enqueueMutation(async () => {
      const currentUserId = getCurrentUserId();
      const currentTask = getTasks().find((t) => t.id === taskId);
      if (!currentUserId || !currentTask) return;
      try {
        await saveTask(currentUserId, { ...currentTask, note: newNote });
        await refreshTasks();
      } catch (error) {
        console.error("Failed to save note:", error);
        alert("Could not save note.");
        setNoteInputValue(taskId, currentTask.note || "");
      }
    });
    endNoteEdit(taskId);
    closeEdit(taskId, field);
  }
});

// 5e. Context menu wiring (step 8) — opens on right-click and on long-press,
// closes on choosing an item, Escape, an outside click, scroll, or sign-out.
// Every item routes to the exact same handler function the matching inline
// per-row button already calls (handleAddSubtaskClick / handleMoveOutOfInboxClick
// / handleDeleteClick above) — there is no parallel menu-only implementation
// of any of these actions.

// Right-click: the browser's own contextmenu event already carries the
// pointer position and which element was targeted — no gesture tracking
// needed the way long-press requires below.
taskSection.addEventListener("contextmenu", (event) => {
  const li = event.target.closest("li");
  if (!li) return;
  event.preventDefault(); // suppress the native OS/browser context menu
  openTaskMenuForTask(li.dataset.taskId, event.clientX, event.clientY);
});

// Long-press: a ~500ms pointerdown-and-hold on a row. Cancelled by lifting
// early (pointerup), the gesture being taken over by something else
// (pointercancel), the pointer leaving the section entirely (pointerleave),
// or moving past a small threshold — a real long-press holds roughly still;
// past ~10px this is a drag/scroll starting, not a long-press, and step 11
// is what a "moved too far" gesture is actually for.
let longPressTimer = null;
let longPressStart = null; // { x, y, taskId }
// Set true the instant the long-press timer opens the menu; consumed by the
// very next pointerup. It is NOT enough to arm the click suppression at open
// time (armClickSuppression's own setTimeout(0) clears it on the next
// macrotask, i.e. within a few milliseconds of t=500ms) — the ghost click
// that follows a long press fires after the user actually LIFTS their
// finger, which is whenever their hold happens to end, not at t=500ms. A
// realistic hold (say 650ms) leaves the suppression window closed long
// before the ghost click ever arrives, so nothing gets suppressed. Arming it
// in the pointerup handler instead starts that window at the true
// predecessor of the ghost click in the dispatch sequence, whatever the
// actual hold duration was.
let longPressOpenedMenu = false;
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD_PX = 10;

function cancelLongPress() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  longPressStart = null;
}

taskSection.addEventListener("pointerdown", (event) => {
  // button 0 is the primary button (left mouse, or any touch/pen contact).
  // A right-click's own pointerdown reports button 2 and is already handled
  // by the contextmenu listener above — starting a long-press timer for it
  // too would just race the two gestures against the same row.
  if (event.button !== 0) return;
  const li = event.target.closest("li");
  if (!li) return;

  const taskId = li.dataset.taskId;
  longPressStart = { x: event.clientX, y: event.clientY };
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    longPressOpenedMenu = true; // consumed by pointerup below, not suppressed here
    openTaskMenuForTask(taskId, longPressStart.x, longPressStart.y);
    longPressStart = null;
  }, LONG_PRESS_MS);
});

// The ghost click that follows a long press comes right after THIS event,
// however long the hold actually was — so this is where suppression has to
// be armed, not back when the timer fired. Only consumed once: a plain short
// click's pointerup never set the flag, so it falls straight through to
// `cancelLongPress()` with nothing suppressed, exactly as before.
taskSection.addEventListener("pointerup", () => {
  if (longPressOpenedMenu) {
    longPressOpenedMenu = false;
    armClickSuppression();
  }
  cancelLongPress();
});
// A cancelled or abandoned gesture must not leave a stale flag around to
// wrongly suppress some later, unrelated click — pointerup is not guaranteed
// to be the event that follows once the pointer has left the section or the
// gesture was taken over by something else.
taskSection.addEventListener("pointercancel", () => {
  longPressOpenedMenu = false;
  cancelLongPress();
});
taskSection.addEventListener("pointerleave", () => {
  longPressOpenedMenu = false;
  cancelLongPress();
});
taskSection.addEventListener("pointermove", (event) => {
  if (!longPressStart) return;
  const dx = event.clientX - longPressStart.x;
  const dy = event.clientY - longPressStart.y;
  if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_THRESHOLD_PX) cancelLongPress();
});

// Choosing a menu item: close first (idempotent — see closeTaskMenu), then
// dispatch to the same handler the inline button uses. `taskMenu.dataset`
// is read before closeTaskMenu clears it.
taskMenu.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const taskId = taskMenu.dataset.taskId;
  const action = button.dataset.action;
  closeTaskMenu();
  if (!taskId) return;

  if (action === "add-subtask") await handleAddSubtaskClick(taskId);
  else if (action === "move-out") await handleMoveOutOfInboxClick(taskId);
  else if (action === "delete") await handleDeleteClick(taskId);
});

// Escape closes the menu from anywhere in the document, not just while an
// edit input has focus (the menu itself holds no focus — its buttons are
// clicked, not tabbed through, in the primary flows this step verifies).
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuOpen) closeTaskMenu();
});

// A click anywhere outside the menu closes it. Checked against
// suppressNextClick first so the ghost click that follows the long-press
// which just opened this same menu doesn't immediately close it again (see
// armClickSuppression above) — that click's target is the row underneath
// the menu, which is "outside" the menu element and would otherwise match
// here on the very same gesture that opened it.
document.addEventListener("click", (event) => {
  if (suppressNextClick) return;
  if (!menuOpen) return;
  if (event.target.closest("#task-menu")) return; // handled by the menu's own click listener above
  closeTaskMenu();
});

// Scroll doesn't bubble like click does, so this has to be registered in the
// capture phase to see a scroll on any scrollable ancestor, not just window.
window.addEventListener(
  "scroll",
  () => {
    if (menuOpen) closeTaskMenu();
  },
  true
);

// 6. "Show completed" is a local filter over already-fetched data, not a
// mutation, so it just re-renders rather than going through refreshTasks().
showCompletedToggle.addEventListener("change", () => {
  views.main();
});

// 7. Login/logout
loginBtn.addEventListener("click", logInWithGoogle);
logoutBtn.addEventListener("click", logOut);

// 8. Auth wiring: starts/stops the background refresh and clears state on
// sign-out so a second account never sees the first account's tasks.
monitorAuthState(async (uid) => {
  setCurrentUserId(uid);
  if (uid) {
    statusText.textContent = "Sync active!";
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    taskSection.style.display = "block";
    await refreshTasks();
    startAutoRefresh(refreshTasks);
  } else {
    stopAutoRefresh();
    invalidate();
    closeTaskMenu(); // a menu open for one account's task means nothing once signed out
    statusText.textContent = "Please sign in to access your task manager.";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    taskSection.style.display = "none";
    views.main();
  }
});
