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
// Un-completing (nextCompleted === false) does NOT reopen cascaded
// descendants — that reversal is step 7's "un-complete memory", not this
// step's job. It does reset the clicked task's OWN `closedByCascadeFrom` to
// null: a task that isn't completed can't still be "closed by" anything, so
// leaving a stale stamp there would misrepresent an open task as
// cascade-closed once step 7 goes looking for exactly that stamp.
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
        await saveTask(userId, { ...task, completed: false, closedByCascadeFrom: null });
        await refreshTasks();
      } catch (error) {
        console.error("Failed to update task:", error);
        alert("Could not update task.");
        checkbox.checked = true; // revert the toggle on failure
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

// Step 3: soft-delete a leaf task. Cascade delete (a task with children) is
// step 8 — refused here rather than silently doing nothing, since deleting
// only the parent would orphan its children, which the spec never allows.
// `buildTree` (taskTree.js) is the single source of truth for parent/child
// links, so we ask it rather than re-deriving "does anything have this
// parentId" by scanning `tasks[]` here. The confirm-gated checks below run
// against the state at click time (for fast, honest feedback before even
// asking to confirm); the actual write re-reads and re-checks both inside
// the queued mutation, since an earlier queued mutation could have changed
// this very task (or given it a child) between the click and its turn.
async function handleDeleteClick(taskId) {
  const userId = getCurrentUserId();
  const task = getTasks().find((t) => t.id === taskId);
  if (!userId || !task) return;

  // Built over non-deleted tasks only: an already-trashed child shouldn't
  // count against its former parent's leaf-ness (step 4 is what makes this
  // check meaningful for the first time — until now nothing had children).
  const tree = buildTree(getTasks().filter((t) => !t.deleted));
  const node = tree.byId.get(taskId);
  if (node && node.children.length > 0) {
    alert(
      "This task has sub-tasks. Deleting a task with sub-tasks isn't supported yet — that lands in a later step."
    );
    return;
  }

  if (!confirm(`Delete "${task.title}"?`)) return;

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    const currentTask = getTasks().find((t) => t.id === taskId);
    if (!currentUserId || !currentTask || currentTask.deleted) return; // already gone — nothing to do

    const freshTree = buildTree(getTasks().filter((t) => !t.deleted));
    const freshNode = freshTree.byId.get(taskId);
    if (freshNode && freshNode.children.length > 0) {
      alert("This task now has sub-tasks and can't be deleted this way anymore.");
      return;
    }

    try {
      // softDeleteTask (taskService.js) writes deleted:true + deletedAt via
      // the same whole-document saveTask path as every other mutation — never
      // a Firestore deleteDoc, so a later step can restore it from Trash.
      await softDeleteTask(currentUserId, currentTask);
      await refreshTasks();
    } catch (error) {
      console.error("Failed to delete task:", error);
      alert("Could not delete task.");
    }
  });
}

// Step 4: add a subtask under `parentId`, up to the spec's 7-level limit.
// There's no per-task menu until step 8, so this is a plain per-row button
// (consistent with step 3's Delete) plus a prompt() for the title — the
// simplest thing that lets the title still go through the same tag-parsing
// and length rules as every other title. Same re-check-inside-the-queue
// pattern as delete: the depth/parent checks below are for fast feedback
// before prompting; the queued mutation re-derives everything it needs from
// a fresh read so it never acts on a stale parent.
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
    statusText.textContent = "Please sign in to access your task manager.";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    taskSection.style.display = "none";
    views.main();
  }
});
