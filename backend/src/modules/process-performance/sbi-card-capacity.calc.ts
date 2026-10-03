/**
 * SBI Card Collections -- penetration and capacity (pure calculations, no DB).
 *
 * The client's Pen Estimation sheet works like this: each call table's Download (accounts loaded) x Penetration (the dials every account
 * must get, 3) = Dials Required; Dials Required / DPH (dials per agent hour) = Required Agent Hours; compared with the agent hours that were
 * present, that is the Excess / Deficit. This applies the same arithmetic to the day-end export (accounts and the attempts each carries)
 * and the APR (observed dials per login hour), and adds what the dialer outages cost in agent hours (users x downtime hours, the
 * downtime tracker's own "Total Downtime").
 */
export const DEFAULT_TARGET_PENETRATION = 3;

export interface CapacityInput {
  /** one entry per loaded account */
  accounts: Array<{ callTable: string | null; attempts: number }>;
  targetPenetration?: number | null;
  /** from the APR: total calls and total login hours over the same days */
  apr: { calls: number; loginHours: number } | null;
  downtime: Array<{ minutes: number | null; users: number | null }>;
}
export interface CapacityRow { table: string; accounts: number; attempts: number; penetration: number; requiredDials: number; shortfallDials: number; status: "on-target" | "behind" }
export interface CapacityOut {
  target: number; targetFromClient: boolean;
  rows: CapacityRow[];
  total: { accounts: number; attempts: number; penetration: number; requiredDials: number; shortfallDials: number; behindTables: number };
  /** dials per login hour seen in the APR; null when there is no APR */
  capacity: { dph: number; loginHours: number; extraHoursToCloseGap: number; requiredHoursAtTarget: number } | null;
  downtime: { events: number; agentHoursLost: number; dialsLost: number | null };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** "MAS_AHM_CD3_HB_28092026" -> "CD3_HB" (site prefix and date stamp removed), so the same table on different days groups together. */
export function tableLabel(name: string | null | undefined): string {
  const t = String(name ?? "").trim();
  if (!t) return "Unknown";
  return t.replace(/^(MAS|AL|EL)_[A-Z]{2,4}_/i, "").replace(/_?\d{8}_?$/, "").replace(/_+$/, "") || t;
}

export function capacityOf(inp: CapacityInput): CapacityOut {
  const target = inp.targetPenetration && inp.targetPenetration > 0 ? inp.targetPenetration : DEFAULT_TARGET_PENETRATION;
  const groups = new Map<string, { accounts: number; attempts: number }>();
  for (const a of inp.accounts) {
    const k = tableLabel(a.callTable); const g = groups.get(k) ?? { accounts: 0, attempts: 0 };
    g.accounts += 1; g.attempts += Math.max(0, a.attempts); groups.set(k, g);
  }
  const rows: CapacityRow[] = [...groups.entries()].map(([table, g]) => {
    const requiredDials = Math.round(g.accounts * target); const penetration = g.accounts > 0 ? r2(g.attempts / g.accounts) : 0;
    return { table, accounts: g.accounts, attempts: g.attempts, penetration, requiredDials, shortfallDials: Math.max(0, requiredDials - g.attempts), status: (penetration >= target ? "on-target" : "behind") as CapacityRow["status"] };
  }).sort((a, b) => b.shortfallDials - a.shortfallDials || a.table.localeCompare(b.table));
  const accounts = rows.reduce((n, r) => n + r.accounts, 0); const attempts = rows.reduce((n, r) => n + r.attempts, 0);
  const requiredDials = rows.reduce((n, r) => n + r.requiredDials, 0); const shortfall = rows.reduce((n, r) => n + r.shortfallDials, 0);

  const dph = inp.apr && inp.apr.loginHours > 0 && inp.apr.calls > 0 ? inp.apr.calls / inp.apr.loginHours : null;
  const capacity = dph === null || !inp.apr ? null : {
    dph: r2(dph), loginHours: r2(inp.apr.loginHours), extraHoursToCloseGap: r2(shortfall / dph), requiredHoursAtTarget: r2(requiredDials / dph),
  };
  const lost = inp.downtime.reduce((n, d) => n + (d.users && d.minutes ? (d.users * d.minutes) / 60 : 0), 0);
  return {
    target, targetFromClient: inp.targetPenetration !== undefined && inp.targetPenetration !== null && inp.targetPenetration > 0, rows,
    total: { accounts, attempts, penetration: accounts > 0 ? r2(attempts / accounts) : 0, requiredDials, shortfallDials: shortfall, behindTables: rows.filter((r) => r.status === "behind").length },
    capacity,
    downtime: { events: inp.downtime.length, agentHoursLost: r2(lost), dialsLost: dph === null ? null : Math.round(lost * dph) },
  };
}
