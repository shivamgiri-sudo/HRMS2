/**
 * Hands the validated list to the third-party calling tool as a file. The columns are exactly the seven the tool takes
 * (phone, name, role, interview_date, interview_time, branch_address, reference_id); date/phone style are options because
 * the date is read aloud by the bot. Downloading is logged in the HRMS so the next prepared list skips these people.
 */
import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

export interface ExportRow { mobile10: string; name: string; role: string; interviewAt: string; branchAddress: string; referenceId: string }

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COLS = ["phone", "name", "role", "interview_date", "interview_time", "branch_address", "reference_id"];

export function formatDate(ymd: string, style: "spoken" | "dmy" | "iso"): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (style === "iso") return ymd;
  if (style === "dmy") return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[dow]}, ${d} ${MON[m - 1]} ${y}`;
}
export function formatTime(hms: string, style: "ampm" | "h24"): string {
  const [h, mi] = hms.split(":").map(Number);
  return style === "h24" ? `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` : `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
export function buildSheet(rows: ExportRow[], o: { date: "spoken" | "dmy" | "iso"; time: "ampm" | "h24"; phone: "plain" | "plus91" }): string[][] {
  return [COLS, ...rows.map((r) => [o.phone === "plus91" ? `+91${r.mobile10}` : r.mobile10, r.name, r.role, formatDate(r.interviewAt.slice(0, 10), o.date), formatTime(r.interviewAt.slice(11, 19), o.time), r.branchAddress, r.referenceId])];
}

const sel = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

export default function CallingFileExport({ rows, label, onLogged }: { rows: ExportRow[]; label: string; onLogged?: (marked: number) => void }) {
  const [date, setDate] = useState<"spoken" | "dmy" | "iso">("spoken");
  const [time, setTime] = useState<"ampm" | "h24">("ampm");
  const [phone, setPhone] = useState<"plain" | "plus91">("plain");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const download = async (kind: "csv" | "xlsx") => {
    setBusy(true); setNote(null);
    try {
      // Record the hand-over FIRST, so the HRMS never has a file out in the world that it does not know about (closing the
      // tab right after a download would otherwise lose the record and the same people could be exported again). A failure
      // here must not block HR's work: the file is still produced, with a warning.
      let marked: number | null = null;
      try {
        const r = await hrmsApi.post<{ data: { marked: number } }>("/api/he/bulk-calls/exported", { mobiles: rows.map((x) => x.mobile10), label, slots: Object.fromEntries(rows.map((x) => [x.mobile10, x.interviewAt])), names: Object.fromEntries(rows.map((x) => [x.mobile10, x.name])) });
        marked = r.data.marked;
      } catch { /* warned below */ }

      const XLSX = await import("xlsx");
      const aoa = buildSheet(rows, { date, time, phone });
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Phone numbers and times must stay text so Excel does not turn 9999746258 into 1E+10 or "10:30 AM" into a fraction.
      for (let r = 1; r < aoa.length; r++) for (const c of [0, 3, 4]) { const ref = XLSX.utils.encode_cell({ r, c }); if (ws[ref]) { ws[ref].t = "s"; ws[ref].z = "@"; } }
      ws["!cols"] = [{ wch: 14 }, { wch: 20 }, { wch: 34 }, { wch: 18 }, { wch: 12 }, { wch: 70 }, { wch: 20 }];
      const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, "");
      if (kind === "xlsx") {
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "calls");
        XLSX.writeFile(wb, `calling_file_${stamp}.xlsx`, { bookType: "xlsx" });
      } else {
        // Plain UTF-8 with NO byte-order mark: XLSX.writeFile adds one for CSV, which turns the first header into
        // "\uFEFFphone" and can make a portal that matches headers strictly reject the whole file.
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([XLSX.utils.sheet_to_csv(ws)], { type: "text/csv;charset=utf-8" }));
        a.download = `calling_file_${stamp}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      setNote(marked === null
        ? `${rows.length} candidates downloaded, but the HRMS could not record the hand-over, so the next prepared list may include them again.`
        : `${rows.length} candidates downloaded. They are marked as sent to the calling tool, so the next prepared list skips them for 18 hours.`);
      if (marked !== null) onLogged?.(marked);
    } catch (e: unknown) { setNote((e as { message?: string })?.message || "Could not create the file"); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4" aria-label="Download for the calling tool">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900"><FileSpreadsheet className="h-4 w-4 text-blue-600" aria-hidden /> Download the calling file for the third-party tool</h3>
      <p className="mt-1 text-sm text-slate-600">{rows.length} ready candidate{rows.length === 1 ? "" : "s"}, in the seven columns the tool takes. Rejected rows are not included.</p>
      <div className="mt-3 flex flex-wrap items-end gap-4 text-sm">
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Date as</span><select className={sel} value={date} onChange={(e) => setDate(e.target.value as typeof date)}><option value="spoken">Wed, 16 Oct 2026 (as read aloud)</option><option value="dmy">16/10/2026</option><option value="iso">2026-10-16</option></select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Time as</span><select className={sel} value={time} onChange={(e) => setTime(e.target.value as typeof time)}><option value="ampm">10:30 AM</option><option value="h24">10:30 (24-hour)</option></select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Phone as</span><select className={sel} value={phone} onChange={(e) => setPhone(e.target.value as typeof phone)}><option value="plain">9999746258</option><option value="plus91">+919999746258</option></select></label>
        <div className="ml-auto flex gap-2">
          <button type="button" disabled={busy || rows.length === 0} onClick={() => void download("csv")} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"><Download className="h-4 w-4" aria-hidden /> Download CSV</button>
          <button type="button" disabled={busy || rows.length === 0} onClick={() => void download("xlsx")} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3.5 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Download className="h-4 w-4" aria-hidden /> Download Excel</button>
        </div>
      </div>
      {note && <p role="status" className="mt-3 text-sm text-slate-700">{note}</p>}
    </div>
  );
}
