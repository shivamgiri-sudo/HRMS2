/**
 * Bulk voice calls. Upload the sheet HR already uses (phone, name, role, interview_date, interview_time, branch_address,
 * reference_id), review exactly what is valid before anything is queued, then start the calls. Each row becomes one
 * confirmation call by the voice bot; results flow into the lead pool like every other call.
 *
 * The file is read in the browser (SheetJS). CSV is read as raw text so "05/10/2026" is never re-interpreted as a US
 * date; Excel date/time cells arrive as serial numbers and the server converts them, so locale never matters.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, ListChecks, Phone, PhoneOff, Upload } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { EmptyState, StatTile, num } from "@/components/analytics/analytics-kit";
import CallingFileExport from "./CallingFileExport";
import CallResultsImport from "./CallResultsImport";
import { useMetaRecruitment } from "./MetaRecruitmentStrip";
import SuperbotReportUpload from "./SuperbotReportUpload";

interface PreviewRow { display: { phone: string; name: string; role: string; when: string }; rowNo: number; ok: boolean; errors: string[]; warnings: string[]; notes: string[]; row?: { mobile10: string; name: string; role: string; interviewAt: string; branchAddress: string; referenceId: string } }
interface Preview { missingColumns: string[]; tooMany: boolean; rows: PreviewRow[]; summary: { total: number; valid: number; rejected: number; willSkip: number } }
interface Batch { id: string; label: string | null; status: string; total_rows: number; rejected_rows: number; created_at: string; queued: number | null; in_progress: number | null; completed: number | null; skipped: number | null; cancelled: number | null; confirmed: number | null; rescheduled: number | null; declined: number | null; no_answer: number | null }
interface Campaign { id: string; status: string; campaignName: string; requisitionCode: string | null; role: string | null; branchName: string | null; city: string | null; isAhmedabad: boolean; qualifiedFuture: number; invitedFuture: number; interviewPassed: number }
interface Job { id: string; row_no: number; mobile10: string; candidate_name: string; role: string; interview_at: string; reference_id: string; status: string; skip_reason: string | null; attempts: number; outcome: string | null }

const TEMPLATE = [
  "phone,name,role,interview_date,interview_time,branch_address,reference_id",
  '9876543210,Rohit Sharma,Customer Success Executive - Telesales,16/10/2026,10:30 AM,"Trapezoid IT Park, 1st Floor, C-27, Sector 62, Noida - 201309",HE-1001',
  '9812345678,Priya Singh,Collections Executive,16/10/2026,11:00 AM,"F-15, Jal Darshan Co-operative Society, Ashram Road, Ahmedabad - 380006",HE-1002',
].join("\n");

const OUTCOME: Record<string, string> = { WALKIN_CONFIRMED_YES: "Confirmed", WALKIN_RESCHEDULED: "Rescheduled", WALKIN_DECLINED_NEEDS_FOLLOWUP: "Declined - needs follow-up", NO_ANSWER: "No answer", WRONG_PERSON_REACHED: "Wrong person" };
const outcomeLabel = (o: string | null) => (o ? (OUTCOME[o] ?? (o.startsWith("CALL_FAILED") ? "Call failed" : o)) : "—");
const pill = (s: string) => ({ active: "bg-emerald-50 text-emerald-700 ring-emerald-200", queued: "bg-blue-50 text-blue-700 ring-blue-200", done: "bg-slate-100 text-slate-600 ring-slate-200", cancelled: "bg-rose-50 text-rose-700 ring-rose-200", placed: "bg-amber-50 text-amber-700 ring-amber-200", completed: "bg-emerald-50 text-emerald-700 ring-emerald-200", skipped: "bg-slate-100 text-slate-500 ring-slate-200" }[s] ?? "bg-slate-50 text-slate-600 ring-slate-200");
const EXCLUDED: Record<string, string> = { already_walked_in: "already walked in", duplicate_phone: "same phone twice", opted_out: "opted out", no_slot_capacity: "no slot left that day (raise seats per slot)",  already_sent_to_calling_tool: "already sent to the calling tool today", already_confirmed: "already confirmed on WhatsApp", invite_not_sent_yet: "invite not sent yet", interview_date_passed: "interview date has passed", no_interview_assigned: "no interview slot assigned", declined: "declined", requisition_closed_or_filled: "requisition closed or filled" };
const field = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

export default function BulkCallsTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [label, setLabel] = useState("");
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const { data: recruitment } = useMetaRecruitment();
  const recOf = (id: string) => recruitment?.campaigns.find((r) => r.campaignId === id);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [includeConfirmed, setIncludeConfirmed] = useState(false);
  const [requireInvite, setRequireInvite] = useState(true);
  const [includeExported, setIncludeExported] = useState(false);
  const tomorrowIst = () => new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);
  const [mode, setMode] = useState<"upcoming" | "missed">("upcoming");
  const [newDate, setNewDate] = useState(tomorrowIst);
  const [slotStart, setSlotStart] = useState("10:00");
  const [slotEnd, setSlotEnd] = useState("17:30");
  const [perSlot, setPerSlot] = useState(6);
  const [excluded, setExcluded] = useState<Record<string, number> | null>(null);

  const loadBatches = useCallback(async () => {
    try { const r = await hrmsApi.get<{ data: Batch[] }>("/api/he/bulk-calls"); setBatches(r.data ?? []); } catch { /* shown on next action */ }
  }, []);
  useEffect(() => { void loadBatches(); }, [loadBatches]);
  useEffect(() => {
    hrmsApi.get<{ data: Campaign[] }>("/api/he/bulk-calls/campaigns").then((r) => {
      const list = r.data ?? [];
      setCampaigns(list);
      setPicked(list.filter((c) => c.isAhmedabad && c.qualifiedFuture > 0).map((c) => c.id)); // AHM pre-selected
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!batches.some((b) => b.status === "active")) return;
    const t = setInterval(() => { void loadBatches(); if (open) void openBatch(open, true); }, 15_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, open, loadBatches]);

  const downloadTemplate = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    a.download = "voice_call_upload_template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const runPreview = async (data: Array<Record<string, unknown>>, name: string) => {
    setRows(data); setFileName(name);
    const p = await hrmsApi.post<{ data: Preview }>("/api/he/bulk-calls/preview", { rows: data });
    setPreview(p.data);
  };

  const onFile = async (f: File | undefined) => {
    setMsg(null); setPreview(null); setRows([]); setAttest(false); setExcluded(null);
    if (!f) return;
    setFileName(f.name); setBusy("parse");
    try {
      const XLSX = await import("xlsx");
      const isCsv = /\.csv$/i.test(f.name);
      const wb = isCsv ? XLSX.read(await f.text(), { type: "string", raw: true }) : XLSX.read(await f.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true }).filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
      if (!data.length) { setMsg({ ok: false, text: "The file has no data rows." }); return; }
      await runPreview(data, f.name);
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not read that file. Use the template (CSV or Excel)." }); }
    finally { setBusy(null); }
  };

  /** Build the sheet from the selected campaigns, then it follows exactly the same review-and-queue path as a file. */
  const prepare = async () => {
    setMsg(null); setPreview(null); setRows([]); setAttest(false); setExcluded(null); setBusy("prepare");
    try {
      const r = mode === "missed"
        ? await hrmsApi.post<{ data: { rows: Array<Record<string, unknown>>; truncated: boolean; excluded: Record<string, number> } }>("/api/he/bulk-calls/prepare-missed", { campaignIds: picked, newDate, slotStart, slotEnd, perSlot, includeRecentlyExported: includeExported })
        : await hrmsApi.post<{ data: { rows: Array<Record<string, unknown>>; truncated: boolean; excluded: Record<string, number> } }>("/api/he/bulk-calls/prepare", { campaignIds: picked, includeConfirmed, requireInviteSent: requireInvite, includeRecentlyExported: includeExported });
      setExcluded(r.data.excluded);
      if (!r.data.rows.length) { setMsg({ ok: false, text: mode === "missed" ? "No candidate who missed their interview needs a new invite in these campaigns right now." : "No qualified candidates with a future interview match these campaigns right now." }); return; }
      const names = campaigns.filter((c) => picked.includes(c.id)).map((c) => c.campaignName).join(", ");
      await runPreview(r.data.rows, `${mode === "missed" ? `Re-invite ${newDate}: ` : "Campaigns: "}${names}`.slice(0, 140));
      if (r.data.truncated) setMsg({ ok: false, text: "More than 500 candidates match. Only the first 500 (earliest interviews) are listed; queue them, then prepare again." });
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not prepare the list" }); }
    finally { setBusy(null); }
  };

  const queue = async () => {
    setBusy("queue"); setMsg(null);
    try {
      const r = await hrmsApi.post<{ data: { queued: number; rejected: number } }>("/api/he/bulk-calls", { rows, label: label.trim() || fileName, attest });
      setMsg({ ok: true, text: `${r.data.queued} calls queued${r.data.rejected ? ` (${r.data.rejected} rows left out because of errors)` : ""}. Nothing is dialled until you press Start calling.` });
      setPreview(null); setRows([]); setFileName(""); setAttest(false); setLabel(""); setExcluded(null);
      if (fileRef.current) fileRef.current.value = "";
      await loadBatches();
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not queue the calls" }); }
    finally { setBusy(null); }
  };

  const start = async (b: Batch) => {
    if (!window.confirm(`Start calling for "${b.label ?? "this batch"}"? Real phone calls will be placed to ${num(Number(b.queued ?? 0))} candidates (between 9:00 and 20:00 IST).`)) return;
    setBusy(`s${b.id}`); setMsg(null);
    try {
      const r = await hrmsApi.post<{ data: { placed: number; skipped: Record<string, number>; blocked: Record<string, number>; failed: number } }>(`/api/he/bulk-calls/${b.id}/start`, { dryRun: false });
      const d = r.data;
      const parts = [`${d.placed} call${d.placed === 1 ? "" : "s"} placed`];
      for (const [k, v] of Object.entries(d.blocked)) parts.push(`${v} waiting (${k.replace(/_/g, " ")})`);
      for (const [k, v] of Object.entries(d.skipped)) parts.push(`${v} skipped (${k.replace(/_/g, " ")})`);
      if (d.failed) parts.push(`${d.failed} failed to start`);
      setMsg({ ok: d.placed > 0 || (!d.failed && Object.keys(d.blocked).length > 0), text: parts.join(" · ") });
      await loadBatches(); if (open === b.id) await openBatch(b.id, true);
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not start the calls" }); }
    finally { setBusy(null); }
  };

  const cancel = async (b: Batch) => {
    if (!window.confirm("Cancel the calls that have not been placed yet? Calls already in progress are not affected.")) return;
    setBusy(`c${b.id}`);
    try { await hrmsApi.post(`/api/he/bulk-calls/${b.id}/cancel`, {}); await loadBatches(); } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not cancel" }); }
    finally { setBusy(null); }
  };

  const openBatch = async (id: string, keep = false) => {
    if (!keep && open === id) { setOpen(null); return; }
    setOpen(id);
    try { const r = await hrmsApi.get<{ data: Job[] }>(`/api/he/bulk-calls/${id}`); setJobs(r.data ?? []); } catch { setJobs([]); }
  };

  const s = preview?.summary;
  const canQueue = Boolean(preview && !preview.missingColumns.length && !preview.tooMany && s && s.valid > 0 && attest && busy === null);

  return (
    <div className="space-y-6">
      <SuperbotReportUpload />
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Prepare from Meta campaigns">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900"><ListChecks className="h-4 w-4 text-blue-600" aria-hidden /> Prepare from Meta campaigns</h2>
        <div role="radiogroup" aria-label="Who to call" className="mt-3 inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
          {([["upcoming", "Confirm upcoming interviews"], ["missed", "Did not walk in - invite again"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => { setMode(k); setPreview(null); setRows([]); setExcluded(null); setPicked(campaigns.filter((c) => c.isAhmedabad && (k === "missed" ? c.interviewPassed > 0 : c.qualifiedFuture > 0)).map((c) => c.id)); }} className={`cursor-pointer rounded-md px-3 py-1.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${mode === k ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{l}</button>
          ))}
        </div>
        <p className="mt-2 text-sm text-slate-600">{mode === "missed" ? "Finds qualified candidates whose interview date has passed and who never registered at the branch, and invites them for the new date below. Anyone with a walk-in record (by link, phone or queue token) is left out." : "Builds the calling list for qualified candidates whose interview is still in the future. Ahmedabad (AHM) campaigns are pre-selected. A campaign marked draft or paused in HRMS is listed too when it has such candidates. You review the list before anything is queued."}</p>
        {campaigns.length === 0 ? <p className="mt-3 text-sm text-slate-500">No active campaigns found.</p> : (
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {campaigns.map((c) => (
              <li key={c.id}>
                <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-blue-500 ${picked.includes(c.id) ? "border-blue-300 bg-blue-50/50" : "border-slate-200 hover:bg-slate-50"}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4 cursor-pointer" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} aria-label={`Include ${c.campaignName}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{c.campaignName}{c.isAhmedabad && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">AHM</span>}{c.status !== "active" && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700" title="This campaign is not marked active in HRMS but has qualified candidates with a future interview">{c.status} in HRMS</span>}</span>
                    <span className="block text-xs text-slate-500">{c.role ?? "—"} · {c.branchName ?? "no branch"}</span>
                    {recOf(c.id) && <span className="mt-0.5 block text-xs font-medium text-emerald-700">Recruited so far: {num(recOf(c.id)!.joined)} joined · {num(recOf(c.id)!.selected)} selected</span>}
                    <span className="mt-1 block text-xs text-slate-700">{mode === "missed" ? <><b>{num(c.interviewPassed)}</b> qualified with an interview date that has passed</> : <><b>{num(c.invitedFuture)}</b> invited and waiting · {num(c.qualifiedFuture)} qualified with a future interview</>}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {mode === "missed" && (
          <div className="mt-3 flex flex-wrap items-end gap-4 rounded-lg bg-slate-50 p-3 text-sm">
            <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">New interview date</span><input type="date" className={field} value={newDate} min={new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)} onChange={(e) => setNewDate(e.target.value)} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">First slot</span><input type="time" className={field} value={slotStart} onChange={(e) => setSlotStart(e.target.value)} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Last slot ends</span><input type="time" className={field} value={slotEnd} onChange={(e) => setSlotEnd(e.target.value)} /></label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">Seats per 30 min</span><input type="number" min={1} max={50} className={`${field} w-24`} value={perSlot} onChange={(e) => setPerSlot(Number(e.target.value))} /></label>
            <p className="text-xs text-slate-500">Candidates are spread across the day so nobody is told the same time as everyone else.</p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-700">
          {mode === "upcoming" && <><label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 cursor-pointer" checked={requireInvite} onChange={(e) => setRequireInvite(e.target.checked)} /> Only candidates who were already sent the invite</label>
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 cursor-pointer" checked={includeConfirmed} onChange={(e) => setIncludeConfirmed(e.target.checked)} /> Include those who already confirmed on WhatsApp</label></>}
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 cursor-pointer" checked={includeExported} onChange={(e) => setIncludeExported(e.target.checked)} /> Include those already sent to the calling tool in the last 18 hours</label>
          <button type="button" disabled={picked.length === 0 || busy !== null} onClick={() => void prepare()} className="ml-auto cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">{busy === "prepare" ? "Preparing…" : mode === "missed" ? `Prepare re-invite list (${picked.length} campaign${picked.length === 1 ? "" : "s"})` : `Prepare calling list (${picked.length} campaign${picked.length === 1 ? "" : "s"})`}</button>
        </div>
        {excluded && Object.keys(excluded).length > 0 && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Qualified candidates left out: {Object.entries(excluded).map(([k, v]) => `${v} ${EXCLUDED[k] ?? k}`).join(" · ")}.</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Upload className="h-4 w-4 text-blue-600" aria-hidden /> Upload a calling list</h2>
            <p className="mt-1 text-sm text-slate-600">One row per candidate. The voice bot calls each one to confirm the interview date, time and branch address.</p>
            <p className="mt-1 text-xs text-slate-500">Columns: phone · name · role · interview_date · interview_time · branch_address · reference_id (optional). Dates as DD/MM/YYYY, times like 10:30 AM. Up to 500 rows.</p>
          </div>
          <button type="button" onClick={downloadTemplate} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <Download className="h-4 w-4" aria-hidden /> Download template
          </button>
        </div>
        <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/40 focus-within:ring-2 focus-within:ring-blue-500">
          <FileSpreadsheet className="h-8 w-8 text-slate-400" aria-hidden />
          <span className="text-sm font-medium text-slate-700">{busy === "parse" ? "Reading file…" : fileName || "Choose a CSV or Excel file"}</span>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" aria-label="Calling list file" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </section>

      {msg && <div role={msg.ok ? "status" : "alert"} className={`rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{msg.text}</div>}

      {preview && (
        <section className="space-y-4" aria-label="File check">
          {preview.missingColumns.length > 0 && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">The file is missing these columns: <b>{preview.missingColumns.join(", ")}</b>. Download the template and copy your data into it.</div>}
          {preview.tooMany && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Too many rows. Split the file into batches of 500 or fewer.</div>}
          {s && !preview.missingColumns.length && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatTile label="Rows in file" value={num(s.total)} />
                <StatTile label="Ready to call" value={num(s.valid)} intent="good" icon={<Phone className="h-4 w-4" />} />
                <StatTile label="Rejected" value={num(s.rejected)} intent={s.rejected ? "critical" : "neutral"} denominator="fix and re-upload" icon={<PhoneOff className="h-4 w-4" />} />
                <StatTile label="Will be skipped" value={num(s.willSkip)} intent={s.willSkip ? "warning" : "neutral"} denominator="opted out / reached today" />
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Row</th><th className="px-4 py-3">Candidate</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Interview</th><th className="px-4 py-3">Check</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.rows.map((r) => (
                      <tr key={r.rowNo} className={r.ok ? "" : "bg-rose-50/40"}>
                        <td className="px-4 py-2.5 tabular-nums text-slate-500">{r.rowNo}</td>
                        <td className="px-4 py-2.5"><div className="font-medium text-slate-900">{r.row?.name ?? (r.display.name || "—")}</div><div className="text-xs text-slate-500">{r.row?.mobile10 ?? r.display.phone}</div></td>
                        <td className="px-4 py-2.5 text-slate-700">{r.row?.role ?? (r.display.role || "—")}</td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-700">{r.row ? r.row.interviewAt.slice(0, 16) : (r.display.when || "—")}</td>
                        <td className="px-4 py-2.5">
                          {r.ok ? <span className="text-emerald-700">Ready</span> : <ul className="space-y-0.5 text-rose-700">{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                          {r.warnings.map((w, i) => <div key={i} className="text-xs text-amber-700">{w}</div>)}
                          {r.notes.map((w, i) => <div key={i} className="text-xs text-amber-700">{w}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {s.valid > 0 && <CallingFileExport rows={preview.rows.filter((r) => r.ok && r.row).map((r) => ({ mobile10: r.row!.mobile10, name: r.row!.name, role: r.row!.role, interviewAt: r.row!.interviewAt, branchAddress: r.row!.branchAddress, referenceId: r.row!.referenceId }))} label={fileName} />}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="font-semibold text-slate-900">Or call from the HRMS</h3>
                <p className="mt-1 text-sm text-slate-600">Only when voice calling is configured in the HRMS. Not needed if you are uploading the file to the third-party tool.</p>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <label className="block text-sm"><span className="mb-1 block font-medium text-slate-700">Batch name (optional)</span><input className={`${field} w-full`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={fileName} maxLength={150} /></label>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 cursor-pointer" checked={attest} onChange={(e) => setAttest(e.target.checked)} /><span className="text-slate-700">I confirm these candidates applied for the role and agreed to be contacted. <span className="text-slate-500">This is recorded against each candidate.</span></span></label>
                </div>
                <div className="mt-4 flex justify-end">
                  <button type="button" disabled={!canQueue} onClick={() => void queue()} className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
                    {busy === "queue" ? "Queueing…" : `Queue ${s.valid} call${s.valid === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      <CallResultsImport />

      <section aria-label="Batches">
        <h2 className="mb-2 font-semibold text-slate-900">Batches</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Batch</th><th className="px-4 py-3">Progress</th><th className="px-4 py-3">Results</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {batches.map((b) => (
                <tr key={b.id} className="align-top">
                  <td className="px-4 py-3"><button type="button" onClick={() => void openBatch(b.id)} className="cursor-pointer text-left font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{b.label ?? "Untitled batch"}</button><div className="text-xs text-slate-500">{String(b.created_at).slice(0, 16)} · {b.total_rows} rows{b.rejected_rows ? ` · ${b.rejected_rows} rejected` : ""}</div></td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{num(Number(b.queued ?? 0))} waiting · {num(Number(b.in_progress ?? 0))} on call · {num(Number(b.completed ?? 0))} done{Number(b.skipped ?? 0) ? ` · ${b.skipped} skipped` : ""}</td>
                  <td className="px-4 py-3 text-slate-700"><b>{num(Number(b.confirmed ?? 0))}</b> confirmed · {num(Number(b.rescheduled ?? 0))} rescheduled · {num(Number(b.declined ?? 0))} declined · {num(Number(b.no_answer ?? 0))} no answer</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${pill(b.status)}`}>{b.status}</span></td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-1.5">
                    {(b.status === "queued" || b.status === "active") && Number(b.queued ?? 0) > 0 && <button type="button" disabled={busy !== null} onClick={() => void start(b)} className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"><Phone className="h-3.5 w-3.5" aria-hidden /> {b.status === "active" ? "Place next calls" : "Start calling"}</button>}
                    {(b.status === "queued" || b.status === "active") && <button type="button" disabled={busy !== null} onClick={() => void cancel(b)} className="cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Cancel</button>}
                  </div></td>
                </tr>
              ))}
              {open && (
                <tr><td colSpan={5} className="bg-slate-50/60 p-0">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[10px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-6 py-2">Row</th><th className="px-4 py-2">Candidate</th><th className="px-4 py-2">Interview</th><th className="px-4 py-2">Reference</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Tries</th><th className="px-4 py-2">Outcome</th></tr></thead>
                    <tbody className="divide-y divide-slate-200/70">
                      {jobs.map((j) => (
                        <tr key={j.id}><td className="px-6 py-2 tabular-nums">{j.row_no}</td><td className="px-4 py-2"><span className="font-medium text-slate-900">{j.candidate_name}</span> <span className="text-slate-500">{j.mobile10}</span></td><td className="px-4 py-2 tabular-nums">{String(j.interview_at).slice(0, 16)}</td><td className="px-4 py-2">{j.reference_id}</td>
                          <td className="px-4 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ring-1 ring-inset ${pill(j.status)}`}>{j.status}{j.skip_reason ? ` · ${j.skip_reason.replace(/_/g, " ")}` : ""}</span></td>
                          <td className="px-4 py-2 tabular-nums">{j.attempts}</td><td className="px-4 py-2 font-medium">{outcomeLabel(j.outcome)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </td></tr>
              )}
            </tbody>
          </table>
          {batches.length === 0 && <EmptyState label="No batches yet" hint="Upload a calling list above." />}
        </div>
      </section>
    </div>
  );
}
