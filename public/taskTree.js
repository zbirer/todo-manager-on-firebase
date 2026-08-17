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
