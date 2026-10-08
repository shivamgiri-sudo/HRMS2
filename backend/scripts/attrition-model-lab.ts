// Read-only model lab. Takes weekly snapshots of who was employed, fits a logistic regression on the older ones and
// tests it on the newest ones it has never seen (out-of-time), next to the current hand-tuned score. Prints AUC and
// coefficients only: no names, codes or ids. Writes nothing.
//
//   DOTENV_CONFIG_PATH=/var/www/HRMS2/backend/.env npx tsx scripts/attrition-model-lab.ts
import "dotenv/config";
import { loadSnapshot, addDays, today } from "../src/modules/analytics/attrition-hub.data.js";
import { aucOf, scoreFeatures, tierOf, TIER_CUTOFFS, type Features } from "../src/modules/analytics/attrition-model.js";
import { scoreFeatures as scoreV1, tierOf as tierV1 } from "./lab/attrition-model-v1.js";

const WEEKS = 16;
const t = today();
const asOfs = Array.from({ length: WEEKS }, (_, i) => addDays(t, -30 - 7 * i)); // newest first
const TEST = asOfs.slice(0, 3);                       // the 3 newest cohorts
const trainCut = addDays(TEST[TEST.length - 1], -30); // train outcomes must end before any test cohort starts
const TRAIN = asOfs.filter((d) => d <= trainCut);
console.log(`cohorts: ${asOfs.length}; train ${TRAIN.length} (<= ${trainCut}); test ${TEST.length} (${TEST.join(", ")})`);

type Row = { x: number[]; f: Features; y: 0 | 1; cohort: string };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const NAMES = ["aon<=30", "aon31-60", "aon61-90", "aon91-180", "aon181-365", "att60", "att60 missing", "attTrend", "streak(cap10)", "streak>=3", "absent7", "late30(cap20)/10", "leave60", "reg60/5", "warnSeverity", "warnCount", "peerPay", "monthsSinceInc/12", "noIncrementRecord", "walkIn", "teamLossRate", "teamRate missing", "ctc<15k"];
function vec(f: Features): number[] {
  const a = f.aonDays;
  return [
    a <= 30 ? 1 : 0, a > 30 && a <= 60 ? 1 : 0, a > 60 && a <= 90 ? 1 : 0, a > 90 && a <= 180 ? 1 : 0, a > 180 && a <= 365 ? 1 : 0,
    (f.att60Pct ?? 90) / 100, f.att60Pct == null ? 1 : 0, (f.attDeltaPts ?? 0) / 100,
    clamp(f.absentStreak ?? 0, 0, 10), (f.absentStreak ?? 0) >= 3 ? 1 : 0, clamp(f.absent7 ?? 0, 0, 7),
    clamp(f.late30 ?? 0, 0, 20) / 10, clamp(f.leaveCount60 ?? 0, 0, 10), clamp(f.reg60 ?? 0, 0, 15) / 5,
    f.warningSeverity ?? 0, clamp(f.warningCount ?? 0, 0, 5),
    f.peerCtcRatio ?? 1, clamp(f.monthsSinceIncrement ?? 0, 0, 36) / 12, f.monthsSinceIncrement == null && (f.tenureMonths ?? 0) >= 12 ? 1 : 0,
    f.walkIn ? 1 : 0, f.teamExitRate90 ?? 0, f.teamExitRate90 == null ? 1 : 0, (f.ctc ?? 99999) < 15000 ? 1 : 0,
  ];
}

async function rowsFor(asOf: string): Promise<Row[]> {
  const snap = await loadSnapshot(asOf, { live: false });
  const end = addDays(asOf, 30);
  return snap.people.map((p) => ({ x: vec(p.features), f: p.features, y: (p.exitDate && p.exitDate > asOf && p.exitDate <= end ? 1 : 0) as 0 | 1, cohort: asOf }));
}

const rows: Row[] = [];
for (const d of asOfs) { const r = await rowsFor(d); rows.push(...r); console.log(`  ${d}: ${r.length} people, ${r.filter((x) => x.y).length} left within 30 days`); }
const train = rows.filter((r) => TRAIN.includes(r.cohort)), test = rows.filter((r) => TEST.includes(r.cohort));
console.log(`train ${train.length} rows (${train.filter((r) => r.y).length} leavers, ${(100 * train.filter((r) => r.y).length / train.length).toFixed(1)}%); test ${test.length} rows (${test.filter((r) => r.y).length} leavers, ${(100 * test.filter((r) => r.y).length / test.length).toFixed(1)}%)`);

// ridge logistic regression by Newton / IRLS on standardised features
function fit(data: Row[], cols: number[], lambda = 3) {
  const d = cols.length;
  const mean = cols.map((c) => data.reduce((s, r) => s + r.x[c], 0) / data.length);
  const sd = cols.map((c, i) => Math.sqrt(data.reduce((s, r) => s + (r.x[c] - mean[i]) ** 2, 0) / data.length) || 1);
  const Z = data.map((r) => cols.map((c, i) => (r.x[c] - mean[i]) / sd[i]));
  let w = new Array(d + 1).fill(0); // w[d] = intercept
  for (let it = 0; it < 30; it++) {
    const H = Array.from({ length: d + 1 }, () => new Array(d + 1).fill(0));
    const g = new Array(d + 1).fill(0);
    for (let n = 0; n < Z.length; n++) {
      let z = w[d]; for (let j = 0; j < d; j++) z += w[j] * Z[n][j];
      const p = 1 / (1 + Math.exp(-z)); const s = p * (1 - p); const err = p - data[n].y;
      for (let j = 0; j <= d; j++) { const xj = j < d ? Z[n][j] : 1; g[j] += err * xj; for (let k = 0; k <= j; k++) H[j][k] += s * xj * (k < d ? Z[n][k] : 1); }
    }
    for (let j = 0; j < d; j++) { g[j] += lambda * w[j]; H[j][j] += lambda; }
    for (let j = 0; j <= d; j++) for (let k = j + 1; k <= d; k++) H[j][k] = H[k][j];
    // solve H * step = g (Gaussian elimination)
    const A = H.map((row, i) => [...row, g[i]]);
    for (let i = 0; i <= d; i++) { let piv = i; for (let r = i + 1; r <= d; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r; [A[i], A[piv]] = [A[piv], A[i]]; for (let r = i + 1; r <= d; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c <= d + 1; c++) A[r][c] -= f * A[i][c]; } }
    const step = new Array(d + 1).fill(0);
    for (let i = d; i >= 0; i--) { let s = A[i][d + 1]; for (let c = i + 1; c <= d; c++) s -= A[i][c] * step[c]; step[i] = s / A[i][i]; }
    let delta = 0; for (let j = 0; j <= d; j++) { w[j] -= step[j]; delta = Math.max(delta, Math.abs(step[j])); }
    if (delta < 1e-6) break;
  }
  const predict = (x: number[]) => { let z = w[d]; for (let j = 0; j < d; j++) z += w[j] * (x[cols[j]] - mean[j]) / sd[j]; return 1 / (1 + Math.exp(-z)); };
  return { w, cols, mean, sd, predict };
}
const all = NAMES.map((_, i) => i);
const auc = (data: Row[], score: (r: Row) => number) => aucOf(data.map((r) => ({ score: score(r), leaver: r.y === 1 })));
const f2 = (v: number | null) => (v == null ? "n/a" : v.toFixed(3));

const current = (r: Row) => scoreV1(r.f).score;     // the scorer before re-weighting
const reweighted = (r: Row) => scoreFeatures(r.f).score;
const tenureOnly = fit(train, [0, 1, 2, 3, 4]);
const noAbsence = fit(train, all.filter((i) => ![8, 9, 10].includes(i)));
const full = fit(train, all);
console.log("\n== out-of-time AUC (higher is better; 0.5 = coin flip) ==");
console.log(`OLD hand-tuned score            test ${f2(auc(test, current))}   train ${f2(auc(train, current))}`);
console.log(`NEW re-weighted score           test ${f2(auc(test, reweighted))}   train ${f2(auc(train, reweighted))}`);
console.log(`tenure bands only (fitted)      test ${f2(auc(test, (r) => tenureOnly.predict(r.x)))}`);
console.log(`fitted, without absence streaks test ${f2(auc(test, (r) => noAbsence.predict(r.x)))}`);
console.log(`fitted, all features            test ${f2(auc(test, (r) => full.predict(r.x)))}   train ${f2(auc(train, (r) => full.predict(r.x)))}`);

console.log("\n== fitted coefficients (standardised; positive = more likely to leave) ==");
const coefs = full.cols.map((c, j) => ({ name: NAMES[c], coef: full.w[j] })).sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef));
for (const c of coefs) console.log(`${c.name.padEnd(20)} ${c.coef >= 0 ? "+" : ""}${c.coef.toFixed(3)}`);

// calibration of the fitted model on the test cohorts: predicted vs observed by decile
const sorted = test.map((r) => ({ p: full.predict(r.x), y: r.y })).sort((a, b) => b.p - a.p);
console.log("\n== fitted model on test cohorts, by decile of predicted risk (top = riskiest) ==");
for (let k = 0; k < 10; k++) { const s = sorted.slice(Math.floor(k * sorted.length / 10), Math.floor((k + 1) * sorted.length / 10)); console.log(`decile ${k + 1}: predicted ${(100 * s.reduce((a, b) => a + b.p, 0) / s.length).toFixed(1)}%  observed ${(100 * s.reduce((a, b) => a + b.y, 0) / s.length).toFixed(1)}%  (n=${s.length})`); }
const curSorted = test.map((r) => ({ s: reweighted(r), y: r.y })).sort((a, b) => b.s - a.s);
const cap = (arr: { y: number }[], pct: number) => { const n = Math.floor(arr.length * pct); const caught = arr.slice(0, n).reduce((a, b) => a + b.y, 0); return (100 * caught / arr.reduce((a, b) => a + b.y, 0)).toFixed(1); };
console.log(`\nshare of real leavers caught by flagging the riskiest 10% / 20% / 30%:  NEW scorer ${cap(curSorted, 0.1)} / ${cap(curSorted, 0.2)} / ${cap(curSorted, 0.3)}   fitted ${cap(sorted, 0.1)} / ${cap(sorted, 0.2)} / ${cap(sorted, 0.3)}`);

// score bands: how many people and what share left within 30 days, per scorer, on the TEST cohorts
function bands(label: string, score: (r: Row) => number) {
  console.log(`\n== ${label}: test cohorts by score band ==`);
  const edges = [0, 10, 20, 25, 30, 40, 50, 55, 60, 70, 101];
  for (let i = 0; i < edges.length - 1; i++) {
    const g = test.filter((r) => { const v = score(r); return v >= edges[i] && v < edges[i + 1]; });
    if (g.length) console.log(`${String(edges[i]).padStart(3)}-${String(edges[i + 1] - 1).padEnd(3)} n=${String(g.length).padStart(5)} (${(100 * g.length / test.length).toFixed(1)}% of people)  left in 30d ${(100 * g.reduce((a, b) => a + b.y, 0) / g.length).toFixed(1)}%`);
  }
  const q = test.map(score).sort((a, b) => a - b); const at = (p: number) => q[Math.floor(p * (q.length - 1))];
  console.log(`score quantiles: p50 ${at(0.5)}  p75 ${at(0.75)}  p90 ${at(0.9)}  p95 ${at(0.95)}  max ${q[q.length - 1]}`);
}
bands("OLD scorer", current); bands("NEW scorer", reweighted);
const tiers = (label: string, tf: (n: number) => string, score: (r: Row) => number) => {
  const out: Record<string, { n: number; l: number }> = {};
  for (const r of test) { const t = tf(score(r)); (out[t] ||= { n: 0, l: 0 }).n++; out[t].l += r.y; }
  console.log(`${label} tiers: ` + ["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((k) => out[k] ? `${k} ${(100 * out[k].n / test.length).toFixed(1)}% of people, ${(100 * out[k].l / out[k].n).toFixed(1)}% left` : `${k} none`).join(" | "));
};
console.log("\ncurrent cut-offs:", JSON.stringify(TIER_CUTOFFS));
tiers("OLD", tierV1, current); tiers("NEW", tierOf, reweighted);
// candidate cut-offs for the new scorer (share of people flagged and observed rate at or above)
for (const c of [25, 30, 35, 40, 45, 50, 55]) { const g = test.filter((r) => reweighted(r) >= c); console.log(`new score >= ${c}: ${(100 * g.length / test.length).toFixed(1)}% of people, ${g.length ? (100 * g.reduce((a, b) => a + b.y, 0) / g.length).toFixed(1) : "-"}% left in 30d`); }
process.exit(0);
