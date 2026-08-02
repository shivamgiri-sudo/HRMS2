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
  AlertTriangle, BadgeCheck, Ban, Download, FileSignature, Loader2, RefreshCw, ShieldAlert,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

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
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-[30px] border border-white/10 bg-white/5 p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">Payroll HR</p>
            <h1 className="mt-2 text-3xl font-black">Appointment letters</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Issued at the end of joining formalities. The company signature is applied before the
              letter reaches the employee, who then accepts it with Aadhaar eSign.
            </p>
          </div>
          <button
            type="button" onClick={() => void load()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-semibold hover:bg-black/30"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p className="font-semibold">{error}</p></div>
          </div>
        )}
        {notice && (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            <div className="flex gap-3"><BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" /><p className="font-semibold">{notice}</p></div>
          </div>
        )}

        <div className="flex gap-2">
          {(["eligible", "blocked", "issued"] as const).map((t) => (
            <button
              key={t} type="button" onClick={() => setTab(t)}
              className={`min-h-[44px] rounded-2xl px-4 text-sm font-bold capitalize transition ${
                tab === t ? "bg-cyan-500 text-slate-950" : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {t} <span className="opacity-70">({counts[t]})</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-[30px] border border-white/10 bg-white/5">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="rounded-[30px] border border-white/10 bg-white/5 p-5">
            {tab === "eligible" && (
              queue?.eligible.length ? (
                <div className="space-y-3">
                  {queue.eligible.map((row) => (
                    <div key={row.employeeId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div>
                        <p className="text-sm font-bold text-white">{row.employeeName ?? "Unnamed"}</p>
                        <p className="text-xs text-slate-400">{row.employeeCode}</p>
                        {row.warnings.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {row.warnings.map((w) => (
                              <li key={w.code} className="flex items-start gap-1.5 text-[11px] text-amber-300">
                                <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />{w.reason}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <button
                        type="button" disabled={busy === row.employeeId}
                        onClick={() => void issue(row, row.warnings.length > 0)}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-cyan-500 px-4 text-sm font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                      >
                        {busy === row.employeeId ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
                        {row.warnings.length > 0 ? "Issue with override" : "Issue letter"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : <Empty text="Nobody is ready for an appointment letter yet. Check the Blocked tab to see what each person is waiting on." />
            )}

            {tab === "blocked" && (
              queue?.blocked.length ? (
                <div className="space-y-3">
                  {queue.blocked.map((row) => (
                    <div key={row.employeeId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="text-sm font-bold text-white">{row.employeeName ?? "Unnamed"}</p>
                      <p className="text-xs text-slate-400">{row.employeeCode}</p>
                      <ul className="mt-2.5 space-y-1.5">
                        {row.blockers.map((b) => (
                          <li key={b.code} className="flex items-start gap-2 text-xs text-slate-300">
                            <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                            <span>{b.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : <Empty text="Nothing is blocked." />
            )}

            {tab === "issued" && (
              issued.length ? (
                <div className="space-y-3">
                  {issued.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div>
                        <p className="text-sm font-bold text-white">
                          {row.letter_number}
                          {row.status === "revoked" && <span className="ml-2 rounded-lg bg-red-500/20 px-2 py-0.5 text-[10px] font-black uppercase text-red-300">Revoked</span>}
                          {!row.is_ca_issued && row.status !== "revoked" && (
                            <span className="ml-2 rounded-lg bg-amber-500/20 px-2 py-0.5 text-[10px] font-black uppercase text-amber-300">Self-signed</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">
                          {row.employee_name} · {row.employee_code}
                          {row.branch_name ? ` · ${row.branch_name}` : ""}
                        </p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
                          Employee acceptance: {String(row.employee_esign_status ?? "pending").replace(/_/g, " ")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void download(row)}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm font-semibold hover:bg-black/30">
                          <Download className="h-4 w-4" /> PDF
                        </button>
                        {row.status !== "revoked" && (
                          <button type="button" disabled={busy === row.id} onClick={() => void revoke(row)}
                            className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 text-sm font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-60">
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
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-12 text-center text-sm text-slate-400">{text}</p>;
}
