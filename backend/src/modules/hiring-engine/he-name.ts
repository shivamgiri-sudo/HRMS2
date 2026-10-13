/**
 * Candidate display names (pure). Meta/portal leads often type their name in decorative Unicode ("Ñítîń", "𝓡𝓪𝓿𝓲"),
 * repeat words or add emoji; addressing them with that raw text looks broken. NFKC maps styled letters to plain ones,
 * NFKD + stripping combining marks removes accents, then anything that is not a letter is dropped and words title-cased.
 */
const COMBINING = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;
const NOT_NAME = /^(mr|mrs|ms|miss|dr|sir|madam|candidate|test|na|n\/a|null|none|unknown|user|hr)$/i;

export function cleanName(raw: unknown): string {
  // Markup or links typed into a name field are dropped whole (so "<b>Rohan</b>" and "<img src=x onerror=..> Rohan" both give Rohan).
  const text = String(raw ?? "").replace(/<[^>]*>?/g, " ").replace(/https?:\/\/\S+/gi, " ");
  const plain = text.normalize("NFKC").normalize("NFKD").replace(COMBINING, "");
  const words = plain.split(/[^\p{L}\p{M}]+/u).filter((w) => w.length > 1 && !NOT_NAME.test(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(/^[a-z]+$/i.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w);
  }
  return out.slice(0, 4).join(" ").normalize("NFC");
}

/** First name to greet with; "there" when nothing usable is left ("Hi there"). */
export function displayFirstName(raw: unknown): string {
  // A decorative or spaced-out form name ("Engineer-p-r-i-n-c-e") is not a first name: greet with "there" instead of printing nonsense.
  const first = cleanName(raw).split(" ")[0] || "";
  return (decorative(raw) ? "" : first) || "there";
}

/** Letters strung together with separators: three or more single-letter pieces in a row is decoration, not a name. */
function decorative(raw: unknown): boolean {
  return /(?:^|[\s\-_.])(?:\p{L}[\s\-_.]+){3,}\p{L}(?:$|[\s\-_.])/u.test(String(raw ?? "").normalize("NFKC"));
}

/**
 * The name to greet a candidate with in a letter, or "" when the form name is not a real first name: decorative or spaced-out letters
 * ("Engineer-p-r-i-n-c-e", "ⓇⒶⒽⓊⓁ"), a lone initial, or a label ("Candidate"). The caller then writes "Dear Candidate,".
 */
export function greetingName(raw: unknown): string {
  const text = String(raw ?? "").normalize("NFKC");
  if (decorative(raw)) return "";
  const first = cleanName(text).split(" ")[0] ?? "";
  if (first.length < 2 || first.length > 20) return "";
  // After folding, a name must still be mostly letters of one script (emoji, symbols and boxed letters fold away or fail this test).
  const letters = [...first].filter((c) => /\p{L}/u.test(c)).length;
  if (letters < first.length) return "";
  return first;
}
