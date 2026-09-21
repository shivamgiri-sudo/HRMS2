import { useEffect, useMemo, useState } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { Target, Plus, Trash2, Upload, Pencil } from "lucide-react";
import { SectionCard, formatINR, formatShortDate } from "./DashboardKit";

/**
 * Date-wise Abandon Cart Revenue target, per the reference sheet the user
 * supplied (Date / Conv Tgt% / Allocation / Sale Target / Revenue target,
 * with real cell formulas Sale Target = Allocation x Conv Tgt% and Revenue
 * target = Sale Target x 500). Backed by GET/PUT/POST .../bellavita-cart-
 * dashboard/daily-target(s) -- see that backend service's own header
 * comment for exactly what's stored (only the final Revenue target, per
 * date) and why.
 *
 * Three ways to set it, all admin-only:
 * - Upload a batch of Date/Conv Tgt%/Allocation rows -- Sale Target/Revenue
 *   target are computed here AND on the server with the identical formula,
 *   so what's previewed is exactly what gets saved.
 * - Edit one date's Revenue target directly (bypassing the formula), for a
 *   quick correction.
 * - Nothing at all: days with no daily value fall back to the Overview
 *   tab's monthly target, spread evenly -- same as before this existed.
 */

interface DailyRow { date: string; target: number | null; source: "daily" | "monthly" | "none"; actualRevenue: number }
interface DailyData { from: string; to: string; rows: DailyRow[]; canSetTarget: boolean }
interface UploadRow { date: string; convTgtPct: number; allocation: number }
interface ComputedRow extends UploadRow { saleTarget: number; revenueTarget: number }

const CART_API = "/api/process-performance/bellavita-cart-dashboard";
const REVENUE_PER_SALE = 500; // same fixed assumption the reference sheet's own "=D2*500" formula uses

function computeRow(r: UploadRow): ComputedRow {
  const saleTarget = Math.round(r.allocation * (r.convTgtPct / 100) * 1000) / 1000;
  return { ...r, saleTarget, revenueTarget: Math.round(saleTarget * REVENUE_PER_SALE) };
}

const SOURCE_LABEL: Record<DailyRow["source"], string> = { daily: "Uploaded", monthly: "Monthly (even split)", none: "Not set" };
const SOURCE_TONE: Record<DailyRow["source"], string> = {
  daily: "bg-emerald-100 text-emerald-700", monthly: "bg-slate-100 text-slate-500", none: "bg-amber-100 text-amber-700",
};

export function BellavitaCartDailyTarget({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editDate, setEditDate] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [rowBusy, setRowBusy] = useState(false);

  const [pending, setPending] = useState<UploadRow[]>([]);
  const [newDate, setNewDate] = useState("");
  const [newConvTgt, setNewConvTgt] = useState("");
  const [newAllocation, setNewAllocation] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DailyData }>(`${CART_API}/daily-targets?from=${from}&to=${to}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the date-wise target.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  async function saveRow(date: string) {
    setRowBusy(true);
    try {
      await hrmsApi.put(`${CART_API}/daily-target`, { date, target: Number(editValue) });
      setEditDate(null);
      setEditValue("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that date's target.");
    } finally {
      setRowBusy(false);
    }
  }

  const previewRow = useMemo<ComputedRow | null>(() => {
    const convTgtPct = Number(newConvTgt);
    const allocation = Number(newAllocation);
    if (!newDate || !(convTgtPct >= 0) || !(allocation >= 0)) return null;
    return computeRow({ date: newDate, convTgtPct, allocation });
  }, [newDate, newConvTgt, newAllocation]);

  function addPendingRow() {
    if (!previewRow) return;
    setPending((cur) => [...cur.filter((r) => r.date !== previewRow.date), { date: previewRow.date, convTgtPct: previewRow.convTgtPct, allocation: previewRow.allocation }].sort((a, b) => a.date.localeCompare(b.date)));
    setNewDate(""); setNewConvTgt(""); setNewAllocation("");
  }

  async function uploadPending() {
    if (pending.length === 0) return;
    setUploadBusy(true);
    setUploadMsg("");
    try {
      await hrmsApi.post(`${CART_API}/daily-targets/upload`, { rows: pending });
      setUploadMsg(`Saved ${pending.length} date${pending.length > 1 ? "s" : ""}.`);
      setPending([]);
      await load();
    } catch (err) {
      setUploadMsg(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadBusy(false);
    }
  }

  const chartData = data?.rows.map((r) => ({ date: r.date, target: r.target ?? 0, actual: r.actualRevenue })) ?? [];
  const computedPending = pending.map(computeRow);

  return (
    <SectionCard
      icon={Target} title="Date-wise Target" tone="amber"
      footnote="Target vs Actual Abandon Cart Revenue, by date. A date with no value set falls back to the Overview tab's monthly target, spread evenly across the month -- 'Monthly (even split)' below shows which days that applies to."
    >
      {loading && !data && <p className="py-8 text-center text-xs text-slate-400">Loading…</p>}
      {error && <div className="mb-3 rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
      {data && (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} formatter={(value: number) => formatINR(value)} contentStyle={{ fontSize: 12, borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="target" name="Target" fill="#fbbf24" radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="actual" name="Actual Revenue" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>

          <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-slate-100">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pl-3 pr-3 font-semibold">Date</th>
                  <th className="py-2 pr-3 text-right font-semibold">Target</th>
                  <th className="py-2 pr-3 text-right font-semibold">Actual</th>
                  <th className="py-2 pr-3 text-right font-semibold">Achv%</th>
                  <th className="py-2 pr-3 font-semibold">Source</th>
                  {data.canSetTarget && <th className="py-2 pr-3 font-semibold">Edit</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.date} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pl-3 pr-3 font-medium text-slate-700">{formatShortDate(r.date)}</td>
                    <td className="py-2 pr-3 text-right text-slate-600">{r.target !== null ? formatINR(r.target) : "—"}</td>
                    <td className="py-2 pr-3 text-right text-slate-600">{formatINR(r.actualRevenue)}</td>
                    <td className={`py-2 pr-3 text-right font-semibold ${r.target ? (r.actualRevenue / r.target >= 1 ? "text-emerald-600" : r.actualRevenue / r.target >= 0.7 ? "text-amber-600" : "text-red-600") : "text-slate-400"}`}>
                      {r.target ? `${Math.round((r.actualRevenue / r.target) * 1000) / 10}%` : "—"}
                    </td>
                    <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SOURCE_TONE[r.source]}`}>{SOURCE_LABEL[r.source]}</span></td>
                    {data.canSetTarget && (
                      <td className="py-2 pr-3">
                        {editDate === r.date ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number" min={0} value={editValue} onChange={(e) => setEditValue(e.target.value)}
                              autoFocus aria-label={`Target for ${r.date}`}
                              className="w-24 rounded border border-slate-200 px-1.5 py-1 text-[11px] focus:border-amber-400 focus:outline-none"
                            />
                            <button type="button" disabled={rowBusy} onClick={() => void saveRow(r.date)} className="rounded bg-amber-600 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50">Save</button>
                            <button type="button" onClick={() => setEditDate(null)} className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">Cancel</button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => { setEditDate(r.date); setEditValue(r.target !== null ? String(r.target) : ""); }} className="text-slate-400 hover:text-amber-600" aria-label={`Edit target for ${r.date}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.canSetTarget && (
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><Upload className="h-3.5 w-3.5" />Upload dates (Conv Tgt% x Allocation formula)</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px] text-slate-500">
                  Date
                  <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="mt-0.5 block rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-amber-400 focus:outline-none" />
                </label>
                <label className="text-[11px] text-slate-500">
                  Conv Tgt %
                  <input type="number" min={0} max={100} step="0.01" value={newConvTgt} onChange={(e) => setNewConvTgt(e.target.value)} placeholder="e.g. 9.48" className="mt-0.5 block w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-amber-400 focus:outline-none" />
                </label>
                <label className="text-[11px] text-slate-500">
                  Allocation
                  <input type="number" min={0} value={newAllocation} onChange={(e) => setNewAllocation(e.target.value)} placeholder="e.g. 1680" className="mt-0.5 block w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-amber-400 focus:outline-none" />
                </label>
                <div className="text-[11px] text-slate-500">
                  {previewRow ? (
                    <>Sale Target <b>{previewRow.saleTarget}</b> · Revenue target <b>{formatINR(previewRow.revenueTarget)}</b></>
                  ) : "Sale Target / Revenue target preview"}
                </div>
                <button type="button" onClick={addPendingRow} disabled={!previewRow} className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                  <Plus className="h-3 w-3" />Add
                </button>
              </div>

              {pending.length > 0 && (
                <div className="mt-3">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="text-slate-400"><th className="py-1 pr-2">Date</th><th className="py-1 pr-2 text-right">Conv Tgt%</th><th className="py-1 pr-2 text-right">Allocation</th><th className="py-1 pr-2 text-right">Sale Target</th><th className="py-1 pr-2 text-right">Revenue target</th><th></th></tr>
                    </thead>
                    <tbody>
                      {computedPending.map((r) => (
                        <tr key={r.date} className="border-t border-slate-100">
                          <td className="py-1 pr-2">{formatShortDate(r.date)}</td>
                          <td className="py-1 pr-2 text-right">{r.convTgtPct}%</td>
                          <td className="py-1 pr-2 text-right">{r.allocation}</td>
                          <td className="py-1 pr-2 text-right">{r.saleTarget}</td>
                          <td className="py-1 pr-2 text-right font-semibold">{formatINR(r.revenueTarget)}</td>
                          <td className="py-1 text-right">
                            <button type="button" onClick={() => setPending((cur) => cur.filter((x) => x.date !== r.date))} aria-label={`Remove ${r.date}`} className="text-slate-400 hover:text-red-600">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" disabled={uploadBusy} onClick={() => void uploadPending()} className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50">
                      {uploadBusy ? "Saving…" : `Save ${pending.length} date${pending.length > 1 ? "s" : ""}`}
                    </button>
                    {uploadMsg && <span className="text-[11px] text-slate-500">{uploadMsg}</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
