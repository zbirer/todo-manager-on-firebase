// Pure functions for turning the flat `tasks[]` array into a hierarchy and
// answering questions about it. No DOM, no Firestore — this module is safe
// to unit-test in isolation and safe to call from anywhere (render, drag
// logic, the future Eisenhower sort). Nothing renders the hierarchy yet
// (that lands in step 4); this exists now because every later step that
// touches hierarchy builds on `buildTree`'s shape.
//
// Parent/child links are derived from `parentId`, not from the stored
// `ancestors` field — `ancestors` is a cached denormalization for cheap
// reads elsewhere, but the tree built here is the source of truth for it.

// buildTree(tasks) -> { roots, byId }
//   - byId: Map<taskId, task & { children: node[] }>
//   - roots: nodes whose parentId is null/missing, or points at a task that
//     isn't in this list (an orphan is treated as a root rather than dropped,
//     so a task never silently disappears from the tree).
//
// A task pointing `parentId` at itself is refused and treated as a root
// instead. The app itself never produces this — it's a guard against
// corrupt or hand-edited data, since nothing in firestore.rules forbids
// `parentId === id`. Without it, a self-parented node would become its own
// child, and the traversals below would spin forever on it.
export function buildTree(tasks) {
  const byId = new Map();

  for (const task of tasks) {
    byId.set(task.id, { ...task, children: [] });
  }

  const roots = [];
  for (const node of byId.values()) {
    const isSelfParent = node.parentId === node.id;
    const parent = !isSelfParent && node.parentId != null ? byId.get(node.parentId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return { roots, byId };
}

// All ids below `id` in the tree, deepest-first order not guaranteed.
//
// `visited` guards against a `parentId` cycle elsewhere in the data turning
// a node into its own descendant — again not a shape the app produces, but
// nothing stops corrupt or hand-edited data from forming one, and without
// this guard the stack below would grow forever.
export function descendantIds(tree, id) {
  const node = tree.byId.get(id);
  if (!node) return [];

  const result = [];
  const visited = new Set([id]);
  const stack = [...node.children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    result.push(current.id);
    stack.push(...current.children);
  }
  return result;
}

// Ids from the root down to (but not including) `id`, root first.
//
// `visited` guards against a `parentId` cycle (e.g. A -> B -> A) turning this
// walk into an infinite loop over corrupt or hand-edited data.
export function ancestorChain(tree, id) {
  const chain = [];
  const visited = new Set([id]);
  let node = tree.byId.get(id);
  while (node && node.parentId != null && tree.byId.has(node.parentId) && !visited.has(node.parentId)) {
    node = tree.byId.get(node.parentId);
    visited.add(node.id);
    chain.unshift(node.id);
  }
  return chain;
}

// How many levels below a root `id` sits (a root itself is depth 0).
export function depthOf(tree, id) {
  return ancestorChain(tree, id).length;
}

// Step 11 (D4): the height of `taskId`'s own subtree — 0 for a leaf, else how
// many levels its deepest live-or-deleted descendant sits below it. `tree`
// must be built from the FULL task set (deleted included) — a deleted
// descendant is restorable, and `firestore.rules`' `ancestors.size() <= 6`
// would reject a write for it the moment it's restored into a subtree moved
// too deep while it was gone. Pure and side-effect-free, exported for direct
// verification (same precedent as the reorder/purge helpers in app.js) since
// it's the one piece of D4's math neither the drag's live check nor
// performReparent's write-time re-check can skip.
//
// Issue 6: moved here from app.js — this is pure tree math with no DOM or
// Firestore involvement, so it belongs alongside buildTree/descendantIds/
// depthOf rather than in the orchestrator file. app.js imports it from here.
export function computeSubtreeHeight(tree, taskId) {
  const ids = descendantIds(tree, taskId);
  if (ids.length === 0) return 0;
  const draggedDepth = depthOf(tree, taskId);
  return Math.max(...ids.map((id) => depthOf(tree, id))) - draggedDepth;
}

// Step 11 (D3): the four refusals that keep a reparent drop from ever
// "appearing to work and then snapping back" — the same rule step 10 already
// applies to an invalid sibling target. `subtreeHeight` is
// `computeSubtreeHeight(tree, draggedId)`, passed in rather than recomputed
// here since both the drag's live check and performReparent's write-time
// re-check already have it in hand. Pure (only reads `tree`), exported for
// direct verification for the same reason as computeSubtreeHeight above —
// both the live drag-hover check (app.js's isValidReparentTarget) and
// performReparent's write-time re-check route through this one function, so
// there is exactly one place the four refusal rules live.
//
// Issue 6: moved here from app.js alongside computeSubtreeHeight, for the
// same reason — pure tree math, no DOM/Firestore. `canReparent` reading task
// fields off `tree.byId` stays pure: `tree` is itself a pure data structure
// (buildTree's output), not a live DOM/store reference.
export function canReparent(tree, draggedId, newParentId, subtreeHeight) {
  if (newParentId === draggedId) return false; // defensive: can't parent onto itself
  const draggedTask = tree.byId.get(draggedId);
  if (!draggedTask) return false;
  if (descendantIds(tree, draggedId).includes(newParentId)) return false; // D3: would cut the tree into a cycle
  if (draggedTask.parentId === newParentId) return false; // D3: no-op — already the parent
  const newParentTask = tree.byId.get(newParentId);
  if (!newParentTask || newParentTask.deleted) return false; // defensive: not a renderable row
  if (depthOf(tree, newParentId) + 1 + subtreeHeight > 6) return false; // D4
  return true;
}

// Step 11 (D5), rewritten for issue 4: the ancestors a DESCENDANT of the
// moved task gets after the move. The tail (this descendant's own nesting
// below the dragged task) comes from walking `tree` via `ancestorChain` —
// NOT from slicing the descendant's own cached `ancestors` field, which was
// this function's original (buggy) shape when it lived in app.js. `tree`
// must be the pre-write snapshot (`performReparent`'s `freshTree`): a
// reparent never changes any DESCENDANT's `parentId`, only the dragged
// task's own, so `tree` still reflects the true, current parent/child shape
// for every descendant even though the dragged task's write may already
// have landed by the time a later descendant's turn comes up. Deriving the
// tail from `parentId` (via the tree) rather than from the cached field is
// exactly what makes this robust to a descendant's `ancestors` having
// drifted stale or corrupt: a partial write failure earlier can never
// propagate into this computation, because this computation never reads the
// field it would have corrupted. `newDraggedAncestors` is the dragged task's
// own new `ancestors` (root-first, not including itself); this returns the
// descendant's full new chain, dragged task included. Pure, exported for
// direct verification (11d, and the corrupted-cache proof issue 4 requires)
// — the one place this rewrite math lives, called from performReparent
// (app.js) for the real write.
//
// Issue 6: moved here from app.js alongside the other two — pure tree math,
// no DOM/Firestore, now callable directly against this module's own
// ancestorChain with no import needed.
export function rewriteDescendantAncestors(tree, newDraggedAncestors, draggedId, descendantId) {
  const descendantChain = ancestorChain(tree, descendantId); // root-first, not including descendantId
  const draggedIndex = descendantChain.indexOf(draggedId);
  const tail = draggedIndex === -1 ? [] : descendantChain.slice(draggedIndex + 1);
  return [...newDraggedAncestors, draggedId, ...tail];
}
