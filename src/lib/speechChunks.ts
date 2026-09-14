/**
 * Splitting streamed text into speakable sentences.
 *
 * Spoken replies used to wait for the whole answer, which is the difference
 * between an assistant and a form that eventually reads itself out. Speaking
 * each sentence as it completes means the voice starts within a sentence of the
 * first token instead of after the last one.
 *
 * The hard part is not finding full stops — it is not finding them where they
 * are not. Mira's answers are full of "11.5 days available", "3.4% of your
 * working days" and "82,000". Splitting on a naive /[.!?]/ would speak "eleven
 * point" and then "five days available" as separate utterances, with a pause in
 * the middle of a number.
 */

/** A '.' that sits between digits is a decimal point, not a sentence ending. */
const SENTENCE_END = /([.!?]+)(\s+|$)/g;

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st',
  'vs', 'etc', 'eg', 'ie', 'approx', 'no', 'inc', 'ltd', 'pvt', 'co',
]);

function endsOnAbbreviation(text: string): boolean {
  const match = text.match(/(?:^|\s)([A-Za-z]{1,6})\.$/);
  if (!match) return false;
  return ABBREVIATIONS.has(match[1].toLowerCase());
}

function isDecimalPoint(text: string, index: number): boolean {
  return /\d/.test(text[index - 1] ?? '') && /\d/.test(text[index + 1] ?? '');
}

/**
 * Pull every complete sentence out of a growing buffer, leaving the unfinished
 * tail behind for the next chunk.
 *
 * A newline also closes a unit: Mira answers in bullet lists, and a bullet is a
 * sentence for speaking purposes whether or not it ends in a full stop.
 */
export function takeSpeakableSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < buffer.length; i += 1) {
    const char = buffer[i];

    if (char === '\n') {
      const piece = buffer.slice(start, i).trim();
      if (piece) sentences.push(piece);
      start = i + 1;
      continue;
    }

    if (char !== '.' && char !== '!' && char !== '?') continue;
    if (char === '.' && isDecimalPoint(buffer, i)) continue;

    // Run past "?!" and "..." so they close once, not once per mark.
    let end = i;
    while (end + 1 < buffer.length && '.!?'.includes(buffer[end + 1])) end += 1;

    const next = buffer[end + 1];
    // Only a following space or the very end closes a sentence; mid-token dots
    // (URLs, file names, version numbers) are left alone.
    if (next !== undefined && !/\s/.test(next)) {
      i = end;
      continue;
    }
    if (next === undefined) break; // may still be mid-word — wait for more text

    const piece = buffer.slice(start, end + 1).trim();
    if (piece && !endsOnAbbreviation(piece)) {
      sentences.push(piece);
      start = end + 1;
    }
    i = end;
  }

  return { sentences, rest: buffer.slice(start) };
}

/** Strip the markdown and symbols that a speech engine reads out literally. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[•*_#`>|]/g, ' ')
    .replace(/₹/g, ' rupees ')
    .replace(/\s+/g, ' ')
    .trim();
}
