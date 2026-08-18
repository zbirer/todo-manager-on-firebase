// Step 18 (Recurrence): pure recurrence-rule arithmetic, kept out of
// app.js/render.js so this step's one genuinely tricky part — the "advance"
// algorithm (S18-2/S18-4) — can be exercised directly against synthetic
// dates with no DOM and no Firestore, exactly like taskTree.js's own pure
// core. No history of past occurrences is kept anywhere in this module
// (S18-7): every function here takes "the current due date" and returns
// "the next one," never a list.
//
// Deliberately has NO imports (same standing as taskTree.js) even though
// render.js already exports a `localMidnight` that does the same local-
// midnight construction this file needs internally — importing it would
// create a render.js <-> recurrence.js cycle (render.js's row badge wants
// this file's `describeRecurrence`, and this file would want render.js's
// `localMidnight` back), so `localMidnightOf` below is a deliberate,
// one-line duplicate rather than a shared helper. Callers (app.js) are
// responsible for unwrapping a Firestore Timestamp into a plain Date
// (render.js's `timestampToDate`) before calling anything here — this
// module only ever works with plain Dates.
//
// On-disk shape (S18-1), stored on the task document as `recurrence`:
//   { kind: "daily" }
//   { kind: "weekdays", days: number[] }          0=Sun..6=Sat, non-empty
//   { kind: "weekly", anchorDay: number }         0=Sun..6=Sat
//   { kind: "monthly", anchorDayOfMonth: number } 1..31
// `null` means "does not repeat" — this is also the ONLY way a recurrence
// ever stops (S18-0): there is no separate "stop repeating" action or state.

export const RECURRENCE_KIND_DAILY = "daily";
export const RECURRENCE_KIND_WEEKDAYS = "weekdays";
export const RECURRENCE_KIND_WEEKLY = "weekly";
export const RECURRENCE_KIND_MONTHLY = "monthly";
export const RECURRENCE_KINDS = [
  RECURRENCE_KIND_DAILY,
  RECURRENCE_KIND_WEEKDAYS,
  RECURRENCE_KIND_WEEKLY,
  RECURRENCE_KIND_MONTHLY,
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// See the file header: identical to render.js's exported `localMidnight`,
// duplicated on purpose to keep this module import-free.
function localMidnightOf(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Walks forward day-by-day (at most 7 steps — every week contains a matching
// weekday) to the next date whose LOCAL day-of-week is in `days`. Always
// strictly forward: never returns `date` itself even if its own weekday is
// already in `days`, because this is one STEP of the rule, not a "does this
// date already qualify" check.
function nextWeekday(date, days) {
  let next = addDays(date, 1);
  for (let i = 0; i < 7; i++) {
    if (days.includes(next.getDay())) return next;
    next = addDays(next, 1);
  }
  // Unreachable given a validated non-empty `days` (parseWeekdaysInput below
  // never returns one) — returned instead of looping forever on corrupt data.
  return next;
}

// S18-4: clamps to the target month's real length but always re-derives the
// target day from the STORED anchor (`anchorDayOfMonth`), never from
// `date`'s own day-of-month. That distinction is exactly what makes
// Jan 31 -> Feb 28/29 -> Mar 31 work: March's target is
// min(anchorDayOfMonth, daysInMarch) computed from the anchor (31) again,
// not from February's already-clamped 28 — so the rule re-anchors instead of
// degrading permanently to the shorter month.
function addMonthsClamped(date, monthsForward, anchorDayOfMonth) {
  const targetIndex = date.getMonth() + monthsForward;
  const year = date.getFullYear() + Math.floor(targetIndex / 12);
  const month = ((targetIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.min(anchorDayOfMonth, daysInTargetMonth);
  return new Date(year, month, day);
}

// One step of `rule` forward from `date` (expected to already be a local
// midnight). Never called directly by app.js — see advanceRecurrence below
// for the "keep stepping until strictly after today" rule this always sits
// underneath (S18-2).
function stepOnce(date, rule) {
  switch (rule.kind) {
    case RECURRENCE_KIND_DAILY:
      return addDays(date, 1);
    case RECURRENCE_KIND_WEEKDAYS:
      return nextWeekday(date, rule.days);
    case RECURRENCE_KIND_WEEKLY:
      // Adding exactly 7 days preserves the weekday by construction — there
      // is no separate "snap to anchorDay" step, and re-deriving the weekday
      // from `date` here would be redundant with (and could drift from) the
      // anchor stored at setup time.
      return addDays(date, 7);
    case RECURRENCE_KIND_MONTHLY:
      return addMonthsClamped(date, 1, rule.anchorDayOfMonth);
    default:
      throw new Error(`advanceRecurrence: unknown recurrence kind "${rule.kind}"`);
  }
}

// S18-2 (locked): steps `rule` forward from `fromDate` REPEATEDLY until the
// result is strictly after today's local midnight — not one step from
// `fromDate`. This is what makes a daily task completed five days late land
// tomorrow instead of staying overdue: a single step from a five-day-stale
// due date would still be in the past, so the loop keeps stepping until it
// actually clears today. `fromDate`/`today` are plain Dates — the caller
// (app.js) unwraps any Firestore Timestamp first.
export function advanceRecurrence(fromDate, rule, today = new Date()) {
  const todayMidnight = localMidnightOf(today);
  let next = localMidnightOf(fromDate);
  do {
    next = stepOnce(next, rule);
  } while (next.getTime() <= todayMidnight.getTime());
  return next;
}

// Derives a weekly rule's anchorDay / a monthly rule's anchorDayOfMonth from
// a concrete anchor date. Called exactly once, when a rule is first set on a
// task (S18-5: the anchor is the task's due date, defaulted to today if it
// didn't have one) — never re-derived on a later advance, because S18-4's
// re-anchoring depends on the anchor being a stored fact, not something
// recomputed from a possibly-already-clamped current due date.
export function deriveAnchorFromDate(kind, anchorDate) {
  if (kind === RECURRENCE_KIND_WEEKLY) return { anchorDay: anchorDate.getDay() };
  if (kind === RECURRENCE_KIND_MONTHLY) return { anchorDayOfMonth: anchorDate.getDate() };
  throw new Error(`deriveAnchorFromDate: kind "${kind}" has no anchor to derive`);
}

// Human-readable summary — shared by render.js's row badge and app.js's
// context-menu label/prompt default, so wording only ever changes in one
// place.
export function describeRecurrence(recurrence) {
  if (!recurrence) return "Does not repeat";
  switch (recurrence.kind) {
    case RECURRENCE_KIND_DAILY:
      return "Daily";
    case RECURRENCE_KIND_WEEKDAYS:
      return `Weekdays: ${recurrence.days.map((d) => DAY_NAMES[d] ?? "?").join(", ")}`;
    case RECURRENCE_KIND_WEEKLY:
      return `Weekly (${DAY_NAMES[recurrence.anchorDay] ?? "?"})`;
    case RECURRENCE_KIND_MONTHLY:
      return `Monthly (day ${recurrence.anchorDayOfMonth})`;
    default:
      return "Repeats";
  }
}

// Validates a comma-separated "0,3,5" weekday prompt input into a
// de-duplicated, sorted array of integers 0..6, or `null` if the input is
// empty or contains anything else — the caller (app.js) alerts and re-asks
// rather than silently defaulting to an empty/invalid rule that could never
// advance (nextWeekday above would spin through all 7 days and return
// something, but a `{ days: [] }` rule reaching storage at all would be a
// silent misconfiguration, not a readable rejection).
export function parseWeekdaysInput(raw) {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (parts.length === 0) return null;
  const days = [];
  for (const part of parts) {
    if (!/^[0-6]$/.test(part)) return null;
    const n = Number(part);
    if (!days.includes(n)) days.push(n);
  }
  days.sort((a, b) => a - b);
  return days;
}
