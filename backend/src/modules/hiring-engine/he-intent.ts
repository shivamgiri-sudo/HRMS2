/**
 * Candidate reply intent for the walk-in invite flow. Replies are short Hinglish/English texts or
 * quick-reply button payloads. Order matters: opt-out and decline are checked before confirm so
 * "nahi aaunga" is never read as a yes, and "no" never matches inside another word.
 */
export type ReplyIntent = "confirm" | "reschedule" | "decline" | "opt_out" | "on_my_way" | "unknown";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasWord = (t: string, words: string[]) => words.some((w) => new RegExp(`(^| )${w}( |$)`).test(t));

export function parseReplyIntent(text: string | null | undefined): ReplyIntent {
  if (!text) return "unknown";
  const t = norm(text);
  if (!t) return "unknown";

  if (hasWord(t, ["stop", "unsubscribe", "band karo", "mat bhejo", "dnd"]) || /\bstop\b/.test(t)) return "opt_out";
  if (t === "3" || hasWord(t, ["nahi", "nahin", "no", "not interested", "interested nahi", "cancel"])) {
    // "nahi aa sakta, kal aunga" is a reschedule, not a decline
    if (hasWord(t, ["kal", "parso", "baad", "later", "tomorrow", "reschedule"])) return "reschedule";
    return "decline";
  }
  if (t === "2" || hasWord(t, ["reschedule", "baad", "later", "kal", "parso", "tomorrow", "change"])) return "reschedule";
  if (hasWord(t, ["nikal", "nikla", "nikli", "raste", "rasta", "on my way", "omw", "pahunch"])) return "on_my_way";
  if (
    t === "1" ||
    hasWord(t, ["yes", "haan", "han", "ha", "ok", "okay", "confirm", "confirmed", "aaunga", "aaungi", "aunga", "aungi", "pakka", "done"])
  )
    return "confirm";
  return "unknown";
}
