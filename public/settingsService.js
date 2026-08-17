// Owns the Firestore round trip for the user's settings document
// (users/{uid}/meta/settings). Mirrors taskService.js's two rules exactly:
//   - Writes are whole-document (setDoc), never a partial updateDoc, so a save
//     always replaces the document rather than merging fields into it (step 1's
//     conflict rule, applied to settings for the same reason it applies to
//     tasks: the spec's rule is that a later write replaces, and updateDoc
//     merges).
//   - Reads normalize on the way in, so every downstream consumer can assume
//     the shape is `{ tags: { ... } }` instead of null-checking everywhere.
//
// Step 14 (D1) is the FIRST code in this repo to touch the `meta` collection.
// The document id is the literal string "settings" — one document holding
// every per-user preference, not one document per tag. Reasons:
//   - The whole map is read on every refresh and rendered as one screen, so a
//     per-tag document would be N reads to draw one list.
//   - `firestore.rules`' isValidSettings() (already deployed, unchanged by this
//     step per D6) caps `tags` at 500 keys and validates a `weekStart` field
//     alongside it — a shape that only makes sense for one shared document.
//   - Step 15 extends each tag's ENTRY with a quadrant rather than forking a
//     second map, and step 20 adds `weekStart` to the same document. Neither
//     needs a new collection.
//
// D6: this writes fine under the deployed rules today — isValidSettings()
// accepts any `tags` map of <= 500 keys and does not constrain entry shape —
// so no rules change ships with this step. D7: only `fg`/`bg` are written
// here; `quadrant` belongs to step 15 and no groundwork for it is laid.
// `weekStart` is deliberately never written by this module — that field is
// step 20's, and writing a default for it now would silently pick the user's
// week-start setting for them before the UI that owns it exists.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./auth.js";
import { normalizeTagSettings } from "./tagColors.js";

// One document per user holds every setting. See the module comment above for
// why this isn't a document (or a collection) per tag.
const SETTINGS_DOC_ID = "settings";

function settingsRef(userId) {
  return doc(db, "users", userId, "meta", SETTINGS_DOC_ID);
}

// D10: a settings document that has never been written yet is the normal case
// for every existing user of this app (nothing has ever written `meta` before
// step 14), so a missing document is not an error — it degrades to "no colors"
// exactly like an empty map would. The first color the user assigns is what
// creates the document.
export const fetchSettings = async (userId) => {
  try {
    const snapshot = await getDoc(settingsRef(userId));
    return normalizeTagSettings(snapshot.exists() ? snapshot.data() : null);
  } catch (error) {
    console.error("Error fetching settings: ", error);
    throw error;
  }
};

// D9: whole-document setDoc, never updateDoc — same rule as saveTask. The
// caller passes the COMPLETE settings object (spread the current one and
// override just the changed tag), not a patch.
//
// The 500-key cap mirrors firestore.rules' isValidSettings(), checked here for
// the same reason taskService.js checks the title/tags caps client-side: a cap
// hit surfaces as a readable message instead of an opaque permission-denied.
export const saveSettings = async (userId, settings) => {
  try {
    const normalized = normalizeTagSettings(settings);
    if (Object.keys(normalized.tags).length > 500) {
      throw new Error("At most 500 tags can have settings.");
    }
    // Whole-document write. `normalized` is deliberately what goes out rather
    // than the caller's raw object: it is the same shape a read hands back, so
    // a write-then-read round trip can never change the document's shape.
    // normalizeTagSettings only ever rewrites `tags` and copies every other
    // top-level field through untouched, so a color change here can never
    // erase step 20's `weekStart` even though this module never writes one.
    await setDoc(settingsRef(userId), normalized);
  } catch (error) {
    console.error("Error saving settings: ", error);
    throw error;
  }
};
