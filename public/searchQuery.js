// Search — basic (step 19). Pure functions only: no DOM, no Firestore, same
// standing as taskTree.js and tagColors.js. This module exists so app.js's
// renderMainView can filter the tree without owning any matching logic
// itself, and — the whole reason this is its own file rather than a few
// lines inlined into render.js — so step 20 (Search — advanced) can hang a
// boolean AND/OR/parentheses grammar over `matchesTerm` without touching
// this file's callers at all. Nothing here parses `AND`/`OR`, parentheses,
// or any temporal term (`today`, `age > 20d`, `overdue`, ...) — that is
// entirely step 20's grammar (product-spec.md §6:159-165, :175-187); step 19
// is only ever "split the box on whitespace, every term must match"
// (product-spec.md §6:166-168, S19-2/S19-3).

import { buildTree, ancestorChain } from "./taskTree.js";

// A tag term is a bare `#`/`@` sigil immediately followed by word
// characters and NOTHING else — this is deliberately the same shape
// tagColors.js's own TAG_PATTERN recognizes inside a title (`[#@]\w+`),
// anchored start-to-end here because a whole search TERM (not a substring
// of one) is being classified, not scanned out of running text.
const TAG_TERM_PATTERN = /^[#@]\w+$/;

// S19-2 — the one leaf evaluator both step 19 and step 20 use. Standalone
// and pure on purpose: step 20 hangs a boolean AST over this EXACT function,
// so nothing about matching a single term may ever move into render.js or
// app.js, and nothing here may assume anything about how many terms a query
// has or how they're combined.
//
// - A bare word (anything that isn't `#foo`/`@foo`) is a case-insensitive
//   substring match over `title + "\n" + note` (spec:166-168's "the tags in
//   the title, the rest of the title, and the note" in one pass — a tag
//   token is literally already sitting inside the title string, so scanning
//   the title covers it without a second pass over `task.tags`; consulting
//   `task.tags` too would only double-count, never change the outcome).
// - A `#foo`/`@foo` term restricts the match to tags (spec:168), as WHOLE-
//   TOKEN case-insensitive equality against `task.tags` — whole-token
//   because a prefix match would conflate `#pr` with `#private` (spec's own
//   example treats them as two distinct tags; step 17's rewriteTagInTitle
//   guards the identical hazard for renames). Case-insensitive here only:
//   search is a convenience, so `#Work` finds `#work`, but tag IDENTITY
//   stays case-sensitive everywhere else in the app — `#Work` and `#work`
//   remain two separate entries on the Tag Settings screen.
export function matchesTerm(task, term) {
  if (!term) return true; // defensive — matchingTaskIds below never actually passes an empty term

  if (TAG_TERM_PATTERN.test(term)) {
    const lowerTerm = term.toLowerCase();
    return (task.tags || []).some((tag) => tag.toLowerCase() === lowerTerm);
  }

  const haystack = `${task.title || ""}\n${task.note || ""}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

// S19-3 — whitespace is an implicit AND: `foo bar` is two terms, both of
// which must match (not a literal substring search for `"foo bar"`). A
// blank/whitespace-only query splits to zero terms, and "every term in an
// empty list matches" is vacuously true for every task — so an empty search
// box returns every task's id, which is exactly "search is off" with no
// separate active/inactive flag anywhere in this module or its caller.
// Quoted-phrase search is deliberately NOT implemented in either step 19 or
// step 20 — there is no `"..."` handling here, and none should be added
// without a new product-spec.md decision.
export function matchingTaskIds(rawQuery, tasks) {
  const terms = String(rawQuery ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const matches = new Set();
  for (const task of tasks) {
    if (terms.every((term) => matchesTerm(task, term))) matches.add(task.id);
  }
  return matches;
}

// S19-4 — the visible-id set for search is matches UNION ancestors-of-
// matches (spec:169-172: "the parent is still shown, as context... results
// keep the shape of the tree"), computed via taskTree.js's own
// buildTree/ancestorChain rather than a second, independent tree walk here.
// `tasks` must be the same set the caller will build its render tree from
// (renderMainView's `nonDeletedTasks`) so a matched task's ancestor chain
// agrees with what will actually render — building this module's tree from
// a differently-filtered list could surface an ancestor id that doesn't
// exist in the tree the caller ends up rendering.
//
// Descendants of a match are deliberately NOT added here — the spec grants
// context upward (toward the root) only. A matching parent pulling its
// whole subtree back in would defeat the filter: every leaf under a
// one-word-matching top-level task would reappear regardless of whether it
// itself matches anything. Record the asymmetry explicitly, since matching
// only-upward reads as a bug to anyone who hasn't read this comment.
export function expandMatchesWithAncestors(tasks, matchIds) {
  const tree = buildTree(tasks);
  const visibleIds = new Set(matchIds);
  for (const id of matchIds) {
    for (const ancestorId of ancestorChain(tree, id)) {
      visibleIds.add(ancestorId);
    }
  }
  return visibleIds;
}
