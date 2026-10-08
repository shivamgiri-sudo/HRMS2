import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2, Target, TrendingUp, Upload, Users, IndianRupee } from "lucide-react";
import BlaAnalytics from "@/components/process-operations/BlaAnalytics";
import BbbUploadedFiles from "@/components/process-operations/BbbUploadedFiles";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * BLA / BLI / BLU (Bellavita Cart ABC / Inbound / Upgrade) Sales Dashboard.
 * All maths lives in backend bla-metrics.ts (Formula Demo sheet of BLA_BLI_BLU_Dashboard_Calculation);
 * this page only renders it and hosts the Received Data upload. Overall Sales is read from the existing
 * bla_bli_blu_overall_sales_raw table (Bulk Upload Hub); it is deliberately not uploadable a second time here.
 */

interface Row {
  key: string; label: string;
  freshBase: number; freshWorkable: number; totalWorkable: number; dnd: number; uniqueAttempt: number; connected: number;
  le30: number; lt1m: number; ge1m: number; realTimeSale: number; prepaid: number; rto: number; revenue: number; ptp: number; h24: number;
  requiredData: number; cappedData: number; targetSale: number; targetRevenue: number;
  connectPct: number; attemptPct: number; conversionTarget: number; prepaidTarget: number; rtoTarget: number;
  deliveryConversion: number; deliveryPrepaid: number; deliveryRto: number; aov: number;
  saleAchievement: number; conversionAchievement: number; prepaidAchievement: number; revenueAchievement: number;
}
interface Block { lob: string; hasTarget: boolean; daily: Row[]; weekly: Row[]; mtd: Row }
interface Overview { from: string; to: string; latestDataDate?: string | null; lobs: string[]; blocks: Block[]; all: Block }
interface Product { product: string; cartAbc: number; inbound: number; upgrade: number; other?: number; total: number; contributionPct: number; paid: number; cod: number }
interface ProductWise { grandTotal: number; products: Product[] }
interface UploadResult { validRows: number; totalRows: number; storedRows: number; dateFrom: string | null; dateTo: string | null; skippedNoDate: number; duplicateSameDay?: number; skippedNoNumber?: number; fresh?: number; nc?: number; pending?: boolean }

const ALL = "All LOBs";
const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function monthRange() {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return { from: `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`, to: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(last)}` };
}

/** Achievement colouring: green >= 100%, amber >= 80%, red below. */
const achClass = (n: number) => (n >= 1 ? "text-emerald-600" : n >= 0.8 ? "text-amber-600" : "text-rose-600");

function Card({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: React.ElementType }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <Icon className="mb-2 h-5 w-5 text-slate-400" />
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function UploadBox({ title, hint, endpoint, onDone }: { title: string; hint: string; endpoint: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await hrmsApi.postForm<{ data: UploadResult }>(endpoint, form);
      const d = res.data;
      const parts = [
        `${fmt(d.storedRows)} of ${fmt(d.totalRows)} rows added${d.dateFrom ? ` (${d.dateFrom}${d.dateTo && d.dateTo !== d.dateFrom ? ` to ${d.dateTo}` : ""})` : ""}`,
        d.pending ? "Fresh / NC and the dashboard totals are still being worked out for this file; they will appear in a few minutes" : d.fresh !== undefined && d.storedRows > 0 ? `${fmt(d.fresh)} Fresh, ${fmt(d.nc ?? 0)} NC` : "",
        d.duplicateSameDay ? `${fmt(d.duplicateSameDay)} skipped: number already uploaded for that date` : "",
        d.skippedNoNumber ? `${fmt(d.skippedNoNumber)} skipped: no 10-digit mobile number` : "",
        d.skippedNoDate ? `${fmt(d.skippedNoDate)} skipped: no valid date` : "",
      ].filter(Boolean);
      setMsg({ ok: true, text: `${parts.join(". ")}.` });
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed" });
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mb-3 text-xs text-slate-400">{hint}</p>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-amber-300">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Choose .xlsx / .csv
        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={busy} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>}
    </div>
  );
}

export default function BlaBliBluSalesDashboard({ month, canUpload }: { month?: string; canUpload?: boolean }) {
  const init = useMemo(() => {
    if (!month) return monthRange();
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
  }, [month]);
  const [range, setRange] = useState(init);
  const [lob, setLob] = useState(ALL);
  const [view, setView] = useState<"daily" | "weekly">("daily");
  const [data, setData] = useState<Overview | null>(null);
  const [products, setProducts] = useState<ProductWise | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filesKey, setFilesKey] = useState(0);
  const [jumpedTo, setJumpedTo] = useState<string | null>(null);
  const autoJumped = useRef(false);

  useEffect(() => { autoJumped.current = false; setJumpedTo(null); setRange(init); }, [init]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const qs = `from=${range.from}&to=${range.to}`;
      const [o, p] = await Promise.all([
        hrmsApi.get<{ data: Overview }>(`/api/bla-bli-blu-dashboard/overview?${qs}`),
        hrmsApi.get<{ data: ProductWise }>(`/api/bla-bli-blu-dashboard/product-wise?${qs}`),
      ]);
      // The chosen month has nothing yet (e.g. the new month before its first upload): open on the newest month that does.
      const latest = o.data.latestDataDate;
      if (!autoJumped.current && o.data.all.daily.length === 0 && latest && latest < range.from) {
        autoJumped.current = true;
        const [y, mo] = latest.split("-").map(Number);
        const last = new Date(y, mo, 0).getDate();
        setJumpedTo(`${y}-${String(mo).padStart(2, "0")}`);
        setRange({ from: `${y}-${String(mo).padStart(2, "0")}-01`, to: `${y}-${String(mo).padStart(2, "0")}-${String(last).padStart(2, "0")}` });
        return;
      }
      setData(o.data); setProducts(p.data);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to load dashboard"); }
    finally { setLoading(false); }
  }, [range.from, range.to]);
  useEffect(() => { void load(); }, [load]);

  const block: Block | null = data ? (lob === ALL ? data.all : data.blocks.find((b) => b.lob === lob) ?? data.all) : null;
  const m = block?.mtd;
  const rows = block ? (view === "daily" ? block.daily : block.weekly) : [];
  const empty = !!data && data.all.daily.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1 text-sm" />
        <span className="text-sm text-slate-400">to</span>
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="rounded-lg border border-slate-200 px-2 py-1 text-sm" />
        <div className="ml-auto flex gap-1 rounded-xl bg-slate-100 p-1">
          {[ALL, ...(data?.lobs ?? [])].map((l) => (
            <button key={l} onClick={() => setLob(l)} className="rounded-lg px-3 py-1 text-xs font-semibold"
              style={lob === l ? { background: "#1A1A1A", color: "#D4AF37" } : { color: "#64748B" }}>{l}</button>
          ))}
        </div>
      </div>

      {jumpedTo && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">No data yet for the month you picked, so this shows {jumpedTo}, the latest month with data. Change the dates above to look elsewhere.</p>}
      {err && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{err}</p>}
      {loading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {!loading && empty && <p className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No BLA / BLI / BLU data for this range. Upload Received Data below, and Overall Sales via the Bulk Upload Hub.</p>}

      {!loading && m && !empty && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Card icon={Users} label="Fresh Workable" value={fmt(m.freshWorkable)} sub={`Base ${fmt(m.freshBase)} · DND ${fmt(m.dnd)}`} />
            <Card icon={TrendingUp} label="Real Time Sales" value={fmt(m.realTimeSale)} sub={`Target ${fmt(m.targetSale)}`} />
            <Card icon={Target} label="Sale Achievement" value={m.targetSale > 0 ? pct(m.saleAchievement) : "—"} sub={m.targetSale > 0 ? undefined : block.hasTarget ? "Needs Received Data (workable base) to set the target" : "No target set"} />
            <Card icon={IndianRupee} label="Revenue" value={inr(m.revenue)} sub={m.targetRevenue > 0 ? `Target ${inr(m.targetRevenue)} · ${pct(m.revenueAchievement)}` : "No target yet"} />
            <Card icon={TrendingUp} label="Delivery Conversion" value={m.cappedData > 0 ? pct(m.deliveryConversion) : "—"} sub={m.cappedData > 0 ? `Target ${pct(m.conversionTarget)}` : "Needs Received Data"} />
            <Card icon={IndianRupee} label="AOV" value={inr(m.aov)} sub={`Prepaid ${pct(m.deliveryPrepaid)} · RTO ${pct(m.deliveryRto)}`} />
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="mb-2 text-sm font-semibold text-slate-700">Sales vs Target — {block.lob}</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={block.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tickFormatter={(v: string) => v.slice(8)} fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip /><Legend />
                  <Bar dataKey="realTimeSale" name="Real Time Sale" fill="#D4AF37" />
                  <Line dataKey="targetSale" name="Target Sale" stroke="#1A1A1A" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="mb-3 text-sm font-semibold text-slate-700">Target vs Achievement (MTD) — {block.lob}</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {([
                ["Sale", m.saleAchievement, `${fmt(m.realTimeSale)} / ${fmt(m.targetSale)}`],
                ["Conversion", m.conversionAchievement, `${pct(m.deliveryConversion)} / ${pct(m.conversionTarget)}`],
                ["Prepaid", m.prepaidAchievement, `${pct(m.deliveryPrepaid)} / ${pct(m.prepaidTarget)}`],
                ["Revenue", m.revenueAchievement, `${inr(m.revenue)} / ${inr(m.targetRevenue)}`],
              ] as const).map(([l, v, s]) => (
                <div key={l} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{l} Achievement</p>
                  <p className={`text-xl font-bold ${m.targetSale > 0 || l === "Prepaid" ? achClass(v) : "text-slate-300"}`}>{m.targetSale > 0 || l === "Prepaid" ? pct(v) : "—"}</p>
                  <p className="text-[11px] text-slate-400">{s}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Required data {fmt(m.requiredData)} · Capped data {fmt(m.cappedData)} (Fresh Workable capped at Required × Cap%, per day) · RTO target {pct(m.rtoTarget)}</p>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-700">Sales MBR — {block.lob}</p>
              <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-1">
                {(["daily", "weekly"] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className="rounded-md px-3 py-1 text-xs font-semibold capitalize"
                    style={view === v ? { background: "#1A1A1A", color: "#D4AF37" } : { color: "#64748B" }}>{v}</button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>{["", "Fresh Workable", "Total Workable", "DND", "Unique Attempt", "Connected", "Connect %", "≤30s", "<1m", "≥1m", "RT Sale", "Target Sale", "Ach %", "Conv %", "Prepaid %", "RTO %", "Revenue", "AOV", "PTP", "24Hr"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {[...rows, m].map((r) => (
                    <tr key={r.key} className={`border-t border-slate-100 ${r.key === "MTD" ? "bg-amber-50 font-semibold" : ""}`}>
                      <td className="whitespace-nowrap px-2 py-1.5">{r.label}</td>
                      <td className="px-2">{fmt(r.freshWorkable)}</td><td className="px-2">{fmt(r.totalWorkable)}</td><td className="px-2">{fmt(r.dnd)}</td>
                      <td className="px-2">{fmt(r.uniqueAttempt)}</td><td className="px-2">{fmt(r.connected)}</td><td className="px-2">{pct(r.connectPct)}</td>
                      <td className="px-2">{fmt(r.le30)}</td><td className="px-2">{fmt(r.lt1m)}</td><td className="px-2">{fmt(r.ge1m)}</td>
                      <td className="px-2">{fmt(r.realTimeSale)}</td><td className="px-2">{fmt(r.targetSale)}</td>
                      <td className={`px-2 ${achClass(r.saleAchievement)}`}>{pct(r.saleAchievement)}</td>
                      <td className="px-2">{pct(r.deliveryConversion)}</td><td className="px-2">{pct(r.deliveryPrepaid)}</td><td className="px-2">{pct(r.deliveryRto)}</td>
                      <td className="px-2">{inr(r.revenue)}</td><td className="px-2">{inr(r.aov)}</td><td className="px-2">{fmt(r.ptp)}</td><td className="px-2">{fmt(r.h24)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && !empty && <BlaAnalytics from={range.from} to={range.to} funnel={m ? { freshBase: m.freshBase, freshWorkable: m.freshWorkable, uniqueAttempt: m.uniqueAttempt, connected: m.connected, realTimeSale: m.realTimeSale } : undefined} />}

      {!loading && products && products.products.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-slate-700">Product Wise Sales</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>{["Product / Category", "Cart ABC", "Inbound", "Upgrade", "Repeat / other", "Total", "Contribution", "Paid", "COD"].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {products.products.map((p) => (
                  <tr key={p.product} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">{p.product}</td><td className="px-2">{fmt(p.cartAbc)}</td><td className="px-2">{fmt(p.inbound)}</td><td className="px-2">{fmt(p.upgrade)}</td>
                    <td className="px-2">{fmt(p.other ?? 0)}</td><td className="px-2 font-semibold">{fmt(p.total)}</td><td className="px-2">{pct(p.contributionPct)}</td><td className="px-2">{fmt(p.paid)}</td><td className="px-2">{fmt(p.cod)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canUpload && (
        <div className="grid gap-3 md:grid-cols-2">
          <UploadBox title="Received Data" hint="Daily data allocation sheet (Date, Phone, LOB, Workable, Same Day Attempt, Final Dispo…). Each number is kept once per date; a repeat for the same date is skipped. Fresh / NC is worked out from the previous 3 days." endpoint="/api/bla-bli-blu-dashboard/upload/received-data" onDone={() => { void load(); setFilesKey((k) => k + 1); }} />
          <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-700">Overall Sales</p>
            <p className="text-xs text-slate-400">Both uploads are also in the Bulk Upload Hub: "Bla Bli Blu — Overall Sales Raw" (the workbook's Overall Sales sheet) and "Bla Bli Blu — Abandon (Received Data)" (the Received Data sheet). Rows are keyed by OrderID, so re-uploading a file does not duplicate orders.</p>
            <a href="/bulk-upload" className="mt-2 inline-block text-xs font-semibold text-blue-600 underline">Open Bulk Upload Hub</a>
          </div>
        </div>
      )}
      {canUpload && <BbbUploadedFiles refreshKey={filesKey} onChanged={() => void load()} />}
    </div>
  );
}
