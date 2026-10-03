/**
 * SBI Card Collections -- how the book moved between two account snapshots (pure calculations, no DB).
 *
 * Compares the opening snapshot (A) with a later one (B), account by account, and says what happened to each opening account:
 *   left the file     absent from B (paid up, normalised, withdrawn or reallocated: the export does not say which)
 *   rolled back       a lower CD stage in B (e.g. CD3 -> CD2)
 *   rolled forward    a higher CD stage in B
 *   stayed, paid down same stage, amount due lower
 *   stayed            same stage, amount due not lower
 * These are NEUTRAL movements. How they map onto SBI's Resolution / Normalisation / Rollback depends on SBI's definitions, which have
 * not been confirmed: load SBI's own figures through the Outcome upload and compare, rather than reading these as the payout measures.
 */
export interface SnapRow { accountNo: string; cd: number | null; due: number; flow?: string | null }
export type MoveKey = "left" | "rolledBack" | "rolledForward" | "stayedPaidDown" | "stayed";
export const MOVE_META: Record<MoveKey, { label: string; hint: string }> = {
  left: { label: "Left the file", hint: "Not in the later snapshot: paid up, normalised, withdrawn or reallocated" },
  rolledBack: { label: "Rolled back", hint: "A lower CD stage than at the start" },
  rolledForward: { label: "Rolled forward", hint: "A higher CD stage than at the start" },
  stayedPaidDown: { label: "Stayed, paid down", hint: "Same CD stage, amount due is lower" },
  stayed: { label: "Stayed", hint: "Same CD stage, amount due is not lower" },
};
export const MOVE_ORDER: MoveKey[] = ["left", "rolledBack", "stayedPaidDown", "stayed", "rolledForward"];
const r1 = (n: number): number => Math.round(n * 10) / 10;
const money = (n: number): number => Math.round(n * 100) / 100;
const pct = (n: number, d: number): number => (d > 0 ? r1((n / d) * 100) : 0);
const label = (cd: number | null): string => (cd === null ? "Unknown" : `CD${cd}`);

export interface MovementRow { key: MoveKey; label: string; hint: string; accounts: number; exposure: number; pct: number; exposurePct: number }
export interface MovementOut {
  dateA: string; dateB: string;
  opening: { accounts: number; exposure: number }; closing: { accounts: number; exposure: number };
  outcomes: MovementRow[];
  newInB: { accounts: number; exposure: number };
  /** Amount due that fell on accounts still on the file (A minus B, never negative). */
  paidDownAmount: number;
  matrix: Array<{ from: string; total: number; to: Record<string, number> }>;
  byStage: Array<{ from: string; accounts: number; exposure: number; pct: Record<MoveKey, number> }>;
}

/** One row per account; where an account is in both flows the NEW-flow row is the one counted. */
function dedupe(rows: SnapRow[]): Map<string, SnapRow> {
  const m = new Map<string, SnapRow>();
  for (const r of rows) { const have = m.get(r.accountNo); if (!have || (String(have.flow ?? "NEW").toUpperCase() !== "NEW" && String(r.flow ?? "NEW").toUpperCase() === "NEW")) m.set(r.accountNo, r); }
  return m;
}

export function movementOf(dateA: string, a: SnapRow[], dateB: string, b: SnapRow[]): MovementOut {
  const A = dedupe(a); const B = dedupe(b);
  const sum = (m: Iterable<SnapRow>) => { let n = 0; let e = 0; for (const r of m) { n += 1; e += r.due; } return { accounts: n, exposure: money(e) }; };
  const acc: Record<MoveKey, { n: number; e: number }> = { left: { n: 0, e: 0 }, rolledBack: { n: 0, e: 0 }, rolledForward: { n: 0, e: 0 }, stayedPaidDown: { n: 0, e: 0 }, stayed: { n: 0, e: 0 } };
  const matrix = new Map<string, Map<string, number>>(); const stage = new Map<string, { n: number; e: number; k: Record<MoveKey, number> }>();
  let paidDown = 0;
  for (const [no, ra] of A) {
    const rb = B.get(no); let k: MoveKey; let to: string;
    if (!rb) { k = "left"; to = "Left"; }
    else {
      to = label(rb.cd);
      if (ra.cd !== null && rb.cd !== null && rb.cd < ra.cd) k = "rolledBack";
      else if (ra.cd !== null && rb.cd !== null && rb.cd > ra.cd) k = "rolledForward";
      else if (rb.due < ra.due - 0.5) k = "stayedPaidDown"; else k = "stayed";
      paidDown += Math.max(0, ra.due - rb.due);
    }
    acc[k].n += 1; acc[k].e += ra.due;
    const from = label(ra.cd);
    const row = matrix.get(from) ?? new Map<string, number>(); row.set(to, (row.get(to) ?? 0) + 1); matrix.set(from, row);
    const st = stage.get(from) ?? { n: 0, e: 0, k: { left: 0, rolledBack: 0, rolledForward: 0, stayedPaidDown: 0, stayed: 0 } }; st.n += 1; st.e += ra.due; st.k[k] += 1; stage.set(from, st);
  }
  const opening = sum(A.values());
  const newRows = [...B.values()].filter((r) => !A.has(r.accountNo));
  return {
    dateA, dateB, opening, closing: sum(B.values()),
    outcomes: MOVE_ORDER.map((key) => ({ key, ...MOVE_META[key], accounts: acc[key].n, exposure: money(acc[key].e), pct: pct(acc[key].n, opening.accounts), exposurePct: pct(acc[key].e, opening.exposure) })),
    newInB: sum(newRows), paidDownAmount: money(paidDown),
    matrix: [...matrix.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([from, to]) => ({ from, total: [...to.values()].reduce((s, v) => s + v, 0), to: Object.fromEntries([...to.entries()].sort(([x], [y]) => x.localeCompare(y))) })),
    byStage: [...stage.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([from, s]) => ({
      from, accounts: s.n, exposure: money(s.e), pct: Object.fromEntries(MOVE_ORDER.map((k) => [k, pct(s.k[k], s.n)])) as Record<MoveKey, number>,
    })),
  };
}
