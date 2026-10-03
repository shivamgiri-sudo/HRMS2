/**
 * Small, dependency-free significance tests so the dashboard never presents noise as an insight.
 * chiSquareP: Pearson chi-square test of independence for an r x 2 table (rows = segments, columns = hit / miss).
 */
function gammaLn(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x; const t = x + 5.5; let s = 1.000000000190015;
  const tmp = t - (x + 0.5) * Math.log(t);
  for (const cj of c) s += cj / ++y;
  return -tmp + Math.log((2.5066282746310005 * s) / x);
}
/** Regularised upper incomplete gamma Q(a, x). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let ap = a; let sum = 1 / a; let del = sum;
    for (let n = 0; n < 200; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - gammaLn(a)));
  }
  let b = x + 1 - a; let c = 1e300; let d = 1 / b; let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.min(1, Math.exp(-x + a * Math.log(x) - gammaLn(a)) * h);
}
export const chiSquareSurvival = (x: number, df: number): number => (df <= 0 ? 1 : gammaQ(df / 2, x / 2));

/** p-value that the hit rate is the same in every row; null when the table is too thin to say anything (under 30 observations or one row). */
export function chiSquareP(rows: Array<[hit: number, miss: number]>): number | null {
  const t = rows.filter(([h, m]) => h + m > 0);
  const total = t.reduce((n, [h, m]) => n + h + m, 0); const hits = t.reduce((n, [h]) => n + h, 0);
  if (t.length < 2 || total < 30 || hits === 0 || hits === total) return null;
  const rate = hits / total; let stat = 0;
  for (const [h, m] of t) { const n = h + m; const eh = n * rate; const em = n * (1 - rate); stat += (h - eh) ** 2 / eh + (m - em) ** 2 / em; }
  return chiSquareSurvival(stat, t.length - 1);
}
