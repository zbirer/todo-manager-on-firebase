// Owns the in-memory task list and the signed-in user id — the one shared
// piece of state every view reads from and every mutation writes back to.
// Also owns the 5-minute auto-refresh timer and the interaction guard that
// protects it: per the "one refresh strategy" rule (no optimistic local
// mutation anywhere), a background refresh is the only thing that can change
// `tasks` behind a view's back, so it must never fire while something like a
// drag (step 11) is mid-gesture over the DOM the render owns.

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let tasks = [];
let currentUserId = null;

let refreshTimerId = null;
let refreshCallback = null;
let interactionDepth = 0;
let refreshPendingInteraction = false;

export function getTasks() {
  return tasks;
}

export function setTasks(newTasks) {
  tasks = newTasks;
}

export function getCurrentUserId() {
  return currentUserId;
}

export function setCurrentUserId(userId) {
  currentUserId = userId;
}

// Clears everything the store holds. Called on sign-out so a second account
// signing in on the same page never sees the previous user's tasks flash by.
export function invalidate() {
  tasks = [];
  currentUserId = null;
  interactionDepth = 0;
  refreshPendingInteraction = false;
}

// An "interaction" is any user gesture that owns the DOM the render touches
// (nothing in step 1 opens one yet; drag in step 11 will). Interactions can
// nest, hence a depth counter rather than a boolean.
export function beginInteraction() {
  interactionDepth += 1;
}

export function endInteraction() {
  interactionDepth = Math.max(0, interactionDepth - 1);
  if (interactionDepth === 0 && refreshPendingInteraction) {
    refreshPendingInteraction = false;
    refreshCallback?.();
  }
}

// Read-only escape hatch onto the guard's own count. There is no test
// runner in this project (browser-only verification, per the project
// constraints), so a caller driving this module directly needs some way to
// assert "did that close actually decrement, or did an idempotent guard
// correctly no-op it" without inferring it indirectly from a 5-minute timer.
// Nothing in app.js/render.js calls this — it exists for exactly that kind
// of direct verification.
export function getInteractionDepth() {
  return interactionDepth;
}

// Starts the 5-minute background refresh. `onRefresh` is provided by the
// caller (app.js) rather than imported here, so this module stays ignorant
// of Firestore and DOM rendering — it only decides *when* a refresh may run.
export function startAutoRefresh(onRefresh) {
  stopAutoRefresh();
  refreshCallback = onRefresh;
  refreshTimerId = setInterval(() => {
    if (interactionDepth > 0) {
      refreshPendingInteraction = true;
      return;
    }
    refreshCallback?.();
  }, REFRESH_INTERVAL_MS);
}

export function stopAutoRefresh() {
  if (refreshTimerId !== null) {
    clearInterval(refreshTimerId);
    refreshTimerId = null;
  }
  refreshCallback = null;
}

// Serializes every mutation (add, save, delete — every path that reads
// `tasks`, writes a whole document, then refetches) into one queue. Without
// this, two handlers firing close together (e.g. clicking a checkbox while a
// title edit is mid-commit) each read their own stale copy of the same task
// and each `setDoc` a whole document — whichever write lands second silently
// discards the other's change. Chaining every mutation onto one promise
// means a queued mutation's body never even starts running until the
// previous one's write-then-refetch has fully landed, so by the time it
// reads `getTasks()` for itself, that read already reflects everything
// queued ahead of it. This is a different axis from the interaction guard
// above: that one holds off the *background timer*; this one orders
// *user-initiated* writes against each other. Neither substitutes for the
// other, and this queue is not a second way to update the view or an
// optimistic-mutation path — callers still do their own read-write-refetch
// inside the function they hand to enqueueMutation.
let mutationQueue = Promise.resolve();

export function enqueueMutation(mutation) {
  const run = () => mutation();
  // Chained onto both branches so one mutation throwing never wedges every
  // mutation queued after it.
  const result = mutationQueue.then(run, run);
  // The internal chain must never itself become a rejected promise (that
  // would make the *next* .then(run, run) run with the rejection reason as
  // its argument instead of cleanly) — the caller still gets the real
  // outcome via `result`, which this swallowed copy is never returned as.
  mutationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
