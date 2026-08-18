// Thin orchestrator: wires auth state to the store, holds the (currently
// one-entry) view dispatch table, and owns the top-level delegated event
// listeners. No task/tree logic lives here — that's taskService.js,
// store.js, taskTree.js and render.js; this file just connects them to the
// DOM.

import { logInWithGoogle, logOut, monitorAuthState } from "./auth.js";
import { addTask, fetchTasks, saveTask, softDeleteTask, purgeTask } from "./taskService.js";
import { fetchSettings, saveSettings } from "./settingsService.js";
import {
  // Step 14: `parseTags` MOVED here from app.js — the tag-color resolver needs
  // the exact same rule, and step 2's decision is that exactly one place
  // decides what counts as a tag. Same function, same regex, new home.
  parseTags,
  collectTagNames,
  readTagColors,
  DEFAULT_TAG_FG,
  DEFAULT_TAG_BG,
  // Step 16 (Priority ordering): the drag machinery needs to know a task's
  // rank to decide whether a hovered gap is "free" (R5) — computeQuadrantRankMap
  // is the one shared builder render.js's own comparator also reads from (see
  // its comment in tagColors.js); resolveTaskQuadrant/describeQuadrant are only
  // used here to word the overruled-drop message.
  computeQuadrantRankMap,
  resolveTaskQuadrant,
  describeQuadrant,
  // Step 17 (Tag rename/delete): planTagRewrite/isValidTagToken/
  // moveTagSettingsEntry are the pure title/map arithmetic (S17-4/S17-5/
  // S17-6/S17-7) — this file only owns the confirm dialog, the
  // enqueueMutation/saveTask loop, and the in-memory undo snapshot.
  planTagRewrite,
  isValidTagToken,
  moveTagSettingsEntry,
} from "./tagColors.js";
// Step 18 (Recurrence): the pure advance/derive/parse arithmetic (S18-2/
// S18-4) — this file only owns the prompt-based editor UI, the confirm/alert
// wording, and the enqueueMutation-wrapped write; render.js imports
// describeRecurrence too (the row badge), so wording can never drift between
// the two places a rule is described.
import {
  RECURRENCE_KINDS,
  advanceRecurrence,
  deriveAnchorFromDate,
  describeRecurrence,
  parseWeekdaysInput,
} from "./recurrence.js";
// Step 15 (Quadrant mapping): app.js's own write handler below
// (handleTagQuadrantChange) never needs to VALIDATE the incoming value — it
// writes whatever the <select> held (or null for the blank option) straight
// through, same as handleTagColorChange does for fg/bg. Reading a quadrant
// back out for resolution/display is render.js's concern (resolveTaskQuadrant,
// tagColors.js), not app.js's.
import {
  buildTree,
  depthOf,
  descendantIds,
  ancestorChain,
  // Step 11's pure reparent math, moved here from app.js (issue 6): no
  // DOM/Firestore, so it belongs alongside buildTree/descendantIds/depthOf.
  computeSubtreeHeight,
  canReparent,
  rewriteDescendantAncestors,
} from "./taskTree.js";
// Step 19 (Search — basic): the pure leaf-match/ancestor-expansion pair
// (S19-1/S19-4) — this file only owns the search box's DOM element, the
// per-keystroke re-render, and the Escape-to-clear/sign-out-clear lifecycle
// (S19-7/S19-8). See searchQuery.js's own header for why step 20 needs this
// kept out of app.js/render.js entirely.
import { matchingTaskIds, expandMatchesWithAncestors } from "./searchQuery.js";
// Step 21 (Export / import): the pure file-shape/serialize/deserialize/
// validate functions (S21-2/S21-3/S21-7) — this file only owns the download
// click, the hidden file input, the confirm dialogs, and the
// enqueueMutation-wrapped saveTask/saveSettings write loop (S21-8). See
// dataTransfer.js's own header for why none of that lives there instead.
import {
  buildExportPayload,
  stringifyExportPayload,
  buildExportFilename,
  parseImportPayload,
  validateImportPayload,
  deserializeTaskFromImport,
} from "./dataTransfer.js";
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
  // Step 14 (D9): store.js owns the tag settings cache, refreshed alongside
  // tasks by refreshTasks below and cleared by invalidate() on sign-out.
  getTagSettings,
  setTagSettings,
} from "./store.js";
import {
  renderTasks,
  renderTrash,
  renderOverdue,
  renderSettings,
  sortTasks,
  // Step 13 (D5): the one shared ordering mechanism Focus and Overdue both
  // sort by — see render.js's own comment on why this is exported rather
  // than left inline inside renderTasks.
  computeMainListOrderIndex,
  // Issue 2 fix: each of these takes a row-context ("main", "focus", or
  // (step 13) "overdue" — see render.js's CONTEXT_MAPS) as its second
  // argument, addressing specifically the row the user actually interacted
  // with. A pinned task renders in Focus AND its normal place at once (step
  // 12, D1/D4), and an overdue task renders on the separate Overdue screen
  // too (step 13) — up to three independent <li>s, three independent edit
  // states, so a bare taskId alone can no longer identify "the entry" on its
  // own.
  beginTitleEdit,
  endTitleEdit,
  getTitleInputValue,
  setTitleInputValue,
  beginNoteEdit,
  endNoteEdit,
  getNoteInputValue,
  setNoteInputValue,
  beginDueDateEdit,
  endDueDateEdit,
  getDueDateInputValue,
  setDueDateInputValue,
  // Step 13 (D2): the one place both halves of the local-midnight
  // date<->input conversion live — see render.js's own comments on each for
  // why the naive string-based approaches are wrong.
  parseDateInputToLocalMidnight,
  formatDateForInput,
  // Step 13 (D3): the one predicate for "is this task overdue" — shared by
  // the Overdue screen's own filter below and render.js's per-row display
  // styling, never a second copy.
  isOverdueTask,
  // Step 18 (Recurrence): `timestampToDate` unwraps a task's `dueDate`
  // (Firestore Timestamp | Date | null) into a plain Date before it's handed
  // to recurrence.js's advance/derive functions, which only ever work with
  // plain Dates (see recurrence.js's file header on why it has no imports of
  // its own). `localMidnight` is the same local-midnight construction the
  // due-date/overdue/age helpers already share, reused here for "today" and
  // for the moment a recurring completion resets `occurrenceStart` to.
  timestampToDate,
  localMidnight,
} from "./render.js";

// Mirrors firestore.rules' isValidTask() caps. Checked here, client-side,
// before ever calling saveTask, so an over-long edit fails visibly and
// locally instead of bouncing off a permission-denied from the server.
const TITLE_MAX_LENGTH = 1000;
const NOTE_MAX_LENGTH = 10000;
const TAGS_MAX_COUNT = 50;

// Step 9 (Trash): product-spec.md §3 — "the trash holds the 50 most recently
// deleted tasks; beyond that, the oldest fall out and are gone for good...
// Tasks are counted individually, not per deletion." A count, not a time
// limit, so a rarely-used trash keeps its contents indefinitely.
const TRASH_CAP = 50;

// Step 10 (manual reorder): repeated `(prev.order + next.order) / 2`
// midpoints halve the gap between two neighbours every time something is
// dropped between them, and float precision runs out eventually. Below this
// gap, the midpoint would round to a value equal to (or indistinguishable
// from) one of its neighbours, which would make sibling order silently
// non-deterministic from then on — two tasks tied on `order` sort however
// the JS engine's sort happens to leave equal elements, not however the user
// last dragged them. See computeReorderOrder below for what happens instead.
const ORDER_RENUMBER_EPSILON = 1e-6;

// Tracks which edits currently hold an open interaction, keyed by
// `${taskId}:${field}`, where `field` is `"title"`/`"note"` for an edit on a
// task's normal-place row or `"title:focus"`/`"note:focus"` for an edit on
// its Focus row (step 12, D1/D4: a pinned task has two independent <li>s and
// two independent edit states, so they need two independent keys here too —
// without the `:focus` suffix, opening an edit on one row and closing it via
// the OTHER row's path would double-decrement this same task+field's
// interaction, exactly the class of bug the rest of this comment describes).
// Two independent paths can each try to close the
// same edit — a normal commit/cancel via focusout, and renderTasks's
// onEditCancelled firing because the row disappeared out from under an
// open edit (e.g. a concurrent delete lands while the title is still being
// typed) — and they are demonstrably not mutually exclusive. This set makes
// closing idempotent per edit: whichever path gets there first wins, the
// other becomes a no-op, so closing one edit can never also decrement a
// different, still-open edit's interaction out from under it.
const openEdits = new Set();

// Step 13 extends step 12's D1/D4 disambiguation from two row-contexts to
// three: a task can now render on its normal-place row, its Focus row, AND
// (on the separate Overdue screen) its Overdue row, each an independent
// <li> with independent edit state (render.js's CONTEXT_MAPS). Every place
// that used to branch on a boolean `isFocusRow` now calls this instead, so
// there is exactly one row-context lookup, not one per call site drifting
// independently as a third context got bolted on.
function contextForRow(li) {
  if (li?.closest("#focus-list")) return "focus";
  if (li?.closest("#overdue-list")) return "overdue";
  return "main";
}
// The openEdits/onEditCancelled field suffix a given context uses — "" for
// the normal-place row (unchanged since step 2, so existing keys/behavior
// for plain tasks stay byte-identical), ":focus"/":overdue" otherwise.
function fieldSuffixForContext(context) {
  return context === "main" ? "" : `:${context}`;
}

// Step 13 review round (issues 1+2): idempotent per key — re-opening an
// edit that's already open is a no-op, before either side effect. Title and
// note only ever have one entry point onto their edit state each (clicking
// the display), and that display element is hidden mid-edit, so it can't be
// clicked again — they were accidentally immune to double-counting a
// re-open. Due date is the first field with a SECOND independent entry
// point onto the same edit state (the context menu's "Change due date",
// handleEditDueDateMenuClick below), and its due-display is NOT hidden
// mid-edit, so right-clicking a row while its due-date editor is already
// open and choosing "Change due date" used to call this a second time:
// `openEdits.add` was already a no-op for a repeated key, but
// `beginInteraction()` fired unconditionally, incrementing depth with no
// matching decrement (closeEdit's own guard only ever fires once per key,
// so the extra increment is never paid back) — a permanent, invisible leak
// of the interaction guard that silently disables the 5-minute auto-refresh
// for the rest of the session. Guarding here, rather than at every call
// site (e.g. only in handleEditDueDateMenuClick), makes ALL fields immune to
// a future second entry point, instead of relying on every new
// menu-triggered "open the same editor" action to remember to guard itself.
function beginEdit(taskId, field) {
  const key = `${taskId}:${field}`;
  if (openEdits.has(key)) return; // already open — no-op, no double-count
  openEdits.add(key);
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
// Step 19 (Search — basic): the search box and the "no results" message that
// replaces the lists in place (S19-9) — see renderMainView below for the
// filter itself and the keydown/input listeners further down for the
// per-keystroke re-render (S19-7) and Escape-to-clear (S19-8).
const searchInput = document.getElementById("search-input");
const searchEmptyMessage = document.getElementById("search-empty-message");
// Step 20 (S20-9): a parse error (e.g. mid-keystroke on `#a AND `) never
// blanks the list — it shows the full unfiltered list plus this message,
// which renderMainView below toggles alongside computing the effective
// (unfiltered) visible set.
const searchErrorMessage = document.getElementById("search-error-message");
const taskMenu = document.getElementById("task-menu");
const taskMenuMoveOutItem = taskMenu.querySelector('[data-action="move-out"]');
// Step 11 (D9): shown only for a task that currently has a parent — see
// openTaskMenuForTask below.
const taskMenuMoveToTopItem = taskMenu.querySelector('[data-action="move-to-top"]');
// Step 12 (D7): hidden for a completed task, label toggles per current
// `pinned` state — see openTaskMenuForTask below.
const taskMenuTogglePinItem = taskMenu.querySelector('[data-action="toggle-pin"]');
// Step 13 (D10): "Set due date"/"Change due date" always opens the inline
// editor (label toggles per whether a due date is already set); "Clear due
// date" is shown only when there's actually something to clear — see
// openTaskMenuForTask below.
const taskMenuEditDueDateItem = taskMenu.querySelector('[data-action="edit-due-date"]');
const taskMenuClearDueDateItem = taskMenu.querySelector('[data-action="clear-due-date"]');
// Step 18 (D10 precedent): "Set recurrence"/"Change recurrence" always opens
// the same prompt-based editor (label toggles per whether a rule is already
// set) — see openTaskMenuForTask below. There is no separate "Clear"/"Stop"
// item (S18-0): the editor itself offers "none" as one of its answers.
const taskMenuSetRecurrenceItem = taskMenu.querySelector('[data-action="set-recurrence"]');

// Step 12 (D1/D8): the Focus section/list — a third container rendered
// alongside Inbox/main from the same renderTasks call (render.js), hidden
// entirely by renderMainView below whenever nothing is pinned.
const focusSection = document.getElementById("focus-section");
const focusList = document.getElementById("focus-list");

// Step 9: the two view panels and the buttons that switch between them.
// Step 13 (D4) adds a third — Overdue — following this exact precedent
// rather than step 12's in-main-view Focus section.
const mainView = document.getElementById("main-view");
const trashView = document.getElementById("trash-view");
const trashBtn = document.getElementById("trash-btn");
const trashBackBtn = document.getElementById("trash-back-btn");
const trashCountText = document.getElementById("trash-count");
const trashList = document.getElementById("trash-list");
const overdueView = document.getElementById("overdue-view");
const overdueBtn = document.getElementById("overdue-btn");
const overdueBackBtn = document.getElementById("overdue-back-btn");
const overdueCountText = document.getElementById("overdue-count");
const overdueList = document.getElementById("overdue-list");
// Step 14 (D4): the Tag Settings screen — a FOURTH view panel, following the
// exact same Trash/Overdue precedent rather than inventing a modal or a fourth
// navigation pattern. Step 15 (quadrant mapping) adds its column to this same
// screen (product-spec.md §7: "it is the same screen that sets each tag's
// colors").
const settingsView = document.getElementById("settings-view");
const settingsBtn = document.getElementById("settings-btn");
const settingsBackBtn = document.getElementById("settings-back-btn");
const settingsCountText = document.getElementById("settings-count");
const settingsList = document.getElementById("settings-list");
// Step 20 (S20-8): the week-start control lives directly on the Tag
// Settings screen (there is no other settings surface in this app) — see
// renderSettingsView below for how its value is initialized from the
// stored setting, and updateWeekStart for the write path.
const weekStartSelect = document.getElementById("week-start-select");
// Step 17 (S17-1): the one Undo affordance for the last tag rename/delete —
// see tagUndoSnapshot's own comment below for exactly what it holds.
const settingsUndoBtn = document.getElementById("settings-undo-btn");
// Step 21 (S21-9): the two Data Portability actions, static single controls
// on this same screen (there is no other settings surface in this app) — see
// weekStartSelect's own precedent just above for why these get their own
// listeners rather than routing through the delegated per-tag-row listeners
// further down. `importFileInput` is hidden and triggered by `importBtn`'s
// click rather than shown directly, so the button reads like every other
// button here instead of a bare unstyled native file picker.
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFileInput = document.getElementById("import-file-input");
const IMPORT_BTN_LABEL = "Import from JSON file";

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
  delete taskMenu.dataset.context;
  endInteraction();
}

// Opens (or re-targets) the menu at viewport coordinates `x, y`, clamped so
// it never renders partly off-screen. Closes any menu already open first —
// idempotent-safe and it means there is only ever one open interaction to
// account for, never two stacked from a stray second open.
//
// `context` (step 13) is which of render.js's CONTEXT_MAPS the row the menu
// was opened FOR belongs to ("main", "focus", or "overdue") — stashed on the
// menu's own dataset (mirroring `taskId`) so "Set due date" can later open
// the inline editor on the correct one of a task's up-to-three independent
// rows, the same disambiguation the click-to-edit listener already needs.
function openTaskMenuForTask(taskId, x, y, context = "main") {
  const task = getTasks().find((t) => t.id === taskId);
  if (!task || task.deleted) return;

  closeTaskMenu();

  // Only an Inbox row has anything to file out of the Inbox — same rule
  // updateTaskElement (render.js) uses for the inline per-row button.
  taskMenuMoveOutItem.style.display = task.inInbox ? "" : "none";
  // Step 11 (D9): only a task that already has a parent has anywhere to
  // "promote" from — a root task choosing this would be a no-op.
  taskMenuMoveToTopItem.style.display = task.parentId != null ? "" : "none";
  // Step 12 (D7): only a task that is neither completed nor deleted may be
  // pinned — a finished task isn't "what I'm working on now". `task.deleted`
  // is already refused above (the `if (!task || task.deleted) return;`
  // guard), so only `completed` needs checking here. Label reflects the
  // task's CURRENT pinned state at open time.
  taskMenuTogglePinItem.style.display = task.completed ? "none" : "";
  taskMenuTogglePinItem.textContent = task.pinned ? "Unpin from Focus" : "Pin to Focus";
  // Step 13 (D10): due-date items. Editing (opening the inline row editor) is
  // always offered, labeled per whether a due date already exists; clearing
  // is offered only when there's actually a value to clear.
  taskMenuEditDueDateItem.textContent = task.dueDate ? "Change due date" : "Set due date";
  taskMenuClearDueDateItem.style.display = task.dueDate ? "" : "none";
  // Step 18 (D10 precedent): label toggles per whether a rule is already
  // set; always offered (never hidden) — a task with no due date can still
  // open the editor, which will default its due date to today (S18-5).
  taskMenuSetRecurrenceItem.textContent = task.recurrence ? "Change recurrence" : "Set recurrence";
  taskMenu.dataset.taskId = taskId;
  taskMenu.dataset.context = context;
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

// 2. View dispatch table. Step 1 left only `main` here as a scaffold; step 9
// is the first thing to register a second entry. `currentView` plus this
// object is deliberately not a router — no hash change, no history entry,
// no bookmarkable per-screen URL — because the plan for this step is exactly
// "a currentView string plus that dispatch object", and a two-screen app has
// no back/forward stack worth building.
let currentView = "main";

const views = {
  main: renderMainView,
  trash: renderTrashView,
  // Step 13 (D1/D4): the Overdue screen — a THIRD panel, following this
  // exact Trash precedent (a currentView entry + the dispatch table) rather
  // than step 12's in-main-view Focus section.
  overdue: renderOverdueView,
  // Step 14 (D4): the Tag Settings screen — same precedent again, third time.
  settings: renderSettingsView,
};

// Switches which of the four panels is visible and renders it fresh. Used
// by the Trash/Overdue/Settings/Back buttons below and by sign-out (which must
// not leave a non-main panel showing under a "please sign in" message for the
// next user).
function switchView(view) {
  currentView = view;
  mainView.hidden = view !== "main";
  trashView.hidden = view !== "trash";
  overdueView.hidden = view !== "overdue";
  settingsView.hidden = view !== "settings";
  views[view]();
}

trashBtn.addEventListener("click", () => switchView("trash"));
trashBackBtn.addEventListener("click", () => switchView("main"));
overdueBtn.addEventListener("click", () => switchView("overdue"));
overdueBackBtn.addEventListener("click", () => switchView("main"));
settingsBtn.addEventListener("click", () => switchView("settings"));
settingsBackBtn.addEventListener("click", () => switchView("main"));
// Step 17: a single static button (not per-row, so it lives outside the
// delegated #task-section listeners below) — see handleTagUndoClick.
settingsUndoBtn.addEventListener("click", () => {
  handleTagUndoClick();
});
// Step 20 (S20-8): the week-start control — a single static <select>, not a
// per-row control, so (like settingsUndoBtn above) it lives outside the
// delegated per-tag-row listeners the rest of this screen uses.
weekStartSelect.addEventListener("change", () => {
  updateWeekStart(weekStartSelect.value);
});
// Step 21 (S21-9): Export/Import, the same "static single control, own
// listener" precedent as weekStartSelect just above.
exportBtn.addEventListener("click", () => {
  handleExportClick();
});
importBtn.addEventListener("click", () => {
  handleImportClick();
});
importFileInput.addEventListener("change", () => {
  handleImportFileSelected();
});

function renderMainView() {
  const showCompleted = showCompletedToggle.checked;
  // Structure and depth always come from every non-deleted task, never from
  // the "show completed" filter — otherwise the filter becomes a second
  // input to depth, which taskTree.js is supposed to be the only source of.
  // `visibleIds` is what actually narrows each container's render; a task
  // can still be hidden while its non-completed children render (indented
  // at their true depth) via render.js's flattenTree.
  const nonDeletedTasks = getTasks().filter((task) => !task.deleted);

  // Step 19 (S19-0/S19-5): the search filter stage, inserted AHEAD of every
  // filter this function already had — the ordering is load-bearing (S19-5)
  // and must not be reshuffled. Built from `nonDeletedTasks` (both Inbox and
  // main together, matching S19-6's "not Trash, not Overdue" scope) so a
  // matched task's ancestor chain agrees with the exact tree the containers
  // below render from; Inbox/main's strict partition means an ancestor chain
  // never crosses between them anyway.
  //
  // A blank search box makes `matchingTaskIds` return every task's id
  // (searchQuery.js: an empty/whitespace-only query has no AST, and
  // evaluating "no AST" is vacuously true for every task), so
  // `searchVisibleIds` degrades to "every task" and `searchContextIds`
  // degrades to empty below — every filter this stage adds is a genuine
  // no-op with the box empty, with no separate "is search active" branch
  // needed anywhere in this function.
  //
  // Step 20 (S20-8/S20-5): `weekStart` and `now` are read fresh on every
  // render (no debounce, S19-7 unchanged) rather than cached, so a setting
  // change or the calendar day rolling over takes effect on the very next
  // keystroke or refresh with no separate invalidation path. `weekStart`
  // defaults to `'sunday'` when the settings document has never been
  // written (S20-8's own documented default), matching what a brand new
  // user — or every pre-step-20 user — sees with no backfill.
  const searchQuery = searchInput.value;
  const searchContext = { now: new Date(), weekStart: getTagSettings()?.weekStart ?? "sunday" };
  const { matches: parsedMatchIds, error: searchError } = matchingTaskIds(searchQuery, nonDeletedTasks, searchContext);
  // S20-9: a parse error must not blank the list — every task counts as a
  // "match" for visibility purposes (the filter is inert, not destructive)
  // while the error text renders beside the box. `searchContextIds` stays
  // empty in this state: with nothing actually filtered out, there is no
  // ancestor-of-a-hidden-match case to dim.
  searchErrorMessage.textContent = searchError ?? "";
  searchErrorMessage.hidden = !searchError;
  const searchMatchIds = searchError ? new Set(nonDeletedTasks.map((task) => task.id)) : parsedMatchIds;
  const searchVisibleIds = expandMatchesWithAncestors(nonDeletedTasks, searchMatchIds);
  // S19-4: a task in `searchVisibleIds` that ISN'T itself a match is showing
  // only as ancestor context for a matching descendant — render.js dims it
  // via `.task-item--search-context`.
  const searchContextIds = searchError
    ? new Set()
    : new Set([...searchVisibleIds].filter((id) => !searchMatchIds.has(id)));

  // Inbox vs. main is a strict partition: a subtask always inherits its
  // parent's `inInbox` at creation time (handleAddSubtaskClick below), so no
  // task's ancestry ever crosses between the two — each side is a complete,
  // self-contained forest on its own.
  const inboxTasks = nonDeletedTasks.filter((task) => task.inInbox);
  const mainTasks = nonDeletedTasks.filter((task) => !task.inInbox);
  const visibleIdsFor = (tasks) =>
    new Set(
      tasks
        .filter((task) => showCompleted || !task.completed)
        // Step 19 (S19-5): applied to the SAME candidate set the completed
        // filter above just narrowed, exactly as the decision requires — a
        // completed match hidden by "show completed" being off can never
        // drag an otherwise-empty ancestor into view on its own, because the
        // ancestor's own visibility here depends only on its OWN completed
        // state, not on the hidden match that earned it a place in
        // `searchVisibleIds`.
        .filter((task) => searchVisibleIds.has(task.id))
        .map((task) => task.id)
    );

  // Step 12 (D2/D5/D8), ordering per issue 1's fix (SUPERSEDES step 12's D3
  // — see that superseding Decisions entry in PROGRESS.md, not the original
  // D3 one): Focus is a flat, hand-picked set of pinned tasks — never a
  // subtree, never a second `renderTasks` call (render.js's own
  // containers-doc comment explains why). `renderTasks` itself decides
  // Focus's actual order: each pinned task's index in the depth-first RENDER
  // POSITION `flattenTree` produces for the Inbox/main containers, not a
  // sibling-comparator sort here — `order` is only comparable within one
  // sibling group, so a raw `sortTasks` over a cross-parent pinned set could
  // (and did) disagree with the main list's real order. This still inherits
  // step 16's future comparator for free, just via a different path than
  // originally planned: `flattenTree` runs through `compareSiblings`, so
  // whatever step 16 makes of that comparator, Focus's render-position index
  // picks it up automatically, with no second ordering rule to keep in sync.
  // `!task.completed` here is defensive, not the actual mechanism that hides
  // a finished task — D5 unconditionally clears `pinned` the instant a task
  // completes (directly OR via a step-6 cascade), so a completed+pinned task
  // should never exist in the store to begin with; this filter just means a
  // stale/hand-edited doc can't leak a finished task into Focus even if that
  // invariant is ever violated some other way. `showCompleted` deliberately
  // does NOT gate this filter the way it gates the main list/Inbox — a
  // task's pinned flag being false is what removes it from Focus,
  // unconditionally, not a toggle.
  // Step 19 (S19-6): Focus is in scope for search too — a pinned task that
  // the search stage has hidden (not itself a match, and not an ancestor of
  // one) drops out of Focus exactly as it would drop out of the main list.
  const focusTasks = nonDeletedTasks.filter(
    (task) => task.pinned && !task.completed && searchVisibleIds.has(task.id)
  );
  focusSection.hidden = focusTasks.length === 0; // D8: no empty heading when nothing is pinned

  const visibleInboxIds = visibleIdsFor(inboxTasks);
  const visibleMainIds = visibleIdsFor(mainTasks);

  renderTasks(
    [
      { element: inboxList, tasks: inboxTasks, visibleIds: visibleInboxIds },
      { element: taskList, tasks: mainTasks, visibleIds: visibleMainIds },
    ],
    { element: focusList, tasks: focusTasks },
    (id, field) => closeEdit(id, field),
    // Step 14: the tag settings cache, passed in rather than imported by
    // render.js (module boundary — see render.js's own comment). Every row's
    // colors are resolved from this plus the row's own title on every render.
    getTagSettings(),
    // Step 19: which of the rows just rendered are dimmed ancestor context
    // rather than real matches (S19-4).
    searchContextIds
  );

  // S19-9: "No tasks match" replaces the (now genuinely empty) lists only
  // when the box actually holds a query — a blank box producing zero visible
  // tasks means "you have no tasks," a different and correctly silent state,
  // which is why this checks the trimmed query rather than reusing
  // `searchContextIds`/`searchVisibleIds` (both degrade to "everything," per
  // this function's own opening comment, and would never on their own tell
  // "search found nothing" apart from "search is off").
  const isSearchActive = searchQuery.trim().length > 0;
  const hasAnyVisibleTask = visibleInboxIds.size > 0 || visibleMainIds.size > 0 || focusTasks.length > 0;
  searchEmptyMessage.hidden = !(isSearchActive && !hasAnyVisibleTask);
}

// Converts a task's `deletedAt` into a millisecond number safe to compare
// with `<`/`>`, or `null` when there isn't one to compare — either because
// the field was never set (a doc soft-deleted before step 3 added it) or
// because it's still a locally-unresolved `serverTimestamp()` sentinel that
// hasn't round-tripped through a read yet. `null` is always treated as
// "oldest", both for display (sorts last, per this step's plan) and for
// eviction (purged first, being indistinguishable from "deleted longest
// ago" once there is no timestamp to say otherwise).
function deletedAtMillis(task) {
  return typeof task.deletedAt?.toMillis === "function" ? task.deletedAt.toMillis() : null;
}

// Sorts deleted tasks newest-deletion-first for the Trash screen. Ties
// (including two `null`s) break on `id` so the order is stable across
// refreshes — without a tie-break, two documents sharing an exact
// `deletedAt` (or both missing it) would be free to swap places on every
// re-render, which would look like the list randomly shuffling itself.
//
// Verification-only export (same precedent as store.js's getInteractionDepth
// and the openEdits/menuOpen idempotent-close pattern it documents) — this
// project has no test runner, so a caller driving this module directly needs
// a way to exercise the Trash's sort/eviction math without a live Firestore
// connection, which browser-only unsigned-in verification can never provide.
export function compareTrashNewestFirst(a, b) {
  const aMillis = deletedAtMillis(a);
  const bMillis = deletedAtMillis(b);
  if (aMillis == null && bMillis == null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (aMillis == null) return 1; // null sorts last
  if (bMillis == null) return -1;
  if (aMillis !== bMillis) return bMillis - aMillis; // descending
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Step 9: the Trash is a FLAT list — every deleted document is its own row,
// never grouped back into the tree it was cascade-deleted from — because
// that is exactly what the 50-item cap counts (see render.js's renderTrash
// comment). Sorted newest-deletion-first, per this step's plan.
function renderTrashView() {
  const trashedTasks = getTasks().filter((task) => task.deleted).sort(compareTrashNewestFirst);
  trashCountText.textContent = `Trash — ${trashedTasks.length} of ${TRASH_CAP}`;
  renderTrash(trashList, trashedTasks);
}

// Step 13 (D1/D4): the Overdue screen — a flat list of every non-deleted,
// non-completed task whose due date's local calendar day is strictly before
// today's (isOverdueTask, render.js), ordered by D5: the exact same
// depth-first main-list render-position index Focus sorts by
// (computeMainListOrderIndex), never a second ordering rule and never raw
// `order` (which is only meaningful within one sibling group — see the
// step-12 issue-1 Decisions entry this reuses verbatim). Rows are full task
// rows (render.js's renderOverdue, reusing createTaskElement/
// updateTaskElement), flat, at depth 0 — exactly Focus's row shape.
function renderOverdueView() {
  const nonDeletedTasks = getTasks().filter((task) => !task.deleted);
  // Step 16 (R4): one Map<taskId, rank> for this render pass (per
  // computeQuadrantRankMap's own comment — never rebuilt per comparison),
  // threaded into the exact same computeMainListOrderIndex/flattenTree path
  // renderMainView's renderTasks call already uses — Overdue gets
  // quadrant-first ordering with no ordering rule of its own.
  const rankMap = computeQuadrantRankMap(nonDeletedTasks, getTagSettings());
  const orderIndex = computeMainListOrderIndex(nonDeletedTasks, rankMap);
  const overdueTasks = nonDeletedTasks
    .filter((task) => isOverdueTask(task))
    .sort((a, b) => (orderIndex.get(a.id) ?? Infinity) - (orderIndex.get(b.id) ?? Infinity));
  overdueCountText.textContent = `Overdue — ${overdueTasks.length}`;
  renderOverdue(overdueList, overdueTasks, (id, field) => closeEdit(id, field), getTagSettings());
}

// Step 14 (D4/D5): the Tag Settings screen. The listed tags are the union of
// every tag on a non-deleted task and every tag already present in the
// settings map (collectTagNames, tagColors.js) — the second half is what stops
// deleting the last task carrying a tag from silently orphaning that tag's
// configured color with no way left to see or clear it.
//
// Deleted tasks are excluded from the first half deliberately: a tag that only
// survives on a trashed task is not part of the user's live vocabulary, and if
// that tag has colors assigned, the settings-map half lists it anyway.
function renderSettingsView() {
  const tagSettings = getTagSettings();
  const nonDeletedTasks = getTasks().filter((task) => !task.deleted);
  const tagNames = collectTagNames(nonDeletedTasks, tagSettings);
  settingsCountText.textContent =
    tagNames.length === 0
      ? "No tags yet — add a #tag or @tag to a task title."
      : `${tagNames.length} tag${tagNames.length === 1 ? "" : "s"}`;
  renderSettings(settingsList, tagNames, tagSettings);

  // Step 20 (S20-8): re-set on every render, same as every other settings
  // control on this screen — a <select> has no in-progress-edit state to
  // guard (unlike the title/note/due-date inputs elsewhere in this app),
  // so there is no "skip while mid-edit" branch needed here. Absent field
  // reads as `'sunday'`, the setting's own documented default.
  weekStartSelect.value = tagSettings?.weekStart ?? "sunday";

  // Step 17 (S17-1): the Undo button only exists while the in-memory
  // snapshot exists — its own text names the exact action and is explicit
  // that reloading (or signing out) loses it, rather than implying a
  // durable history this app doesn't have.
  settingsUndoBtn.hidden = !tagUndoSnapshot;
  if (tagUndoSnapshot) {
    const verb = tagUndoSnapshot.kind === "rename" ? "renaming" : "deleting";
    settingsUndoBtn.textContent = `Undo ${verb} "${tagUndoSnapshot.tagName}" (lost on reload)`;
  }
}

// Picks which deleted documents to permanently purge once the Trash holds
// more than `cap` — the oldest ones past the cap, exactly `product-spec.md`
// §3's rule ("beyond that, the oldest fall out and are gone for good").
// Pure and side-effect-free so it can be exercised directly (same
// verification-only reasoning as compareTrashNewestFirst above): given the
// full post-delete task list, it returns the ids handleDeleteClick's queued
// mutation should call `purgeTask` on, without touching Firestore itself.
export function selectPurgeCandidates(allTasks, cap) {
  const trashedOldestFirst = allTasks
    .filter((task) => task.deleted)
    .sort((a, b) => -compareTrashNewestFirst(a, b));
  const purgeCount = Math.max(0, trashedOldestFirst.length - cap);
  return trashedOldestFirst.slice(0, purgeCount).map((task) => task.id);
}

// 3. Refetch-and-render: the single refresh path every mutation and the
// 5-minute timer both funnel through (see store.js's "one refresh strategy").
async function refreshTasks() {
  const userId = getCurrentUserId();
  if (!userId) return;
  try {
    // Step 14 (D9): the settings document is refetched on the SAME path and in
    // the SAME pass as the tasks, because per-tag colors are read on every
    // render — a settings cache refreshed on some other schedule would leave
    // rows painted from a stale color map after any settings write. Issued
    // together (not sequentially) since neither read depends on the other.
    const [tasks, settings] = await Promise.all([fetchTasks(userId), fetchSettings(userId)]);
    setTasks(tasks);
    setTagSettings(settings);
    // Re-render whichever panel is actually on screen — step 9 added a
    // second one (Trash), and every mutation (including a restore performed
    // FROM the Trash) still funnels through this one refresh path.
    views[currentView]();
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
          // Step 14 (D3): no `colors` — a row's colors come from its winning
          // tag now (tagColors.js's resolveTagColor), never from a stored
          // per-task field, so there is nothing to hardcode at creation time.
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
//
// Step 12 (D6): un-completing deliberately does NOT restore `pinned`. Both
// writes below spread the existing task/current object without touching
// `pinned` at all, so whatever the completing branch already set it to (D5:
// always `false`) is exactly what a reopened task keeps. Pinning is a cheap,
// explicit, one-click act; silently resurrecting a pin the user never asked
// to restore on reopen would be worse than just making them re-pin it.
taskSection.addEventListener("change", (event) => {
  // Step 14: the Tag Settings screen's color inputs are reached through this
  // same delegated listener (#settings-view is nested inside #task-section for
  // exactly that reason, following #trash-view/#overdue-view's precedent).
  // Checked before the checkbox branch because a settings row carries no
  // `data-task-id` at all — everything below this point assumes one.
  // `change` (not `input`) so a drag through a native color picker commits
  // once on release, not once per intermediate shade.
  const colorInput = event.target.closest(".tag-setting__color");
  if (colorInput) {
    const tagName = colorInput.closest("li")?.dataset.tagName;
    if (tagName) handleTagColorChange(tagName, colorInput.dataset.colorField, colorInput.value);
    return;
  }

  // Step 15: the Tag Settings screen's quadrant <select>, same delegated
  // listener, same "checked before a data-task-id is required" placement as
  // the color branch just above.
  const quadrantSelect = event.target.closest(".tag-setting__quadrant");
  if (quadrantSelect) {
    const tagName = quadrantSelect.closest("li")?.dataset.tagName;
    if (tagName) handleTagQuadrantChange(tagName, quadrantSelect.value);
    return;
  }

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

    // Step 18 (S18-6, locked): completing a RECURRING task never actually
    // completes it. This branches BEFORE the plain `completed: true` write
    // and the cascade below, and returns immediately — a recurring task's
    // own completion never runs the cascade at all, so no descendant is ever
    // touched by it (product-spec.md's recurrence bullet only ever describes
    // ONE task moving forward, never a subtree). The checkbox visually
    // un-checks itself because the refetch below still has `completed: false`
    // on this task.
    if (task.recurrence) {
      try {
        // S18-5 already guarantees a recurring task has a due date at the
        // moment recurrence was set, but this re-derives from whatever is
        // actually on the document right now (architecture rule: re-read at
        // run time) rather than trusting that invariant blindly — a due date
        // cleared out from under a recurring task some other way still needs
        // a sane fallback to advance from.
        const fromDate = task.dueDate ? timestampToDate(task.dueDate) : localMidnight(new Date());
        const nextDueDate = advanceRecurrence(fromDate, task.recurrence);
        // S18-3: occurrenceStart is stamped to the MOMENT of this advance
        // (today), not to nextDueDate — the new occurrence begins now, and
        // age must reset to "today" regardless of how far out the next due
        // date lands (a monthly task's next occurrence can be weeks away;
        // its age should still read as freshly reset, not as a negative or
        // future-dated age).
        await saveTask(userId, {
          ...task,
          dueDate: nextDueDate,
          occurrenceStart: localMidnight(new Date()),
          completed: false,
          closedByCascadeFrom: null,
        });
      } catch (error) {
        console.error("Failed to advance recurring task:", error);
        alert("Could not advance the recurring task. The list has been refreshed to show what actually saved.");
      } finally {
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
      // a cascade effect. Step 12 (D5): completing ALSO unpins — Focus is
      // "what I'm working on now", and a finished task is not that.
      await saveTask(userId, { ...task, completed: true, closedByCascadeFrom: null, pinned: false });

      // Snapshotted once before the loop: nothing else can change these
      // tasks mid-loop (the mutation queue serializes against every other
      // enqueued mutation), so re-reading getTasks() per iteration would
      // only ever see this same snapshot anyway.
      const currentById = new Map(getTasks().map((t) => [t.id, t]));
      for (const id of descendantsToClose) {
        const current = currentById.get(id);
        if (!current || current.completed) continue; // core rule: never restamp an already-completed descendant
        // Step 12 (D5): a cascade-closed descendant unpins too, exactly like
        // a direct completion — this is the easy-to-miss half of D5, called
        // out by name in PROGRESS.md because a cascade is not "the user
        // ticking that specific box" and it would be easy to only handle the
        // clicked task's own write above and forget this one.
        await saveTask(userId, { ...current, completed: true, closedByCascadeFrom: taskId, pinned: false });
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

  // Step 14: the Tag Settings screen's "Clear colors" button, reached through
  // this same delegated listener. Checked before `taskId` is required, since a
  // settings row is keyed by tag name and has no task id at all.
  const clearColorsBtn = event.target.closest(".tag-setting__clear-btn");
  if (clearColorsBtn) {
    const tagName = clearColorsBtn.closest("li")?.dataset.tagName;
    if (tagName) await handleTagClearColors(tagName);
    return;
  }

  // Step 17: Rename/Delete, same "checked before a data-task-id is
  // required" placement as every other settings-row branch above (a
  // settings row has no task id at all).
  const renameTagBtn = event.target.closest(".tag-setting__rename-btn");
  if (renameTagBtn) {
    const tagName = renameTagBtn.closest("li")?.dataset.tagName;
    if (tagName) await handleTagRenameClick(tagName);
    return;
  }

  const deleteTagBtn = event.target.closest(".tag-setting__delete-btn");
  if (deleteTagBtn) {
    const tagName = deleteTagBtn.closest("li")?.dataset.tagName;
    if (tagName) await handleTagDeleteClick(tagName);
    return;
  }

  const li = event.target.closest("li");
  const taskId = li?.dataset.taskId;
  if (!taskId) return;

  // Step 9: Restore lives on a Trash row, not a main-list row, but the
  // Trash's <ul> sits inside #task-section too (see index.html's comment on
  // #trash-view), so it's reached through this same delegated listener
  // rather than a second one.
  if (event.target.closest(".trash-item__restore-btn")) {
    await handleRestoreClick(taskId);
    return;
  }

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

  // Step 12 (D1/D4), extended by step 13 to three contexts: a task can now
  // have up to THREE independent <li>s — its normal-place row, its Focus
  // row, and (on the Overdue screen) its Overdue row — each with its own
  // editingTitle/editingNote/editingDueDate state in render.js. Which one
  // this click landed on decides `context` (render.js's row-context
  // parameter, issue 2) and the openEdits key's field suffix, so opening an
  // edit here can never accidentally toggle a DIFFERENT row's independent
  // edit state.
  const context = contextForRow(li);
  const fieldSuffix = fieldSuffixForContext(context);
  if (event.target.closest(".task-item__label")) {
    beginEdit(taskId, "title" + fieldSuffix);
    beginTitleEdit(taskId, context);
  } else if (event.target.closest(".task-item__note-display")) {
    beginEdit(taskId, "note" + fieldSuffix);
    beginNoteEdit(taskId, context);
  } else if (event.target.closest(".task-item__due-display")) {
    // Step 13 (D10): clicking the due-date display opens its inline
    // `<input type="date">` editor — the exact same click-to-edit shape
    // title/note already use, reusing step 2's machinery and guard.
    beginEdit(taskId, "dueDate" + fieldSuffix);
    beginDueDateEdit(taskId, context);
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

  // Step 9: this deletion is about to add (1 + liveDescendantCount) new
  // documents to the Trash — the clicked task plus every live descendant the
  // cascade below sweeps up with it. If that pushes the total past the
  // 50-item cap, the oldest documents beyond it get permanently purged. The
  // plan is explicit that a silent purge is a defect, so the confirm below
  // has to name the exact count BEFORE anything is written — this is a
  // best-effort projection from the last fetch (the same honesty level as
  // `liveDescendantCount` above, which has the same limitation); the queued
  // mutation re-derives the real, authoritative count from a fresh fetch
  // right before it actually purges anything.
  const currentTrashCount = getTasks().filter((t) => t.deleted).length;
  const projectedTrashCount = currentTrashCount + 1 + liveDescendantCount;
  const purgeCount = Math.max(0, projectedTrashCount - TRASH_CAP);

  let confirmMessage =
    liveDescendantCount === 0
      ? `Delete "${task.title}"?`
      : `Delete "${task.title}" and its ${liveDescendantCount} sub-task${liveDescendantCount === 1 ? "" : "s"}?`;
  if (purgeCount > 0) {
    confirmMessage += ` The trash is full: this will permanently purge ${purgeCount} of the oldest trashed item${purgeCount === 1 ? "" : "s"}. This cannot be undone.`;
  }
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

      // Step 9's 50-item cap. The local store (`getTasks()`) is never
      // optimistically mutated — per this app's one-refresh-strategy rule,
      // it only changes via refreshTasks's own fetchTasks/setTasks — so it
      // still reflects the PRE-delete state even though the soft-deletes
      // above just landed in Firestore. A dedicated fetch here is the only
      // way to see the count the cap actually has to act against, which is
      // what this step's plan calls for ("the count it evicts against is the
      // real post-delete count"), rather than reusing the confirm's
      // best-effort projection for the actual eviction.
      const postDeleteTasks = await fetchTasks(currentUserId);
      const purgeIds = selectPurgeCandidates(postDeleteTasks, TRASH_CAP);
      for (const id of purgeIds) {
        await purgeTask(currentUserId, id);
      }
    } catch (error) {
      console.error("Failed to delete task:", error);
      alert("Could not delete the whole cascade. The list has been refreshed to show what actually saved.");
    } finally {
      await refreshTasks();
    }
  });
}

// Step 9: restore a task and, symmetrically, every task its own deletion
// cascade swept up with it — the exact same global-filter pattern step 7
// uses to reverse a cascade-complete via `closedByCascadeFrom` (see
// PROGRESS.md's step 7 decision for why this has to be a stamp match, not a
// tree walk: the stamp is what recorded cascade membership at delete time,
// and a walk from the CURRENT parentId could disagree with it the moment
// step 11 (drag-to-reparent) exists). One queued mutation, one refresh.
//
// Restoring into a still-deleted parent: `parentId` is deliberately left
// exactly as it was. taskTree.js's orphan-is-root rule (buildTree treats a
// task whose parent isn't in the live set as a root) means this task simply
// renders at the top level until its parent is restored too — this function
// warns about that in the confirm and then does it, per this step's plan.
// It does NOT walk up and resurrect the ancestor chain: the user asked to
// restore what they clicked, and reviving an unrelated ancestor they never
// asked for would be a second, uninvited restore riding along on this one.
async function handleRestoreClick(taskId) {
  const userId = getCurrentUserId();
  const task = getTasks().find((t) => t.id === taskId);
  if (!userId || !task || !task.deleted) return;

  if (task.parentId != null) {
    const parentTask = getTasks().find((t) => t.id === task.parentId);
    if (parentTask && parentTask.deleted) {
      const proceed = confirm(
        `"${task.title}"'s parent is still in the trash. Restoring it now will place it at the top level until the parent is restored too. Restore anyway?`
      );
      if (!proceed) return;
    }
  }

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    const currentTask = getTasks().find((t) => t.id === taskId);
    if (!currentUserId || !currentTask || !currentTask.deleted) return; // already restored, or gone

    // Global filter over every task carrying this stamp — not a subtree
    // walk from `taskId`'s current position, for the same reason step 7's
    // reopen set isn't a walk either (see the comment above this function).
    const toRestore = getTasks().filter((t) => t.deletedByCascadeFrom === taskId);

    try {
      // The clicked task first, so the row the user actually pressed
      // reflects their action even if the rest of the restore fails partway
      // — mirrors step 6/7/8's "clicked task first" ordering.
      await saveTask(currentUserId, {
        ...currentTask,
        deleted: false,
        deletedAt: null,
        deletedByCascadeFrom: null,
      });
      for (const current of toRestore) {
        await saveTask(currentUserId, {
          ...current,
          deleted: false,
          deletedAt: null,
          deletedByCascadeFrom: null,
        });
      }
    } catch (error) {
      console.error("Failed to restore task:", error);
      alert("Could not restore the whole cascade. The list has been refreshed to show what actually saved.");
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
      // Issue 4 fix (out-of-scope-but-identical bug, step 4 code): derived
      // from `freshTree`/`parentId` via ancestorChain, NOT from the parent's
      // own cached `ancestors` field. taskTree.js's own header is explicit
      // that `parentId` is the source of truth and `ancestors` is only a
      // cached denormalization — reading the cached field here means a stale
      // or corrupted `ancestors` on the parent silently propagates into every
      // new subtask underneath it, exactly the defect this fix (and
      // performReparent's identical fix below) both close.
      const ancestors = [...ancestorChain(freshTree, parentId), parentId];
      await addTask(
        currentUserId,
        {
          title: rawTitle,
          tags,
          parentId,
          ancestors,
          inInbox: currentParent.inInbox, // see the step 5 correction above
          // Step 14 (D3): no `colors` here either — same reason as the
          // add-task handler above.
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

// Step 12 (D7): pin/unpin a single task into Focus. Context-menu only — no
// inline per-row button — the same shape as step 11's "Move to top level"
// (D9): one shared handler, routed to from the menu's click dispatch below,
// with one enqueueMutation-wrapped whole-document saveTask. It simply flips
// whatever `pinned` IS at write time (re-read fresh, not the value the menu
// happened to show when it was opened) — there is no separate "pin" vs
// "unpin" function, matching the single toggle affordance the menu item
// itself is (D7's label already told the user which way this click goes).
// Only a task that is neither completed nor deleted may end up pinned (D5's
// invariant already keeps a completed task unpinned; this guards the write
// itself rather than trusting the menu's own visibility check, the same
// belt-and-suspenders pattern as every other handler in this file that
// re-validates inside the queued mutation instead of trusting click-time
// state).
async function handleTogglePinClick(taskId) {
  const userId = getCurrentUserId();
  const task = getTasks().find((t) => t.id === taskId);
  if (!userId || !task || task.deleted || task.completed) return;

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    const currentTask = getTasks().find((t) => t.id === taskId);
    if (!currentUserId || !currentTask || currentTask.deleted || currentTask.completed) return;
    try {
      await saveTask(currentUserId, { ...currentTask, pinned: !currentTask.pinned });
    } catch (error) {
      console.error("Failed to toggle pin:", error);
      alert("Could not update Focus.");
    } finally {
      // Always resync with Firestore's real state, same as every other
      // queued mutation in this file — a failed write must not leave the UI
      // silently showing the pre-write pinned state until the 5-minute timer.
      await refreshTasks();
    }
  });
}

// Step 14 (D9): the one write path for the settings document. Both settings
// mutations below (assign a color, clear a tag's colors) funnel through this,
// so there is exactly one place that builds the whole-document payload.
//
// Shape rules, all load-bearing:
//   - Whole-document `setDoc` via saveSettings — never `updateDoc`, matching
//     step 1's conflict rule and every mutation in this file.
//   - Routed through `enqueueMutation`, so a settings write can never
//     interleave with a task write (or another settings write) and land built
//     from a stale copy of the map.
//   - The current map is re-read from the store INSIDE the queued mutation,
//     not captured at click time — the same "re-read at run time" rule every
//     other handler here follows.
//   - `finally { await refreshTasks(); }`, the same resync shape as every
//     other mutation: a failed write must not leave the screen showing a color
//     that was never saved, and a successful one has to repaint every task row
//     that the changed tag now colors.
//
// `mutate` receives the current tag map and returns the new one. It must not
// touch anything outside `tags` — step 20's `weekStart` lives in this same
// document and is carried through untouched by normalizeTagSettings.
async function updateTagSettings(mutate, failureMessage) {
  const userId = getCurrentUserId();
  if (!userId) return;

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    if (!currentUserId) return;
    const current = getTagSettings();
    try {
      await saveSettings(currentUserId, { ...current, tags: mutate(current.tags ?? {}) });
    } catch (error) {
      console.error("Failed to save tag settings:", error);
      alert(failureMessage);
    } finally {
      await refreshTasks();
    }
  });
}

// Assigns one half of a tag's color pair (`field` is "fg" or "bg"). A tag with
// no colors yet starts from the defaults the settings screen was already
// showing in its inputs, so a single change always produces a COMPLETE entry —
// a half-written `{ fg }` would read back as "no colors" (readTagColors
// requires both), which would look like the change silently failed.
//
// D7: only `fg`/`bg` are written. The existing entry is spread first so a
// `quadrant` step 15 later adds survives a color change made after it.
async function handleTagColorChange(tagName, field, value) {
  await updateTagSettings(
    (tags) => {
      const existing = readTagColors(tags[tagName]);
      const base = existing ?? { fg: DEFAULT_TAG_FG, bg: DEFAULT_TAG_BG };
      return {
        ...tags,
        [tagName]: { ...(tags[tagName] ?? {}), fg: base.fg, bg: base.bg, [field]: value },
      };
    },
    "Could not save the tag color."
  );
}

// Removes a tag's colors so its tasks fall back to the default row style.
// Deletes only the color keys, not the whole entry — an entry may already
// carry a step-15 quadrant, and "clear colors" is not "clear everything about
// this tag". An entry left with no keys at all is kept rather than deleted, so
// the tag still lists on the settings screen (D5) even if no live task carries
// it anymore.
async function handleTagClearColors(tagName) {
  await updateTagSettings(
    (tags) => {
      if (!tags[tagName]) return tags;
      const { fg, bg, ...rest } = tags[tagName];
      return { ...tags, [tagName]: rest };
    },
    "Could not clear the tag color."
  );
}

// Step 15 (Q1): assigns (or clears) one tag's quadrant. `quadrant` is the
// <select>'s raw value — the blank option's "" is normalized to `null` here,
// which readTagQuadrant (tagColors.js) reads back as "unconfigured" exactly
// like a missing key. The existing entry is spread first (mirroring
// handleTagColorChange's own comment) so a quadrant change never drops a
// tag's colors, and a color change made after this survives this quadrant
// the same way (already verified for the reverse direction in step 14, 14i).
async function handleTagQuadrantChange(tagName, quadrant) {
  await updateTagSettings(
    (tags) => ({
      ...tags,
      [tagName]: { ...(tags[tagName] ?? {}), quadrant: quadrant || null },
    }),
    "Could not save the tag quadrant."
  );
}

// Step 20 (S20-8): writes the `weekStart` field of the SAME settings
// document `updateTagSettings` above writes `tags` into — not routed
// through that helper because this mutation touches a sibling field, not
// `tags` itself, but every other rule is identical: whole-document
// `setDoc` via `saveSettings`, serialized through `enqueueMutation` so this
// can never interleave with a concurrent tag-color/quadrant write, the
// current settings object re-read fresh at mutation time (never the one
// captured when the <select> fired its `change` event), and the same
// `finally { refreshTasks() }` resync every mutation in this file uses.
// `value` is exactly the <select>'s raw value — `'sunday'` or `'monday'`,
// the two strings `isValidSettings()` (firestore.rules) already accepts.
async function updateWeekStart(value) {
  const userId = getCurrentUserId();
  if (!userId) return;

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    if (!currentUserId) return;
    const current = getTagSettings();
    try {
      await saveSettings(currentUserId, { ...current, weekStart: value });
    } catch (error) {
      console.error("Failed to save the week-start setting:", error);
      alert("Could not save the week-start setting.");
    } finally {
      await refreshTasks();
    }
  });
}

// Step 21 (S21-11): a real backup is never up to five minutes stale — this
// refreshes BEFORE reading getTasks()/getTagSettings() out of memory, rather
// than exporting whatever the store happened to be holding from the last
// background refresh. No separate fetch path: buildExportPayload
// (dataTransfer.js) reads the exact same in-memory shapes every other view
// in this app already reads.
async function handleExportClick() {
  const userId = getCurrentUserId();
  if (!userId) return;

  await refreshTasks();
  const payload = buildExportPayload(getTasks(), getTagSettings());
  const json = stringifyExportPayload(payload);

  // S21-4: Blob + object URL + a synthetic <a download> click, no library.
  // revokeObjectURL runs in a `finally` so a click that throws (or one the
  // browser silently swallows) can never leak the object URL.
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = buildExportFilename(new Date());
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Step 21 (S21-9): Import's own hidden `<input type="file">` is triggered by
// this click rather than shown directly. The value is cleared first so
// selecting the SAME file twice in a row still fires the input's `change`
// event the second time (a browser does not fire `change` for a no-op
// selection otherwise).
function handleImportClick() {
  const userId = getCurrentUserId();
  if (!userId) return;
  importFileInput.value = "";
  importFileInput.click();
}

// Step 21 (S21-5/S21-7/S21-8): the file input's `change` handler — the whole
// import pipeline from "a File object exists" through the write loop.
// Reachability: file input change -> FileReader -> parse -> validate ->
// (confirm) -> enqueueMutation -> re-validate -> saveTask loop ->
// saveSettings -> refreshTasks.
function handleImportFileSelected() {
  const file = importFileInput.files?.[0];
  if (!file) return;
  const userId = getCurrentUserId();
  if (!userId) return;

  const reader = new FileReader();
  reader.onerror = () => {
    alert("Could not read the file.");
  };
  reader.onload = async () => {
    const text = String(reader.result ?? "");

    // S21-7: validated against every task CURRENTLY in the account (deleted
    // or not — a parentId pointing at a soft-deleted-but-not-purged parent
    // is still a real document, not a dangling reference) before the confirm
    // dialog is even shown, so that dialog only ever offers an operation
    // that CAN fully succeed (S17's identical rename/delete precedent).
    const { ok, errors, payload } = parseImportPayload(text, getTasks());
    if (!ok) {
      alert(
        `Cannot import this file: ${errors[0]}` +
          (errors.length > 1 ? ` (${errors.length} problems found in total; nothing was changed.)` : " Nothing was changed.")
      );
      return;
    }

    // S21-5/S21-10: named explicitly, in plain words, so a user expecting a
    // wipe-and-replace finds that out from THIS dialog, not from the result.
    const taskCount = payload.tasks.length;
    const confirmMessage =
      `Import ${taskCount} task${taskCount === 1 ? "" : "s"} from this file? Existing tasks with matching ids ` +
      "will be overwritten; every other task in your account is left completely untouched — this is a merge, " +
      "not a wipe-and-replace." +
      (payload.settings
        ? " Tag colors, quadrant mappings and the week-start setting will be REPLACED wholesale by the file's."
        : "");
    if (!confirm(confirmMessage)) return;

    await enqueueMutation(async () => {
      const currentUserId = getCurrentUserId();
      if (!currentUserId) return;

      // S21-7 / this file's standing "re-read at run time" rule: a
      // click-time-valid file could have a parentId dangle on a task some
      // OTHER queued mutation deleted while this one waited its turn, so the
      // whole file is checked again against whatever's actually in the
      // account right now, before the first write.
      const revalidated = validateImportPayload(payload, getTasks());
      if (!revalidated.ok) {
        alert(
          `Import aborted: ${revalidated.errors[0]}` +
            (revalidated.errors.length > 1
              ? ` (${revalidated.errors.length} problems found in total; nothing was changed.)`
              : " Nothing was changed.")
        );
        return;
      }

      // S21-8: hundreds of sequential setDocs take real seconds — a silent
      // multi-second freeze reads as a hang, so the button is disabled and
      // shows visible progress for the whole loop.
      const total = payload.tasks.length;
      importBtn.disabled = true;
      let written = 0;
      try {
        for (let i = 0; i < total; i++) {
          importBtn.textContent = `Importing ${i + 1} of ${total}…`;
          const task = deserializeTaskFromImport(payload.tasks[i]);
          await saveTask(currentUserId, task);
          written++;
        }
        // S21-10: settings REPLACES the whole document, asymmetric with
        // tasks' per-id upsert on purpose — merging two tag-color maps would
        // produce a state that existed in neither the file nor the account.
        // A file with no `settings` key leaves the account's settings
        // untouched entirely.
        if (payload.settings) {
          await saveSettings(currentUserId, payload.settings);
        }
      } catch (error) {
        // S21-8: stop at the first failure, report how many tasks were
        // written, and refresh. No retry, no rollback (a rollback would
        // itself be a destructive multi-write with no guarantee of
        // completing).
        console.error("Import stopped partway through a write failure:", error);
        alert(
          `Import stopped after writing ${written} of ${total} tasks. The list has been refreshed to show what actually saved.`
        );
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = IMPORT_BTN_LABEL;
        await refreshTasks();
      }
    });
  };
  reader.readAsText(file);
}

// Step 17 (S17-1/S17-3): the ONE undo slot for the last tag rename/delete —
// a module-level variable, not a stack, not persisted anywhere. Lost on
// reload (nothing here survives a page load) and cleared on sign-out
// (alongside store.js's own invalidate() — see the monitorAuthState wiring
// below). A new rename/delete silently replaces whatever this held; the
// Undo button itself consumes it the moment it runs (handleTagUndoClick).
// Shape: `{ kind: 'rename'|'delete', tagName, entries: [{taskId,
// previousTitle}], previousTagSettings }` — `tagName` is the NEW name for a
// rename (what the Undo button names) and the deleted name for a delete.
// `previousTagSettings` is a direct reference to the settings object
// getTagSettings() returned right before the write — safe to hold without
// cloning because every mutator in this file (updateTagSettings included)
// only ever builds a NEW object via spread, never mutates one in place.
let tagUndoSnapshot = null;

// Step 17: renames a tag across every non-deleted task's title (S17-4's
// literal, offset-based token substitution — never a bare string replace)
// and moves its settings entry to the new key (S17-6). Deleted tasks are
// deliberately excluded from the sweep, matching D5's "the live vocabulary"
// reasoning for which tags even list on this screen — a tag surviving only
// on a trashed task isn't part of it, and rewriting a trashed title the user
// can't currently see would be an invisible side effect.
async function handleTagRenameClick(oldTagName) {
  const userId = getCurrentUserId();
  if (!userId) return;

  const rawInput = prompt(`Rename "${oldTagName}" to:`, oldTagName);
  if (rawInput == null) return; // cancelled
  const newTagName = rawInput.trim();
  if (!newTagName) return;

  if (!isValidTagToken(newTagName)) {
    alert(`"${newTagName}" isn't a valid tag — a tag is # or @ followed by letters, numbers, or underscores, with nothing else.`);
    return;
  }
  if (newTagName === oldTagName) {
    alert("New name must be different from the current name.");
    return;
  }

  // S17-5: the whole batch is checked before anything runs, so the confirm
  // below only ever offers an operation that CAN fully succeed. Renaming is
  // explicitly a no-op for tasks (but not for settings) when no task carries
  // the tag — the spec's own wording for this ("the settings entry still
  // moves") — so an empty `entries` array is a valid, non-blocked outcome.
  const nonDeletedTasks = getTasks().filter((t) => !t.deleted);
  const plan = planTagRewrite(nonDeletedTasks, oldTagName, newTagName);
  if (!plan.ok) {
    alert(
      `Can't rename "${oldTagName}": "${plan.blockedTask.title}" would become ${plan.blockedTitle.length} characters, over the 1000-character limit. Nothing was changed.`
    );
    return;
  }

  const count = plan.entries.length;
  const confirmMessage =
    (count === 0
      ? `Rename tag "${oldTagName}" to "${newTagName}"? No current task carries this tag, but its settings will move to the new name.`
      : `Rename "${oldTagName}" to "${newTagName}" in ${count} task${count === 1 ? "" : "s"}?`) +
    " You can undo this until you reload or sign out.";
  if (!confirm(confirmMessage)) return;

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    if (!currentUserId) return;

    // Re-derive fresh at run time (this file's standing rule) rather than
    // trusting the click-time plan, which could be stale if another queued
    // mutation ran first.
    const currentTasks = getTasks().filter((t) => !t.deleted);
    const currentPlan = planTagRewrite(currentTasks, oldTagName, newTagName);
    if (!currentPlan.ok) {
      alert(
        `Can't rename "${oldTagName}": "${currentPlan.blockedTask.title}" would exceed the 1000-character limit. Nothing was changed.`
      );
      return;
    }

    const previousTagSettings = getTagSettings();

    // S17-8: the snapshot is taken BEFORE the first write, not after the
    // loop finishes — so a mid-batch network failure is already covered by
    // Undo (replaying a task's previousTitle is a harmless no-op for any
    // task this attempt never got to), which is what makes the catch
    // block's "click Undo" below honest rather than aspirational.
    tagUndoSnapshot = {
      kind: "rename",
      tagName: newTagName,
      entries: currentPlan.entries.map((e) => ({ taskId: e.taskId, previousTitle: e.previousTitle })),
      previousTagSettings,
    };

    try {
      // S17-8: one enqueueMutation, a sequential saveTask loop — the exact
      // idiom step 8's cascade delete already established (app.js:911-937).
      for (const entry of currentPlan.entries) {
        const currentTask = getTasks().find((t) => t.id === entry.taskId);
        if (!currentTask || currentTask.deleted) continue; // vanished since the plan was built — nothing to write
        await saveTask(currentUserId, { ...currentTask, title: entry.newTitle });
      }
      await saveSettings(currentUserId, {
        ...previousTagSettings,
        tags: moveTagSettingsEntry(previousTagSettings.tags ?? {}, oldTagName, newTagName),
      });
    } catch (error) {
      console.error("Failed to rename tag:", error);
      alert(`Could not finish renaming "${oldTagName}". Click Undo to restore every title this rename touched.`);
    } finally {
      await refreshTasks();
    }
  });
}

// Step 17 (S17-7): deletes a tag outright — strips its token from every
// non-deleted task's title AND removes its settings entry, both in one
// operation (unlike step 14's "Clear colors", which deliberately leaves an
// empty entry behind for a different reason — see moveTagSettingsEntry's own
// comment). Same confirm/pre-check/snapshot/enqueueMutation shape as rename.
async function handleTagDeleteClick(tagName) {
  const userId = getCurrentUserId();
  if (!userId) return;

  const nonDeletedTasks = getTasks().filter((t) => !t.deleted);
  const plan = planTagRewrite(nonDeletedTasks, tagName, null);
  if (!plan.ok) {
    // Delete can only ever shorten a title (S17-5), so the only possible
    // block here is the LOWER bound: this tag was the title's only content.
    alert(
      `Can't delete "${tagName}": removing it from "${plan.blockedTask.title}" would leave an empty title. Nothing was changed.`
    );
    return;
  }

  const count = plan.entries.length;
  const confirmMessage =
    (count === 0
      ? `Delete tag "${tagName}"? No current task carries it, but its settings will be removed.`
      : `Delete tag "${tagName}" from ${count} task${count === 1 ? "" : "s"}?`) +
    " You can undo this until you reload or sign out.";
  if (!confirm(confirmMessage)) return;

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    if (!currentUserId) return;

    const currentTasks = getTasks().filter((t) => !t.deleted);
    const currentPlan = planTagRewrite(currentTasks, tagName, null);
    if (!currentPlan.ok) {
      alert(
        `Can't delete "${tagName}": removing it from "${currentPlan.blockedTask.title}" would leave an empty title. Nothing was changed.`
      );
      return;
    }

    const previousTagSettings = getTagSettings();

    // S17-8: snapshot before the first write — see handleTagRenameClick's
    // identical comment for why.
    tagUndoSnapshot = {
      kind: "delete",
      tagName,
      entries: currentPlan.entries.map((e) => ({ taskId: e.taskId, previousTitle: e.previousTitle })),
      previousTagSettings,
    };

    try {
      for (const entry of currentPlan.entries) {
        const currentTask = getTasks().find((t) => t.id === entry.taskId);
        if (!currentTask || currentTask.deleted) continue;
        await saveTask(currentUserId, { ...currentTask, title: entry.newTitle });
      }
      await saveSettings(currentUserId, {
        ...previousTagSettings,
        tags: moveTagSettingsEntry(previousTagSettings.tags ?? {}, tagName, null),
      });
    } catch (error) {
      console.error("Failed to delete tag:", error);
      alert(`Could not finish deleting "${tagName}". Click Undo to restore every title this touched.`);
    } finally {
      await refreshTasks();
    }
  });
}

// Step 17 (S17-2/S17-3): replays the snapshot's exact previous titles
// VERBATIM — never a reverse rename/re-insertion, which would also rewrite
// tasks that legitimately already carried the destination tag by the time
// Undo actually runs — and restores previousTagSettings WHOLESALE. One
// shared handler for both rename and delete, since both snapshot shapes are
// identical. Performing the undo consumes the slot immediately (S17-3): no
// stack, no redo, and a failed undo doesn't get a second Undo pointed at it.
async function handleTagUndoClick() {
  const userId = getCurrentUserId();
  const snapshot = tagUndoSnapshot;
  if (!userId || !snapshot) return;

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    if (!currentUserId) return;
    tagUndoSnapshot = null; // consumed regardless of how this attempt goes

    try {
      for (const entry of snapshot.entries) {
        const currentTask = getTasks().find((t) => t.id === entry.taskId);
        if (!currentTask || currentTask.deleted) continue; // gone since — nothing left to restore it onto
        await saveTask(currentUserId, { ...currentTask, title: entry.previousTitle });
      }
      await saveSettings(currentUserId, snapshot.previousTagSettings);
    } catch (error) {
      console.error("Failed to undo tag change:", error);
      alert("Could not fully undo the tag change. The list has been refreshed to show what actually saved.");
    } finally {
      await refreshTasks();
    }
  });
}

// Step 13 (D10): the context menu's "Set due date"/"Change due date" item —
// opens the inline editor on the SAME row/context the menu was opened for
// (stashed on `taskMenu.dataset.context` by openTaskMenuForTask), the same
// way clicking the due-date display directly does. Not a mutation itself —
// no enqueueMutation here — the actual write happens on commit (blur),
// exactly like every other click-to-edit entry point in this file.
function handleEditDueDateMenuClick(taskId, context) {
  const fieldSuffix = fieldSuffixForContext(context);
  beginEdit(taskId, "dueDate" + fieldSuffix);
  beginDueDateEdit(taskId, context);
}

// Step 13 (D10): the context menu's "Clear due date" item — an immediate
// one-shot clear with no editor step, the same shape as step 12's
// handleTogglePinClick (one enqueueMutation-wrapped whole-document saveTask,
// re-validated at write time rather than trusting the menu's click-time
// state). Only shown in the menu when task.dueDate is already set, but the
// write itself re-checks fresh anyway per this file's own belt-and-suspenders
// convention.
async function handleClearDueDateClick(taskId) {
  const userId = getCurrentUserId();
  const task = getTasks().find((t) => t.id === taskId);
  if (!userId || !task || task.deleted) return;

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    const currentTask = getTasks().find((t) => t.id === taskId);
    if (!currentUserId || !currentTask || currentTask.deleted) return;
    try {
      await saveTask(currentUserId, { ...currentTask, dueDate: null });
    } catch (error) {
      console.error("Failed to clear due date:", error);
      alert("Could not clear due date.");
    } finally {
      await refreshTasks();
    }
  });
}

// Step 18 (Recurrence): the context menu's "Set recurrence"/"Change
// recurrence" item. Prompt-based, matching this codebase's existing pattern
// for a multi-field, non-trivial edit with no dedicated inline UI (see
// handleTagRenameClick's prompt() above) — recurrence needs a kind PLUS,
// for "weekdays", a set of days, which doesn't fit the single inline
// display/input pair every other editable field (title/note/due date) uses.
//
// S18-0's residual: "none" here is the ONLY way to stop a recurrence short of
// deleting the task — there is no separate "Stop recurrence" menu action.
// All prompting happens BEFORE enqueueMutation, same as handleTagRenameClick;
// the mutation itself only re-reads the current task and writes.
async function handleSetRecurrenceClick(taskId) {
  const userId = getCurrentUserId();
  const task = getTasks().find((t) => t.id === taskId);
  if (!userId || !task || task.deleted) return;

  const currentLabel = describeRecurrence(task.recurrence);
  const rawKind = prompt(
    `Repeat this task? Enter one of: ${RECURRENCE_KINDS.join(", ")}, or none.\n(Currently: ${currentLabel})`,
    task.recurrence ? task.recurrence.kind : "none"
  );
  if (rawKind == null) return; // cancelled
  const kind = rawKind.trim().toLowerCase();

  if (kind === "none" || kind === "") {
    if (!task.recurrence) return; // already not repeating — nothing to change
    await enqueueMutation(async () => {
      const currentUserId = getCurrentUserId();
      const currentTask = getTasks().find((t) => t.id === taskId);
      if (!currentUserId || !currentTask || currentTask.deleted) return;
      try {
        await saveTask(currentUserId, { ...currentTask, recurrence: null });
      } catch (error) {
        console.error("Failed to stop recurrence:", error);
        alert("Could not stop the recurrence.");
      } finally {
        await refreshTasks();
      }
    });
    return;
  }

  if (!RECURRENCE_KINDS.includes(kind)) {
    alert(`"${rawKind}" isn't a recurrence option. Enter ${RECURRENCE_KINDS.join(", ")}, or none.`);
    return;
  }

  // "weekdays" needs a second prompt for which days; every other kind
  // derives its anchor from the due date inside the mutation below.
  let days = null;
  if (kind === "weekdays") {
    const rawDays = prompt(
      "Which days? Comma-separated, 0=Sunday .. 6=Saturday (e.g. 1,3,5 for Mon/Wed/Fri)",
      Array.isArray(task.recurrence?.days) ? task.recurrence.days.join(",") : ""
    );
    if (rawDays == null) return; // cancelled
    days = parseWeekdaysInput(rawDays);
    if (!days) {
      alert("Enter at least one day, 0 through 6, comma-separated.");
      return;
    }
  }

  await enqueueMutation(async () => {
    const currentUserId = getCurrentUserId();
    const currentTask = getTasks().find((t) => t.id === taskId);
    if (!currentUserId || !currentTask || currentTask.deleted) return;
    try {
      // S18-5: a recurring task must have a due date — default to today if
      // it doesn't have one, so weekly/monthly have a real date to derive
      // their anchor from and daily/weekdays have something to advance from.
      // Re-read at run time (architecture rule), not from the `task` closed
      // over above, which may be stale by the time this actually executes.
      const existingDueDate = currentTask.dueDate ? timestampToDate(currentTask.dueDate) : null;
      const anchorDate = existingDueDate ?? localMidnight(new Date());

      let recurrence;
      if (kind === "weekdays") recurrence = { kind, days };
      else if (kind === "weekly" || kind === "monthly") recurrence = { kind, ...deriveAnchorFromDate(kind, anchorDate) };
      else recurrence = { kind }; // daily

      await saveTask(currentUserId, {
        ...currentTask,
        recurrence,
        dueDate: existingDueDate ? currentTask.dueDate : anchorDate,
      });
    } catch (error) {
      console.error("Failed to set recurrence:", error);
      alert("Could not set the recurrence.");
    } finally {
      await refreshTasks();
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
  // Step 13: the due-date input commits on Enter same as title (it's a
  // single value, not multi-line text the way a note is), and cancels on
  // Escape identically to both.
  const isDueDateInput = event.target.classList?.contains("task-item__due-input");
  if (!isTitleInput && !isNoteInput && !isDueDateInput) return;

  if (event.key === "Enter" && (isTitleInput || isDueDateInput)) {
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
//
// Step 12 (D1/D4), extended by step 13 to three contexts: `context` picks
// which of a task's up-to-three independent rows this specific input
// belongs to — the same row-vs-row disambiguation the click-to-edit listener
// above uses (issue 2: `context` is render.js's own row-context parameter,
// not a second named function per context) — and `field` gets the matching
// suffix (none for "main", ":focus"/":overdue" otherwise) to match the
// openEdits key beginEdit used when this edit opened, so closeEdit's
// idempotent guard closes exactly the interaction this row's edit actually
// holds, never a DIFFERENT row's independent one for the same task.
taskSection.addEventListener("focusout", async (event) => {
  const target = event.target;
  const isTitleInput = target.classList?.contains("task-item__title-input");
  const isNoteInput = target.classList?.contains("task-item__note-input");
  const isDueDateInput = target.classList?.contains("task-item__due-input");
  if (!isTitleInput && !isNoteInput && !isDueDateInput) return;

  const li = target.closest("li");
  const context = contextForRow(li);
  const fieldName = isTitleInput ? "title" : isNoteInput ? "note" : "dueDate";
  const field = fieldName + fieldSuffixForContext(context);
  const taskId = li?.dataset.taskId;
  const userId = getCurrentUserId();
  const task = getTasks().find((t) => t.id === taskId);

  const endEdit = () => {
    if (isTitleInput) endTitleEdit(taskId, context);
    else if (isNoteInput) endNoteEdit(taskId, context);
    else endDueDateEdit(taskId, context);
  };
  const getValue = () =>
    isTitleInput
      ? getTitleInputValue(taskId, context)
      : isNoteInput
        ? getNoteInputValue(taskId, context)
        : getDueDateInputValue(taskId, context);
  const setValue = (value) => {
    if (isTitleInput) setTitleInputValue(taskId, context, value);
    else if (isNoteInput) setNoteInputValue(taskId, context, value);
    else setDueDateInputValue(taskId, context, value);
  };

  const cancelling = target.dataset.cancelling === "true";
  delete target.dataset.cancelling;

  if (cancelling || !userId || !task) {
    endEdit();
    closeEdit(taskId, field);
    return;
  }

  if (isTitleInput) {
    const newTitle = getValue().trim();
    const tags = parseTags(newTitle);
    if (!newTitle || newTitle.length > TITLE_MAX_LENGTH) {
      alert(`Title must be between 1 and ${TITLE_MAX_LENGTH} characters. Edit discarded.`);
      setValue(task.title); // revert — don't trap the row on an invalid value
      endEdit();
      closeEdit(taskId, field);
      return;
    }
    if (tags.length > TAGS_MAX_COUNT) {
      alert(`A task can have at most ${TAGS_MAX_COUNT} tags. Edit discarded.`);
      setValue(task.title);
      endEdit();
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
        setValue(currentTask.title); // revert to the last-saved value
      }
    });
    endEdit();
    closeEdit(taskId, field);
  } else if (isNoteInput) {
    const newNote = getValue();
    if (newNote.length > NOTE_MAX_LENGTH) {
      alert(`Note must be ${NOTE_MAX_LENGTH} characters or fewer. Edit discarded.`);
      setValue(task.note || "");
      endEdit();
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
        setValue(currentTask.note || "");
      }
    });
    endEdit();
    closeEdit(taskId, field);
  } else {
    // Step 13 (D9): due date commit. `rawValue` is "" (cleared) or a
    // "YYYY-MM-DD" string from the native date picker; parsed via
    // parseDateInputToLocalMidnight — never `new Date(rawValue)` — see
    // render.js's own comment on that function for the UTC-parsing bug this
    // avoids (D2). No length/format cap to enforce here the way title/note
    // have one: a native `<input type="date">` can only ever produce "" or a
    // well-formed calendar date string.
    const rawValue = getValue();
    const newDueDate = rawValue ? parseDateInputToLocalMidnight(rawValue) : null;
    await enqueueMutation(async () => {
      const currentUserId = getCurrentUserId();
      const currentTask = getTasks().find((t) => t.id === taskId);
      if (!currentUserId || !currentTask) return;
      try {
        // Whole-document write (D9) — never updateDoc — same rule every
        // other mutation in this file follows.
        await saveTask(currentUserId, { ...currentTask, dueDate: newDueDate });
        await refreshTasks();
      } catch (error) {
        console.error("Failed to save due date:", error);
        alert("Could not save due date.");
        setValue(formatDateForInput(currentTask.dueDate)); // revert to the last-saved value
      }
    });
    endEdit();
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
  // Step 14: `dataset.taskId`, not just "some <li>" — the Tag Settings screen's
  // rows are keyed by tag name and have no task menu of their own, so a
  // right-click there must fall through to the browser's own menu rather than
  // being swallowed by a preventDefault for a menu that then refuses to open.
  if (!li?.dataset.taskId) return;
  event.preventDefault(); // suppress the native OS/browser context menu
  openTaskMenuForTask(li.dataset.taskId, event.clientX, event.clientY, contextForRow(li));
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

// Step 10: manual reorder via a dedicated drag handle. Pointer events
// (pointerdown/pointermove/pointerup), not the HTML5 drag-and-drop API —
// step 11 (drag-to-reparent) is a hand-rolled pointer drag built directly on
// top of this same mechanism, so this deliberately isn't the browser's own
// DnD from the start.
//
// `drag` holds everything the gesture needs, or is `null` when no drag is in
// progress:
//   - taskId / parentId / inInbox: identity of the task being moved, and
//     which sibling group it belongs to. Siblings are matched on BOTH
//     parentId and inInbox, not parentId alone — a root-level Inbox task and
//     a root-level main-list task both have `parentId: null`, but they are
//     NOT siblings; they render in two different containers because a
//     subtask always inherits its parent's inInbox (step 5's decision), so
//     the partition only actually needs disambiguating at the root. Every
//     non-root task's siblings already share both fields automatically
//     (inherited from the same parent), so this check is a no-op there and
//     only matters at the root.
//   - otherSiblingIds: every OTHER live sibling's id, in the exact
//     `(quadrantRank, order)` order render.js's sortTasks/compareSiblings
//     renders them in (step 16) — used to find neighbours by array position.
//   - rankMap / draggedRank (step 16, R5): a snapshot, taken once in
//     beginDrag alongside tree/descendantIdSet/subtreeHeight below and for
//     the identical reason (nothing mutates the store mid-drag) — `rankMap`
//     covers the dragged task plus every other sibling, `draggedRank` is
//     just `rankMap.get(taskId)` pulled out for convenience. Used by
//     updateDragTarget to decide whether a hovered gap sits inside the
//     dragged task's own contiguous same-rank run (free) or crosses into a
//     different rank's run (constrained/overruled) — never recomputed via
//     resolveTaskQuadrant per pointermove, per computeQuadrantRankMap's own
//     comment in tagColors.js.
//   - tree / descendantIdSet / subtreeHeight (step 11, D3/D4): a snapshot
//     taken once in beginDrag, not recomputed on every pointermove — nothing
//     mutates the store mid-drag (the interaction guard blocks the 5-minute
//     refresh, and nothing else calls refreshTasks() until the drop itself),
//     so recomputing would be wasted work, not extra correctness. `tree` is
//     built from the FULL task set, deleted tasks included, matching step 8's
//     cascade-delete precedent — D4 counts a deleted descendant toward the
//     depth cap for the same reason it must be rewritten in D5: it's
//     restorable, and an `ancestors.size() > 6` write is rejected outright by
//     firestore.rules, so nothing later in the write batch can be allowed to
//     land in a state the rules would reject. `subtreeHeight` is the height
//     of the dragged task's own subtree (0 for a leaf) — see D4's formula.
//   - target: `{ type: 'sibling', beforeId, afterId, overruled }` (either id
//     may be null, meaning "top of the group" / "bottom of the group"; step
//     16's `overruled` is true when this exact gap crosses a quadrant-rank
//     boundary — see updateDragTarget) once the pointer is hovering a valid
//     sibling drop position, or `{ type: 'reparent', parentId }` once it's
//     hovering a valid reparent target (D1), or `null` when it isn't
//     hovering a valid position of either kind (product-spec.md's "a drag
//     can be overruled... the interface should make that visible rather than
//     letting a drag appear to work and then snap back" — an invalid target
//     simply never becomes a valid one, rather than showing a misleading
//     indicator). Step 16 is a DIFFERENT visibility case from this one: a
//     sibling target with `overruled: true` IS a valid, droppable target
//     (R5 — the write still lands) — it just won't visually hold once
//     priority re-sorts the list, which is why it gets its own distinct
//     indicator styling (showDropIndicator's `overruled` argument) instead
//     of being refused like an invalid target is.
//   - handleEl / pointerId: needed to release pointer capture on drop/cancel.
let drag = null;

// Idempotent-close guard for the drag's interaction, same pattern as
// `openEdits` (step 2) and `menuOpen` (step 8) — see either of those for why
// this matters: a double decrement here would release a DIFFERENT, still-open
// interaction's deferred refresh, not just this drag's own.
let dragInteractionOpen = false;

function closeDragInteraction() {
  if (!dragInteractionOpen) return; // already closed via the other path
  dragInteractionOpen = false;
  endInteraction();
}

// One shared drop-indicator element, moved (never rebuilt) into whichever
// <ul> the drag is currently over — the same "single shared element" pattern
// step 8's task menu uses for the same reason: something that lived inside
// #inbox-list or #task-list could be torn down by an unrelated refresh while
// still in use. In practice no refresh CAN land mid-drag (the interaction
// guard above blocks the 5-minute timer, and nothing else calls
// refreshTasks() until the drop itself), but building it the same defensive
// way costs nothing and keeps the two patterns consistent.
const dropIndicator = document.createElement("li");
dropIndicator.className = "drop-indicator";

// Step 16 (R5): `overruled` toggles a second class (index.html's
// `.drop-indicator--overruled`) that paints this exact gap differently
// BEFORE the user releases, so a position that crosses a quadrant-rank
// boundary is knowable up front rather than looking identical to a free
// position and then silently not holding after the drop. This is still a
// perfectly valid, droppable target — see the `drag` doc comment's target
// entry — the styling is the whole point, not a refusal.
function showDropIndicator(referenceLi, before, overruled = false) {
  dropIndicator.classList.toggle("drop-indicator--overruled", overruled);
  const parent = referenceLi.parentElement;
  if (before) parent.insertBefore(dropIndicator, referenceLi);
  else parent.insertBefore(dropIndicator, referenceLi.nextSibling);
}

// Fully detaches the indicator rather than just hiding it, so it can never
// linger as a stray child for some later renderTasks call to have to
// reconcile around. Also drops the overruled styling so the NEXT time this
// shared element is shown it doesn't inherit a stale class from whichever
// gap was hovered last.
function hideDropIndicator() {
  dropIndicator.remove();
  dropIndicator.classList.remove("drop-indicator--overruled");
}

// Step 11 (D2): the middle-50%-of-the-row "reparent onto this task" zone
// marks the ROW ITSELF as the target, not an insertion point between two
// rows — a line indicator would be misleading there, since dropping doesn't
// insert next to this row, it becomes this row's child. Tracked the same way
// dropIndicator is (a single reference, moved rather than duplicated) so
// switching from one hovered row's middle zone to another's always clears
// the previous row's highlight instead of leaving it stuck once the pointer
// moves on. No refresh can land mid-drag (see the `drag` doc comment above),
// so the class survives untouched by updateTaskElement's own
// `li.className = ...` for the whole time it's shown.
let reparentHighlightLi = null;

function showReparentHighlight(li) {
  if (reparentHighlightLi === li) return; // already showing on this exact row
  hideReparentHighlight();
  li.classList.add("task-item--reparent-target");
  reparentHighlightLi = li;
}

function hideReparentHighlight() {
  if (!reparentHighlightLi) return;
  reparentHighlightLi.classList.remove("task-item--reparent-target");
  reparentHighlightLi = null;
}

function beginDrag(taskId, event, handleEl) {
  if (drag) return; // defensive: pointer capture below should make a second concurrent drag impossible
  const task = getTasks().find((t) => t.id === taskId);
  if (!task || task.deleted) return;

  const siblingTasks = getTasks().filter(
    (t) => !t.deleted && t.id !== taskId && t.parentId === task.parentId && t.inInbox === task.inInbox
  );

  // Step 16 (R3/R5): one Map<taskId, rank> for the whole drag, covering the
  // dragged task itself plus every sibling — never rebuilt per pointermove.
  // `otherSiblingIds` is now ordered by the same `(rank, order)` key
  // sortTasks/compareSiblings render the list by, so array-position
  // neighbour lookups in updateDragTarget below agree with what's actually
  // on screen.
  const rankMap = computeQuadrantRankMap([task, ...siblingTasks], getTagSettings());
  const otherSiblingIds = sortTasks(siblingTasks, rankMap).map((t) => t.id);
  const draggedRank = rankMap.get(taskId);

  // Step 11 (D4): snapshot the tree once for the whole drag. Full set —
  // deleted tasks included — see the `drag` doc comment above for why.
  const tree = buildTree(getTasks());
  const descendantIdSet = new Set(descendantIds(tree, taskId));
  const subtreeHeight = computeSubtreeHeight(tree, taskId);

  drag = {
    taskId,
    parentId: task.parentId,
    inInbox: task.inInbox,
    otherSiblingIds,
    rankMap,
    draggedRank,
    tree,
    descendantIdSet,
    subtreeHeight,
    target: null,
    handleEl,
    pointerId: event.pointerId,
  };

  dragInteractionOpen = true;
  beginInteraction(); // held for the drag's whole duration — keeps the 5-minute refresh off the DOM mid-gesture

  try {
    handleEl.setPointerCapture(event.pointerId);
  } catch {
    // Some synthetic/test environments don't implement pointer capture;
    // the drag still works via the delegated listeners below, just without
    // the guarantee that a fast pointer stays "captured" by the handle.
  }
}

// Live-drag wrapper around canReparent (taskTree.js): `drag.tree`/
// `subtreeHeight` are the beginDrag-time snapshot (see the `drag` doc
// comment for why recomputing per-move isn't needed). `hoveredId ===
// drag.taskId` is deliberately NOT re-checked here — updateDragTarget's
// caller already returns before this is ever reached for that case.
function isValidReparentTarget(hoveredId) {
  return canReparent(drag.tree, drag.taskId, hoveredId, drag.subtreeHeight);
}

// Step 16 (R5): is the sibling gap bounded by `beforeId`/`afterId` (either
// may be null — "top of the group" / "bottom of the group") one the dragged
// task can actually SETTLE at, or does it cross a quadrant-rank boundary?
//
// The list renders sorted by `(rank, order)` (render.js's compareSiblings),
// so after this drop's write, the dragged task's real neighbours will be
// whichever siblings are adjacent to it under THAT key — not necessarily the
// ones it was dropped between. Writing an `order` between two neighbours
// only produces the visually-dropped position when the dragged task's own
// rank is compatible with both of them: for the drop to actually land here,
// `beforeId`'s rank (if any) must be <= the dragged task's rank, AND the
// dragged task's rank must be <= `afterId`'s rank (if any) — i.e. the
// dragged rank has to fall in the closed range the two neighbours bound.
// A gap strictly INSIDE one rank's contiguous run has beforeRank === afterRank,
// so this only accepts a dragged task of that exact rank, as R5 requires
// ("free only within a contiguous run of same-rank siblings"). A gap
// sitting exactly AT a rank-transition boundary (beforeRank < afterRank)
// additionally accepts a dragged task whose rank equals EITHER bounding
// rank — that position is still the true edge of the dragged task's own
// run (its first or last slot), which is genuinely achievable, not merely
// "close enough."
function isSiblingGapFree(beforeId, afterId) {
  const beforeRank = beforeId != null ? drag.rankMap.get(beforeId) : null;
  const afterRank = afterId != null ? drag.rankMap.get(afterId) : null;
  return (
    (beforeRank == null || beforeRank <= drag.draggedRank) &&
    (afterRank == null || drag.draggedRank <= afterRank)
  );
}

// Re-evaluates the drop target on every pointermove. `document.elementFromPoint`
// (not `event.target`) is used deliberately: pointer capture means
// `event.target` stays pinned to the handle for the whole gesture, but what
// we need here is whatever row is actually under the cursor right now.
//
// Step 11 (D2): each hovered row is split into three vertical zones — top
// 25% ("before" this row, sibling-only), bottom 25% ("after" this row,
// sibling-only), middle 50% ("reparent onto" this row, valid for ANY live
// row that passes isValidReparentTarget, sibling or not).
function updateDragTarget(event) {
  const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY);
  // `li[data-task-id]` never matches the drop indicator itself (it carries no
  // such attribute), so hovering exactly over the thin indicator line falls
  // straight into the `!hoveredLi` branch below and is treated the same as
  // hovering empty space between rows.
  const hoveredLi = elementUnderPointer?.closest("li[data-task-id]");
  const hoveredId = hoveredLi?.dataset.taskId;

  if (!hoveredLi || hoveredId === drag.taskId) {
    // Nothing new to decide: not over a real row (including the indicator
    // itself), or over the dragged row's own (visually stationary — this app
    // never live-reorders the DOM mid-drag) element. Leave whatever
    // target/indicator already exists alone rather than flicker it invalid
    // on every small jitter of the pointer.
    return;
  }

  const rect = hoveredLi.getBoundingClientRect();
  const offsetY = event.clientY - rect.top;
  const zone = offsetY < rect.height * 0.25 ? "before" : offsetY > rect.height * 0.75 ? "after" : "middle";

  if (zone !== "middle" && drag.otherSiblingIds.includes(hoveredId)) {
    // Sibling before/after edge (step 10's original behavior, now confined to
    // the outer 25% bands instead of the whole row — see D2).
    const before = zone === "before";
    const idx = drag.otherSiblingIds.indexOf(hoveredId);
    const beforeId = before ? (idx > 0 ? drag.otherSiblingIds[idx - 1] : null) : hoveredId;
    const afterId = before ? hoveredId : (idx < drag.otherSiblingIds.length - 1 ? drag.otherSiblingIds[idx + 1] : null);

    // Step 16 (R5): still a valid, droppable target either way (a
    // priority-overruled gap is never REFUSED, only styled differently — see
    // the `drag` doc comment's target entry) — `overruled` just tells
    // showDropIndicator/finishDrag whether this exact gap crosses a
    // quadrant-rank boundary.
    const overruled = !isSiblingGapFree(beforeId, afterId);

    drag.target = { type: "sibling", beforeId, afterId, overruled };
    hideReparentHighlight();
    showDropIndicator(hoveredLi, before, overruled);
    return;
  }

  if (zone === "middle" && isValidReparentTarget(hoveredId)) {
    drag.target = { type: "reparent", parentId: hoveredId };
    hideDropIndicator();
    showReparentHighlight(hoveredLi);
    return;
  }

  // Neither a valid sibling edge (a non-sibling row's top/bottom 25%, per D2
  // — edges are sibling-only) nor a valid reparent target (D3's refusals). No
  // indicator of either kind, so the drag never "appears to work" over a spot
  // it can't actually land on.
  drag.target = null;
  hideDropIndicator();
  hideReparentHighlight();
}

// Computes the fractional-index `order` a task should get when dropped
// between `prevTask` and `nextTask` (either may be `null`, meaning "top of
// the group" / "bottom of the group" respectively) — step 10's plan, exactly:
//   top    -> min(siblingOrders) - 1000   (nextTask.order IS that minimum)
//   bottom -> max(siblingOrders) + 1000   (prevTask.order IS that maximum)
//   between -> the midpoint
// Returns `{ renumber: true }` instead of a value when the gap between
// `prevTask` and `nextTask` has been halved so many times by repeated
// midpoint math that it's fallen below ORDER_RENUMBER_EPSILON — silently
// writing a value indistinguishable from one of its neighbours would make
// their relative order non-deterministic from then on (see the constant's
// own comment above). The caller is the one who actually knows the rest of
// the sibling group and rewrites it; this function only ever looks at the
// two immediate neighbours; a single sibling group can never need a value
// this function alone could compute).
//
// Pure and side-effect-free, so — like compareTrashNewestFirst/
// selectPurgeCandidates above — it can be exercised directly against
// synthetic sibling values without a live Firestore connection. Exported for
// exactly that (verification-only, same precedent as store.js's
// getInteractionDepth).
export function computeReorderOrder(prevTask, nextTask) {
  if (prevTask == null && nextTask == null) return { renumber: false, order: 0 }; // only sibling in the group
  if (prevTask == null) return { renumber: false, order: nextTask.order - 1000 }; // top
  if (nextTask == null) return { renumber: false, order: prevTask.order + 1000 }; // bottom
  if (nextTask.order - prevTask.order < ORDER_RENUMBER_EPSILON) return { renumber: true };
  return { renumber: false, order: (prevTask.order + nextTask.order) / 2 };
}

// Step 11 (D1): the shared reparent handler both the drag-drop reparent
// target AND the "Move to top level" menu item (D9) route through — there is
// no parallel implementation of either. `newParentId === null` means "move
// to root" (D9's promote-to-root case, which drag can't express — there is
// no row to drop onto for "no parent"); otherwise it's a drop onto another
// task's row. Every refusal rule the drag's own `isValidReparentTarget`
// already checked live gets re-checked here against a FRESH tree at write
// time, not the drag-time snapshot — the same "never trust the click-time
// copy" rule every mutation in this app follows (see enqueueMutation's own
// comment in store.js): something else could have changed the tree in the
// time it took this mutation to reach the front of the queue.
async function performReparent(taskId, newParentId) {
  await enqueueMutation(async () => {
    const userId = getCurrentUserId();
    const currentTask = getTasks().find((t) => t.id === taskId);
    // True no-ops (issue 5): the dragged task itself is gone, or the user
    // signed out mid-drag. There is no drop left to overrule — the object of
    // the action vanished, not a still-valid drop that got refused — so this
    // stays silent, same as every other stale-data race in this app.
    if (!userId || !currentTask || currentTask.deleted) return;

    // Full set, deleted included — same reasoning as the drag-time snapshot
    // (see the `drag` doc comment above beginDrag).
    const freshTree = buildTree(getTasks());
    const newParentTask = newParentId != null ? freshTree.byId.get(newParentId) : null;

    // Issue 5: product-spec.md's "make an overruled action visible rather
    // than letting it appear to work and then snap back" applies to every
    // refusal below that follows a drop the user actually completed — only a
    // genuine no-op (nothing was overruled) stays silent. Each explained
    // refusal gets its own short, specific message and a refresh, rather
    // than being collapsed into one generic string.
    if (newParentId != null) {
      if (!newParentTask || newParentTask.deleted) {
        // The drop target itself vanished (deleted, or purged from the
        // trash) between the drag starting and this write actually running —
        // a real refusal of a completed drop, not a no-op.
        alert("That task no longer exists. The list has been refreshed.");
        await refreshTasks();
        return;
      }
      if (currentTask.parentId === newParentId) return; // true no-op — already the parent, nothing to explain

      // D9's "move to root" (newParentId === null) has no hovered row for
      // canReparent to validate against, so it skips straight to the no-op
      // check below instead; every other refusal in D3 (self/cycle, depth
      // cap) is exactly what canReparent re-checks here, against this fresh
      // tree instead of the drag-time one.
      const subtreeHeight = computeSubtreeHeight(freshTree, taskId);
      if (!canReparent(freshTree, taskId, newParentId, subtreeHeight)) {
        if (depthOf(freshTree, newParentId) + 1 + subtreeHeight > 6) {
          alert("That would put a task too deep — subtasks can't go further than 7 levels.");
        } else {
          // The remaining canReparent refusals once no-op/missing-target/
          // depth-cap are already handled above: dropping onto self or onto
          // one of its own descendants — both would cut the tree into a
          // cycle. Reachable only via a concurrent structural change between
          // the drag's own hover validation and this write-time re-check.
          alert("That move isn't allowed — it would create a cycle in the task hierarchy.");
        }
        await refreshTasks();
        return;
      }
    } else if (currentTask.parentId === null) {
      return; // D9: already at the root — true no-op, nothing was overruled
    }

    const descendantsFull = descendantIds(freshTree, taskId);

    // D5/D6: the dragged task's new ancestors, and the inInbox the whole
    // moved subtree now follows. A move to root (newParentTask null) leaves
    // inInbox exactly as it was (D9) — there's no new parent to inherit from.
    // Issue 4 fix: derived from `freshTree`/`parentId` via `ancestorChain` —
    // NOT from `newParentTask.ancestors`, the cached field. See
    // rewriteDescendantAncestors's own comment in taskTree.js for the full
    // reasoning; this is the identical fix applied to the dragged task's own
    // write.
    const newAncestors = newParentTask ? [...ancestorChain(freshTree, newParentTask.id), newParentTask.id] : [];
    const newInInbox = newParentTask ? newParentTask.inInbox : currentTask.inInbox;

    // D7: top of the new parent's (or the root group's) live children —
    // computed as a true minimum over the siblings' STORED `order`, the same
    // formula and the same idiom as task creation (taskService.js:51).
    //
    // Deliberately NOT `sortTasks(newSiblings)[0]`. Since step 16 that first
    // element is the highest-*ranked* sibling, and its rank says nothing
    // about its `order`, so `[0].order - 1000` can still sit above a sibling
    // holding a much smaller stored value. `order` is only ever this task's
    // tie-break *within* whichever rank it resolves to, and this function
    // cannot know that rank's membership — so the only value that places it
    // first in every tier it might land in is one below the whole group's
    // minimum. Sorting for display and picking a minimum are different
    // questions; this one wants the minimum.
    const newSiblings = getTasks().filter((t) => !t.deleted && t.id !== taskId && t.parentId === newParentId);
    const newSiblingOrders = newSiblings.map((t) => t.order);
    const newOrder = newSiblingOrders.length > 0 ? Math.min(...newSiblingOrders) - 1000 : 0;

    // Issue 7 fix: snapshotted ONCE before the loop, matching step 5/6/8's
    // established idiom (`currentById`/`currentParent`) — nothing else can
    // change these tasks mid-loop (the mutation queue serializes against
    // every other enqueued mutation), so re-reading getTasks().find() per
    // iteration was an O(n) rescan for no benefit, and silently diverged from
    // this function's own comment claiming to mirror step 8 exactly.
    const currentById = new Map(getTasks().map((t) => [t.id, t]));

    try {
      // D8: the dragged task first, then its descendants — mirrors step 8's
      // cascade-delete write order exactly, one whole-document write each.
      await saveTask(userId, {
        ...currentTask,
        parentId: newParentId,
        ancestors: newAncestors,
        inInbox: newInInbox,
        order: newOrder,
      });

      for (const id of descendantsFull) {
        const current = currentById.get(id);
        if (!current) continue; // gone by the time this write's turn came up
        // D5, rewritten for issue 4: replace the dragged task's OLD ancestor
        // prefix with its NEW one, deriving the descendant's tail from
        // `freshTree`/`parentId` (rewriteDescendantAncestors), never from
        // this descendant's own possibly-stale cached `ancestors`. parentId/
        // order are untouched — only inInbox also follows (D6).
        await saveTask(userId, {
          ...current,
          ancestors: rewriteDescendantAncestors(freshTree, newAncestors, taskId, id),
          inInbox: newInInbox,
        });
      }
    } catch (error) {
      console.error("Failed to move task:", error);
      alert("Could not move the task. The list has been refreshed to show what actually saved.");
    } finally {
      await refreshTasks();
    }
  });
}

function finishDrag() {
  const { taskId, parentId, target } = drag;
  hideDropIndicator();
  hideReparentHighlight();
  try {
    drag.handleEl.releasePointerCapture(drag.pointerId);
  } catch {
    // Already released, or never supported — nothing left to clean up either way.
  }
  drag = null;
  closeDragInteraction();

  if (!target) return; // no valid hover was ever registered — a no-op, never a "snap back"

  // D1: finishDrag branches on target.type. The reparent branch routes
  // through the exact same performReparent the "Move to top level" menu item
  // uses (D9) — no parallel implementation.
  if (target.type === "reparent") {
    performReparent(taskId, target.parentId);
    return;
  }

  const { beforeId, afterId, overruled } = target;

  enqueueMutation(async () => {
    const userId = getCurrentUserId();
    const currentTask = getTasks().find((t) => t.id === taskId);
    if (!userId || !currentTask || currentTask.deleted) return; // abandon cleanly — task is gone or user signed out

    // Re-derive the sibling group fresh at write time, not from the
    // drag-time snapshot — the same architecture rule every mutation in this
    // app follows (see enqueueMutation's own comment in store.js). `beforeId`
    // /`afterId` are looked up by identity, not by their original array
    // index, so this still lands correctly even if something elsewhere
    // shifted the group's exact order values in the meantime. Step 16:
    // `sortTasks` needs a rank Map now — built fresh here, once, not
    // recomputed per comparison.
    const currentSiblingsRaw = getTasks().filter(
      (t) => !t.deleted && t.id !== taskId && t.parentId === parentId && t.inInbox === currentTask.inInbox
    );
    const currentSiblingsRankMap = computeQuadrantRankMap(currentSiblingsRaw, getTagSettings());
    const currentSiblings = sortTasks(currentSiblingsRaw, currentSiblingsRankMap);
    const prevTask = beforeId ? currentSiblings.find((t) => t.id === beforeId) ?? null : null;
    const nextTask = afterId ? currentSiblings.find((t) => t.id === afterId) ?? null : null;

    try {
      const plan = computeReorderOrder(prevTask, nextTask);
      if (plan.renumber) {
        // Precision guard (step 10's plan): renumber the WHOLE sibling group
        // with evenly spaced values, including the dragged task at its
        // intended new slot, all inside this one queued mutation — the one
        // documented exception to "one document write per reorder".
        const finalOrder = [...currentSiblings];
        const insertAt = prevTask ? finalOrder.findIndex((t) => t.id === prevTask.id) + 1 : 0;
        finalOrder.splice(insertAt, 0, currentTask);
        for (let i = 0; i < finalOrder.length; i++) {
          await saveTask(userId, { ...finalOrder[i], order: (i + 1) * 1000 });
        }
      } else {
        await saveTask(userId, { ...currentTask, order: plan.order });
      }

      // Step 16 (R5): the write above ALWAYS lands, whether or not this drop
      // crossed a quadrant-rank boundary (`overruled`, captured at hover time
      // in updateDragTarget — see the `drag` doc comment's target entry) —
      // manual order is never discarded, per the orchestrator's explicit
      // instruction. What the spec forbids is a SILENT snap-back, so a drop
      // that will not visually hold gets a message naming the quadrant whose
      // priority overruled it — the dragged task's OWN resolved quadrant,
      // since that's what actually governs where it settles regardless of
      // which side of the boundary the drop crossed.
      if (overruled) {
        const quadrant = resolveTaskQuadrant(currentTask.title, getTagSettings());
        const quadrantLabel = quadrant ? describeQuadrant(quadrant) : "unranked (no quadrant tag)";
        alert(
          `Priority order overruled this drop: this task is in the "${quadrantLabel}" quadrant, so it will settle among that group instead of the position you dropped it at. Your manual order was still saved, and takes effect the moment the tag mapping puts it in that same quadrant.`
        );
      }
    } catch (error) {
      console.error("Failed to reorder task:", error);
      alert("Could not save the new order. The list has been refreshed to show what actually saved.");
    } finally {
      await refreshTasks();
    }
  });
}

// Escape mid-drag, or an aborted gesture (pointercancel/pointerleave/sign-out)
// cancels with NO write — product-spec.md's "the interface should make [an
// overruled drag] visible rather than letting a drag appear to work and then
// snap back" applies just as much to an abandoned one.
function cancelDrag() {
  if (!drag) return;
  hideDropIndicator();
  hideReparentHighlight();
  try {
    drag.handleEl.releasePointerCapture(drag.pointerId);
  } catch {
    // Already released, or never supported.
  }
  drag = null;
  closeDragInteraction();
}

taskSection.addEventListener("pointerdown", (event) => {
  // button 0 is the primary button (left mouse, or any touch/pen contact).
  // A right-click's own pointerdown reports button 2 and is already handled
  // by the contextmenu listener above — starting a long-press timer for it
  // too would just race the two gestures against the same row.
  if (event.button !== 0) return;
  const li = event.target.closest("li");
  // Same step-14 reason as the contextmenu listener above: a Tag Settings row
  // is an <li> with no task id, and neither gesture this handler starts (drag,
  // long-press menu) means anything for one.
  if (!li?.dataset.taskId) return;

  // Step 10: a pointerdown on the drag handle starts a drag instead of the
  // long-press timer, full stop — it never even schedules one, which is
  // exactly what "cancel/suppress the long-press timer" (this step's plan)
  // needs: a slow drag start can now never also pop the context menu open
  // mid-drag, because there is no timer running to do it.
  const handle = event.target.closest(".task-item__drag-handle");
  if (handle) {
    beginDrag(li.dataset.taskId, event, handle);
    return;
  }

  const taskId = li.dataset.taskId;
  // Captured now, not re-derived from `li` inside the timer below — same
  // reasoning as capturing `taskId` itself as a plain string rather than
  // holding onto the DOM node for the whole ~500ms window.
  const longPressContext = contextForRow(li);
  longPressStart = { x: event.clientX, y: event.clientY };
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    longPressOpenedMenu = true; // consumed by pointerup below, not suppressed here
    openTaskMenuForTask(taskId, longPressStart.x, longPressStart.y, longPressContext);
    longPressStart = null;
  }, LONG_PRESS_MS);
});

// The ghost click that follows a long press comes right after THIS event,
// however long the hold actually was — so this is where suppression has to
// be armed, not back when the timer fired. Only consumed once: a plain short
// click's pointerup never set the flag, so it falls straight through to
// `cancelLongPress()` with nothing suppressed, exactly as before.
taskSection.addEventListener("pointerup", () => {
  if (drag) {
    finishDrag();
    return;
  }
  if (longPressOpenedMenu) {
    longPressOpenedMenu = false;
    armClickSuppression();
  }
  cancelLongPress();
});
// A cancelled or abandoned gesture must not leave a stale flag around to
// wrongly suppress some later, unrelated click — pointerup is not guaranteed
// to be the event that follows once the pointer has left the section or the
// gesture was taken over by something else. Same reasoning extends to a
// drag: an interrupted gesture must not leave the interaction guard open or
// the indicator lingering, exactly what cancelDrag exists for.
taskSection.addEventListener("pointercancel", () => {
  longPressOpenedMenu = false;
  cancelLongPress();
  cancelDrag();
});
taskSection.addEventListener("pointerleave", () => {
  longPressOpenedMenu = false;
  cancelLongPress();
  cancelDrag();
});
taskSection.addEventListener("pointermove", (event) => {
  if (drag) {
    updateDragTarget(event);
    return;
  }
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
  // Step 13: which of the task's up-to-three rows the menu was opened FOR —
  // read before closeTaskMenu() clears it, same as `taskId` above.
  const context = taskMenu.dataset.context || "main";
  const action = button.dataset.action;
  closeTaskMenu();
  if (!taskId) return;

  if (action === "add-subtask") await handleAddSubtaskClick(taskId);
  else if (action === "move-out") await handleMoveOutOfInboxClick(taskId);
  else if (action === "move-to-top") await performReparent(taskId, null);
  else if (action === "toggle-pin") await handleTogglePinClick(taskId);
  else if (action === "edit-due-date") handleEditDueDateMenuClick(taskId, context);
  else if (action === "clear-due-date") await handleClearDueDateClick(taskId);
  else if (action === "set-recurrence") await handleSetRecurrenceClick(taskId);
  else if (action === "delete") await handleDeleteClick(taskId);
});

// Escape closes the menu from anywhere in the document, not just while an
// edit input has focus (the menu itself holds no focus — its buttons are
// clicked, not tabbed through, in the primary flows this step verifies).
// Step 10: Escape during a drag takes priority and cancels it with no write
// (see cancelDrag) — a drag and the task menu can never both be open at once
// (the drag handle's pointerdown never arms the long-press timer that would
// open the menu), but checking drag first keeps that assumption explicit
// rather than relying on it silently.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (drag) {
    cancelDrag();
    return;
  }
  if (menuOpen) closeTaskMenu();
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

// 6b. Step 19 (Search — basic, S19-7): every keystroke re-renders through the
// exact same pipeline "Show completed" above already uses — a pure filter
// over an already-fetched, keyed-rendered list (renderTasks/entriesByTaskId)
// is cheap enough per keystroke that a debounce would trade away
// responsiveness for a performance problem that doesn't exist here.
// Escape-to-clear (S19-8) is handled by the shared keydown listener at 5c
// instead of here, alongside the title/note/due-date inputs' own Escape
// handling.
searchInput.addEventListener("input", () => {
  views.main();
});

// S19-8: Escape clears the box and re-renders. A separate small listener
// rather than a branch inside 5c's keydown handler above — that handler's
// whole job is cancelling an in-progress PER-ROW edit (dataset.cancelling,
// then a focusout commit/cancel), and the search box has no such lifecycle
// at all (no `beginInteraction()`, no `openEdits` entry — it's a standing
// toolbar control, not something that opens and closes per row).
searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  searchInput.value = "";
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
    // Step 17 (S17-1): the undo snapshot is in-memory only and scoped to one
    // session's tag operation — a different account signing in on the same
    // page must never see an "Undo" offering to rewrite ITS tasks with the
    // PREVIOUS account's title snapshot.
    tagUndoSnapshot = null;
    // Step 19 (S19-8): search state is UI-only and never persisted — the
    // same reasoning as tagUndoSnapshot above applies here too, a different
    // account signing in on the same page must never land on a search box
    // still holding the PREVIOUS account's query.
    searchInput.value = "";
    closeTaskMenu(); // a menu open for one account's task means nothing once signed out
    cancelDrag(); // ditto for a drag in progress — see step 10's cancelDrag
    statusText.textContent = "Please sign in to access your task manager.";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    taskSection.style.display = "none";
    switchView("main"); // reset the panel so the next sign-in doesn't land on Trash
  }
});
