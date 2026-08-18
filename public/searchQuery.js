// Search — basic (step 19) + advanced (step 20). Pure functions only: no
// DOM, no Firestore, same standing as taskTree.js and tagColors.js. This
// module exists so app.js's renderMainView can filter the tree without
// owning any matching logic itself.
//
// Step 19 built `matchesTerm(task, term)` as a standalone leaf evaluator
// specifically so step 20 could hang a boolean AND/OR/parentheses grammar
// over it without touching this file's callers (render.js/app.js) at all —
// see S19-1/S20's file-header note in step19-decisions.md. That promise is
// now cashed in below: `parseSearchQuery` turns a raw query string into an
// AST (product-spec.md §6:159-165, :175-187 — AND/OR/parens, mixed sigil
// distribution, and the temporal/age/overdue leaf kinds step 19
// deliberately left out), and `matchingTaskIds` walks that AST calling
// `matchesTerm` (unchanged) at every word/tag leaf. Whitespace-separated
// bare words/tags — step 19's entire vocabulary — parse as a flat implicit
// AND (S19-3, S20 grammar's `andExpr`), so every step-19 query produces the
// exact same match set it always did; nothing here may change that.
import { buildTree, ancestorChain } from "./taskTree.js";
// S20-10: localMidnight/timestampToDate/isOverdueTask are reused from
// render.js rather than re-implemented here — importing them is the only
// option that adds zero duplication (a private copy would be the THIRD
// local-midnight implementation in the repo, after render.js and
// recurrence.js). render.js does not import this module, so this is not a
// cycle.
import { localMidnight, timestampToDate, isOverdueTask } from "./render.js";

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

// ---------------------------------------------------------------------------
// Step 20 (Search — advanced) — grammar
//
//   query      := orExpr
//   orExpr     := andExpr ( OR andExpr )*
//   andExpr    := primary ( (AND)? primary )*        // juxtaposition is AND (S19-3)
//   primary    := sigilGroup | group | term
//   group      := "(" query ")"
//   sigilGroup := SIGIL "(" query ")"
//   term       := overdueTerm | dateTerm | ageTerm | tagTerm | word
//
//   SIGIL       := "#" | "@"
//   AND         := "AND"   (case-insensitive, S20-3)
//   OR          := "OR"    (case-insensitive, S20-3)
//   overdueTerm := "overdue"
//   dateTerm    := "today" | "this week" | "this month"
//   ageTerm     := "age" ( ">" | "<" ) INT ( "d" | "m" )
//   tagTerm     := SIGIL WORD
//   word        := any run of non-space, non-paren characters
//
// This grammar and every S20-n decision it cites were settled by the
// orchestrator BEFORE this code was written (see the step 20 Decisions log
// entries below) — nothing here revisits them. AND/OR are the only
// keywords called out as case-insensitive (S20-3); `overdue`/`today`/
// `this`/`week`/`month`/`age` are matched literally (lowercase), same as
// the grammar quotes them, so a capitalized "Today" is a bare word, not a
// hole in the design — an explicit, minimal reading of an otherwise-silent
// grammar, not a deviation from a stated decision.
// ---------------------------------------------------------------------------

// A tokenizer, not a character-by-character scanner: parentheses always act
// as delimiters (the grammar's `word` production explicitly excludes them),
// so splitting on them up front means the parser below never has to peek
// inside a "word" token to find a hidden paren. `#(`/`@(` are matched as
// SINGLE tokens (checked before the bare `(` alternative) specifically so
// "#(private OR pr)" tokenizes as `["#(", "private", "OR", "pr", ")"]` — the
// sigil and its paren travel together, which is what lets parsePrimary tell
// a sigilGroup apart from a plain group with one token lookahead.
const TOKEN_PATTERN = /#\(|@\(|\(|\)|[^\s()]+/g;

function tokenize(rawQuery) {
  return String(rawQuery ?? "").match(TOKEN_PATTERN) || [];
}

// Thrown only for genuinely malformed input (S20-9) — unbalanced
// parentheses, a dangling AND/OR, or a lone operator with no term. Never
// exposed as a raw stack trace: `parseSearchQuery` catches this and hands
// the caller a plain-English `.message` to show beside the search box.
class SearchParseError extends Error {}

// `age > 20d` / `age>20d` / `age >20d` / `age> 20d` all lex to the same
// three possible tokens ("age", the operator, the number+unit) split at
// different points — S20-6's "whitespace around the operator is free".
// Concatenating 1, 2, or 3 consecutive tokens with NO separator and testing
// the result against this pattern reconstructs the original text exactly
// regardless of where the whitespace fell, because none of "age"/">"/"<"/
// digits/"d"/"m" ever contains a space itself. Row 27's `age > 20` (no
// unit) matches at none of the three lengths, which is exactly what makes
// it fall through to three bare words instead of a silently-assumed unit.
const AGE_TERM_PATTERN = /^age([<>])(\d+)([dm])$/;

function classifyAgeTerm(tokens, pos) {
  for (let length = 1; length <= 3 && pos + length <= tokens.length; length++) {
    const joined = tokens.slice(pos, pos + length).join("");
    const match = AGE_TERM_PATTERN.exec(joined);
    if (match) {
      return {
        consumed: length,
        term: { type: "term", kind: "age", op: match[1], amount: Number(match[2]), unit: match[3] },
      };
    }
  }
  return null;
}

// Classifies the term starting at `pos`, returning how many tokens it
// consumed (1 for everything except `this week`/`this month`, which are 2
// — dateTerm's own grammar line is the only two-word term). Tried in the
// grammar's own `term` order (overdueTerm | dateTerm | ageTerm | tagTerm |
// word) since it is a priority order, not an ambiguous one: nothing here
// can match two of these alternatives at once, so trying them in any order
// would give the same result, but this order mirrors the grammar for
// anyone reading both side by side.
function classifyTerm(tokens, pos) {
  const token = tokens[pos];

  if (token === "overdue") {
    return { consumed: 1, term: { type: "term", kind: "overdue" } };
  }

  if (token === "today") {
    return { consumed: 1, term: { type: "term", kind: "date", value: "today" } };
  }
  if (token === "this" && pos + 1 < tokens.length) {
    const next = tokens[pos + 1];
    if (next === "week" || next === "month") {
      return { consumed: 2, term: { type: "term", kind: "date", value: next } };
    }
  }

  const ageTerm = classifyAgeTerm(tokens, pos);
  if (ageTerm) return ageTerm;

  if (TAG_TERM_PATTERN.test(token)) {
    return { consumed: 1, term: { type: "term", kind: "tag", value: token } };
  }

  return { consumed: 1, term: { type: "term", kind: "word", value: token } };
}

// S20-4 — sigil distribution. Pushes `sigil` onto every BARE-WORD leaf of
// an already-parsed subtree, recursively. The three exceptions the
// decision names all fall out of this one rule with no extra bookkeeping:
//   1. A leaf that already carries its own sigil (kind "tag") is left
//      alone — the `if (kind !== "word") return node` branch below.
//   2. A nested sigil group stops the outer sigil at its boundary: by the
//      time THIS function runs on the outer group's body, any nested
//      sigilGroup inside it already had ITS OWN distribution applied (see
//      parsePrimary's sigilGroup case, which calls this function the
//      moment that inner group closes) — so every leaf under a nested
//      group is already "tag" kind, never "word", by the time the outer
//      call walks over it. No group-boundary tracking needed; recursion
//      order alone makes this correct.
//   3. Temporal/overdue/age terms are classified during lexing (see
//      classifyTerm above), BEFORE this function ever runs — a bare
//      "overdue" is already `{kind:"overdue"}`, never `{kind:"word",
//      value:"overdue"}`, so `#(private OR overdue)` can only ever
//      distribute onto "private". This is S20-4.3's "easiest thing to get
//      wrong" — and it is unreachable to get wrong here, because the word
//      leaf it would need to see never exists.
function applySigilDistribution(node, sigil) {
  if (node.type === "and" || node.type === "or") {
    return { type: node.type, terms: node.terms.map((term) => applySigilDistribution(term, sigil)) };
  }
  if (node.kind !== "word") return node; // tag/overdue/date/age: immune (exceptions 1 and 3)
  return { type: "term", kind: "tag", value: `${sigil}${node.value}` };
}

// Hand-written recursive-descent parser over the token array produced by
// `tokenize`. Returns the AST (an "and"/"or" node with a `terms` array, or
// a bare `{type:"term", ...}` leaf when the whole query is a single term)
// or throws SearchParseError. Kept as one function with nested closures
// (rather than a class) because the whole parser is ~40 lines and every
// helper only ever needs the shared `pos` cursor — no state a class would
// clarify that a closure doesn't already give for free.
function runParser(tokens) {
  let pos = 0;

  const peek = () => tokens[pos];
  const atEnd = () => pos >= tokens.length;
  const isAnd = (token) => typeof token === "string" && token.toLowerCase() === "and";
  const isOr = (token) => typeof token === "string" && token.toLowerCase() === "or";

  function parseOrExpr() {
    const terms = [parseAndExpr()];
    while (!atEnd() && isOr(peek())) {
      pos++; // consume OR
      if (atEnd() || peek() === ")" || isOr(peek()) || isAnd(peek())) {
        throw new SearchParseError("expected a term after OR");
      }
      terms.push(parseAndExpr());
    }
    return terms.length === 1 ? terms[0] : { type: "or", terms };
  }

  function parseAndExpr() {
    const terms = [parsePrimary()];
    while (!atEnd() && peek() !== ")" && !isOr(peek())) {
      if (isAnd(peek())) {
        pos++; // consume the explicit AND
        if (atEnd() || peek() === ")" || isOr(peek()) || isAnd(peek())) {
          throw new SearchParseError("expected a term after AND");
        }
      }
      // No `pos++` in the implicit-AND branch — juxtaposition (S19-3) means
      // the next primary starts right where we already are.
      terms.push(parsePrimary());
    }
    return terms.length === 1 ? terms[0] : { type: "and", terms };
  }

  function parsePrimary() {
    const token = peek();
    if (token === undefined) throw new SearchParseError("expected a term");

    if (token === "(") {
      pos++;
      const inner = parseOrExpr();
      if (peek() !== ")") throw new SearchParseError("unbalanced parenthesis");
      pos++;
      return inner; // a plain group is transparent to the AST — S20-4's row 5/6 equivalence
    }

    if (token === "#(" || token === "@(") {
      const sigil = token[0];
      pos++;
      const inner = parseOrExpr();
      if (peek() !== ")") throw new SearchParseError("unbalanced parenthesis");
      pos++;
      return applySigilDistribution(inner, sigil);
    }

    if (isAnd(token) || isOr(token)) {
      throw new SearchParseError(`"${token}" is not a term`); // row 26: a lone operator
    }

    const { term, consumed } = classifyTerm(tokens, pos);
    pos += consumed;
    return term;
  }

  const ast = parseOrExpr();
  if (!atEnd()) throw new SearchParseError("unbalanced parenthesis");
  return ast;
}

// Entry point: turns a raw query string into `{ ast, error }`. `ast` is
// `null` for a blank/whitespace-only query (row 25) — a genuinely different
// case from a parse error (S20-9 distinguishes "no query" from "invalid
// query": the former filters nothing and shows no message; the latter also
// filters nothing but DOES show a message). Exported so verification code
// can inspect the AST directly (e.g. confirming rows 5/6 produce identical
// trees) without reaching into the parser's internals.
export function parseSearchQuery(rawQuery) {
  const tokens = tokenize(rawQuery);
  if (tokens.length === 0) return { ast: null, error: null };
  try {
    return { ast: runParser(tokens), error: null };
  } catch (error) {
    if (error instanceof SearchParseError) return { ast: null, error: error.message };
    throw error;
  }
}

// S20-5 — age reads the SAME clock the row itself displays:
// `occurrenceStart ?? createdAt`, byte-identical to render.js's
// `updateTaskElement` (render.js:792). Spec:178-180 says age filters read
// "the creation date," but step 18 already made the displayed age reset on
// each recurrence advance (S18-3) — a query language whose numbers disagree
// with the numbers on screen would be unusable, so this resolves the
// apparent conflict by matching the screen, not the literal spec text.
function ageSourceDate(task) {
  return timestampToDate(task.occurrenceStart ?? task.createdAt);
}

// Precedent: render.js's `computeAgeLabel` (render.js:306-318) floors this
// exact whole-local-calendar-day difference via `localMidnight` — reused
// here as MATH, not as a call, because that function returns a formatted
// string ("5 days old"), not the number this comparison needs (S20-10).
function ageInWholeDays(ageDate, now) {
  return Math.floor((localMidnight(now).getTime() - localMidnight(ageDate).getTime()) / 86400000);
}

// S20-6's month unit is CALENDAR months, not 30-day blocks — the same
// end-of-month clamping recurrence.js's `addMonthsClamped` (recurrence.js:
// 74, not exported) uses, mirrored here with a negative offset since that
// function only ever steps forward. Re-anchors from `date`'s OWN
// day-of-month every call (never from an already-clamped previous result),
// which is what makes Mar 31 -> "3m ago" land on Dec 31 rather than
// degrading permanently to a shorter month once one clamp has happened.
function monthsAgoClamped(date, months) {
  const targetIndex = date.getMonth() - months;
  const year = date.getFullYear() + Math.floor(targetIndex / 12);
  const month = ((targetIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.min(date.getDate(), daysInTargetMonth);
  return new Date(year, month, day);
}

function evaluateAgeTerm(task, term, context) {
  const ageDate = ageSourceDate(task);
  if (!ageDate) return false; // no creation date to compare against — never matches, same "can't answer" stance isOverdueTask takes for a missing dueDate

  if (term.unit === "d") {
    const days = ageInWholeDays(ageDate, context.now);
    return term.op === ">" ? days > term.amount : days < term.amount;
  }

  // unit === "m": compare against a calendar-month CUTOFF DATE rather than
  // a day count (S20-6) — "age < 3m" means the age date is strictly AFTER
  // (today minus 3 months); "age > 3m" means strictly BEFORE it.
  const cutoff = monthsAgoClamped(localMidnight(context.now), term.amount);
  const ageMidnight = localMidnight(ageDate);
  return term.op === ">" ? ageMidnight.getTime() < cutoff.getTime() : ageMidnight.getTime() > cutoff.getTime();
}

// S20-8 — the week-start setting is the STRING 'sunday'/'monday' that
// firestore.rules already reserves, not a 0/1 index; this is the one and
// only place that string is translated into the day-of-week index
// Date#getDay() uses, so the rest of this module never has to know the
// setting is stored as a word rather than a number.
const WEEK_START_DAY_INDEX = { sunday: 0, monday: 1 };

// S20-7 — date terms read `dueDate`, never `age`'s source; a task with no
// due date matches none of them (an absent value can't be "today" any more
// than a null number can be "> 5"). All three compare LOCAL calendar days
// via `localMidnight` — never `new Date("YYYY-MM-DD")`, which parses as UTC
// and lands a day early west of Greenwich (the hazard this repo has hit
// before, per D2/D3 in render.js).
function evaluateDateTerm(task, value, context) {
  const dueDate = timestampToDate(task.dueDate);
  if (!dueDate) return false;
  const dueMidnight = localMidnight(dueDate);
  const todayMidnight = localMidnight(context.now);

  if (value === "today") {
    return dueMidnight.getTime() === todayMidnight.getTime();
  }

  if (value === "week") {
    // Walk backward from today to the most recent day whose weekday equals
    // the configured week-start day, then take the 6 days after it — this
    // is what makes "this week" a fixed calendar block instead of a
    // rolling 7-day window (spec:177-178), and what makes today itself
    // land as the LAST day of the week when the setting is Monday (row 15).
    const weekStartIndex = WEEK_START_DAY_INDEX[context.weekStart] ?? WEEK_START_DAY_INDEX.sunday;
    const daysSinceWeekStart = (todayMidnight.getDay() - weekStartIndex + 7) % 7;
    const weekStart = new Date(todayMidnight);
    weekStart.setDate(weekStart.getDate() - daysSinceWeekStart);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return dueMidnight.getTime() >= weekStart.getTime() && dueMidnight.getTime() <= weekEnd.getTime();
  }

  // value === "month": the calendar month `now` falls in, first day to
  // last day inclusive — `new Date(y, m+1, 0)` is the standard idiom for
  // "the last day of month m" (one day before the 1st of the next month).
  const monthStart = new Date(todayMidnight.getFullYear(), todayMidnight.getMonth(), 1);
  const monthEnd = new Date(todayMidnight.getFullYear(), todayMidnight.getMonth() + 1, 0);
  return dueMidnight.getTime() >= monthStart.getTime() && dueMidnight.getTime() <= monthEnd.getTime();
}

// Walks the AST, calling S19-2's unchanged `matchesTerm` at every word/tag
// leaf and the new temporal evaluators above at every overdue/date/age
// leaf. `node === null` (a blank query, or the vacuous base case) matches
// every task, same as S19-3's "zero terms" rule — this is the one line
// that makes an empty search box behave identically before and after this
// step.
function evaluateNode(node, task, context) {
  if (node === null) return true;
  if (node.type === "and") return node.terms.every((child) => evaluateNode(child, task, context));
  if (node.type === "or") return node.terms.some((child) => evaluateNode(child, task, context));

  switch (node.kind) {
    case "word":
    case "tag":
      return matchesTerm(task, node.value); // S19-1: the exact same leaf function, untouched
    case "overdue":
      return isOverdueTask(task, context.now);
    case "date":
      return evaluateDateTerm(task, node.value, context);
    case "age":
      return evaluateAgeTerm(task, node, context);
    default:
      return false;
  }
}

// S19-3 (whitespace is implicit AND) survives here as the degenerate case
// of the S20 grammar: `foo bar` tokenizes to two bare-word terms with no
// operator between them, `parseAndExpr`'s implicit-AND branch joins them
// into one `and` node, and `evaluateNode` requires both to match — bit-for-
// bit the same result step 19 produced with its own whitespace-split
// implementation, just reached by parsing instead of splitting.
//
// `context` carries what the temporal terms need and nothing else: `now`
// (defaults to the real clock; overridable so this can be exercised against
// a fixed synthetic "today" — same pattern as isOverdueTask/
// computeAgeLabel) and `weekStart` (S20-8's 'sunday'/'monday' string,
// defaulting to 'sunday' per the setting's own documented default so a
// caller that hasn't read the setting yet still gets spec-correct
// behavior).
//
// Returns `{ matches, error }` rather than a bare Set (step 19's shape)
// because a parse error (S20-9) has to be distinguishable from "valid query,
// zero results" — `matches` is `null` on error, an actual (possibly empty)
// Set otherwise. The caller (app.js's renderMainView) is what turns a
// non-null `error` into "show everyone, plus this message beside the box."
export function matchingTaskIds(rawQuery, tasks, context = {}) {
  const { ast, error } = parseSearchQuery(rawQuery);
  if (error) return { matches: null, error };

  const evalContext = {
    now: context.now ?? new Date(),
    weekStart: context.weekStart ?? "sunday",
  };
  const matches = new Set();
  for (const task of tasks) {
    if (evaluateNode(ast, task, evalContext)) matches.add(task.id);
  }
  return { matches, error: null };
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
