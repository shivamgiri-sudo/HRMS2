import { Suspense, lazy, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DrawerSection, FieldGrid } from "@/components/wfm/console/DetailDrawer";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  OWNER_LABEL, PRIORITY_LABEL, TIER_LABEL, TIER_TONE, fmtDate, fmtDateTime, fmtPct,
  type Owner, type Priority, type Recommendation, type Tier,
} from "./calc";

const AttendanceTrend = lazy(() => import("./AttendanceTrend"));
const BASE = "/api/analytics/intervention-recommendations";

export interface DetailApi {
  record: {
    id: string; employee_id: string; generated_at: string; risk_tier: Tier; prediction_score: number;
    recommendations: Recommendation[]; action_taken: boolean; action_taken_at: string | null;
    action_taken_by_name: string | null; action_notes: string | null; outcome: "retained" | "exited" | "pending";
    outcome_date: string | null; created_at: string; updated_at: string; sla_hours: number;
  };
  employee: null | { employee_code: string; employee_name: string; branch_name: string; process_name: string; designation_name: string; manager_name: string | null; date_of_joining: string | null; employment_status: string; aon_days: number | null };
  signals: { attendance_pct_60d: number | null; quality_pct_30d: number | null; late_marks_30d: number; aon_days: number | null };
  attendance_trend: Array<{ week_start: string; pct: number | null }>;
  history: Array<{ id: string; generated_at: string; risk_tier: Tier; prediction_score: number; action_taken: number; outcome: string; outcome_date: string | null }>;
  timeline: Array<{ at: string; event: string; actor: string | null; decision: string | null; remarks: string | null }>;
  audit: Array<{ id: string; actor: string | null; action: string; at: string; notes: string | null; outcome: string | null }>;
}

export function useCaseDetail(id: string) {
  return useQuery({
    queryKey: ["interventions", "detail", id],
    queryFn: async () => (await hrmsApi.get<{ data: DetailApi }>(`${BASE}/${encodeURIComponent(id)}`)).data,
    enabled: !!id,
    staleTime: 30_000,
  });
}

const Skeleton = () => <div className="h-24 animate-pulse rounded-md bg-slate-100" role="status" aria-label="Loading" />;

export function drawerHeaderFor(d: DetailApi | undefined) {
  if (!d) return { title: "Intervention case", badge: null as React.ReactNode, subtitle: "" };
  const r = d.record;
  return {
    title: d.employee?.employee_name || "Intervention case",
    badge: <StatusPill tone={TIER_TONE[r.risk_tier] ?? "neutral"}>{TIER_LABEL[r.risk_tier] ?? r.risk_tier}</StatusPill>,
    subtitle: `Case ${r.id} · created ${fmtDateTime(r.created_at)}`,
  };
}

export function RecordBody({ id, onDone }: { id: string; onDone: () => void }) {
  const q = useCaseDetail(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState<"keep" | "retained" | "exited" | "pending">("keep");
  const save = useMutation({
    mutationFn: () => hrmsApi.patch(`${BASE}/${encodeURIComponent(id)}`, { notes, ...(outcome !== "keep" ? { outcome } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["interventions"] }); setNotes(""); setOutcome("keep"); onDone(); },
  });
  if (q.isLoading) return <div className="space-y-3"><Skeleton /><Skeleton /><Skeleton /></div>;
  if (q.isError || !q.data) return <p className="text-sm text-red-700" role="alert">Could not load this case. Close and try again.</p>;
  const d = q.data;
  const r = d.record;
  const e = d.employee;
  const trend = d.attendance_trend.map((t) => ({ label: fmtDate(t.week_start).slice(0, 5), pct: t.pct }));
  const canSave = notes.trim().length > 0 && !save.isPending;

  return (
    <>
      <DrawerSection label="Case">
        <FieldGrid fields={[
          ["Risk tier", TIER_LABEL[r.risk_tier]], ["Attrition risk score", r.prediction_score],
          ["Generated", fmtDateTime(r.generated_at)], ["Action due within", `${r.sla_hours} h`],
          ["Action taken", r.action_taken ? `Yes — ${fmtDateTime(r.action_taken_at)}` : "No"],
          ["Actioned by", r.action_taken_by_name], ["Outcome", r.outcome], ["Outcome date", fmtDate(r.outcome_date)],
          ["Last updated", fmtDateTime(r.updated_at)],
        ]} />
      </DrawerSection>

      <DrawerSection label="Employee">
        {e ? (
          <>
            <FieldGrid fields={[
              ["Name", e.employee_name], ["Code", e.employee_code], ["Designation", e.designation_name], ["Process", e.process_name],
              ["Branch", e.branch_name], ["Reporting manager", e.manager_name], ["Date of joining", fmtDate(e.date_of_joining)],
              ["Tenure", e.aon_days == null ? null : `${e.aon_days} days`], ["Status", e.employment_status],
            ]} />
            <Button variant="outline" size="sm" className="mt-2 cursor-pointer gap-2" onClick={() => navigate(`/wfm/employee-roster/${r.employee_id}`)}>
              <ExternalLink className="h-4 w-4" aria-hidden /> Open employee roster profile
            </Button>
          </>
        ) : null}
      </DrawerSection>

      <DrawerSection label="Risk signals">
        <FieldGrid fields={[
          ["Attendance, working days (60d)", fmtPct(d.signals.attendance_pct_60d)], ["Quality avg (30d)", fmtPct(d.signals.quality_pct_30d)],
          ["Late marks (30d)", d.signals.late_marks_30d], ["Age on network", d.signals.aon_days == null ? null : `${d.signals.aon_days} days`],
        ]} />
      </DrawerSection>

      <DrawerSection label="Attendance trend (weekly, working days)">
        {trend.length ? (
          <div className="h-[180px]" aria-label="Weekly attendance percentage">
            <Suspense fallback={<Skeleton />}><AttendanceTrend data={trend} /></Suspense>
          </div>
        ) : null}
      </DrawerSection>

      <DrawerSection label="Recommended actions">
        {r.recommendations.length ? (
          <ul className="space-y-2">
            {r.recommendations.map((rec, i) => (
              <li key={i} className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium text-slate-900">{rec.action}</p>
                <p className="mt-0.5 text-xs text-slate-600">{rec.reason}</p>
                <p className="mt-1 text-xs text-slate-700">{OWNER_LABEL[rec.owner as Owner] ?? rec.owner} · {PRIORITY_LABEL[rec.priority as Priority] ?? rec.priority}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </DrawerSection>

      <DrawerSection label="Timeline">
        <ol className="space-y-2">
          {d.timeline.map((t, i) => (
            <li key={i} className="rounded-md border border-border p-2 text-sm">
              <p className="font-medium text-slate-900">{t.event} <span className="font-normal text-slate-600">· {fmtDateTime(t.at)}</span></p>
              <p className="text-xs text-slate-700">{[t.actor, t.decision].filter(Boolean).join(" · ") || "—"}</p>
              {t.remarks && <p className="text-xs text-slate-600">{t.remarks}</p>}
            </li>
          ))}
        </ol>
      </DrawerSection>

      <DrawerSection label="Related cases for this employee">
        {d.history.length > 1 ? (
          <ul className="space-y-1 text-sm">
            {d.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 border-b border-border py-1 last:border-0">
                <span className="tabular-nums">{fmtDate(h.generated_at)}</span>
                <StatusPill tone={TIER_TONE[h.risk_tier] ?? "neutral"}>{TIER_LABEL[h.risk_tier] ?? h.risk_tier}</StatusPill>
                <span className="tabular-nums">score {h.prediction_score}</span>
                <span className="text-xs text-slate-600">{h.outcome}{h.id === r.id ? " (this case)" : ""}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </DrawerSection>

      <DrawerSection label="Audit trail">
        {d.audit.length ? (
          <ul className="space-y-1 text-sm">
            {d.audit.map((a) => (
              <li key={a.id} className="border-b border-border py-1 last:border-0">
                <p>{a.action.replace(/_/g, " ")} · <span className="text-slate-600">{a.actor ?? "Unknown"} · {fmtDateTime(a.at)}</span></p>
                {a.notes && <p className="text-xs text-slate-600">{a.notes}</p>}
              </li>
            ))}
          </ul>
        ) : null}
      </DrawerSection>

      <DrawerSection label={r.action_taken ? "Update outcome" : "Record action"}>
        <label htmlFor="iv-notes" className="text-xs font-medium text-slate-700">Notes (required)</label>
        <Textarea id="iv-notes" rows={3} value={notes} onChange={(ev) => setNotes(ev.target.value)} maxLength={2000}
          placeholder="What was done — e.g. 1:1 held, mentor assigned, escalated to manager" />
        <label htmlFor="iv-outcome" className="mt-2 block text-xs font-medium text-slate-700">Outcome</label>
        <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
          <SelectTrigger id="iv-outcome" className="w-full sm:w-64" aria-label="Outcome"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="keep">Keep current ({r.outcome})</SelectItem>
            <SelectItem value="retained">Retained</SelectItem>
            <SelectItem value="exited">Exited</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        {save.isError && <p className="text-xs text-red-700" role="alert">Could not save. Try again.</p>}
        <Button className="mt-2 min-h-[44px] cursor-pointer sm:min-h-9" disabled={!canSave} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : r.action_taken ? "Save update" : "Mark action taken"}
        </Button>
      </DrawerSection>
    </>
  );
}
