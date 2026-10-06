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
  return cleanName(raw).split(" ")[0] || "there";
}
