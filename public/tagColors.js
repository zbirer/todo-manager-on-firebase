// Everything pure about tags: what counts as a tag in a title, which colors a
// tag settings map assigns to it, and which of a task's tags actually wins.
//
// This module exists for the same reason taskTree.js does — it is logic with
// no DOM and no Firestore, so it belongs neither in render.js (which owns how
// the DOM looks) nor in app.js (whose own header says task logic doesn't live
// there) nor in settingsService.js (which owns the Firestore round trip).
// Every function here is exported and callable directly against synthetic
// data: this project has no test runner, so "pure and exported" is the only
// form verification can actually reach without a signed-in Firestore session.
//
// `parseTags` used to live in app.js. It moved here in step 14 because the
// color resolver below needs the exact same rule, and step 2's decision is
// explicit that there must be exactly ONE place deciding what counts as a
// tag — a second regex here would be a second answer to that question.

// A tag is a `#` or `@` sigil followed by word characters, and the sigil is
// PART of the tag: `#work` and `@work` are two different tags, so the settings
// map is keyed by the full token including its sigil.
const TAG_PATTERN = /([#@]\w+)/g;

// A settings entry's colors are two `#rrggbb` strings. Anything else — a
// 3-digit shorthand, a named color, a number, a missing half — is treated as
// "no color assigned" (D10) rather than passed through to `li.style`, where a
// malformed value would silently paint nothing and look like a bug in the
// resolver instead of bad data.
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// The colors a brand-new settings entry starts from — deliberately the same
// pair index.html's default `.task-item` rule paints, so the color inputs on
// the settings screen open showing what the row actually looks like right now
// rather than an arbitrary black-on-white that no row has ever used.
export const DEFAULT_TAG_FG = "#ffffff";
export const DEFAULT_TAG_BG = "#3b82f6";

// Extracts #tag / @context tokens from a title string, in the order they
// appear IN THE STRING. String order is the whole point (D2): in a Hebrew
// title the browser renders the last-typed tag furthest LEFT on screen, so
// anything that read tags in visual or DOM order would silently invert the
// winner for exactly the titles this app exists to handle. Shared by the
// add-task/edit-commit handlers in app.js (which persist the result as the
// task's `tags` field) and by resolveTagColor below.
export function parseTags(title) {
  return String(title ?? "").match(TAG_PATTERN) || [];
}

// Reads the color half of a settings entry, or null when this tag has no
// usable colors. Kept separate from the entry itself because an entry is an
// OBJECT, not a color pair (D1): step 15 adds a `quadrant` key to this same
// entry, and it must be able to exist on a tag that has no colors, exactly as
// colors must be able to exist on a tag with no quadrant.
export function readTagColors(entry) {
  if (!entry || typeof entry !== "object") return null;
  const { fg, bg } = entry;
  if (typeof fg !== "string" || typeof bg !== "string") return null;
  if (!HEX_COLOR_PATTERN.test(fg) || !HEX_COLOR_PATTERN.test(bg)) return null;
  return { fg, bg };
}

// D10: turns whatever the settings document actually held into the one shape
// every reader below assumes — `{ tags: { [tagName]: entryObject } }`. A
// document that doesn't exist yet, has no `tags` field, or holds a `tags`
// value that isn't a map all degrade to "no colors" here rather than throwing
// somewhere deep in a render pass. Individual entries are NOT validated away:
// a malformed entry keeps its key so the tag still LISTS on the settings
// screen (D5 — a tag present in the map is listed whether or not a live task
// carries it, and dropping a broken entry would hide the very row the user
// needs in order to fix it); `readTagColors` above is what decides, per
// entry, whether it actually colors anything.
//
// Unrecognized keys are preserved verbatim at BOTH levels, which is what makes
// D7 work and what keeps step 20 safe: step 15 writes a `quadrant` alongside
// `fg`/`bg` inside an entry, and step 20 writes a `weekStart` alongside `tags`
// at the top level. Since every write in this app is whole-document (D9), a
// normalize pass that dropped a field it didn't recognize would make a step-14
// color change silently erase a step-15 quadrant or a step-20 week-start
// setting — this only ever rewrites `tags`, never the rest of the document.
export function normalizeTagSettings(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const tags = {};
  const rawTags = source.tags;
  if (rawTags && typeof rawTags === "object" && !Array.isArray(rawTags)) {
    for (const [name, entry] of Object.entries(rawTags)) {
      tags[name] = entry && typeof entry === "object" && !Array.isArray(entry) ? { ...entry } : {};
    }
  }
  return { ...source, tags };
}

// D2 — THE COLOR RESOLUTION RULE, and it is NOT the rule step 15 needs.
//
// Color: the LAST tag in the title string that actually has colors assigned
// wins, scanning right-to-left through the string-order tag list and stopping
// at the first hit. product-spec.md §4 says "the last tag in the title text
// forces the color"; read literally that would mean an uncolored last tag
// STRIPS a task's color, which is surprising and almost certainly not what
// "forces the color" is describing — so the deliberate reading is "last
// COLORED tag wins" (recorded as an explicit spec interpretation in
// PROGRESS.md, not left silent).
//
// Quadrant (step 15) resolves COMPLETELY DIFFERENTLY and must not reuse this
// function or its shape: urgency and importance are each taken as the HIGHEST
// value any of the task's tags claims, independently of each other, escalating
// rather than averaging, across ALL tags — position in the string is
// irrelevant there. Two rules, one settings page, one entry object; do not
// collapse them.
export function resolveTagColor(title, tagSettings) {
  const tagsMap = tagSettings?.tags;
  if (!tagsMap) return null;
  const tags = parseTags(title);
  for (let i = tags.length - 1; i >= 0; i--) {
    const colors = readTagColors(tagsMap[tags[i]]);
    if (colors) return colors;
  }
  return null;
}

// D5: which tags the settings screen lists — the union of every tag on a
// non-deleted task and every tag already present in the settings map. The
// second half is not redundant: without it, deleting the last task that
// carried a tag would silently discard that tag's configured color, since the
// screen would stop offering any way to see or clear it while the entry
// itself lived on in the document forever.
//
// Sorted by name so the list doesn't reshuffle between renders (tags are
// `[#@]\w+`, i.e. ASCII, so a plain string comparison is a total order here).
export function collectTagNames(nonDeletedTasks, tagSettings) {
  const names = new Set();
  for (const task of nonDeletedTasks) {
    for (const tag of parseTags(task.title)) names.add(tag);
  }
  for (const name of Object.keys(tagSettings?.tags ?? {})) names.add(name);
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// --- Quadrant mapping (step 15) ---------------------------------------------
// Storage is a SINGLE enum string per entry (Q1) — `entry.quadrant` sits
// alongside `entry.fg`/`entry.bg` in the exact same object D1 (step 14) built
// to be extensible. Do NOT reintroduce this as two booleans: the spec (§7)
// talks about assigning "a quadrant," singular, and its own worked examples
// (`#p1` = important-not-urgent, `#deadline` = urgent-not-important) are whole
// quadrants a human picks directly — urgency/importance are only ever derived
// FROM this string, at resolve time, never stored as their own fields.
export const QUADRANT_URGENT_IMPORTANT = "urgent-important";
export const QUADRANT_IMPORTANT_ONLY = "not-urgent-important";
export const QUADRANT_URGENT_ONLY = "urgent-not-important";
export const QUADRANT_NEITHER = "not-urgent-not-important";

const VALID_QUADRANTS = new Set([
  QUADRANT_URGENT_IMPORTANT,
  QUADRANT_IMPORTANT_ONLY,
  QUADRANT_URGENT_ONLY,
  QUADRANT_NEITHER,
]);

// Every valid quadrant value, in the order the settings screen's <select>
// lists them (matching QUADRANT_RANK's order below, so the dropdown reads
// top-to-bottom in the same "most demanding first" sense the recommended
// order will eventually sort by).
export const QUADRANT_OPTIONS = [
  QUADRANT_URGENT_IMPORTANT,
  QUADRANT_IMPORTANT_ONLY,
  QUADRANT_URGENT_ONLY,
  QUADRANT_NEITHER,
];

const QUADRANT_LABELS = {
  [QUADRANT_URGENT_IMPORTANT]: "Urgent & important",
  [QUADRANT_IMPORTANT_ONLY]: "Important, not urgent",
  [QUADRANT_URGENT_ONLY]: "Urgent, not important",
  [QUADRANT_NEITHER]: "Neither urgent nor important",
};

// A compact per-quadrant token for the task-row badge (Q6) — the `title`
// attribute carries the words in full (describeQuadrant below); this is just
// what fits inline next to the due date/age without disturbing an RTL title.
const QUADRANT_BADGE_TEXT = {
  [QUADRANT_URGENT_IMPORTANT]: "U+I",
  [QUADRANT_IMPORTANT_ONLY]: "I",
  [QUADRANT_URGENT_ONLY]: "U",
  [QUADRANT_NEITHER]: "–",
};

export function describeQuadrant(quadrant) {
  return QUADRANT_LABELS[quadrant] ?? null;
}

export function quadrantBadgeText(quadrant) {
  return QUADRANT_BADGE_TEXT[quadrant] ?? null;
}

// Decomposes a quadrant enum into its two independent booleans. Internal only
// — nothing outside this module needs urgency/importance as separate values,
// since Q1 forbids storing them separately.
function decomposeQuadrant(quadrant) {
  switch (quadrant) {
    case QUADRANT_URGENT_IMPORTANT:
      return { urgent: true, important: true };
    case QUADRANT_IMPORTANT_ONLY:
      return { urgent: false, important: true };
    case QUADRANT_URGENT_ONLY:
      return { urgent: true, important: false };
    case QUADRANT_NEITHER:
      return { urgent: false, important: false };
    default:
      return null;
  }
}

// Recombines the two independently-resolved booleans back into one quadrant
// enum string — the inverse of decomposeQuadrant, used only by
// resolveTaskQuadrant below once urgency/importance have each been OR'd
// across a task's configured tags.
function composeQuadrant(urgent, important) {
  if (urgent && important) return QUADRANT_URGENT_IMPORTANT;
  if (important) return QUADRANT_IMPORTANT_ONLY;
  if (urgent) return QUADRANT_URGENT_ONLY;
  return QUADRANT_NEITHER;
}

// Reads the quadrant half of a settings entry, or null when this tag has no
// valid quadrant assigned (Q5) — mirrors readTagColors's shape exactly, so a
// tag can carry colors and no quadrant, or a quadrant and no colors, and a
// malformed/unrecognized value (Q1: "absent, null, or any unrecognized value")
// degrades to null rather than throwing anywhere downstream.
export function readTagQuadrant(entry) {
  if (!entry || typeof entry !== "object") return null;
  const { quadrant } = entry;
  return typeof quadrant === "string" && VALID_QUADRANTS.has(quadrant) ? quadrant : null;
}

// Q2/Q4 — THE QUADRANT RESOLUTION RULE, and it is NOT resolveTagColor's rule.
//
// Resolved from the TITLE string via parseTags (D12's precedent, never from
// the cached `tags` array), then urgency and importance are each taken
// independently as an OR across every CONFIGURED tag (readTagQuadrant !==
// null) the task carries — escalating, never averaging: a task tagged both
// `#p1` (important, not urgent) and `#deadline` (urgent, not important) lands
// in urgent-and-important even though no single tag put it there (§7's own
// example). String POSITION is irrelevant here, unlike resolveTagColor, where
// it's everything — two rules, one entry object, do not collapse them (D8).
//
// An unconfigured tag contributes NOTHING, not `false` — it is simply skipped
// (§7: "an unconfigured tag stays silent rather than defaulting into a
// quadrant"). Critically, if NONE of the task's tags carries a valid
// quadrant, this returns `null` ("unranked"), which is a DIFFERENT state from
// QUADRANT_NEITHER ("explicitly neither urgent nor important" — still ranked,
// still part of the matrix). Conflating the two would make an unmapped task
// rank identically to one whose only configured tag explicitly said "bottom
// quadrant," when the spec's whole point is that the former isn't part of the
// matrix at all and the latter is.
export function resolveTaskQuadrant(title, tagSettings) {
  const tagsMap = tagSettings?.tags;
  if (!tagsMap) return null;

  let urgent = false;
  let important = false;
  let anyConfigured = false;

  for (const tag of parseTags(title)) {
    const quadrant = readTagQuadrant(tagsMap[tag]);
    if (!quadrant) continue; // unconfigured tag: contributes nothing (Q2)
    anyConfigured = true;
    const decomposed = decomposeQuadrant(quadrant);
    if (decomposed.urgent) urgent = true;
    if (decomposed.important) important = true;
  }

  if (!anyConfigured) return null; // unranked — distinct from QUADRANT_NEITHER
  return composeQuadrant(urgent, important);
}

// Q3 — the recommended-order rank, lower sorts first. Defined here, not in
// step 16, so step 16's comparator just imports and consumes it rather than
// re-deriving it. Important-before-urgent (rank 1 vs rank 2) is standard
// Eisenhower framing (schedule outranks delegate) — the spec itself is silent
// on the tie-order between the two single-dimension quadrants, so this is the
// step's own recorded call (see PROGRESS.md's Decisions log). `null`
// (unranked — no configured tag at all) is deliberately WORSE than every
// explicit quadrant, including QUADRANT_NEITHER: an explicit "neither" is
// still a real answer from a real tag mapping, while `null` is no information
// at all, and product-spec.md's "recommended order" can only ever act on
// tasks it actually has an opinion about.
const QUADRANT_RANK = {
  [QUADRANT_URGENT_IMPORTANT]: 0,
  [QUADRANT_IMPORTANT_ONLY]: 1,
  [QUADRANT_URGENT_ONLY]: 2,
  [QUADRANT_NEITHER]: 3,
};
const UNRANKED_RANK = 4;

export function quadrantRank(quadrant) {
  return quadrant == null ? UNRANKED_RANK : QUADRANT_RANK[quadrant] ?? UNRANKED_RANK;
}

// --- Priority ordering (step 16) ---------------------------------------------
// R2/R3 (locked by the orchestrator): a task's rank is NEVER stored — it's
// recomputed from the title + tag settings on every render, exactly like
// resolveTagColor/resolveTaskQuadrant above, so an edited tag mapping can
// never leave a stale rank sitting on a document with no write having
// touched it. R3 forbids calling resolveTaskQuadrant/quadrantRank from
// inside a sort comparator (that would re-parse every title on every one of
// an O(n log n) sort's comparisons) — this is the one shared helper every
// caller builds ONCE per render/drag pass instead: render.js's
// compareSiblings/flattenTree/computeMainListOrderIndex read from the Map
// this returns, and app.js's drag machinery
// (beginDrag/updateDragTarget/finishDrag/performReparent) builds its own
// once per gesture for the identical reason — never inside a pointermove
// handler.
export function computeQuadrantRankMap(tasks, tagSettings) {
  const rankMap = new Map();
  for (const task of tasks) {
    rankMap.set(task.id, quadrantRank(resolveTaskQuadrant(task.title, tagSettings)));
  }
  return rankMap;
}
