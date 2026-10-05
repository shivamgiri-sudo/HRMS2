import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2, Mail, Pause, Play, Plus, Send, X, XCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Right-side drawer for scheduled MIS emails on a process dashboard. Opened from the Export
 * menu ("Schedule email"). Lists the schedules for this dashboard, creates new ones, and shows
 * a schedule's full detail with its send history and actions.
 *
 * Dates display as DD/MM/YYYY HH:mm. Closed choices (frequency, period, weekday) are dropdowns.
 */

type Frequency = "once" | "daily" | "weekly";
type RangeMode = "mtd" | "yesterday" | "last_7_days" | "fixed";
type ScheduleStatus = "active" | "paused" | "completed" | "cancelled";

interface ScheduleListItem {
  id: string;
  reportTitle: string;
  to: string[];
  cc: string[];
  subject: string;
  frequency: Frequency;
  sendTime: string;
  status: ScheduleStatus;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
}

interface ScheduleDetail extends ScheduleListItem {
  bodyText: string;
  lob: string | null;
  rangeMode: RangeMode;
  rangeFrom: string | null;
  rangeTo: string | null;
  sendOnDate: string | null;
  weekday: number | null;
  lastError: string | null;
  createdBy: string;
}

interface RunRow {
  id: string;
  trigger: "scheduled" | "manual";
  startedAt: string;
  finishedAt: string | null;
  status: "sent" | "failed";
  periodFrom: string | null;
  periodTo: string | null;
  to: string[];
  cc: string[];
  attachmentRows: number | null;
  messageId: string | null;
  error: string | null;
}

const BASE = "/api/process-performance/mis-schedules";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PERIOD_LABEL: Record<RangeMode, string> = {
  mtd: "Month to date", yesterday: "Yesterday", last_7_days: "Last 7 days (ending yesterday)", fixed: "Fixed date range",
};
const FREQ_LABEL: Record<Frequency, string> = { once: "Once", daily: "Every day", weekly: "Every week" };
const STATUS_STYLE: Record<ScheduleStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  paused: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-slate-100 text-slate-600 border-slate-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
};

/** "YYYY-MM-DD HH:mm[:ss]" or ISO -> "DD/MM/YYYY HH:mm". */
function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "None";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "None";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{children}</p>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block space-y-1">
    <span className="text-xs font-semibold text-slate-600">{label}</span>
    {children}
  </label>
);

function defaultBody(reportTitle: string): string {
  return `Hello,\n\nPlease find the ${reportTitle} data attached for the period shown in the file.\n\nRegards,\nMAS Callnet HRMS`;
}

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface MisEmailScheduleDrawerProps {
  open: boolean;
  onClose: () => void;
  dashboardKey: string;
  reportTitle: string;
  lob?: string;
}

export function MisEmailScheduleDrawer({ open, onClose, dashboardKey, reportTitle, lob }: MisEmailScheduleDrawerProps) {
  const [view, setView] = useState<"list" | "new" | "detail">("list");
  const [schedules, setSchedules] = useState<ScheduleListItem[] | null>(null);
  const [listError, setListError] = useState("");
  const [detail, setDetail] = useState<{ schedule: ScheduleDetail; runs: RunRow[] } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  // form state
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`${reportTitle} - scheduled MIS`);
  const [bodyText, setBodyText] = useState(() => defaultBody(reportTitle));
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [sendTime, setSendTime] = useState("09:30");
  const [sendOnDate, setSendOnDate] = useState(todayIso());
  const [weekday, setWeekday] = useState("1");
  const [rangeMode, setRangeMode] = useState<RangeMode>("yesterday");
  const [rangeFrom, setRangeFrom] = useState(todayIso());
  const [rangeTo, setRangeTo] = useState(todayIso());

  const loadList = useCallback(async () => {
    setListError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ScheduleListItem[] }>(`${BASE}?dashboard=${encodeURIComponent(dashboardKey)}`);
      setSchedules(res.data ?? []);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load schedules.");
    }
  }, [dashboardKey]);

  const loadDetail = useCallback(async (id: string) => {
    setNotice(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: { schedule: ScheduleDetail; runs: RunRow[] } }>(`${BASE}/${id}`);
      setDetail(res.data);
    } catch (err) {
      setNotice({ tone: "err", text: err instanceof Error ? err.message : "Could not load the schedule." });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setView("list");
    setNotice(null);
    void loadList();
  }, [open, loadList]);

  useEffect(() => {
    if (open && view === "detail" && detailId) void loadDetail(detailId);
  }, [open, view, detailId, loadDetail]);

  if (!open) return null;

  const openDetail = (id: string) => {
    setDetail(null);
    setDetailId(id);
    setView("detail");
  };

  const submitNew = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const payload = {
        dashboardKey, reportTitle, lob: lob ?? null, to, cc, subject, bodyText, frequency, sendTime,
        sendOnDate: frequency === "once" ? sendOnDate : null,
        weekday: frequency === "weekly" ? Number(weekday) : null,
        rangeMode, rangeFrom: rangeMode === "fixed" ? rangeFrom : null, rangeTo: rangeMode === "fixed" ? rangeTo : null,
      };
      const res = await hrmsApi.post<{ success: boolean; data: { id: string; nextRunAt: string | null } }>(BASE, payload);
      setNotice({ tone: "ok", text: `Scheduled. Next send: ${fmtDateTime(res.data.nextRunAt)}.` });
      setDetailId(res.data.id);
      setView("detail");
    } catch (err) {
      setNotice({ tone: "err", text: err instanceof Error ? err.message : "Could not create the schedule." });
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: "pause" | "resume" | "cancel" | "run-now") => {
    if (!detailId) return;
    if (action === "cancel" && !window.confirm("Cancel this scheduled email? It will not be sent again.")) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await hrmsApi.post<{ success: boolean; data?: { status?: string } }>(`${BASE}/${detailId}/${action}`);
      const text = action === "run-now" ? "Sent now. The run is recorded below." : `Schedule ${action === "pause" ? "paused" : action === "resume" ? "resumed" : "cancelled"}.`;
      setNotice({ tone: "ok", text: res.success ? text : "Done." });
      await loadDetail(detailId);
    } catch (err) {
      setNotice({ tone: "err", text: err instanceof Error ? err.message : "Action failed." });
    } finally {
      setBusy(false);
    }
  };

  const s = detail?.schedule;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Scheduled MIS email"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Scheduled MIS email</p>
            <h2 className="truncate text-base font-bold text-slate-800">
              {view === "detail" && s ? s.reportTitle : reportTitle}
            </h2>
            {view === "detail" && s && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className={`rounded-full border px-2 py-0.5 font-semibold capitalize ${STATUS_STYLE[s.status]}`}>{s.status}</span>
                <span>ID {s.id.slice(0, 8)}</span>
                <span>Created {fmtDateTime(s.createdAt)}</span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {view !== "new" && (
              <Button size="sm" onClick={() => { setNotice(null); setView("new"); }}>
                <Plus className="mr-1 h-3.5 w-3.5" /> New schedule
              </Button>
            )}
            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {notice && (
            <div className={`rounded-lg border p-3 text-sm ${notice.tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {notice.text}
            </div>
          )}

          {view === "list" && (
            <div className="space-y-3">
              <SectionLabel>Schedules for this report</SectionLabel>
              {listError && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{listError}</p>}
              {!schedules && !listError && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
              {schedules && schedules.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                  None yet. Use "New schedule" to set up an email for this report.
                </p>
              )}
              {schedules?.map((r) => (
                <button
                  key={r.id} type="button" onClick={() => openDetail(r.id)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800">{r.subject}</span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    To {r.to.join(", ")} · {FREQ_LABEL[r.frequency]} at {r.sendTime} · Next: {fmtDateTime(r.nextRunAt)}
                  </p>
                </button>
              ))}
            </div>
          )}

          {view === "new" && (
            <div className="space-y-5">
              <div className="space-y-3">
                <SectionLabel>Recipients</SectionLabel>
                <Field label="To (comma or semicolon separated)">
                  <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="manager@company.com; ops@company.com" />
                </Field>
                <Field label="CC (optional)">
                  <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="qa@company.com" />
                </Field>
              </div>

              <div className="space-y-3">
                <SectionLabel>Message</SectionLabel>
                <Field label="Subject">
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
                </Field>
                <Field label="Body (write your own message)">
                  <Textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={7} maxLength={5000} />
                </Field>
                <p className="text-xs text-slate-500">The Excel file for the period is attached automatically.</p>
              </div>

              <div className="space-y-3">
                <SectionLabel>Period covered</SectionLabel>
                <Select value={rangeMode} onValueChange={(v) => setRangeMode(v as RangeMode)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PERIOD_LABEL) as RangeMode[]).map((m) => (
                      <SelectItem key={m} value={m}>{PERIOD_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rangeMode === "fixed" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From"><Input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} /></Field>
                    <Field label="To"><Input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} /></Field>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <SectionLabel>When to send</SectionLabel>
                <Select value={frequency} onValueChange={(v) => setFrequency(v as Frequency)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FREQ_LABEL) as Frequency[]).map((f) => (
                      <SelectItem key={f} value={f}>{FREQ_LABEL[f]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  {frequency === "once" && (
                    <Field label="Date"><Input type="date" value={sendOnDate} onChange={(e) => setSendOnDate(e.target.value)} /></Field>
                  )}
                  {frequency === "weekly" && (
                    <Field label="Weekday">
                      <Select value={weekday} onValueChange={setWeekday}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {WEEKDAYS.map((w, i) => <SelectItem key={w} value={String(i)}>{w}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                  <Field label="Time (server time)">
                    <Input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} />
                  </Field>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button variant="outline" onClick={() => setView("list")} disabled={busy}>Back</Button>
                <Button onClick={() => void submitNew()} disabled={busy}>
                  {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="mr-1 h-3.5 w-3.5" />}
                  Save schedule
                </Button>
              </div>
            </div>
          )}

          {view === "detail" && (
            <div className="space-y-5">
              {!detail && !notice && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
              {s && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {s.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => void act("pause")} disabled={busy}><Pause className="mr-1 h-3.5 w-3.5" />Pause</Button>
                    )}
                    {s.status === "paused" && (
                      <Button size="sm" variant="outline" onClick={() => void act("resume")} disabled={busy}><Play className="mr-1 h-3.5 w-3.5" />Resume</Button>
                    )}
                    {(s.status === "active" || s.status === "paused") && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => void act("run-now")} disabled={busy}><Send className="mr-1 h-3.5 w-3.5" />Send now</Button>
                        <Button size="sm" variant="outline" onClick={() => void act("cancel")} disabled={busy}><XCircle className="mr-1 h-3.5 w-3.5" />Cancel</Button>
                      </>
                    )}
                  </div>

                  <div className="space-y-2">
                    <SectionLabel>Recipients</SectionLabel>
                    <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
                      <dt className="text-slate-500">To</dt><dd className="break-all text-slate-800">{s.to.join(", ") || "None"}</dd>
                      <dt className="text-slate-500">CC</dt><dd className="break-all text-slate-800">{s.cc.join(", ") || "None"}</dd>
                      <dt className="text-slate-500">Created by</dt><dd className="text-slate-800">{s.createdBy}</dd>
                    </dl>
                  </div>

                  <div className="space-y-2">
                    <SectionLabel>Message</SectionLabel>
                    <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
                      <dt className="text-slate-500">Subject</dt><dd className="text-slate-800">{s.subject}</dd>
                    </dl>
                    <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">{s.bodyText}</pre>
                  </div>

                  <div className="space-y-2">
                    <SectionLabel>Schedule</SectionLabel>
                    <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
                      <dt className="text-slate-500">Frequency</dt><dd className="text-slate-800">{FREQ_LABEL[s.frequency]}</dd>
                      <dt className="text-slate-500">Time</dt><dd className="text-slate-800">{s.sendTime}</dd>
                      {s.frequency === "once" && <><dt className="text-slate-500">Date</dt><dd className="text-slate-800">{fmtDate(s.sendOnDate)}</dd></>}
                      {s.frequency === "weekly" && <><dt className="text-slate-500">Weekday</dt><dd className="text-slate-800">{WEEKDAYS[s.weekday ?? 0]}</dd></>}
                      <dt className="text-slate-500">Period</dt>
                      <dd className="text-slate-800">
                        {PERIOD_LABEL[s.rangeMode]}
                        {s.rangeMode === "fixed" && ` (${fmtDate(s.rangeFrom)} to ${fmtDate(s.rangeTo)})`}
                      </dd>
                      <dt className="text-slate-500">Next send</dt><dd className="text-slate-800">{fmtDateTime(s.nextRunAt)}</dd>
                      <dt className="text-slate-500">Last send</dt>
                      <dd className="text-slate-800">
                        {fmtDateTime(s.lastRunAt)}{s.lastStatus ? ` · ${s.lastStatus}` : ""}
                      </dd>
                      {s.lastError && <><dt className="text-slate-500">Last error</dt><dd className="break-words text-rose-700">{s.lastError}</dd></>}
                    </dl>
                  </div>

                  <div className="space-y-2">
                    <SectionLabel>Send history</SectionLabel>
                    {detail && detail.runs.length === 0 && <p className="text-sm text-slate-500">None</p>}
                    {detail && detail.runs.map((r) => (
                      <div key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-800">{fmtDateTime(r.startedAt)}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === "sent" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                            {r.status}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {r.trigger === "manual" ? "Sent manually" : "Scheduled"} · Period {fmtDate(r.periodFrom)} to {fmtDate(r.periodTo)}
                          {r.attachmentRows !== null && ` · ${r.attachmentRows} raw rows attached`}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">To {r.to.join(", ")}{r.cc.length ? ` · CC ${r.cc.join(", ")}` : ""}</p>
                        {r.error && <p className="mt-1 break-words text-xs text-rose-700">{r.error}</p>}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {view === "detail" && !s && notice?.tone === "err" && (
                <p className="text-sm text-slate-500">This schedule could not be loaded.</p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-slate-100 p-3 text-xs text-slate-500">
          <Mail className="h-3.5 w-3.5" />
          Emails are sent from the server's SMTP account. Times are server time.
        </footer>
      </aside>
    </div>
  );
}
