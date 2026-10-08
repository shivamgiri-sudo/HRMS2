/**
 * Leave-type colours, taken from the app's own chart palette.
 *
 * The page used three separate colour systems (a Tailwind name map, a local hex map inside the
 * charts, and a black "wallet" card). Everything now resolves to the theme's `--chart-1..8`
 * variables (index.css), so cards, chart series, legends and the calendar always agree and
 * follow the product theme (including dark mode) instead of hard-coded colours.
 */
export const CHART_TOKEN_COUNT = 8;

// token 1 = MAS blue, 2 = green, 3 = purple, 4 = orange, 5 = cyan, 6 = pink, 7 = indigo, 8 = red
const KNOWN: Array<[RegExp, number]> = [
  [/\b(cl|casual)\b/i, 1],
  [/\b(el|earned|privilege|annual)\b/i, 2],
  [/\b(ml|medical|sick)\b/i, 3],
  [/\b(lwp|lop|unpaid|without pay)\b/i, 4],
  [/\b(comp|compensatory|co)\b/i, 5],
  [/\b(mtrl|maternity)\b/i, 6],
  [/\b(ptrl|paternity|pl)\b/i, 7],
  [/\b(bereavement|marriage|special)\b/i, 8],
];

/** 1..8 — known types get a fixed token; anything else is hashed so it stays stable. */
export function leaveTypeToken(nameOrCode: string): number {
  const name = String(nameOrCode ?? "").trim();
  for (const [pattern, token] of KNOWN) if (pattern.test(name)) return token;
  const hash = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return (hash % CHART_TOKEN_COUNT) + 1;
}

/** CSS colour for a series/bar/dot, e.g. `hsl(var(--chart-1))`. */
export function leaveTypeChartVar(nameOrCode: string): string {
  return `hsl(var(--chart-${leaveTypeToken(nameOrCode)}))`;
}
