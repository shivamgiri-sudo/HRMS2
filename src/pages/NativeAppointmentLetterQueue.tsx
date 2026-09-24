/**
 * Payroll HR issuance of appointment letters.
 *
 * The backend has had these endpoints for a while; there was no screen, so the
 * whole flow was unreachable from the product. The design principle here is that
 * a blocked employee is the normal case, not an error — most people in the queue
 * are waiting on something — so the reasons are the primary content rather than
 * being hidden behind a failed click.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, BadgeCheck, Ban, CheckCircle2, Download, Eye, FileSignature,
  Loader2, Mail, RefreshCw, Search, ShieldAlert, Users, X, XCircle,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { OnboardingTabBar } from "@/components/onboarding/OnboardingTabBar";

type Blocker = { code: string; reason: string; severity: "critical" | "warning" };
type QueueRow = {
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  eligible: boolean;
  blockers: Blocker[];
  warnings: Blocker[];
  alreadyIssued: boolean;
  existingLetterNumber: string | null;
  contractAlreadySigned: boolean;
  daysSinceIdCreated: number;
  idCreationSlaBreached: boolean;
};
type IssuedRow = {
  id: string; letter_number: string; employee_code: string | null; employee_name: string | null;
  designation: string | null; branch_name: string | null; is_ca_issued: number;
  employee_esign_status: string | null; employee_esign_at?: string | null;
  status: string; issued_at: string | null; revoked_at: string | null;
};

/** The employee's own Aadhaar eSign of the letter, in words HR would use. */
const ESIGN_LABELS: Record<string, string> = {
  not_sent: "Awaiting employee",
  sent: "Signing started",
  opened: "Signing in progress",
  signed: "Accepted",
  accepted: "Accepted",
  completed: "Accepted",
  expired: "Session expired",
};
const esignLabel = (status: string | null): string =>
  ESIGN_LABELS[String(status ?? "not_sent")] ?? String(status).replace(/_/g, " ");
const isAccepted = (status: string | null): boolean =>
  ["signed", "accepted", "completed"].includes(String(status ?? ""));

type DrawerState =
  | { mode: "preview"; row: QueueRow }
  | { mode: "view"; row: IssuedRow }
  | null;

export default function NativeAppointmentLetterQueue() {
  const [queue, setQueue] = useState<{ eligible: QueueRow[]; blocked: QueueRow[]; scope: "all" | "branch" } | null>(null);
  const [issued, setIssued] = useState<IssuedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"eligible" | "blocked" | "issued">("eligible");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [searching, setSearching] = useState(false);

  // Drawer state
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [drawerPdfUrl, setDrawerPdfUrl] = useState<string | null>(null);
  const [drawerPdfLoading, setDrawerPdfLoading] = useState(false);
  const [drawerPdfError, setDrawerPdfError] = useState<string | null>(null);
  const drawerBlobRef = useRef<string | null>(null);
  // Inline field, not window.prompt() — a native prompt() dialog is easy to
  // dismiss without realizing an action was waiting on it, and gives no
  // visible trace afterward. That is the leading theory for why
  // appointment_letter_issue stayed empty in production: every eligible
  // candidate today carries at least one warning, so every issuance requires
  // this reason, and a cancelled/misunderstood native prompt looks identical
  // to a user who simply moved on — no error, no record, nothing to debug.
  const [overrideReasonInput, setOverrideReasonInput] = useState("");

  const closeDrawer = useCallback(() => {
    setDrawer(null);
    setDrawerPdfError(null);
    setDrawerPdfUrl(null);
    setOverrideReasonInput("");
    if (drawerBlobRef.current) {
      URL.revokeObjectURL(drawerBlobRef.current);
      drawerBlobRef.current = null;
    }
  }, []);

  // Fetch PDF whenever the drawer opens
  useEffect(() => {
    if (!drawer) return;
    let cancelled = false;
    setDrawerPdfLoading(true);
    setDrawerPdfError(null);
    if (drawerBlobRef.current) {
      URL.revokeObjectURL(drawerBlobRef.current);
      drawerBlobRef.current = null;
      setDrawerPdfUrl(null);
    }
    void (async () => {
      try {
        const blob =
          drawer.mode === "preview"
            ? await hrmsApi.getBlob(`/api/letters/appointment-letters/preview/${drawer.row.employeeId}`)
            : await hrmsApi.getBlob(`/api/letters/appointment-letters/${drawer.row.id}/download?inline=1`);
        if (!cancelled) {
          const url = URL.createObjectURL(blob);
          drawerBlobRef.current = url;
          setDrawerPdfUrl(url);
        }
      } catch (err) {
        if (!cancelled)
          setDrawerPdfError(err instanceof Error ? err.message : "Unable to load the letter PDF.");
      } finally {
        if (!cancelled) setDrawerPdfLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [drawer]);

  // Debounced, because the search runs on the server: the queue is capped at 200
  // employees ordered by joining date, so filtering the loaded page would never
  // find anyone below that cap.
  useEffect(() => {
    const t = setTimeout(() => setAppliedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setSearching(true);
    setError(null);
    const qs = appliedSearch ? `?search=${encodeURIComponent(appliedSearch)}` : "";
    // Fetched independently, not via Promise.all: the two calls used to fail
    // together, so an error on the issued-letters call (the smaller, less
    // important half) was blanking the eligible/blocked queue too, showing
    // 0/0/0 even though the queue call itself had already succeeded.
    const [qResult, iResult] = await Promise.allSettled([
      hrmsApi.get<{ data: { eligible: QueueRow[]; blocked: QueueRow[]; scope: "all" | "branch" } }>(`/api/letters/appointment-letters/queue${qs}`),
      hrmsApi.get<{ data: IssuedRow[] }>(`/api/letters/appointment-letters${qs}`),
    ]);
    if (qResult.status === "fulfilled") {
      setQueue(qResult.value.data);
    } else {
      setError(qResult.reason instanceof Error ? qResult.reason.message : "Unable to load the appointment letter queue.");
    }
    if (iResult.status === "fulfilled") {
      setIssued(iResult.value.data ?? []);
    } else if (qResult.status === "fulfilled") {
      // Queue loaded fine; only mention the issued-letters failure if nothing else already did.
      setError(iResult.reason instanceof Error ? iResult.reason.message : "Unable to load issued letters.");
    }
    // The skeleton is for the first load only. A search that blanked the list
    // on every keystroke would hide the result it was about to show.
    setLoading(false);
    setSearching(false);
  }, [appliedSearch]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Returns whether the letter was actually issued. The caller (the drawer's
   * "Issue" button) must check this before closing — closing unconditionally
   * made a failed or cancelled issue look identical to a successful one: the
   * drawer disappeared either way, and the only sign of failure was a banner
   * near the top of the page, easy to miss when the user's attention was on
   * the drawer and moving straight to the next candidate.
   *
   * The override reason is now a field the caller passes in, not a
   * window.prompt() this function opened itself — a native prompt is easy to
   * dismiss without registering that anything was waiting on it, and leaves
   * no visible trace either way. Every eligible candidate today carries at
   * least one warning (BGV "pending, not adverse" alone produces one), so
   * every issuance needed this reason, and appointment_letter_issue stayed
   * empty in production with no error anyone could point to — consistent
   * with the prompt being the thing silently failing, not the API.
   */
  const issue = async (row: QueueRow, force: boolean, overrideReason: string | null): Promise<boolean> => {
    // Warnings can be overridden with a stated reason; critical blockers cannot
    // be forced at all, so the button is never offered for them.
    if (force && !overrideReason?.trim()) return false;
    setBusy(row.employeeId);
    setError(null);
    setNotice(null);
    try {
      const res = await hrmsApi.post<{ data: { letterNumber?: string; warning?: string } }>(
        `/api/letters/appointment-letters/${row.employeeId}/issue`,
        { force, override_reason: overrideReason },
      );
      setNotice(
        `Appointment letter ${res.data?.letterNumber ?? ""} issued to ${row.employeeName ?? row.employeeCode}.` +
        (res.data?.warning ? ` ${res.data.warning}` : ""),
      );
      await load();
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to issue this appointment letter.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  // Routes through the existing Exit Management flow rather than a parallel
  // status — an employee ID already exists, so this is a real exit request
  // (exitSubType "did_not_join"), not a shortcut. The employee stays in this
  // queue until that request is processed through to a terminal status.
  const markLeft = async (row: QueueRow) => {
    const reason = window.prompt(
      `Mark ${row.employeeName ?? row.employeeCode} as Left / Dropped?\n\n` +
      "This raises an exit request through Exit Management — the employee stays in this " +
      "queue until it's processed, this does not remove them immediately.\n\n" +
      "Reason (optional):",
    );
    if (reason === null) return; // Cancelled
    setBusy(row.employeeId);
    setError(null);
    setNotice(null);
    try {
      await hrmsApi.post("/api/exit/", {
        employeeId: row.employeeId,
        exitType: "involuntary",
        exitSubType: "did_not_join",
        exitDate: new Date().toISOString().slice(0, 10),
        reason: reason.trim() || "Employee ID created but candidate never joined",
        noticePeriodDays: 0,
      });
      setNotice(`Exit request raised for ${row.employeeName ?? row.employeeCode}.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to raise the exit request.");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (row: IssuedRow) => {
    const reason = window.prompt(`Revoke ${row.letter_number}?\n\nState the reason — it is shown on the public verification page.`);
    if (!reason || !reason.trim()) return;
    setBusy(row.id);
    try {
      await hrmsApi.post(`/api/letters/appointment-letters/${row.id}/revoke`, { reason });
      setNotice(`${row.letter_number} revoked.`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to revoke this letter.");
    } finally {
      setBusy(null);
    }
  };

  /** Mirrors the joining kit's "resend": a fresh accept link is emailed; the provider is not touched. */
  const resendLink = async (row: IssuedRow) => {
    if (!window.confirm(`Email ${row.employee_name ?? "the employee"} a fresh Review & Accept link for ${row.letter_number}?\n\nThe link in their earlier email will stop working.`)) return;
    setBusy(row.id);
    try {
      const res = await hrmsApi.post<{ message?: string }>(`/api/letters/appointment-letters/${row.id}/resend-link`, {});
      setNotice(res.message ?? `Accept link re-sent for ${row.letter_number}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to resend the accept link.");
    } finally {
      setBusy(null);
    }
  };

  /** Ask the provider now whether the employee has signed. */
  const checkEsign = async (row: IssuedRow) => {
    setBusy(row.id);
    try {
      const res = await hrmsApi.post<{ data?: { state?: string; message?: string | null } }>(
        `/api/letters/appointment-letters/${row.id}/esign/check`, {});
      setNotice(res.data?.state === "completed"
        ? `${row.letter_number} has been accepted by the employee.`
        : (res.data?.message ?? `${row.letter_number}: the employee has not completed signing yet.`));
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to check the signing status.");
    } finally {
      setBusy(null);
    }
  };

  const download = async (row: IssuedRow) => {
    try {
      const blob = await hrmsApi.getBlob(`/api/letters/appointment-letters/${row.id}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${row.letter_number}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to download this letter.");
    }
  };

  const counts = {
    eligible: queue?.eligible.length ?? 0,
    blocked: queue?.blocked.length ?? 0,
    issued: issued.length,
  };

  return (
    <DashboardLayout>
    <div className="bg-blue-50 min-h-screen px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-5">

        {/* Page header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-indigo-600 to-blue-700 text-white rounded-2xl p-6">
          {/* Spotlight orb */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-blue-200">Payroll HR</p>
              <h1 className="mt-1.5 text-2xl font-bold">Appointment Letters</h1>
              <p className="mt-1.5 max-w-2xl text-sm text-blue-100">
                Issued at the end of joining formalities. The company signature is applied before the
                letter reaches the employee, who then accepts it with Aadhaar eSign.
              </p>
              <p className="mt-1.5 text-xs text-blue-200">
                {queue?.scope === "branch" ? "Shows the employees in your assigned branch." : "Shows employees company-wide."}
              </p>
            </div>
            <button
              type="button" onClick={() => void load()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 text-sm font-semibold hover:bg-white/20 transition-colors"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </div>

        <OnboardingTabBar />

        {/* Alerts */}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /><p className="font-semibold">{error}</p></div>
          </div>
        )}
        {notice && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <div className="flex gap-3"><BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><p className="font-semibold">{notice}</p></div>
          </div>
        )}

        {/* KPI tiles */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-emerald-200 bg-white shadow-sm p-4 flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{counts.eligible}</p>
              <p className="text-xs font-medium text-slate-500">Eligible for issuance</p>
            </div>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-white shadow-sm p-4 flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{counts.blocked}</p>
              <p className="text-xs font-medium text-slate-500">Blocked — awaiting action</p>
            </div>
          </div>
          <div className="rounded-2xl border border-blue-200 bg-white shadow-sm p-4 flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-800">{counts.issued}</p>
              <p className="text-xs font-medium text-slate-500">Letters issued</p>
            </div>
          </div>
        </div>

        {/* Employee search */}
        <div className="rounded-2xl border border-blue-200 bg-white shadow-sm p-3">
          <label htmlFor="appointment-letter-search" className="sr-only">Search employees</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              id="appointment-letter-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by employee name, code or letter number"
              className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white pl-10 pr-24 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
              {searching && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
              {search && (
                <button
                  type="button" onClick={() => setSearch("")}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
                >
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </div>
          </div>
          {appliedSearch && !searching && (
            <p className="mt-2 px-1 text-xs text-slate-500">
              {counts.eligible + counts.blocked + counts.issued === 0
                ? <>Nobody in your branch matches "{appliedSearch}".</>
                : <>Showing matches for "{appliedSearch}" — {counts.eligible} eligible, {counts.blocked} blocked, {counts.issued} issued.</>}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {(["eligible", "blocked", "issued"] as const).map((t) => (
            <button
              key={t} type="button" onClick={() => setTab(t)}
              className={`min-h-[44px] rounded-xl px-4 text-sm font-semibold capitalize transition-colors ${
                tab === t
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-white border border-blue-200 text-blue-700 hover:bg-blue-50"
              }`}
            >
              {t} <span className={tab === t ? "opacity-80" : "opacity-60"}>({counts[t]})</span>
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-blue-200 bg-white shadow-sm">
            <Loader2 className="h-7 w-7 animate-spin text-blue-400" />
          </div>
        ) : (
          <div className="rounded-2xl border border-blue-200 bg-white shadow-sm p-5">

            {/* Eligible tab */}
            {tab === "eligible" && (
              queue?.eligible.length ? (
                <div className="space-y-3">
                  {queue.eligible.map((row) => (
                    <div
                      key={row.employeeId}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 bg-white p-4 shadow-sm"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-800">{row.employeeName ?? "Unnamed"}</p>
                        <p className="text-xs text-slate-500">{row.employeeCode}</p>
                        {row.idCreationSlaBreached && (
                          <span className="mt-1 inline-block rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 border border-red-300">
                            ID SLA breached ({row.daysSinceIdCreated}d)
                          </span>
                        )}
                        {row.warnings.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {row.warnings.map((w) => (
                              <li key={w.code} className="flex items-start gap-1.5 text-[11px] text-amber-700">
                                <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />{w.reason}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setDrawer({ mode: "preview", row })}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition-colors"
                        >
                          <Eye className="h-4 w-4" /> Preview & Issue
                        </button>
                        <button
                          type="button"
                          disabled={busy === row.employeeId}
                          onClick={() => void markLeft(row)}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-50"
                        >
                          <Ban className="h-4 w-4" /> Mark Left / Dropped
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <Empty text={appliedSearch ? `No eligible employee matches "${appliedSearch}".` : "Nobody is ready for an appointment letter yet. Check the Blocked tab to see what each person is waiting on."} />
            )}

            {/* Blocked tab */}
            {tab === "blocked" && (
              queue?.blocked.length ? (
                <div className="space-y-3">
                  {[...queue.blocked]
                    .sort((a, b) => Number(b.idCreationSlaBreached) - Number(a.idCreationSlaBreached))
                    .map((row) => (
                    <div key={row.employeeId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-sm font-bold text-slate-800">{row.employeeName ?? "Unnamed"}</p>
                      <p className="text-xs text-slate-500">{row.employeeCode}</p>
                      {row.idCreationSlaBreached && (
                        <span className="mt-1 mb-2 inline-block rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 border border-red-300">
                          ID SLA breached ({row.daysSinceIdCreated}d)
                        </span>
                      )}
                      <ul className="mt-2.5 space-y-2">
                        {row.blockers.map((b) => (
                          <li
                            key={b.code}
                            className={`flex items-start gap-2.5 rounded-lg border-l-4 px-3 py-2 text-xs ${
                              b.severity === "critical"
                                ? "bg-red-50 border-l-red-500 text-red-800"
                                : "bg-amber-50 border-l-amber-400 text-amber-800"
                            }`}
                          >
                            {b.severity === "critical"
                              ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                              : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                            }
                            <span>{b.reason}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-[11px] text-slate-400 italic">
                        Resolve all critical blockers before the appointment letter can be issued.
                      </p>
                      <button
                        type="button"
                        disabled={busy === row.employeeId}
                        onClick={() => void markLeft(row)}
                        className="mt-2.5 inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-50"
                      >
                        <Ban className="h-3.5 w-3.5" /> Mark Left / Dropped
                      </button>
                    </div>
                  ))}
                </div>
              ) : <Empty text={appliedSearch ? `No blocked employee matches "${appliedSearch}".` : "Nothing is blocked."} />
            )}

            {/* Issued tab */}
            {tab === "issued" && (
              issued.length ? (
                <div className="space-y-3">
                  {issued.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div>
                        <p className="text-base font-bold text-slate-800 flex flex-wrap items-center gap-2">
                          {row.letter_number}
                          {row.status === "revoked" && (
                            <span className="rounded-lg bg-red-100 px-2 py-0.5 text-[10px] font-black uppercase text-red-600 border border-red-200">Revoked</span>
                          )}
                          {!row.is_ca_issued && row.status !== "revoked" && (
                            <span className="rounded-lg bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-600 border border-amber-200">Self-signed</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {row.employee_name} · {row.employee_code}
                          {row.branch_name ? ` · ${row.branch_name}` : ""}
                        </p>
                        <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          row.status === "revoked"
                            ? "bg-red-100 text-red-700"
                            : isAccepted(row.employee_esign_status)
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                        }`}>
                          {esignLabel(row.employee_esign_status)}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setDrawer({ mode: "view", row })}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-indigo-300 bg-white px-4 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 transition-colors"
                        >
                          <Eye className="h-4 w-4" /> View
                        </button>
                        <button
                          type="button" onClick={() => void download(row)}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition-colors"
                        >
                          <Download className="h-4 w-4" /> PDF
                        </button>
                        {row.status !== "revoked" && !isAccepted(row.employee_esign_status) && (
                          <>
                            <button
                              type="button" disabled={busy === row.id} onClick={() => void resendLink(row)}
                              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-cyan-300 bg-white px-4 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 transition-colors disabled:opacity-60"
                            >
                              <Mail className="h-4 w-4" /> Resend link
                            </button>
                            <button
                              type="button" disabled={busy === row.id} onClick={() => void checkEsign(row)}
                              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
                            >
                              <RefreshCw className="h-4 w-4" /> Check status
                            </button>
                          </>
                        )}
                        {row.status !== "revoked" && (
                          <button
                            type="button" disabled={busy === row.id} onClick={() => void revoke(row)}
                            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-red-300 bg-white px-4 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
                          >
                            <Ban className="h-4 w-4" /> Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <Empty text={appliedSearch ? `No issued letter matches "${appliedSearch}".` : "No appointment letters have been issued yet."} />
            )}

          </div>
        )}
      </div>
    </div>

    {/* ── Letter preview / view drawer ── */}
    {drawer && (
      <div className="fixed inset-0 z-50 flex justify-end">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={closeDrawer}
        />
        {/* Panel */}
        <div className="relative flex flex-col w-full max-w-2xl bg-white h-full shadow-2xl overflow-hidden">

          {/* Drawer header */}
          <div className="shrink-0 flex items-start justify-between gap-3 px-6 py-4 border-b border-blue-700/20 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-blue-200">
                {drawer.mode === "preview" ? "Preview — Not yet issued" : "Issued Appointment Letter"}
              </p>
              <p className="mt-1 text-lg font-bold leading-tight">
                {drawer.mode === "preview"
                  ? (drawer.row.employeeName ?? drawer.row.employeeCode ?? "Employee")
                  : drawer.row.letter_number}
              </p>
              <p className="text-xs text-blue-200 mt-0.5">
                {drawer.mode === "preview"
                  ? drawer.row.employeeCode
                  : `${drawer.row.employee_name ?? ""} · ${drawer.row.employee_code ?? ""}${drawer.row.branch_name ? ` · ${drawer.row.branch_name}` : ""}`}
              </p>
            </div>
            <button
              type="button" onClick={closeDrawer}
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Drawer meta strip — for issued letters */}
          {drawer.mode === "view" && (
            <div className="shrink-0 flex flex-wrap items-center gap-3 px-6 py-3 border-b border-slate-100 bg-slate-50">
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                drawer.row.status === "revoked"
                  ? "bg-red-100 text-red-700"
                  : isAccepted(drawer.row.employee_esign_status)
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
              }`}>
                {esignLabel(drawer.row.employee_esign_status)}
              </span>
              {drawer.row.employee_esign_at && isAccepted(drawer.row.employee_esign_status) && (
                <span className="text-xs text-slate-500">
                  Accepted {new Date(drawer.row.employee_esign_at).toLocaleString("en-IN", {
                    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
                  }).replace(",", "")}
                </span>
              )}
              {!drawer.row.is_ca_issued && drawer.row.status !== "revoked" && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Self-signed</span>
              )}
              {drawer.row.issued_at && (
                <span className="text-xs text-slate-500">
                  Issued {new Date(drawer.row.issued_at).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })}
                </span>
              )}
            </div>
          )}

          {/* Preview note for eligible employees */}
          {drawer.mode === "preview" && (
            <div className="shrink-0 flex items-start gap-2.5 px-6 py-3 bg-amber-50 border-b border-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="text-xs text-amber-800">
                <p>
                  This is a draft — no signature, no letter number, no DB write. Review the name, designation,
                  joining date and salary carefully before issuing.
                  If anything looks wrong, fix it in the employee profile or salary package first.
                </p>
                {drawer.row.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {drawer.row.warnings.map((w) => (
                      <li key={w.code} className="flex items-start gap-1.5 font-medium">
                        <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />{w.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* PDF viewer */}
          <div className="flex-1 overflow-hidden bg-slate-200 min-h-0">
            {drawerPdfLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center space-y-3">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto" />
                  <p className="text-xs text-slate-500">Generating letter…</p>
                </div>
              </div>
            ) : drawerPdfError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <AlertTriangle className="h-10 w-10 text-amber-400" />
                <p className="text-sm font-semibold text-slate-700">Could not load the letter</p>
                <p className="text-xs text-slate-500 max-w-xs">{drawerPdfError}</p>
              </div>
            ) : drawerPdfUrl ? (
              <iframe
                src={drawerPdfUrl}
                title="Appointment Letter"
                className="w-full h-full border-0"
              />
            ) : null}
          </div>

          {/* Footer actions */}
          <div className="shrink-0 flex flex-col gap-3 px-6 py-4 border-t border-slate-200 bg-white">
            {/* The drawer is a full-screen overlay (fixed inset-0), so the page-level
                error banner behind it is invisible while this is open — an issue
                attempt that fails here needs its own visible error, not just the one
                on the page underneath. */}
            {drawer.mode === "preview" && error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
                <div className="flex gap-2.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /><p className="font-medium">{error}</p></div>
              </div>
            )}
            {drawer.mode === "preview" && drawer.row.warnings.length > 0 && (
              <div>
                <label htmlFor="override-reason" className="block text-xs font-semibold text-slate-600 mb-1">
                  Why are you overriding these warnings? (required, recorded against the letter)
                </label>
                <textarea
                  id="override-reason"
                  value={overrideReasonInput}
                  onChange={(e) => setOverrideReasonInput(e.target.value)}
                  rows={2}
                  placeholder="e.g. BGV pending but manager confirmed identity in person"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
            {drawer.mode === "preview" && (
              <>
                <p className="text-xs text-slate-500">
                  {drawer.row.warnings.length > 0
                    ? `${drawer.row.warnings.length} warning(s) present — an override reason will be required.`
                    : "All checks passed — ready to issue."}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button" onClick={closeDrawer}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy === drawer.row.employeeId || (drawer.row.warnings.length > 0 && !overrideReasonInput.trim())}
                    onClick={async () => {
                      const row = drawer.row;
                      const force = row.warnings.length > 0;
                      // Only close on success — an error must leave the drawer (and the
                      // error banner) visible, not read to the user as "done" because the
                      // modal went away.
                      const succeeded = await issue(row, force, force ? overrideReasonInput.trim() : null);
                      if (succeeded) closeDrawer();
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 disabled:opacity-60 transition-all"
                  >
                    {busy === drawer.row.employeeId
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <FileSignature className="h-4 w-4" />}
                    {drawer.row.warnings.length > 0 ? "Issue with override" : "Issue Letter"}
                  </button>
                </div>
              </>
            )}
            {drawer.mode === "view" && (
              <div className="flex flex-wrap gap-2 ml-auto">
                <button
                  type="button" onClick={closeDrawer}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Close
                </button>
                <button
                  type="button" onClick={() => void download(drawer.row)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition-colors"
                >
                  <Download className="h-4 w-4" /> Download PDF
                </button>
                {drawer.row.status !== "revoked" && !isAccepted(drawer.row.employee_esign_status) && (
                  <>
                    <button
                      type="button" disabled={busy === drawer.row.id} onClick={() => void resendLink(drawer.row)}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-cyan-300 bg-white px-4 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 transition-colors disabled:opacity-60"
                    >
                      <Mail className="h-4 w-4" /> Resend link
                    </button>
                    <button
                      type="button" disabled={busy === drawer.row.id} onClick={() => void checkEsign(drawer.row)}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-60"
                    >
                      <RefreshCw className="h-4 w-4" /> Check status
                    </button>
                  </>
                )}
                {drawer.row.status !== "revoked" && (
                  <button
                    type="button" disabled={busy === drawer.row.id}
                    onClick={() => void revoke(drawer.row)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-red-300 bg-white px-4 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
                  >
                    <Ban className="h-4 w-4" /> Revoke
                  </button>
                )}
              </div>
            )}
            </div>
          </div>

        </div>
      </div>
    )}

    </DashboardLayout>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-12 text-center text-sm text-slate-400">{text}</p>;
}
