import { useCallback, useEffect, useMemo, useState } from "react";
import { Target, IndianRupee, Gauge, Users, Layers, Pencil, X, Loader2, Plus, TrendingUp, AlertTriangle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner, KpiCard, SectionCard, formatINR, localDateStr } from "./DashboardKit";
import { GncAgentDrawer } from "./GncAgentDrawer";

/**
 * GNC "Targets" page. The monthly revenue target of each LOB is defined here once (and edited
 * here when it changes); the Overall, Chat and Abandon Cart dashboards read the same numbers, so a
 * target shows everywhere -- headline, LOB-wise summary and agent-wise.
 *
 *  Inbound       per-agent target x agents   (Rs 1,30,000 x 7 = Rs 9,10,000 a month)
 *  Chat          per-agent target x agents   (Rs 1,80,000 x 5 = Rs 9,00,000 a month)
 *  Abandon Cart  a fixed monthly target for the LOB (Rs 53,76,000)
 *
 * Targets are effective-dated by month: a change made "from Oct-26" never rewrites September.
 * Achievement is revenue (gnc_sale gross amount) against the target; a part-month range is
 * measured against the pro-rated target for those days. See gnc-targets.service.ts.
 */

const API = "/api/process-performance";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]}-${ym.slice(2, 4)}`;
const fmtDateTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const LOB_TONE: Record<string, { bar: string; chip: string; kpi: "sky" | "violet" | "amber" }> = {
  Inbound: { bar: "bg-sky-500", chip: "bg-sky-100 text-sky-700", kpi: "sky" },
  Chat: { bar: "bg-violet-500", chip: "bg-violet-100 text-violet-700", kpi: "violet" },
  "Abandon Cart": { bar: "bg-amber-500", chip: "bg-amber-100 text-amber-700", kpi: "amber" },
};
const achColor = (v: number | null) => (v === null ? "text-slate-400" : v >= 100 ? "text-emerald-600" : v >= 60 ? "text-amber-600" : "text-rose-600");

type Basis = "per_agent" | "fixed";
interface TargetRow {
  id: number; lob: string; effectiveMonth: string; basis: Basis; perAgentTarget: number | null; agentCount: number | null;
  fixedTarget: number | null; monthlyTarget: number; updatedBy: string | null; updatedAt: string | null; updatedByLabel?: string | null;
}
interface TargetList { tableAvailable: boolean; lobs: string[]; rows: TargetRow[] }
interface LobBlock {
  lob: string; tableAvailable: boolean; configured: boolean; basis: Basis | null; monthlyTarget: number | null; rangeTarget: number | null;
  perAgentMonthlyTarget: number | null; agentCount: number | null; uncoveredMonths: string[]; revenue: number; achPct: number | null;
}
interface SaleTargets {
  from: string; to: string;
  targets: { tableAvailable: boolean; blocks: LobBlock[]; coveredLobs: string[]; total: { target: number; revenue: number; achPct: number | null } | null };
  agentPerformance: Array<{ empId: string; empName: string; tl: string; lob: string; saleCount: number; revenue: number; target: number | null; achPct: number | null }>;
}
interface Detail {
  row: TargetRow; updatedByLabel: string | null; createdBy: string | null; createdAt: string | null;
  audit: Array<{ at: string; action: string; actor: string; reason: string | null; oldValue: unknown; newValue: unknown }>;
}

function monthOptions(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = -14; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
const currentYm = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`; };
function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0);
  const today = localDateStr(new Date());
  const lastIso = localDateStr(last);
  return { from: `${ym}-01`, to: lastIso > today && today >= `${ym}-01` ? today : lastIso };
}
const formulaOf = (basis: Basis | null, per: number | null, n: number | null, fixed: number | null, monthly: number | null) => {
  if (basis === "per_agent" && per !== null && n !== null) return `${formatINR(per)} × ${n} agent${n === 1 ? "" : "s"} = ${formatINR(per * n)} / month`;
  if (basis === "fixed" && fixed !== null) return `${formatINR(fixed)} fixed / month${n ? ` (≈ ${formatINR(fixed / n)} per agent across ${n})` : ""}`;
  return monthly === null ? "No target configured" : `${formatINR(monthly)} / month`;
};

/* ---------------------------- edit / detail drawer ---------------------------- */

function TargetDrawer({ lob: lobProp, seed, tableAvailable, months, onClose, onSaved }: {
  lob: string; seed: TargetRow | null; tableAvailable: boolean; months: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [lob, setLob] = useState(lobProp);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [ym, setYm] = useState(seed?.effectiveMonth ?? currentYm());
  const [basis, setBasis] = useState<Basis>(seed?.basis ?? (lob === "Abandon Cart" ? "fixed" : "per_agent"));
  const [perAgent, setPerAgent] = useState(seed?.perAgentTarget != null ? String(seed.perAgentTarget) : "");
  const [agents, setAgents] = useState(seed?.agentCount != null ? String(seed.agentCount) : "");
  const [fixed, setFixed] = useState(seed?.fixedTarget != null ? String(seed.fixedTarget) : "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t); }, []);

  useEffect(() => {
    if (!seed) return;
    let cancelled = false;
    setLoadingDetail(true);
    hrmsApi.get<{ success: boolean; data: Detail }>(`${API}/gnc-targets/${seed.id}`)
      .then((r) => { if (!cancelled) setDetail(r.data); })
      .catch(() => { /* the form still works without the trail */ })
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [seed]);

  const perN = Number(perAgent), nN = Number(agents), fixN = Number(fixed);
  const preview = basis === "per_agent"
    ? (perN > 0 && nN > 0 ? `${formatINR(perN)} × ${nN} = ${formatINR(perN * nN)} / month` : "Enter a per-agent target and the number of agents")
    : (fixN > 0 ? `${formatINR(fixN)} / month${nN > 0 ? ` · ≈ ${formatINR(fixN / nN)} per agent` : ""}` : "Enter the monthly target");

  async function save() {
    setSaving(true); setError("");
    try {
      await hrmsApi.put(`${API}/gnc-targets`, {
        lob, effectiveMonth: ym, basis, reason: reason.trim() || undefined,
        perAgentTarget: basis === "per_agent" ? perN : null, agentCount: agents.trim() === "" ? null : nN, fixedTarget: basis === "fixed" ? fixN : null,
      });
      onSaved(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save the target."); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!seed) return;
    setSaving(true); setError("");
    try { await hrmsApi.delete(`${API}/gnc-targets/${seed.id}`); onSaved(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to delete the target."); setSaving(false); }
  }

  const label = "text-xs font-bold uppercase tracking-wide text-slate-400";
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <aside className={`relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl transition-transform duration-200 ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-3">
          <div>
            <p className="text-sm font-bold text-slate-800">{lob} target {seed ? `· from ${monthLabel(seed.effectiveMonth)}` : "· new"}</p>
            <p className="text-[11px] text-slate-400">{seed ? `Record #${seed.id} · created ${fmtDateTime(detail?.createdAt ?? null)}` : "Sets the target from the chosen month onwards"}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-5 p-5">
          {!tableAvailable && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />The target table has not been created yet (migration 1870), so nothing can be saved for now.</p>
          )}

          <section className="space-y-3">
            <p className={label}>{seed ? "Edit target" : "Set target"}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {!seed && (
                <div className="sm:col-span-2">
                  <p className="mb-1 text-[11px] font-semibold text-slate-500">LOB</p>
                  <Select value={lob} onValueChange={(v) => { setLob(v); setBasis(v === "Abandon Cart" ? "fixed" : "per_agent"); }}>
                    <SelectTrigger className="h-9" aria-label="LOB"><SelectValue /></SelectTrigger>
                    <SelectContent>{["Inbound", "Chat", "Abandon Cart"].map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <p className="mb-1 text-[11px] font-semibold text-slate-500">Effective from (month)</p>
                <Select value={ym} onValueChange={setYm}>
                  <SelectTrigger className="h-9" aria-label="Effective month"><SelectValue /></SelectTrigger>
                  <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold text-slate-500">Target basis</p>
                <Select value={basis} onValueChange={(v) => setBasis(v as Basis)}>
                  <SelectTrigger className="h-9" aria-label="Target basis"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_agent">Per agent × number of agents</SelectItem>
                    <SelectItem value="fixed">Fixed monthly target for the LOB</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {basis === "per_agent" ? (
                <>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-slate-500">Target per agent per month (₹)</p>
                    <Input inputMode="decimal" value={perAgent} onChange={(e) => setPerAgent(e.target.value)} placeholder="130000" />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-slate-500">Number of agents</p>
                    <Input inputMode="numeric" value={agents} onChange={(e) => setAgents(e.target.value)} placeholder="7" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-slate-500">Monthly target for the LOB (₹)</p>
                    <Input inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} placeholder="5376000" />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-slate-500">Number of agents (optional)</p>
                    <Input inputMode="numeric" value={agents} onChange={(e) => setAgents(e.target.value)} placeholder="Splits the target per agent" />
                  </div>
                </>
              )}
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700"><span className="mr-2 text-[11px] font-medium text-slate-400">Monthly target</span>{preview}</div>
            <div>
              <p className="mb-1 text-[11px] font-semibold text-slate-500">Reason for change (optional)</p>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. headcount change from October" maxLength={500} />
            </div>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={saving || !tableAvailable} className="h-9">{saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Save target</Button>
              <Button variant="outline" onClick={onClose} className="h-9">Cancel</Button>
              {seed && (confirmDelete
                ? <Button variant="destructive" onClick={remove} disabled={saving} className="ml-auto h-9">Confirm delete</Button>
                : <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={saving || !tableAvailable} className="ml-auto h-9 text-rose-600 hover:text-rose-700">Delete this month's row</Button>)}
            </div>
            <p className="text-[11px] text-slate-400">The target applies from the chosen month until a later month's target replaces it. Earlier months are not changed.</p>
          </section>

          <section className="space-y-2">
            <p className={label}>Stored record</p>
            {!seed ? <p className="text-xs text-slate-400">None — not saved yet</p> : loadingDetail && !detail ? <Spinner /> : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-100 p-3 text-xs">
                {[
                  ["LOB", seed.lob], ["Effective from", monthLabel(seed.effectiveMonth)], ["Basis", seed.basis === "per_agent" ? "Per agent × agents" : "Fixed monthly"],
                  ["Per-agent target", seed.perAgentTarget != null ? formatINR(seed.perAgentTarget) : "—"], ["Agents", seed.agentCount != null ? String(seed.agentCount) : "—"],
                  ["Fixed target", seed.fixedTarget != null ? formatINR(seed.fixedTarget) : "—"], ["Monthly target", formatINR(seed.monthlyTarget)],
                  ["Created by", detail?.createdBy ?? "—"], ["Last updated by", detail?.updatedByLabel ?? seed.updatedByLabel ?? "—"], ["Last updated", fmtDateTime(seed.updatedAt)],
                ].map(([k, v]) => <div key={k}><dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{k}</dt><dd className="font-semibold text-slate-700">{v}</dd></div>)}
              </dl>
            )}
          </section>

          <section className="space-y-2">
            <p className={label}>Change history</p>
            {!seed || !detail || detail.audit.length === 0 ? <p className="text-xs text-slate-400">None</p> : (
              <ul className="space-y-2">
                {detail.audit.map((a, i) => {
                  const nv = a.newValue as { monthlyTarget?: number } | null; const ov = a.oldValue as { monthlyTarget?: number } | null;
                  return (
                    <li key={i} className="rounded-xl border border-slate-100 p-3 text-xs">
                      <p className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold text-slate-700">{a.action.replace("GNC_LOB_TARGET_", "").toLowerCase()}</span><span className="text-slate-400">{fmtDateTime(a.at)} · {a.actor}</span></p>
                      <p className="mt-1 text-slate-600">{ov?.monthlyTarget != null ? `${formatINR(ov.monthlyTarget)} → ` : ""}{nv?.monthlyTarget != null ? formatINR(nv.monthlyTarget) : "removed"}{a.reason ? ` · ${a.reason}` : ""}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

/* ---------------------------------- the page ---------------------------------- */

export function GncTargetsDashboard() {
  const months = useMemo(monthOptions, []);
  const [ym, setYm] = useState(currentYm());
  const [list, setList] = useState<TargetList | null>(null);
  const [sale, setSale] = useState<SaleTargets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState<{ lob: string; seed: TargetRow | null } | null>(null);
  const [agentDrawer, setAgentDrawer] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const range = useMemo(() => monthRange(ym), [ym]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    Promise.all([
      hrmsApi.get<{ success: boolean; data: TargetList }>(`${API}/gnc-targets`),
      hrmsApi.get<{ success: boolean; data: SaleTargets }>(`${API}/gnc-sale-dashboard?from=${range.from}&to=${range.to}`),
    ])
      .then(([t, s]) => { if (!cancelled) { setList(t.data); setSale(s.data); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load the targets."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.from, range.to, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  const rowInForce = useCallback((lob: string): TargetRow | null => {
    let best: TargetRow | null = null;
    for (const r of list?.rows ?? []) if (r.lob === lob && r.effectiveMonth <= ym && (!best || r.effectiveMonth > best.effectiveMonth)) best = r;
    return best;
  }, [list, ym]);

  if (loading && !list) return <Spinner />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!list || !sale) return null;

  const blocks = sale.targets.blocks;
  const total = sale.targets.total;
  const monthlyTotal = blocks.reduce((s, b) => s + (b.monthlyTarget ?? 0), 0);
  const partial = sale.to < `${ym}-${String(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()).padStart(2, "0")}`;
  const overallAch = total && monthlyTotal > 0 ? Math.round((total.revenue / monthlyTotal) * 10000) / 100 : null;
  const agents = sale.agentPerformance.filter((a) => ["Inbound", "Chat", "Abandon Cart"].includes(a.lob)).sort((a, b) => a.lob.localeCompare(b.lob) || b.revenue - a.revenue);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600"><Target className="h-5 w-5" /></span>
          <div>
            <h2 className="text-base font-bold text-slate-800">GNC Targets</h2>
            <p className="text-[11px] text-slate-500">Monthly revenue target per LOB — edit once, every GNC dashboard picks it up.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500">Month</span>
          <Select value={ym} onValueChange={setYm}>
            <SelectTrigger className="h-9 w-[130px]" aria-label="Month"><SelectValue /></SelectTrigger>
            <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {!list.tableAvailable && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          The target table has not been created yet (migration 1870 is pending), so no targets are configured and none can be edited. Dashboards show revenue without a target until it is applied.</p>
      )}

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <KpiCard icon={IndianRupee} label="Monthly target (all LOBs)" value={formatINR(monthlyTotal)} sub={`${blocks.filter((b) => b.configured).length} of 3 LOBs configured`} tone="emerald" />
        <KpiCard icon={Target} label={partial ? "Target till date" : "Target for the month"} value={total ? formatINR(total.target) : "—"} sub={partial ? `${range.from.slice(8)}–${range.to.slice(8)} ${monthLabel(ym)} (pro-rata)` : "full month"} tone="sky" />
        <KpiCard icon={TrendingUp} label="Revenue (LOBs with a target)" value={total ? formatINR(total.revenue) : "—"} sub={total ? total.achPct !== null ? `${total.achPct}% of target till date` : undefined : "no target"} tone="violet" />
        <KpiCard icon={Gauge} label="Overall achievement" value={overallAch === null ? "—" : `${overallAch}%`} sub="revenue ÷ full monthly target" tone="amber" />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {blocks.map((b) => {
          const tone = LOB_TONE[b.lob];
          const row = rowInForce(b.lob);
          const fill = b.achPct === null ? 0 : Math.min(100, b.achPct);
          return (
            <div key={b.lob} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.chip}`}>{b.lob}</span>
                  <p className="mt-2 text-xl font-extrabold tracking-tight text-slate-800">{b.monthlyTarget !== null ? formatINR(b.monthlyTarget) : "Not set"}<span className="ml-1 text-[11px] font-medium text-slate-400">/ month</span></p>
                  <p className="text-[11px] text-slate-500">{formulaOf(row?.basis ?? b.basis, row?.perAgentTarget ?? null, row?.agentCount ?? b.agentCount, row?.fixedTarget ?? null, b.monthlyTarget)}</p>
                </div>
                <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => setDrawer({ lob: b.lob, seed: row })} disabled={!list.tableAvailable}>
                  {row ? <><Pencil className="mr-1 h-3 w-3" />Edit</> : <><Plus className="mr-1 h-3 w-3" />Set</>}
                </Button>
              </div>
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[11px]"><span className="font-semibold text-slate-600">{formatINR(b.revenue)} revenue</span><span className={`font-extrabold ${achColor(b.achPct)}`}>{b.achPct === null ? "—" : `${b.achPct}%`}</span></div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${fill}%` }} /></div>
                <p className="mt-1 text-[10px] text-slate-400">{b.rangeTarget !== null ? `vs ${formatINR(b.rangeTarget)} ${partial ? "target till date" : "target"}` : "No target applies to this month"}{b.uncoveredMonths.length ? ` · no target for ${b.uncoveredMonths.map(monthLabel).join(", ")}` : ""}</p>
              </div>
            </div>
          );
        })}
      </div>

      <SectionCard icon={Layers} title="Target configuration (click a row to edit or see its history)" tone="teal"
        action={<Button size="sm" variant="outline" className="h-8" onClick={() => setDrawer({ lob: "Inbound", seed: null })} disabled={!list.tableAvailable}><Plus className="mr-1 h-3 w-3" />New target</Button>}
        footnote="A row applies from its month until a later row for the same LOB replaces it. Months before the first row have no target.">
        <div className="overflow-x-auto rounded-lg border border-slate-100">
          <table className="w-full text-center text-xs">
            <thead><tr className="bg-slate-800 text-white">{["LOB", "Effective from", "Basis", "Per agent", "Agents", "Monthly target", "Updated by", "Updated at"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {list.rows.map((r, i) => (
                <tr key={r.id} onClick={() => setDrawer({ lob: r.lob, seed: r })} className={`cursor-pointer hover:bg-emerald-50 ${i % 2 ? "bg-slate-50/60" : "bg-white"}`}>
                  <td className="px-3 py-2 text-left"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${LOB_TONE[r.lob]?.chip ?? "bg-slate-100 text-slate-600"}`}>{r.lob}</span></td>
                  <td className="px-3 py-2 font-semibold">{monthLabel(r.effectiveMonth)}</td>
                  <td className="px-3 py-2">{r.basis === "per_agent" ? "Per agent × agents" : "Fixed monthly"}</td>
                  <td className="px-3 py-2">{r.perAgentTarget != null ? formatINR(r.perAgentTarget) : "—"}</td>
                  <td className="px-3 py-2">{r.agentCount ?? "—"}</td>
                  <td className="px-3 py-2 font-bold text-slate-800">{formatINR(r.monthlyTarget)}</td>
                  <td className="px-3 py-2 text-slate-500">{r.updatedByLabel ?? r.updatedBy ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fmtDateTime(r.updatedAt)}</td>
                </tr>
              ))}
              {list.rows.length === 0 && <tr><td colSpan={8} className="py-4 text-slate-400">None</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard icon={Users} title={`Agent-wise target vs revenue — ${monthLabel(ym)}`} tone="violet"
        footnote="An agent's target is the per-agent target of the LOB they sold most in (Abandon Cart shows a target only when its agent count is set). Revenue is all their GNC sales in the month.">
        <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-100">
          <table className="w-full text-center text-xs">
            <thead><tr className="sticky top-0 bg-slate-800 text-white">{["Agent", "LOB", "TL", "Sale count", "Revenue", "Target", "Ach %"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {agents.map((a, i) => (
                <tr key={a.empId + a.lob} onClick={() => setAgentDrawer(a.empId)} className={`cursor-pointer hover:bg-violet-50 ${i % 2 ? "bg-slate-50/60" : "bg-white"}`}>
                  <td className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700">{a.empName}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${LOB_TONE[a.lob]?.chip ?? ""}`}>{a.lob}</span></td>
                  <td className="px-3 py-2 text-slate-500">{a.tl}</td>
                  <td className="px-3 py-2">{a.saleCount}</td>
                  <td className="px-3 py-2 font-semibold">{formatINR(a.revenue)}</td>
                  <td className="px-3 py-2">{a.target !== null ? formatINR(a.target) : "—"}</td>
                  <td className={`px-3 py-2 font-extrabold ${achColor(a.achPct)}`}>{a.achPct === null ? "—" : `${a.achPct}%`}</td>
                </tr>
              ))}
              {agents.length === 0 && <tr><td colSpan={7} className="py-4 text-slate-400">None</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {drawer && (
        <TargetDrawer key={`${drawer.lob}-${drawer.seed?.id ?? "new"}`} lob={drawer.lob} seed={drawer.seed} tableAvailable={list.tableAvailable} months={months}
          onClose={() => setDrawer(null)} onSaved={refresh} />
      )}
      {agentDrawer && <GncAgentDrawer empId={agentDrawer} from={range.from} to={range.to} onClose={() => setAgentDrawer(null)} />}
    </div>
  );
}
