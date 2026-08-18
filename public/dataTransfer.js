// Everything pure about export/import: the file's exact JSON shape, the
// Timestamp<->string conversions, and the whole-file validation that must
// pass before a single write happens. No DOM, no Firestore — same standing
// as taskTree.js/tagColors.js/recurrence.js/searchQuery.js. This project has
// no test runner, so "pure and exported" is the only way any of this step's
// logic can be exercised outside a signed-in browser (searchQuery.js's own
// header states the identical reasoning).
//
// Step 21 (S21-1..S21-12, PROGRESS.md's Decisions log) locks the whole shape
// here — the implementer decided none of it. app.js owns everything this
// file deliberately does NOT: the download click, the hidden file input, the
// confirm dialogs, the enqueueMutation-wrapped saveTask/saveSettings write
// loop (S21-8), and the "Importing N of M…" progress text. Nothing in this
// file ever calls saveTask, saveSettings, or touches the DOM.

import { timestampToDate, formatDateForInput } from "./render.js";
// Fix: the canonical set of valid quadrant values, reused rather than
// hand-copied — QUADRANT_OPTIONS is already tagColors.js's own exported
// list (the settings screen's <select> options), so this file's validation
// and the app's own quadrant resolution can never silently drift apart.
import { QUADRANT_OPTIONS } from "./tagColors.js";

// S21-2: the one shape every export/import round trip agrees on. `format`
// and `version` are the one thing that is free now and impossible to
// retrofit — an unversioned export could never be told apart from a future
// format, so import REJECTS anything else rather than best-effort parsing it
// (validateImportPayload below).
export const EXPORT_FORMAT = "todo-manager-export";
export const EXPORT_VERSION = 1;

// S21-3: the five Timestamp-typed task fields, confirmed by reading
// taskService.js's normalizeTask (not assumed) — there is no `completedAt`;
// completion is the boolean `completed`. Both serializeTaskForExport and
// deserializeTaskFromImport below read this SAME array, so a field added to
// one direction can never silently drift from the other (two hand-kept lists
// would land a Timestamp field in Firestore as a plain, un-rehydrated string
// on the very first import, and every date comparison in the app would then
// quietly compare a string to a Timestamp and return garbage).
export const TIMESTAMP_FIELDS = ["createdAt", "updatedAt", "deletedAt", "dueDate", "occurrenceStart"];

// Mirrors firestore.rules' isValidTask()/isValidSettings() caps exactly (both
// re-read in full before writing this file, not assumed) — checked here so a
// bad file is rejected with a message naming the actual problem instead of a
// mid-import permission-denied after some tasks already wrote (S21-7).
const TITLE_MAX_LENGTH = 1000;
const NOTE_MAX_LENGTH = 10000;
const TAGS_MAX_COUNT = 50;
const ANCESTORS_MAX_LENGTH = 6; // firestore.rules:56 — the 7-level depth cap
const SETTINGS_TAGS_MAX_KEYS = 500;
const VALID_WEEK_STARTS = ["sunday", "monday"];

// ---------------------------------------------------------------------------
// Serialize (export)
// ---------------------------------------------------------------------------

// A single Timestamp-typed field -> an ISO 8601 UTC string, or `null` through
// unchanged (S21-3). Reuses render.js's own Timestamp/Date duck-typing
// (`timestampToDate`, already the one place this codebase decides "is this a
// Timestamp, a Date, or neither") rather than a second copy of that check
// here. Importing a single pure function from render.js creates no cycle —
// render.js does not import this file — the same precedent searchQuery.js's
// S20-10 already established for `localMidnight`.
function serializeTimestampField(value) {
  if (value == null) return null;
  const date = timestampToDate(value);
  return date ? date.toISOString() : null;
}

// Whole task document -> its export shape: every field carried through
// verbatim (S21-1 — a real backup, not a read-only projection — soft-deleted
// tasks included, nothing filtered) except the five Timestamp fields above,
// each converted via serializeTimestampField.
export function serializeTaskForExport(task) {
  const out = { ...task };
  for (const field of TIMESTAMP_FIELDS) {
    if (field in out) out[field] = serializeTimestampField(out[field]);
  }
  return out;
}

// S21-2/S21-11: the one exported file shape. `tasks` is every task document
// (S21-1) and `settings` is the whole tag-settings document as-is — nothing
// dropped or re-shaped, so this is symmetric with what validateImportPayload/
// deserializeTaskFromImport below accept back in. `exportedAt` is metadata
// only; nothing on import reads it.
export function buildExportPayload(tasks, settings, exportedAt = new Date()) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: exportedAt.toISOString(),
    tasks: tasks.map(serializeTaskForExport),
    settings: settings ?? { tags: {} },
  };
}

// S21-4: pretty-printed with 2-space indent — this is a file a human may
// open and read, not just a machine-to-machine payload.
export function stringifyExportPayload(payload) {
  return JSON.stringify(payload, null, 2);
}

// S21-4: the filename's date is the LOCAL calendar date, never
// `toISOString().slice(0, 10)` — that renders in UTC and names YESTERDAY's
// date west of Greenwich, the exact bug render.js's own
// formatDateForInput/parseDateInputToLocalMidnight pair already exists to
// avoid for due dates. Reusing that function here rather than a third copy
// of the same local year/month/day formatting.
export function buildExportFilename(date = new Date()) {
  return `todo-manager-export-${formatDateForInput(date)}.json`;
}

// ---------------------------------------------------------------------------
// Deserialize (import)
// ---------------------------------------------------------------------------

// The reverse of serializeTimestampField (S21-3). Deliberately a plain JS
// `Date`, not a constructed Firestore `Timestamp` — this file must stay
// Firestore-free (module header) so it can run as a bare Node script with no
// bundler and no network, which is the only verification this project has
// (PROGRESS.md). Firestore's own `setDoc` already converts a plain `Date`
// into a Timestamp on write — taskService.js's addTask does exactly this for
// `dueDate: new Date(taskDetails.dueDate)` — so the document that lands in
// Firestore is identical either way; only the construction path differs.
function deserializeTimestampField(iso) {
  if (iso == null) return null;
  return new Date(iso);
}

// A raw task object straight out of `JSON.parse` -> a task object ready to
// hand to `saveTask` (app.js's write loop does exactly that, once per task,
// S21-8). Ids are preserved verbatim (S21-6) — this function never mints a
// new one.
export function deserializeTaskFromImport(rawTask) {
  const out = { ...rawTask };
  for (const field of TIMESTAMP_FIELDS) {
    if (field in out) out[field] = deserializeTimestampField(out[field]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validate (S21-7) — the ENTIRE file is checked before a single write; one
// bad task aborts the whole import, never a partial one.
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// `null` is always a valid Timestamp field value (S21-3); anything else must
// be a string that parses to a real Date.
function isValidIsoTimestamp(value) {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  return !Number.isNaN(new Date(value).getTime());
}

// Validates one task entry, pushing every problem it finds onto `errors`
// (never stopping at the first one WITHIN a task, so one malformed task
// still contributes accurately to S21-7's total problem count) and returning
// whether this task's `id` is at least usable enough to be a resolvable
// parentId target for some OTHER task in the file (the dangling-parentId
// pass below needs that, run as a second pass over the whole file since a
// parentId can point FORWARD to a task later in the array).
function validateTaskEntry(task, index, errors) {
  const titled = isPlainObject(task) && typeof task.title === "string" && task.title;
  const label = titled ? `task ${index} ("${task.title}")` : `task ${index}`;

  if (!isPlainObject(task)) {
    errors.push(`${label} is not an object.`);
    return false;
  }
  if (typeof task.id !== "string" || task.id.length === 0) {
    errors.push(`${label} has no valid id.`);
  }
  if (typeof task.title !== "string" || task.title.length < 1 || task.title.length > TITLE_MAX_LENGTH) {
    errors.push(`${label}'s title must be 1-${TITLE_MAX_LENGTH} characters.`);
  }
  if ("note" in task && task.note != null && (typeof task.note !== "string" || task.note.length > NOTE_MAX_LENGTH)) {
    errors.push(`${label}'s note exceeds ${NOTE_MAX_LENGTH} characters.`);
  }
  if ("tags" in task && task.tags != null && (!Array.isArray(task.tags) || task.tags.length > TAGS_MAX_COUNT)) {
    errors.push(`${label} has more than ${TAGS_MAX_COUNT} tags.`);
  }
  if (
    "ancestors" in task &&
    task.ancestors != null &&
    (!Array.isArray(task.ancestors) || task.ancestors.length > ANCESTORS_MAX_LENGTH)
  ) {
    errors.push(`${label} has more than ${ANCESTORS_MAX_LENGTH} ancestors (the 7-level depth cap).`);
  }
  for (const field of TIMESTAMP_FIELDS) {
    if (field in task && !isValidIsoTimestamp(task[field])) {
      errors.push(`${label}'s "${field}" is not a valid ISO timestamp.`);
    }
  }
  return typeof task.id === "string" && task.id.length > 0;
}

// S21-7's settings checks, mirroring firestore.rules' isValidSettings()
// exactly (re-read in full before writing this, not assumed): `tags`'s
// key-count cap and `weekStart`'s two literal accepted values. A file with no
// `settings` key at all is valid (S21-10 — import leaves settings untouched
// in that case).
function validateSettings(settings, errors) {
  if (settings == null) return;
  if (!isPlainObject(settings)) {
    errors.push('"settings" must be an object.');
    return;
  }
  if ("tags" in settings && settings.tags != null) {
    if (!isPlainObject(settings.tags)) {
      errors.push('"settings.tags" must be an object.');
    } else if (Object.keys(settings.tags).length > SETTINGS_TAGS_MAX_KEYS) {
      errors.push(`"settings.tags" has more than ${SETTINGS_TAGS_MAX_KEYS} entries.`);
    } else {
      // Fix: `entry.quadrant` was never checked here — readTagQuadrant
      // (tagColors.js) already degrades any bad value to null at READ time,
      // so a malformed import could never corrupt resolution, but it could
      // still silently import garbage with no warning. This only rejects a
      // PRESENT, non-null bad value — absent/null is the normal "no quadrant
      // assigned" case (Q1) and stays valid, same as readTagQuadrant treats
      // it. A malformed entry (not an object) is left to whatever it is;
      // this file's own deserialize/normalize step handles that shape
      // problem, not this quadrant-specific check.
      for (const [tagName, entry] of Object.entries(settings.tags)) {
        if (!isPlainObject(entry) || entry.quadrant == null) continue;
        if (!QUADRANT_OPTIONS.includes(entry.quadrant)) {
          errors.push(
            `"settings.tags.${tagName}.quadrant" must be one of ${QUADRANT_OPTIONS.join(", ")} — found ${JSON.stringify(entry.quadrant)}.`
          );
        }
      }
    }
  }
  if ("weekStart" in settings && settings.weekStart != null && !VALID_WEEK_STARTS.includes(settings.weekStart)) {
    errors.push(
      `"settings.weekStart" must be one of ${VALID_WEEK_STARTS.join(", ")} — found ${JSON.stringify(settings.weekStart)}.`
    );
  }
}

// The whole-file check (S21-7). `existingTasks` is every task currently in
// the account (deleted or not — a parentId pointing at a soft-deleted-but-
// not-purged parent is still a real document, not a dangling reference), so
// app.js passes `getTasks()` unfiltered. Returns every problem found, in the
// order this function encounters them — app.js's caller names the first one
// plus the total count (S21-7's own wording), never just one in isolation.
export function validateImportPayload(payload, existingTasks = []) {
  const errors = [];

  if (!isPlainObject(payload)) {
    return { ok: false, errors: ["File does not contain a JSON object."] };
  }
  if (payload.format !== EXPORT_FORMAT) {
    errors.push(`Unrecognized file format ${JSON.stringify(payload.format ?? null)} — expected "${EXPORT_FORMAT}".`);
  }
  if (payload.version !== EXPORT_VERSION) {
    errors.push(`Unsupported version ${JSON.stringify(payload.version ?? null)} — expected ${EXPORT_VERSION}.`);
  }
  if (!Array.isArray(payload.tasks)) {
    errors.push('"tasks" must be an array.');
  }

  const fileTaskIds = new Set();
  if (Array.isArray(payload.tasks)) {
    payload.tasks.forEach((task, index) => {
      const hasValidId = validateTaskEntry(task, index, errors);
      if (hasValidId) fileTaskIds.add(task.id);
    });
  }

  // S21-7: every non-null parentId must resolve — either to another task IN
  // THE FILE (a parentId can point forward to a task later in the array; the
  // pass above already collected every valid file id before this one runs)
  // or to a task ALREADY IN THE ACCOUNT. A dangling parentId renders an
  // invisible orphan — a data-loss bug that looks like nothing happened.
  const existingIds = new Set(existingTasks.map((t) => t.id));
  const resolvableIds = new Set([...fileTaskIds, ...existingIds]);
  if (Array.isArray(payload.tasks)) {
    payload.tasks.forEach((task, index) => {
      if (!isPlainObject(task)) return; // already reported by validateTaskEntry above
      const parentId = task.parentId ?? null;
      if (parentId != null && !resolvableIds.has(parentId)) {
        const titled = typeof task.title === "string" && task.title;
        const label = titled ? `task ${index} ("${task.title}")` : `task ${index}`;
        errors.push(`${label}'s parentId "${parentId}" does not resolve to any task in the file or the account.`);
      }
    });
  }

  validateSettings(payload.settings, errors);

  return { ok: errors.length === 0, errors };
}

// Convenience wrapper for app.js's file-input handler: JSON.parse (a file
// that isn't even valid JSON is its own S21-7-style rejection, never a
// silent best-effort parse) followed immediately by the full validation
// above. `payload` on the returned object is `null` when parsing itself
// failed, and the parsed-but-not-yet-validated object otherwise.
export function parseImportPayload(jsonText, existingTasks = []) {
  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch (error) {
    return { ok: false, errors: [`File is not valid JSON (${error.message}).`], payload: null };
  }
  const { ok, errors } = validateImportPayload(payload, existingTasks);
  return { ok, errors, payload };
}
