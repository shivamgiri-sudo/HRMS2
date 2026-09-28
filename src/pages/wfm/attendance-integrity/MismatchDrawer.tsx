import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { hrmsApi } from "@/lib/hrmsApi";
import { fmtDate, fmtDateTime, fmtMinutes, statusLabel, type EscalationInfo } from "./mismatchTypes";

type DetailRecord = Record<string, unknown> & {
  id: string;
  employee_name: string;
  employee_code: string;
  record_date: string;
  attendance_status: string;
  biometric_status: string | null;
  apr_status: string | null;
  biometric_minutes: number | null;
  dialler_minutes: number | null;
  raw_minutes: number | null;
  lwp_value: number | string;
  branch_name: string | null;
  process_name: string | null;
  mismatch_resolved_at: string | null;
  mismatch_resolution_reason: string | null;
  resolved_by_name: string | null;
  is_locked: number;
};
type Detail = { record: DetailRecord; escalations: (EscalationInfo & { escalated_by_role?: string | null; escalated_by_name?: string | null; escalated_by_code?: string | null })[] };

/** "Wanda Workforce (SBX003) · wfm" — the person first, the role as context. */
function byLabel(e: { escalated_by_name?: string | null; escalated_by_code?: string | null; escalated_by_role?: string | null }): string {
  const name = e.escalated_by_name?.trim();
  const who = name ? `${name}${e.escalated_by_code ? ` (${e.escalated_by_code})` : ""}` : "";
  return [who, e.escalated_by_role].filter(Boolean).join(" · ") || "—";
}

const SECTION = "text-xs font-bold uppercase tracking-wide text-slate-400";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value ?? "—"}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className={SECTION}>{title}</h3>
      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-3">{children}</div>
    </section>
  );
}

export function MismatchDrawer({ recordId, onClose }: { recordId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recordId) { setDetail(null); return; }
    let cancelled = false;
    setDetail(null);
    setError(null);
    hrmsApi.get<{ success: boolean; data: Detail }>(`/api/wfm/mismatches/${recordId}`)
      .then((res) => { if (!cancelled) setDetail(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load record"); });
    return () => { cancelled = true; };
  }, [recordId]);

  const rec = detail?.record;

  return (
    <Sheet open={Boolean(recordId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="h-full w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {rec ? `${rec.employee_name} (${rec.employee_code})` : "Attendance record"}
            {rec && <Badge variant="outline">{statusLabel(rec.attendance_status)}</Badge>}
          </SheetTitle>
          {rec && <p className="text-sm text-slate-500">{fmtDate(rec.record_date)} · {rec.branch_name ?? "—"} · {rec.process_name ?? "—"}</p>}
        </SheetHeader>

        {!rec && !error && <div className="flex justify-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {error && <p className="py-8 text-sm font-medium text-red-700">{error}</p>}

        {rec && detail && (
          <div className="mt-6 space-y-6">
            <Section title="What each source says">
              <Row label="Biometric (COSEC)" value={`${statusLabel(rec.biometric_status)} · ${fmtMinutes(rec.biometric_minutes)}`} />
              <Row label="APR / dialler" value={`${statusLabel(rec.apr_status)} · ${fmtMinutes(rec.dialler_minutes)}`} />
              <Row label="Minutes used for pay" value={fmtMinutes(rec.raw_minutes)} />
              <Row label="Current status" value={statusLabel(rec.attendance_status)} />
              <Row label="Loss of pay" value={String(rec.lwp_value)} />
              <Row label="Locked by payroll" value={rec.is_locked ? "Yes" : "No"} />
            </Section>

            <Section title="Resolution">
              {rec.mismatch_resolved_at ? (
                <>
                  <Row label="Resolved by" value={rec.resolved_by_name?.trim() || "—"} />
                  <Row label="Resolved at" value={fmtDateTime(rec.mismatch_resolved_at)} />
                  <Row label="Reason" value={rec.mismatch_resolution_reason} />
                </>
              ) : (
                <p className="py-2 text-sm text-slate-400">None — still open</p>
              )}
            </Section>

            <Section title="Escalation timeline">
              {detail.escalations.length === 0 ? (
                <p className="py-2 text-sm text-slate-400">None</p>
              ) : detail.escalations.map((e) => (
                <div key={e.id} className="space-y-1 py-2 text-sm">
                  <p className="font-semibold text-slate-900">
                    Level {e.level} → {e.escalated_to_name?.trim() || "—"} {e.escalated_to_code ? `(${e.escalated_to_code})` : ""}
                    <Badge variant="outline" className="ml-2">{e.status}{e.is_overdue ? " · overdue" : ""}</Badge>
                  </p>
                  <p className="text-slate-500">Sent {fmtDateTime(e.created_at)} by {byLabel(e)} · due {fmtDateTime(e.due_at)}</p>
                  {e.escalation_note && <p className="text-slate-700">Note: {e.escalation_note}</p>}
                  {e.recommended_status && (
                    <p className="text-slate-700">
                      Recommended <strong>{statusLabel(e.recommended_status)}</strong> on {fmtDateTime(e.responded_at)} — {e.recommendation_note}
                    </p>
                  )}
                </div>
              ))}
            </Section>

            <Section title="Documents">
              <p className="py-2 text-sm text-slate-400">None</p>
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
