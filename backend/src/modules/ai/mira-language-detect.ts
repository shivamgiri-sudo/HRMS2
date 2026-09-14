/**
 * Script-based language detection for Mira.
 *
 * Deliberately script-based rather than model-based: the only question this has
 * to answer is "which language should Mira reply in", and for the Indic
 * languages this workforce actually writes in, the Unicode block is already a
 * decisive signal. That keeps detection synchronous, dependency-free and off the
 * network, so it can run on every turn inside recordTurn() without adding
 * latency to the chat path.
 *
 * The known limit is romanised input. "mujhe chutti chahiye" is Hindi written in
 * Latin script and this returns null for it, because there is no script signal
 * to read — the request falls through to Mira's default English. That is the
 * honest failure mode; guessing a language from Latin-script word shapes would
 * misfire on ordinary English questions, which are the overwhelming majority.
 */

export type DetectedLangCode = 'hi' | 'te' | 'ta' | 'bn' | 'gu' | 'kn' | 'ml' | 'pa';

export interface DetectedLang {
  code: DetectedLangCode;
  /** Endonym, shown to the user in the chat header badge. */
  name: string;
  rtl: boolean;
}

interface ScriptRange {
  code: DetectedLangCode;
  name: string;
  rtl: boolean;
  start: number;
  end: number;
}

/**
 * Unicode block per language. Devanagari (0900–097F) is shared by Hindi and
 * Marathi and cannot be split by script alone, so it resolves to Hindi — the far
 * more common of the two here. The cost of that choice is small: an instruction
 * to answer in Devanagari Hindi still produces text a Marathi reader can read,
 * whereas a wrong guess in the other direction would not.
 */
const SCRIPT_RANGES: ScriptRange[] = [
  { code: 'hi', name: 'हिंदी', rtl: false, start: 0x0900, end: 0x097F },
  { code: 'bn', name: 'বাংলা', rtl: false, start: 0x0980, end: 0x09FF },
  { code: 'pa', name: 'ਪੰਜਾਬੀ', rtl: false, start: 0x0A00, end: 0x0A7F },
  { code: 'gu', name: 'ગુજરાતી', rtl: false, start: 0x0A80, end: 0x0AFF },
  { code: 'ta', name: 'தமிழ்', rtl: false, start: 0x0B80, end: 0x0BFF },
  { code: 'te', name: 'తెలుగు', rtl: false, start: 0x0C00, end: 0x0C7F },
  { code: 'kn', name: 'ಕನ್ನಡ', rtl: false, start: 0x0C80, end: 0x0CFF },
  { code: 'ml', name: 'മലയാളം', rtl: false, start: 0x0D00, end: 0x0D7F },
];

/**
 * Share of non-whitespace characters that must sit in one script before it wins.
 * 30% rather than a bare "any match" because HRMS questions are routinely mixed
 * — "how do I apply for छुट्टी" is an English question with one Hindi noun, and
 * answering it wholly in Hindi would be worse than answering in English.
 */
const DETECTION_THRESHOLD = 0.3;

/**
 * The dominant non-Latin script language of a message, or null when the text is
 * English, romanised, or too mixed for any single script to clear the threshold.
 */
export function detectLanguage(text: string): DetectedLang | null {
  const chars = [...String(text ?? '')].filter((char) => char.trim().length > 0);
  if (chars.length === 0) return null;

  const counts = new Map<DetectedLangCode, number>();
  for (const char of chars) {
    const codePoint = char.codePointAt(0) ?? 0;
    for (const range of SCRIPT_RANGES) {
      if (codePoint >= range.start && codePoint <= range.end) {
        counts.set(range.code, (counts.get(range.code) ?? 0) + 1);
        break;
      }
    }
  }

  let best: { range: ScriptRange; ratio: number } | null = null;
  for (const range of SCRIPT_RANGES) {
    const ratio = (counts.get(range.code) ?? 0) / chars.length;
    if (ratio >= DETECTION_THRESHOLD && (!best || ratio > best.ratio)) {
      best = { range, ratio };
    }
  }

  if (!best) return null;
  return { code: best.range.code, name: best.range.name, rtl: best.range.rtl };
}
