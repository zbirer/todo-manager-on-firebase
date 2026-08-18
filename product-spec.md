# Product Functional Specification: Todo Manager

This specification guides development of the Todo Manager.

## 1. Overview

The Todo Manager is a responsive web application optimized for both desktop and
mobile browsers. It enables users to capture ideas quickly, organize tasks
hierarchically, apply custom color-coded tags, and perform advanced search
queries.

**Language and text direction.** The interface itself is in **English**, while task
content is written in **Hebrew** and tags are written in **English**. Every task
title is therefore a mixed-direction string: right-to-left Hebrew with
left-to-right English tags embedded in it. This is a normal case here, not an edge
case, and the app must render such titles correctly — including in the list, in
search results, and while editing inline. Anywhere the spec refers to the order of
tags within a title, it means the **order of the characters in the string** (the
order they were typed), never their left-to-right position on screen; in a Hebrew
title those two are not the same.

## 2. User Authentication & Security

- **Google Sign-In:** As a user, I can securely log in using my Google account.
- **Private Persistence:** All my todo items, configurations, and custom rules are
  saved persistently and privately to my user profile so I can access them
  seamlessly on mobile or laptop.
- **Refresh-Based Sync:** Changes made on one device reach another **on refresh**,
  not live — there is no real-time push, and a device does not update itself the
  instant something changes elsewhere. The app refreshes **automatically every 5
  minutes**, so a second device converges on its own within that window without me
  reloading the page by hand.
- **Conflicting Edits — Last Write Wins:** Two devices can edit the same task
  inside that 5-minute window without either knowing. When they do, **the most
  recent write is kept** and the earlier one is discarded. There is no merge and no
  conflict prompt. This resolves at the level of the **whole task**, not the
  individual field: if one device changes the title and another changes the note,
  the later write replaces the task entirely and the other change is lost, even
  though the two edits touched different things.
- **Online Only:** The app requires a connection. There is **no offline mode** —
  tasks cannot be captured without network and queued for later sync.

## 3. Task Management & Structure

- **Hierarchical Tasks:** I can create sub-tasks (e.g., Project > Task > Sub-task)
  to break down complex goals, nested **up to 7 levels deep**. The limit exists so
  the tree stays readable on a narrow phone screen, where indentation runs out of
  room long before the structure does.
- **Completion State:** I can mark any task or sub-task as completed. Completion
  **cascades down**: completing a parent marks every task beneath it complete as
  well, at every level. Completed tasks are hidden from the list by default, with a
  "show completed" toggle to bring them back into view.
- **Task Notes:** A task carries exactly two pieces of text: a **title**, which is
  required and holds the tags, and an optional **note** (its comment) — free text
  for details, context, or links that do not belong in the title. A note can be
  added, edited, and removed at any time, and is available on every task in the
  hierarchy — parent tasks and sub-tasks alike. Tags are never written in the note;
  they live in the title only. A note is plain text with **basic formatting**, and
  any URL in it becomes a **clickable link** on its own — so pasting a reference
  into a note is enough to make it usable later, with no markup to remember.
- **Editing, Moving, Deleting:** Every task stays fully editable after creation.
  - **Edit** by clicking the title or the note directly and typing — editing is
    inline, with no separate edit screen or mode. Editing the title is also how
    tags are added and removed, since tags live in the title text.
  - **Move** by dragging the task onto a new parent. A task carries its whole
    sub-tree with it. Dragging also sets the order within a level (see **List
    Order** below), so one gesture serves both re-parenting and re-ordering.
    Dragging is not the only way: the task menu offers a move command too, so
    the whole hierarchy stays reachable on a touch screen without a precise
    drag.
  - **The task menu** is the same on both platforms and holds the full set of
    per-task commands. It opens three ways: a **long press** on a task on
    mobile, a **right-click** on desktop, and a hover-revealed **⋯ button** on
    the row's left edge — the discoverable entry point on both, since long
    press and right-click are easy to miss without being told about them.
    All three open the identical menu; none is more capable than the others,
    and no command lives only as a permanent on-row button.
  - **Delete** from the task menu. Deleting a parent **deletes its entire
    sub-tree** — children are never promoted up a level and never left orphaned.
    Because this can remove far more than the one task I clicked, it is confirmed
    before it happens.
  - **Duplicate**, from the task menu, copies a single task — its title, note,
    and due date — into a new task placed immediately **below the original**,
    as its next sibling. Children are not copied: a duplicated parent's
    sub-tree stays with the original, since giving every descendant a new
    identity while preserving the tree shape is a bigger feature than "make a
    copy of this one task," and is left for later. Tags are recomputed from
    the copied title rather than carried over verbatim, and the duplicate
    otherwise starts clean — unpinned, not completed, with no recurrence and
    no completed-occurrence history, since two tasks cannot share one
    recurring identity.
  - **Indent inside** and **Indent outside**, from the task menu, reparent a
    task one level without a drag. Indent inside makes the task the **last
    child of the sibling immediately above it in the order the list is
    currently showing** — priority rank first, my own manual order as
    tie-breaker (see **List Order** below) — not the order the siblings were
    created in, since a higher-priority sibling can visually sit between two
    lower ones. Indent outside moves the task up one level, placing it
    **immediately after its former parent** among that parent's own siblings.
    Neither touches anything else in the tree: indent outside does not pull
    the task's younger siblings along as new children of it — they simply
    stay where they were, still under the original parent — and both commands
    respect the same 7-level depth limit as every other move.
- **Trash:** Deletion is not final. Deleted tasks go to a **trash**, where I can
  find and restore them — a restored parent comes back with the sub-tree it was
  deleted with, since that is what was removed in one act. The trash holds the
  **50 most recently deleted tasks**; beyond that, the oldest fall out and are gone
  for good. The bound is a count, not a time limit, so a rarely used trash keeps its
  contents indefinitely. Tasks are counted **individually**, not per deletion — so
  deleting a parent with eleven descendants consumes twelve of the fifty slots, and
  one large deletion can push most of the earlier history out of the trash.
  - **Un-complete** by clicking the same "done" checkbox again, which returns the
    task to its open state. Un-completing a parent re-opens **everything the
    cascade closed** — but a task that had already been completed on its own,
    before the parent was ticked, stays completed. The cascade therefore has to
    remember which descendants it closed, so that undoing it restores exactly the
    state that preceded it rather than blanket-re-opening the sub-tree.
- **List Order:** The main list is ordered by the **recommended order** the
  Eisenhower matrix produces (§7) — the app sorts it, so the most demanding work
  rises to the top on its own. **Manual dragging is the tie-breaker:** among tasks
  the matrix ranks equally, the order is mine to set and is respected exactly.
  A newly created task is added **at the top** of its group, so a fresh capture is
  immediately visible rather than buried at the bottom.

  The consequence to design around: a drag can be overruled. Dragging a low-priority
  task above a high-priority one will not hold, because priority is applied first.
  Ordering is only ever free **within** a priority level, and the interface should
  make that visible rather than letting a drag appear to work and then snap back.

## 4. Tagging & Dynamic Styling

- **Dual Tagging:** I can tag items using `#` for categories/priorities
  (e.g., `#private`, `#work`, `#p1`) and `@` for locations/contexts
  (e.g., `@home`, `@office`). Tags are written **inline in the task title** — there
  is no separate tag field, and the note never carries tags.
- **Visual Color Coding:** I can assign custom foreground and background colors to
  specific tags, on the **same tag settings page** that assigns matrix quadrants
  (§7) — one screen owns everything about a tag, so I never hunt for where a tag is
  configured. Applying a tag automatically colors the task; if multiple tags are
  applied, the **last tag in the title text** forces the color — last meaning last
  in the string as typed, which in a Hebrew title is the tag furthest to the *left*
  on screen (§1). Because tags are part of the title, re-typing the title to
  reorder them changes the color, which keeps the rule predictable: what wins is
  what I typed last.

## 5. Dates & Temporal Tracking

- **Task Dates:** I can assign a specific due date to any task.
- **Task Age:** The system automatically tracks the creation date to calculate task
  age (e.g., "task is 20 days old").
- **Recurring Tasks:** I can make a task repeat, so work that comes back on a cycle
  does not have to be re-typed each time. **I define the cycle myself**, choosing
  one of:
  - **Daily** — every day.
  - **Days of the week** — I pick which days (e.g. Sunday and Wednesday).
  - **Weekly from a chosen date** — repeating every week, anchored to a date I set.
  - **Monthly** — every month.

  Completing a recurring task **advances its due date** to the next occurrence
  rather than creating a new task. There is one task that keeps moving forward, not
  a growing series of instances — so no history of past occurrences is kept, and
  nothing accumulates in the list. Its **age is measured from the current
  occurrence**, which resets each time the date advances: a daily task never reports
  itself as months old, and `age > 20d` stays a meaningful question about neglect.

  A recurrence is stopped by **deleting the task** — from the task menu, reached by
  long press or right-click (§3). Since a recurring task is a single task that keeps
  moving forward, deleting it is what ends the cycle; there is no separate "stop
  repeating" state that leaves an inert task behind. Like any deletion, it lands in
  the trash and can be restored.
- **Overdue Alerts Screen:** A dedicated alerts screen collects tasks whose due date
  has passed, so overdue work is gathered in one place instead of being something I
  have to go looking for across the tree. The alerts live **inside the app**; the
  app does not send push notifications or email. They appear in the **same order the
  tasks hold in the main list**, so the priority ordering I already know carries over
  and the screen introduces no second ranking to learn.

## 6. Advanced Querying & Filtering

- **Boolean Search:** I can filter my list of tasks using logic statements with
  `AND`, `OR`, and parentheses. (Example: `#(private OR #pr) AND @office`).
  The parser **accepts both sigil styles**, including mixed within one query:
  a sigil may be repeated per term (`(#private OR #pr)`) or written once so that it
  distributes across the whole group (`#(private OR pr)`). A term inside a
  sigil-prefixed group that carries its own sigil keeps its own — so the example
  above reads as "`#private` or `#pr`, and `@office`".
- **Search Scope:** A search term matches **both tags and free text** — the tags in
  the title, the rest of the title, and the note. A bare word finds tasks that
  mention it anywhere; a `#` or `@` term restricts the match to tags.
- **Hierarchy in Results:** When a sub-task matches but its parent does not, **the
  parent is still shown**, as context for the match. Results keep the shape of the
  tree rather than collapsing into a flat list, so I can always see where a
  matching task actually lives.
- **Completed Tasks in Results:** Completed tasks stay **hidden by default**, in
  search exactly as in the normal list, with the same option to show them.
- **Date & Age Filters:** I can dynamically filter tasks by temporal states
  (e.g., `today`, `this week`, `this month`, `age > 20d`). Date filters read the
  **due date**: `today` is a task due today, and `this week` is a task due within
  the current **calendar** week — not a rolling seven days. Age filters read the
  **creation date** instead, which is what makes `age > 20d` a question about how
  long a task has survived rather than about when it is owed. All of these resolve
  in my **local time zone**, so "today" means my today.
- **Overdue:** `overdue` matches any task whose due date has already passed. It is
  an ordinary term in the query language, not a separate screen or toggle, so it
  composes with everything else — `#p1 AND overdue` is a valid query.
- **Comparison Operators & Units:** Age comparisons support both directions,
  **greater-than and less-than**, in **days** and **months** — `age > 20d` finds
  what has been sitting too long, `age < 3m` narrows to what is still recent.
- **Week Start Day:** Because "calendar week" has no universal meaning, the first
  day of the week is a **setting**: Sunday or Monday, defaulting to **Sunday**.
  Every `this week` filter reads that setting.
- **Compound Search:** I can combine tags and temporal filters
  (Example: `#galit AND age > 20d`).

## 7. Productivity & Prioritization

- **Focus Section:** I can pin tasks to a "Focus" section to keep what matters in
  front of me. There is **no cap** on how many tasks I pin — pinning and unpinning
  is entirely my call, and the app never blocks a pin or silently drops one.
  Pinned tasks appear in the **same order they hold in the main list**, so Focus
  carries no ordering of its own to maintain. A pinned task that I complete
  **disappears from Focus**, which keeps the section a list of what is left to do
  rather than a record of what was.
- **Auto-Eisenhower Matrix:** The app places tasks on the urgency/importance matrix
  by reading the **tags I write myself** — `#p1`, `@home`, and so on. The tag
  vocabulary is **open**: I can invent new tags at any time, and a tag that did not
  exist yesterday must be usable today without any code change.
- **Resolving Several Tags:** When a task carries more than one mapped tag, the
  **most important and most urgent** reading wins. Urgency and importance are
  resolved independently, each taking the highest value any of the task's tags
  claims — so a task tagged both `#p1` (important, not urgent) and `#deadline`
  (urgent, not important) lands in the urgent-and-important quadrant, even though
  no single tag put it there. Prioritization escalates rather than averages: a task
  is treated as seriously as its most demanding tag.
- **Recommended Order:** The matrix surfaces as a **recommended order** — a
  suggested sequence of what to do next — not as a four-quadrant board. This order
  **drives the main list itself** (§3, *List Order*): the list I work from is
  already sorted by it, so the next thing to do is simply the thing at the top, with
  nothing to open and no second view to consult. My own drag order survives as the
  tie-breaker among equally ranked tasks.
- **Tag Settings Page:** A settings screen lists my tags and lets me assign a
  quadrant to each one — and it is the same screen that sets each tag's colors
  (§4). A tag with **no quadrant assigned is simply not part of the
  matrix** — it is still a perfectly good tag for coloring and for search, it just
  contributes nothing to prioritization. Nothing is ever guessed on my behalf: an
  unconfigured tag stays silent rather than defaulting into a quadrant.
- **Renaming & Deleting Tags Propagates:** Renaming a tag on the settings page
  updates it **in every task that uses it**, and deleting a tag removes it from
  every task that carries it. Because tags live inside task titles, this rewrites
  those titles — the settings page is not a separate registry that can drift out of
  step with the tasks, and there is never a stale tag left pointing at a definition
  that no longer exists. Because one click here rewrites text across many tasks,
  the change is **confirmed before it runs and can be undone afterwards**: a rename
  or deletion that turns out to be wrong is reversible in full, rather than leaving
  me to repair every affected title by hand.

## 8. Data Portability

- **Export:** I can export my data to a **JSON file** — tasks with their hierarchy,
  notes, tags, dates and completion state, along with my settings. The export is a
  file I hold myself, so my data is never trapped in the app.
- **Import:** I can load a JSON file back in, which is what makes the export a real
  backup rather than a read-only snapshot.
