/**
 * Payroll HR issuance of appointment letters.
 *
 * The backend has had these endpoints for a while; there was no screen, so the
 * whole flow was unreachable from the product. The design principle here is that
 * a blocked employee is the normal case, not an error — most people in the queue
 * are waiting on something — so the reasons are the primary content rather than
 * being hidden behind a failed click.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, BadgeCheck, Ban, CheckCircle2, Download, FileSignature,
  Loader2, RefreshCw, ShieldAlert, Users, XCircle,
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
};
type IssuedRow = {
  id: string; letter_number: string; employee_code: string | null; employee_name: string | null;
  designation: string | null; branch_name: string | null; is_ca_issued: number;
  employee_esign_status: string | null; status: string; issued_at: string | null; revoked_at: string | null;
};

export default function NativeAppointmentLetterQueue() {
  const [queue, setQueue] = useState<{ eligible: QueueRow[]; blocked: QueueRow[] } | null>(null);
  const [issued, setIssued] = useState<IssuedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"eligible" | "blocked" | "issued">("eligible");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [q, i] = await Promise.all([
        hrmsApi.get<{ data: { eligible: QueueRow[]; blocked: QueueRow[] } }>("/api/letters/appointment-letters/queue"),
        hrmsApi.get<{ data: IssuedRow[] }>("/api/letters/appointment-letters"),
      ]);
      setQueue(q.data);
      setIssued(i.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load the appointment letter queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const issue = async (row: QueueRow, force = false) => {
    // Warnings can be overridden with a stated reason; critical blockers cannot
    // be forced at all, so the button is never offered for them.
    let overrideReason: string | null = null;
    if (force) {
      overrideReason = window.prompt(
        `Issuing to ${row.employeeName ?? row.employeeCode} despite warnings.\n\n` +
        row.warnings.map((w) => `• ${w.reason}`).join("\n") +
        "\n\nWhy are you overriding? This is recorded against the letter.",
      );
      if (!overrideReason || !overrideReason.trim()) return;
    }
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to issue this appointment letter.");
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
                      <button
                        type="button" disabled={busy === row.employeeId}
                        onClick={() => void issue(row, row.warnings.length > 0)}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 disabled:opacity-60 transition-all"
                      >
                        {busy === row.employeeId ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
                        {row.warnings.length > 0 ? "Issue with override" : "Issue letter"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : <Empty text="Nobody is ready for an appointment letter yet. Check the Blocked tab to see what each person is waiting on." />
            )}

            {/* Blocked tab */}
            {tab === "blocked" && (
              queue?.blocked.length ? (
                <div className="space-y-3">
                  {queue.blocked.map((row) => (
                    <div key={row.employeeId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-sm font-bold text-slate-800">{row.employeeName ?? "Unnamed"}</p>
                      <p className="text-xs text-slate-500 mb-2.5">{row.employeeCode}</p>
                      <ul className="space-y-2">
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
                    </div>
                  ))}
                </div>
              ) : <Empty text="Nothing is blocked." />
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
                            : (row.employee_esign_status === "signed" || row.employee_esign_status === "accepted")
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                        }`}>
                          {String(row.employee_esign_status ?? "pending").replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button" onClick={() => void download(row)}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-blue-300 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition-colors"
                        >
                          <Download className="h-4 w-4" /> PDF
                        </button>
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
              ) : <Empty text="No appointment letters have been issued yet." />
            )}

          </div>
        )}
      </div>
    </div>
    </DashboardLayout>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-12 text-center text-sm text-slate-400">{text}</p>;
}
