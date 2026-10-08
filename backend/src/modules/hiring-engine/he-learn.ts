/**
 * Outcome learning for matching (pure). For each process, compares the selection rate of walk-ins in a bucket
 * (education level, experience band, source) with the process average. Buckets with enough walk-ins become a small,
 * bounded score bonus/penalty, so the matcher drifts toward profiles that actually get selected there.
 */
export interface OutcomeRow { process: string; edu: number | null; expYears: number | null; source: string | null; selected: boolean }

export const MIN_BUCKET = 25;
export const MAX_BONUS = 10;

export const expBand = (y: number | null): string | null => (y == null ? null : y < 0.5 ? "fresher" : y < 2 ? "1y" : y < 5 ? "2-5y" : "5y+");
export const procKey = (p: string | null | undefined) => String(p ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export type Lifts = Record<string, { bonus: number; sample: number }>;

export function learnLifts(rows: OutcomeRow[]): Lifts {
  const out: Lifts = {};
  const byProc = new Map<string, OutcomeRow[]>();
  for (const r of rows) { const k = procKey(r.process); if (!k) continue; (byProc.get(k) ?? byProc.set(k, []).get(k)!).push(r); }
  for (const [proc, list] of byProc) {
    const base = list.filter((r) => r.selected).length / list.length;
    if (list.length < MIN_BUCKET * 2 || base <= 0) continue;
    const buckets = new Map<string, OutcomeRow[]>();
    for (const r of list) {
      for (const k of [r.edu != null ? `edu.${r.edu}` : null, expBand(r.expYears) ? `exp.${expBand(r.expYears)}` : null, r.source ? `src.${r.source.toLowerCase()}` : null]) {
        if (k) (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r);
      }
    }
    for (const [k, b] of buckets) {
      if (b.length < MIN_BUCKET) continue;
      const lift = b.filter((r) => r.selected).length / b.length / base;
      const bonus = Math.max(-MAX_BONUS, Math.min(MAX_BONUS, Math.round((lift - 1) * 20)));
      if (bonus !== 0) out[`match.${proc}.${k}`] = { bonus, sample: b.length };
    }
  }
  return out;
}

/** Bonus for one lead on one process, with the reasons to show HR. */
export function learnedBonus(params: Record<string, number>, process: string | null | undefined, lead: { edu: number | null; expYears: number | null; source: string | null }): { bonus: number; reasons: string[] } {
  const p = procKey(process);
  if (!p) return { bonus: 0, reasons: [] };
  let bonus = 0; const reasons: string[] = [];
  const add = (k: string, label: string) => { const v = params[`match.${p}.${k}`]; if (v) { bonus += v; reasons.push(`${label} ${v > 0 ? "often" : "rarely"} selected here (${v > 0 ? "+" : ""}${v})`); } };
  if (lead.edu != null) add(`edu.${lead.edu}`, "this education level");
  const eb = expBand(lead.expYears); if (eb) add(`exp.${eb}`, `${eb} experience`);
  if (lead.source) add(`src.${lead.source.toLowerCase()}`, `${lead.source} candidates`);
  return { bonus: Math.max(-15, Math.min(15, bonus)), reasons };
}
