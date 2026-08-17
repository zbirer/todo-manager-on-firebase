// Owns every Firestore read/write for a user's tasks (users/{uid}/tasks).
// Two rules shape everything below:
//   - Writes are whole-document (setDoc), never a partial updateDoc, so a
//     save always replaces the task rather than merging fields into it.
//   - Reads normalize documents on the way in. Older docs (written before
//     ancestors/order/updatedAt existed) get deterministic fallbacks here so
//     every downstream consumer (tree building, sorting) can assume the
//     fields are always present instead of null-checking everywhere.

import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "./auth.js"; // Import the db instance we initialized in auth.js

// 1. Add a task to a user's isolated subcollection
export const addTask = async (userId, taskDetails, existingTasks = []) => {
  try {
    // Reference points to: users/{userId}/tasks
    const tasksCollectionRef = collection(db, "users", userId, "tasks");

    // firestore.rules' isValidTask() caps title at 1000 chars and rejects the
    // write with an opaque permission-denied if we don't. Catch it here first
    // so the caller gets a clear, actionable error instead.
    if (!taskDetails.title || taskDetails.title.length > 1000) {
      throw new Error("Task title must be between 1 and 1000 characters.");
    }
    // Mirrors firestore.rules' isValidTask() tags.size() check, same reason
    // as the title check above: catch it here with a message that names the
    // actual problem, rather than let a >50-tag title bounce off the rules
    // as an opaque "Could not add task."
    if (taskDetails.tags && taskDetails.tags.length > 50) {
      throw new Error("A task can have at most 50 tags.");
    }

    const parentId = taskDetails.parentId ?? null;

    // New tasks land at the top of their group. Using a fractional index
    // (one step below the smallest sibling order) means inserting a task
    // never requires renumbering the tasks around it.
    const siblingOrders = existingTasks
      .filter((t) => (t.parentId ?? null) === parentId && typeof t.order === "number")
      .map((t) => t.order);
    const minSiblingOrder = siblingOrders.length > 0 ? Math.min(...siblingOrders) : 0;

    const newTask = {
      title: taskDetails.title,
      // Defaults below mirror isValidTask()'s required booleans, so a caller
      // passing only { title, tags, colors } still writes a valid document.
      completed: taskDetails.completed ?? false,
      deleted: taskDetails.deleted ?? false,
      pinned: taskDetails.pinned ?? false,
      inInbox: taskDetails.inInbox ?? true,
      parentId,                                     // For task hierarchy
      ancestors: taskDetails.ancestors ?? [],        // For task hierarchy
      order: taskDetails.order ?? minSiblingOrder - 1000,
      tags: taskDetails.tags || [],                 // e.g., ["#private", "@office"]
      colors: {
        foreground: taskDetails.colors?.foreground || "#000000",
        background: taskDetails.colors?.background || "#ffffff"
      },
      createdAt: serverTimestamp(),                 // Track task age
      updatedAt: serverTimestamp(),
      dueDate: taskDetails.dueDate ? new Date(taskDetails.dueDate) : null
    };

    // note is optional per isValidTask() — only set it when provided so we
    // don't write `undefined` (Firestore rejects that) or a stray null the
    // rules would otherwise have to special-case.
    if (taskDetails.note !== undefined) {
      newTask.note = taskDetails.note;
    }

    const docRef = await addDoc(tasksCollectionRef, newTask);
    return docRef.id;
  } catch (error) {
    console.error("Error adding document: ", error);
    throw error;
  }
};

// 2. Fetch all tasks for a specific user
export const fetchTasks = async (userId) => {
  try {
    const tasksCollectionRef = collection(db, "users", userId, "tasks");
    const q = query(tasksCollectionRef, orderBy("createdAt", "desc"));
    const querySnapshot = await getDocs(q);

    const tasks = [];
    querySnapshot.forEach((docSnapshot) => {
      tasks.push(normalizeTask({ id: docSnapshot.id, ...docSnapshot.data() }));
    });
    return tasks;
  } catch (error) {
    console.error("Error fetching documents: ", error);
    throw error;
  }
};

// Fills in fields the pre-hierarchy client never wrote. Without this, tasks
// already sitting in the live database would have no `order` to sort by and
// no `ancestors` for tree building to walk.
//
// This is defensive, not a fix for a live outage: every doc under
// `users/{uid}/tasks` had to pass `isValidTask()` — which already requires
// `deleted`/`pinned`/`inInbox` as bools — to be written at all, so a doc
// missing them should not exist. (The old client wrote to a different
// collection, `users/{uid}/todos`, and every one of its writes was rejected
// there.) We backfill anyway because `saveTask` writes whole documents: if a
// malformed doc ever did reach this collection by some other path, missing
// one of these booleans would make it permanently unsavable — every future
// `setDoc` would fail `isValidTask()` again unless we filled the gap here.
function normalizeTask(task) {
  const createdAtMillis = typeof task.createdAt?.toMillis === "function"
    ? task.createdAt.toMillis()
    : 0;

  return {
    ...task,
    deleted: task.deleted ?? false,
    pinned: task.pinned ?? false,
    inInbox: task.inInbox ?? true,
    ancestors: task.ancestors ?? [],
    updatedAt: task.updatedAt ?? task.createdAt,
    // Derived from creation time so existing tasks get a stable relative
    // order (oldest first) without a migration script.
    order: task.order ?? createdAtMillis,
    // Step 2 (inline edit) is the first thing to read/write `note`. Docs
    // written before it have no `note` key at all; normalizing to "" here
    // means render.js and the edit box can always treat it as a string.
    note: task.note ?? "",
    // Step 3 (soft delete) locks this shape: `deletedAt` is a Timestamp set
    // once, alongside `deleted: true`, by softDeleteTask below — null on
    // every task that has never been deleted. No Trash UI reads it yet
    // (that's step 9), but the shape must not be reinvented once it does.
    deletedAt: task.deletedAt ?? null,
    // Step 6 (cascade complete) locks this shape: `closedByCascadeFrom` is
    // the id of the task the USER completed (never a descendant's immediate
    // parent), stamped on every descendant that cascade closed — null on any
    // task that is open, or that was completed directly rather than as a
    // side effect of an ancestor's completion. Step 7 (un-complete memory)
    // reverses exactly one cascade by matching this id.
    closedByCascadeFrom: task.closedByCascadeFrom ?? null,
  };
}

// 3. Save a task as a whole document — every field on `task` is written,
// nothing is merged. A caller must pass the complete task object (spread the
// existing one and override just the changed fields) rather than a patch.
export const saveTask = async (userId, task) => {
  try {
    if (!task.id) {
      throw new Error("saveTask requires a task with an id.");
    }
    if (!task.title || task.title.length > 1000) {
      throw new Error("Task title must be between 1 and 1000 characters.");
    }
    // Mirrors firestore.rules' isValidTask() note-size check. The inline
    // edit box (app.js) already enforces this before ever calling saveTask,
    // but checking it here too means no future caller of saveTask can bypass
    // it and get an opaque permission-denied instead of a clear error.
    if (task.note != null && task.note.length > 10000) {
      throw new Error("Task note must be 10000 characters or fewer.");
    }
    if (task.tags && task.tags.length > 50) {
      throw new Error("A task can have at most 50 tags.");
    }

    const taskRef = doc(db, "users", userId, "tasks", task.id);
    const { id, ...fields } = task; // id is the doc path, not a field

    await setDoc(taskRef, {
      ...fields,
      updatedAt: serverTimestamp(), // re-stamped on every write, not just create
    });
  } catch (error) {
    console.error("Error saving document: ", error);
    throw error;
  }
};

// 4. Soft-delete: mark the task rather than remove the document. No trash UI
// reads `deleted`/`deletedAt` yet, but writing them now means a later trash
// feature doesn't need a migration over tasks deleted before it shipped.
export const softDeleteTask = async (userId, task) => {
  return saveTask(userId, {
    ...task,
    deleted: true,
    deletedAt: serverTimestamp(),
  });
};
