/** Pure helpers over the /api/ats/bmi-benchmark board: demand against supply and what each channel costs. */
export interface BmiCell { value: number | null; source?: string }
export interface BmiRow { key: string; label: string; cells: Record<string, BmiCell>; total: number | null }
export interface Bmi { months: string[]; funnel: BmiRow[]; costs: BmiRow[]; quality: BmiRow[]; speed: BmiRow[] }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const bmiMonthLabel = (m: string) => { const [y, mo] = m.split("-"); return `${MONTHS[Number(mo) - 1] ?? mo} ${String(y).slice(2)}`; };

const rowOf = (d: Bmi, key: string) => [...d.funnel, ...d.costs, ...d.quality, ...d.speed].find((r) => r.key === key);
const cell = (r: BmiRow | undefined, m: string): number | null => { const v = r?.cells?.[m]?.value; return typeof v === "number" && Number.isFinite(v) ? v : null; };
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface DemandSupplyMonth { month: string; label: string; demand: number | null; selected: number | null; accepted: number | null; fillRate: number | null; gap: number | null }

/** Per month: hires asked for, selected, offers accepted, the share of demand filled and the shortfall. */
export function demandSupply(d: Bmi | null | undefined): DemandSupplyMonth[] {
  if (!d) return [];
  const demand = rowOf(d, "demand_raised"), sel = rowOf(d, "ops_selected"), acc = rowOf(d, "offers_accepted");
  return d.months.map((month) => {
    const dm = cell(demand, month), s = cell(sel, month), a = cell(acc, month);
    return { month, label: bmiMonthLabel(month), demand: dm, selected: s, accepted: a, fillRate: dm && dm > 0 && a != null ? round1((a / dm) * 100) : null, gap: dm != null && a != null ? dm - a : null };
  });
}

export const hasDemand = (rows: DemandSupplyMonth[]) => rows.some((r) => (r.demand ?? 0) > 0);

export interface ChannelCost { key: string; label: string; spend: number | null; sourced: number; costPerSourced: number | null }
const CHANNELS: { key: string; label: string; cost: string | null; sourced: string }[] = [
  { key: "portal", label: "Job portals", cost: "portal_cost", sourced: "sourced_portal" },
  { key: "agency", label: "Consultants", cost: "consultant_cost", sourced: "sourced_agency" },
  { key: "referral", label: "Referrals", cost: "referral_bonus", sourced: "sourced_referral" },
  { key: "walk_in", label: "Walk-ins", cost: null, sourced: "sourced_walk_in" },
];

const sum = (r: BmiRow | undefined, months: string[]) => { let t = 0, any = false; for (const m of months) { const v = cell(r, m); if (v != null) { t += v; any = true; } } return any ? t : null; };

/** Spend and candidates sourced per channel over the whole window. Walk-ins carry no direct spend. */
export function channelCosts(d: Bmi | null | undefined): ChannelCost[] {
  if (!d) return [];
  return CHANNELS.map((c) => {
    const spend = c.cost ? sum(rowOf(d, c.cost), d.months) : 0, sourced = sum(rowOf(d, c.sourced), d.months) ?? 0;
    return { key: c.key, label: c.label, spend, sourced, costPerSourced: spend != null && sourced > 0 ? Math.round(spend / sourced) : null };
  });
}

export interface BlendedMonth { month: string; label: string; spend: number | null; accepted: number | null; costPerHire: number | null }
/** Direct spend (portals + consultants + referral bonuses) per accepted offer, month by month. */
export function blendedCostPerHire(d: Bmi | null | undefined): BlendedMonth[] {
  if (!d) return [];
  const rows = ["portal_cost", "consultant_cost", "referral_bonus"].map((k) => rowOf(d, k)), acc = rowOf(d, "offers_accepted");
  return d.months.map((month) => {
    const parts = rows.map((r) => cell(r, month)).filter((v): v is number => v != null);
    const spend = parts.length ? parts.reduce((a, b) => a + b, 0) : null, a = cell(acc, month);
    return { month, label: bmiMonthLabel(month), spend, accepted: a, costPerHire: spend != null && a != null && a > 0 ? Math.round(spend / a) : null };
  });
}

export const hasSpend = (rows: ChannelCost[]) => rows.some((r) => (r.spend ?? 0) > 0);

/** Short findings for the two panels. */
export function demandFindings(rows: DemandSupplyMonth[]): { tone: "good" | "warn" | "bad" | "info"; title: string; body?: string }[] {
  const known = rows.filter((r) => r.demand != null && r.demand > 0 && r.accepted != null);
  if (!known.length) return [];
  const out: { tone: "good" | "warn" | "bad" | "info"; title: string; body?: string }[] = [];
  const last = known[known.length - 1], dem = known.reduce((a, r) => a + (r.demand ?? 0), 0), acc = known.reduce((a, r) => a + (r.accepted ?? 0), 0);
  const overall = Math.round((acc / dem) * 100);
  out.push({ tone: overall >= 90 ? "good" : overall >= 70 ? "warn" : "bad", title: `${overall}% of requested hires were filled`, body: `${acc.toLocaleString("en-IN")} offers accepted against ${dem.toLocaleString("en-IN")} requested over ${known.length} months.` });
  if (last.gap != null && last.gap > 0) out.push({ tone: "warn", title: `${last.label} fell ${last.gap.toLocaleString("en-IN")} short of demand`, body: `${last.fillRate}% filled.` });
  const worst = [...known].sort((a, b) => (a.fillRate ?? 0) - (b.fillRate ?? 0))[0];
  if (worst && worst !== last && (worst.fillRate ?? 100) < 70) out.push({ tone: "bad", title: `${worst.label} was the weakest month at ${worst.fillRate}% filled` });
  return out;
}
