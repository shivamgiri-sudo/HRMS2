import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface SalesUpload {
  batchId: string; batchNo: string; fileName: string | null; uploadedAt: string | null; uploadedBy: string | null; status: string;
  totalRows: number; acceptedRows: number; rejectedRows: number; successPct: number; rejectionPct: number; months: string[];
  updatedOrders: number | null; newOrders: number | null; duplicateInFile: number | null; technicalRejects: number | null; warningRows: number | null;
}
interface Reject { row: number; field: string; value: string | null; code: string; reason: string; requiredFormat: string | null; category: "business" | "technical"; severity: "reject" | "warning" }
interface Reason { code: string; label: string; category: "business" | "technical"; rows: number }
interface DateRow { reportDate: string; existingCount: number; uploadCount: number; updatedCount: number; insertedCount: number; afterCount: number; variance: number }
interface Detail { batchId: string; logAvailable: boolean; rejects: Reject[]; reasons: Reason[]; legacy: Array<{ row: number; message: string }>; dates: DateRow[] }
interface Correction extends DateRow { batchNo: string; fileName: string | null; uploadedAt: string; currentCount: number; duplicateCount: number; uploadsForDate: number }

const BASE = "/api/bla-bli-blu-dashboard";
const n = (v: number) => v.toLocaleString("en-IN");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const STATUS: Record<string, string> = {
  imported: "bg-emerald-100 text-emerald-800", imported_with_errors: "bg-amber-100 text-amber-900", validation_failed: "bg-rose-100 text-rose-800",
  failed: "bg-rose-100 text-rose-800", importing: "bg-indigo-100 text-indigo-800",
};
const statusLabel = (s: string) => s.replace(/_/g, " ");
const sel = "rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs";
const signed = (v: number) => (v > 0 ? `+${n(v)}` : n(v));

function csvCell(v: unknown) { return `"${String(v ?? "").replace(/"/g, '""')}"`; }
function downloadRejects(u: SalesUpload, rejects: Reject[]) {
  const head = ["Row No", "Field", "Uploaded Value", "Reason Code", "Error Reason", "Required Format", "Error Type", "Outcome"];
  const lines = [head.map(csvCell).join(","), ...rejects.map((r) => [r.row, r.field, r.value, r.code, r.reason, r.requiredFormat, r.category, r.severity === "warning" ? "imported with warning" : "rejected"].map(csvCell).join(","))];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `blabli-blu-sales-rejections-${u.batchNo}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/**
 * Blabli Blu Overall Sales upload quality (BB-02 / BB-03 / BB-04): every upload with Total / Accepted / Rejected /
 * Success %, its rejection log (row, field, value, reason, required format, business vs technical) and reason chart,
 * and the per-date correction status (existing vs latest upload, variance, duplicates) for the selected period.
 */
export default function BbbSalesUploadQuality({ from, to, refreshKey }: { from: string; to: string; refreshKey: number }) {
  const [uploads, setUploads] = useState<SalesUpload[] | null>(null);
  const [corr, setCorr] = useState<Correction[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [month, setMonth] = useState("");
  const [open, setOpen] = useState<SalesUpload | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [errType, setErrType] = useState<"" | "business" | "technical" | "warning">("");

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [u, c] = await Promise.all([
        hrmsApi.get<{ data: SalesUpload[] }>(`${BASE}/sales-uploads`),
        hrmsApi.get<{ data: { dates: Correction[] } }>(`${BASE}/correction-status?from=${from}&to=${to}`),
      ]);
      setUploads(u.data); setCorr(c.data.dates);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load the upload status"); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const openLog = async (u: SalesUpload) => {
    if (open?.batchId === u.batchId) { setOpen(null); setDetail(null); return; }
    setOpen(u); setDetail(null); setDetailBusy(true); setErrType("");
    try { setDetail((await hrmsApi.get<{ data: Detail }>(`${BASE}/sales-uploads/${u.batchId}`)).data); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not load the rejection log"); }
    finally { setDetailBusy(false); }
  };

  const monthsSeen = useMemo(() => [...new Set((uploads ?? []).flatMap((u) => u.months))].sort().reverse(), [uploads]);
  const statuses = useMemo(() => [...new Set((uploads ?? []).map((u) => u.status))].sort(), [uploads]);
  const shown = (uploads ?? []).filter((u) => (!status || u.status === status) && (!month || u.months.includes(month)));
  const rejects = (detail?.rejects ?? []).filter((r) => !errType || (errType === "warning" ? r.severity === "warning" : r.severity === "reject" && r.category === errType));

  return (
    <section aria-labelledby="bbb-quality" className="space-y-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="bbb-quality" className="text-sm font-semibold text-slate-700">Overall Sales upload status</h3>
        <div className="ml-auto flex flex-wrap gap-2">
          <select aria-label="Upload status" className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <select aria-label="Sales month" className={sel} value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All months</option>{monthsSeen.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>
      <p className="text-xs text-slate-500">Upload Success % = Accepted rows / Total rows. Every rejected row keeps its row number, field, uploaded value and reason. Business errors are fixed in the file; technical errors are system problems to report.</p>
      {err && <p role="alert" className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{err}</p>}
      {!uploads && !err && <div className="flex items-center gap-2 py-3 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}
      {uploads && !shown.length && <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">No Overall Sales uploads{status || month ? " match these filters" : " yet"}.</p>}

      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>{["Uploaded", "File", "By", "Months", "Status", "Total", "Accepted", "Rejected", "Success %", "Rejection %", "Updated / New", ""].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.batchId} className={`border-t border-slate-100 ${open?.batchId === u.batchId ? "bg-amber-50" : ""}`}>
                  <td className="whitespace-nowrap px-2 py-1.5">{when(u.uploadedAt)}</td>
                  <td className="max-w-[180px] truncate px-2" title={u.fileName ?? u.batchNo}>{u.fileName ?? u.batchNo}</td>
                  <td className="px-2">{u.uploadedBy ?? "—"}</td>
                  <td className="whitespace-nowrap px-2">{u.months.join(", ") || "—"}</td>
                  <td className="px-2"><span className={`rounded px-1.5 py-0.5 font-semibold capitalize ${STATUS[u.status] ?? "bg-slate-100 text-slate-700"}`}>{statusLabel(u.status)}</span></td>
                  <td className="px-2 tabular-nums">{n(u.totalRows)}</td>
                  <td className="px-2 tabular-nums text-emerald-700">{n(u.acceptedRows)}</td>
                  <td className="px-2 tabular-nums text-rose-700">{n(u.rejectedRows)}</td>
                  <td className="px-2 font-semibold tabular-nums">{u.successPct.toFixed(1)}%</td>
                  <td className="px-2 tabular-nums">{u.rejectionPct.toFixed(1)}%</td>
                  <td className="whitespace-nowrap px-2 tabular-nums">{u.updatedOrders === null ? "—" : `${n(u.updatedOrders)} / ${n(u.newOrders ?? 0)}`}</td>
                  <td className="px-2 text-right">
                    <button type="button" onClick={() => void openLog(u)} className="min-h-[32px] cursor-pointer rounded-lg border border-slate-300 px-2 font-semibold text-slate-700 hover:bg-slate-50">
                      {open?.batchId === u.batchId ? "Close" : "Rejection log"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-700">{open.fileName ?? open.batchNo}</p>
            <p className="text-xs text-slate-500">{n(open.acceptedRows)} of {n(open.totalRows)} accepted ({open.successPct.toFixed(1)}%){open.duplicateInFile ? ` · ${n(open.duplicateInFile)} OrderID repeated in file` : ""}{open.warningRows ? ` · ${n(open.warningRows)} imported with a warning` : ""}</p>
            {detail && detail.rejects.length > 0 && (
              <button type="button" onClick={() => downloadRejects(open, detail.rejects)} className="ml-auto inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <Download className="h-3.5 w-3.5" aria-hidden />Download rejection log
              </button>
            )}
          </div>
          {detailBusy && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}
          {detail && detail.reasons.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={detail.reasons} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" fontSize={11} allowDecimals={false} />
                    <YAxis type="category" dataKey="label" width={150} fontSize={11} />
                    <Tooltip formatter={(v: number) => [`${n(v)} rows`, "Rejected"]} />
                    <Bar dataKey="rows">{detail.reasons.map((r) => <Cell key={r.code} fill={r.category === "technical" ? "#7c3aed" : "#e11d48"} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className="text-xs">
                <thead className="text-left text-slate-500"><tr><th className="px-2 py-1">Reason</th><th className="px-2 py-1">Error type</th><th className="px-2 py-1 text-right">Rows</th></tr></thead>
                <tbody>{detail.reasons.map((r) => <tr key={r.code} className="border-t border-slate-100"><td className="px-2 py-1">{r.label} <span className="text-slate-400">({r.code})</span></td><td className="px-2 capitalize">{r.category}</td><td className="px-2 text-right tabular-nums">{n(r.rows)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {detail && detail.rejects.length > 0 && (
            <>
              <div className="flex gap-1">
                {([["", "All"], ["business", "Business errors"], ["technical", "Technical errors"], ["warning", "Warnings (imported)"]] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setErrType(k)} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${errType === k ? "bg-slate-900 text-amber-300" : "bg-slate-100 text-slate-600"}`}>{l}</button>
                ))}
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                    <tr>{["Row", "Field", "Uploaded value", "Reason", "Required format", "Type", "Outcome"].map((h) => <th key={h} scope="col" className="px-2 py-1.5 font-semibold">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rejects.slice(0, 1000).map((r, i) => (
                      <tr key={`${r.row}-${r.field}-${i}`} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-1 tabular-nums">{r.row}</td><td className="px-2 font-medium">{r.field}</td>
                        <td className="max-w-[140px] break-words px-2 text-slate-600">{r.value ?? <span className="text-slate-400">(blank)</span>}</td>
                        <td className="px-2">{r.reason} <span className="text-slate-400">({r.code})</span></td>
                        <td className="px-2 text-slate-500">{r.requiredFormat ?? "—"}</td>
                        <td className="px-2 capitalize">{r.category}</td>
                        <td className={`px-2 ${r.severity === "warning" ? "text-amber-700" : "text-rose-700"}`}>{r.severity === "warning" ? "Imported, value blank" : "Rejected"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rejects.length > 1000 && <p className="p-2 text-xs text-slate-500">Showing 1,000 of {n(rejects.length)}; download the log for all.</p>}
              </div>
            </>
          )}
          {detail && !detail.rejects.length && detail.legacy.length > 0 && (
            <ul className="max-h-60 list-disc overflow-auto pl-5 text-xs text-slate-600">{detail.legacy.map((l) => <li key={l.row}>Row {l.row}: {l.message}</li>)}</ul>
          )}
          {detail && !detail.rejects.length && !detail.legacy.length && <p className="text-xs text-emerald-700">No rejected rows in this upload.</p>}
          {detail && detail.dates.length > 0 && (
            <p className="text-xs text-slate-500">Dates in this file: {detail.dates.map((d) => `${d.reportDate} (${n(d.uploadCount)} uploaded, ${n(d.existingCount)} before, variance ${signed(d.variance)})`).join(" · ")}</p>
          )}
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-slate-700">Data quality / correction status</h4>
        <p className="mb-2 text-xs text-slate-500">Per sales date in the selected period: orders on the dashboard before the latest upload, the count in that upload, and Variance = latest upload count - existing count. OrderID is the key, so a corrected re-upload updates orders instead of adding them; Duplicates must stay 0.</p>
        {corr && !corr.length && <p className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500">No Overall Sales upload has touched a date in this period since the correction log started.</p>}
        {corr && corr.length > 0 && (
          <div className="max-h-80 overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr>{["Date", "Latest upload", "Existing count", "Latest upload count", "Variance", "Updated", "New", "On dashboard now", "Duplicates", "Uploads"].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-2 py-1.5 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {corr.map((c) => (
                  <tr key={c.reportDate} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-2 py-1">{c.reportDate}</td>
                    <td className="max-w-[180px] truncate px-2" title={c.fileName ?? c.batchNo}>{c.fileName ?? c.batchNo} <span className="text-slate-400">{when(c.uploadedAt)}</span></td>
                    <td className="px-2 tabular-nums">{n(c.existingCount)}</td><td className="px-2 tabular-nums">{n(c.uploadCount)}</td>
                    <td className={`px-2 font-semibold tabular-nums ${c.variance === 0 ? "text-slate-600" : c.variance > 0 ? "text-emerald-700" : "text-amber-700"}`}>{signed(c.variance)}</td>
                    <td className="px-2 tabular-nums">{n(c.updatedCount)}</td><td className="px-2 tabular-nums">{n(c.insertedCount)}</td>
                    <td className="px-2 tabular-nums">{n(c.currentCount)}</td>
                    <td className={`px-2 tabular-nums ${c.duplicateCount ? "font-semibold text-rose-700" : "text-emerald-700"}`}>{n(c.duplicateCount)}</td>
                    <td className="px-2 tabular-nums">{n(c.uploadsForDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
