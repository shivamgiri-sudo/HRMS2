import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock, Loader } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MyQualityPanel } from "@/components/quality-dashboard/MyQualityPanel";
import { DailyTrendView } from "./DailyTrendView";
import {
  type AckInfo,
  type CdrCall,
  type CallsFilter,
  type DrawerSpec,
  type QueueBlock,
  TREND_TITLES,
  fmtDate,
  fmtDuration,
  fmtHoursMinutes,
  fmtNum,
  fmtPct,
  getData,
  hourLabel,
  withAgent,
} from "./agent-kpi-model";

type AuditDetail = {
  call_id: number;
  date: string;
  scenario: string | null;
  cq_pct: number;
  has_fatal: boolean;
  duration_sec: number;
  parameters: Array<{ key: string; label: string; group: string; is_fatal_component: boolean; result: 0 | 1 | null }>;
  recording: { url: string | null };
  transcript: string | null;
  feedback: string | null;
  acknowledgement: AckInfo | null;
  ack_available: boolean;
  can_acknowledge: boolean;
};

/**
 * The agent confirms they have read this audit's feedback. Shown as a read-only status to anyone
 * viewing another agent (QA/admin); the backend independently refuses acknowledgements on someone
 * else's behalf.
 */
function AckPanel({ auditId, detail, agentCode }: { auditId: number; detail: AuditDetail; agentCode?: string }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const ack = useMutation({
    mutationFn: () => hrmsApi.post(`/api/agent/feedback/${auditId}/ack`, { comment: comment.trim() || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["agent-kpi"] }); },
  });

  if (detail.acknowledgement) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 size={16} /> Acknowledged on {fmtDate(detail.acknowledgement.acknowledged_at)}</p>
        {detail.acknowledgement.comment && <p className="mt-1 text-xs text-emerald-900">Agent's note: {detail.acknowledgement.comment}</p>}
      </div>
    );
  }
  if (!detail.ack_available) {
    return <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Feedback acknowledgement is not set up yet.</p>;
  }
  if (!detail.can_acknowledge) {
    return <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Not yet acknowledged by the agent{agentCode ? ` (${agentCode})` : ""}.</p>;
  }
  return (
    <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
      <p className="text-xs text-slate-600">Confirm you have read this feedback. You can add a short note (optional).</p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, 1000))}
        rows={2}
        placeholder="e.g. Understood — I will confirm refund timelines on every call."
        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
        aria-label="Note for this acknowledgement"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">{comment.length}/1000</span>
        <button
          onClick={() => ack.mutate()}
          disabled={ack.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
        >
          {ack.isPending ? <Loader size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          I acknowledge this feedback
        </button>
      </div>
      {ack.isError && <p className="text-xs text-rose-600">Could not save the acknowledgement. Please try again.</p>}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</h3>
      {children}
    </section>
  );
}

const None = () => <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>;

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-800">{value ?? "—"}</p>
    </div>
  );
}

function Loading() {
  return <div className="flex justify-center py-12"><Loader className="animate-spin text-indigo-500" size={24} /></div>;
}

function ErrorNote({ error }: { error: unknown }) {
  const status = (error as { status?: number } | null)?.status;
  return (
    <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {status === 404 ? "This record was not found for this agent." : "Could not load this data right now. Please try again."}
    </p>
  );
}

function Recording({ url }: { url: string | null | undefined }) {
  if (!url) return <None />;
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <audio controls preload="none" src={url} className="w-full" />
      <a href={url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600 hover:underline">Open / download recording</a>
    </div>
  );
}

function qs(filter: CallsFilter, offset: number) {
  const p = new URLSearchParams({ from: filter.from, to: filter.to, limit: "25", offset: String(offset) });
  if (filter.hour !== undefined) p.set("hour", String(filter.hour));
  if (filter.campaign) p.set("campaign", filter.campaign);
  if (filter.sl) p.set("sl", filter.sl);
  if (filter.sort) p.set("sort", filter.sort);
  return p.toString();
}

function CallsList({ filter, agentCode, onOpen }: { filter: CallsFilter; agentCode?: string; onOpen: (s: DrawerSpec) => void }) {
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ["agent-kpi", "calls", agentCode, filter, offset],
    queryFn: () => getData<{ total: number; limit: number; offset: number; calls: CdrCall[] }>(withAgent(`/api/agent/my-calls?${qs(filter, offset)}`, agentCode)),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const d = q.data!;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        {fmtNum(d.total)} call{d.total === 1 ? "" : "s"} · {fmtDate(filter.from)}{filter.to !== filter.from ? ` – ${fmtDate(filter.to)}` : ""}
        {filter.hour !== undefined ? ` · ${hourLabel(filter.hour)}–${hourLabel(filter.hour + 1)}` : ""}
        {filter.campaign ? ` · ${filter.campaign}` : ""}
        {filter.sl === "in" ? " · answered within 20 sec" : filter.sl === "out" ? " · answered after 20 sec" : ""}
      </p>
      {d.calls.length === 0 ? <None /> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="px-3 py-2">Date / time</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">Wait</th><th className="px-3 py-2">Talk</th><th className="px-3 py-2">CQ</th></tr>
            </thead>
            <tbody>
              {d.calls.map((c) => (
                <tr key={c.id} onClick={() => onOpen({ kind: "call", id: c.id })} className="cursor-pointer border-t hover:bg-indigo-50/50">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(c.date, c.time)}</td>
                  <td className="px-3 py-2">{c.phone_masked}</td>
                  <td className="px-3 py-2">{c.campaign}</td>
                  <td className={`px-3 py-2 ${c.within_20s ? "" : "font-semibold text-rose-600"}`}>{fmtDuration(c.queue_s)}</td>
                  <td className="px-3 py-2">{fmtDuration(c.talk_s)}</td>
                  <td className="px-3 py-2">{c.audit ? fmtPct(c.audit.cq_pct) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-xs">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - d.limit))} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button>
        <span className="text-slate-500">{d.total === 0 ? 0 : offset + 1}–{Math.min(offset + d.limit, d.total)} of {fmtNum(d.total)}</span>
        <button disabled={offset + d.limit >= d.total} onClick={() => setOffset(offset + d.limit)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

function AuditSections({ auditId, agentCode }: { auditId: number; agentCode?: string }) {
  const q = useQuery({
    queryKey: ["agent-kpi", "audit", agentCode, auditId],
    queryFn: () => getData<AuditDetail>(withAgent(`/api/agent/call/${auditId}/detail`, agentCode)),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const a = q.data!;
  const failed = a.parameters.filter((p) => p.result === 0);
  return (
    <>
      <Section label="Quality audit">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="CQ score" value={fmtPct(a.cq_pct)} />
          <Field label="Fatal call" value={a.has_fatal ? <span className="text-rose-600">Yes</span> : "No"} />
          <Field label="Scenario" value={a.scenario ?? "—"} />
          <Field label="Audited at" value={fmtDate(String(a.date))} />
        </div>
      </Section>
      <Section label="Auditor feedback">
        {a.feedback ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{a.feedback}</p> : <None />}
      </Section>
      <Section label="Acknowledgement">
        <AckPanel auditId={a.call_id} detail={a} agentCode={agentCode} />
      </Section>
      <Section label={`Parameters (${failed.length} missed)`}>
        <div className="divide-y rounded-lg border border-slate-200">
          {a.parameters.map((p) => (
            <div key={p.key} className="flex items-center justify-between px-3 py-1.5 text-xs">
              <span className="text-slate-700">{p.label}{p.is_fatal_component && <span className="ml-1 text-[10px] font-bold text-rose-600">FATAL</span>}</span>
              {p.result === null ? <span className="text-slate-400">Not evaluated</span>
                : p.result === 1 ? <span className="font-semibold text-emerald-600">Pass</span>
                : <span className="font-semibold text-rose-600">Missed</span>}
            </div>
          ))}
        </div>
      </Section>
      <Section label="Recording"><Recording url={a.recording?.url} /></Section>
      <Section label="Transcript">
        {a.transcript ? <p className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{a.transcript}</p> : <None />}
      </Section>
    </>
  );
}

function CallDetail({ id, agentCode }: { id: number; agentCode?: string }) {
  const q = useQuery({
    queryKey: ["agent-kpi", "call", agentCode, id],
    queryFn: () => getData<CdrCall>(withAgent(`/api/agent/my-calls/${id}`, agentCode)),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const c = q.data!;
  return (
    <div className="space-y-5">
      <Section label="Call detail">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Field label="Date / time" value={fmtDate(c.date, c.time)} />
          <Field label="Customer" value={c.phone_masked} />
          <Field label="Campaign" value={c.campaign} />
          <Field label="Queue wait" value={<span className={c.within_20s ? "" : "text-rose-600"}>{fmtDuration(c.queue_s)}{c.within_20s ? " (≤20s)" : " (>20s)"}</span>} />
          <Field label="Talk time" value={fmtDuration(c.talk_s)} />
          <Field label="Handle time" value={fmtDuration(c.duration_s)} />
          <Field label="Hold" value={fmtDuration(c.hold_s)} />
          <Field label="After-call work" value={fmtDuration(c.acw_s)} />
          <Field label="Disconnected by" value={c.disconnected_by ?? "—"} />
          <Field label="Dialer status" value={c.disposition ?? "—"} />
          <Field label="Call id" value={c.id} />
        </div>
      </Section>
      {c.audit ? <AuditSections auditId={c.audit.audit_id} agentCode={agentCode} /> : (
        <>
          <Section label="Quality audit"><p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">This call has not been audited yet.</p></Section>
          <Section label="Recording"><p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Recordings are available for audited calls.</p></Section>
        </>
      )}
      <Section label="Workflow timeline"><None /></Section>
      <Section label="Audit trail"><None /></Section>
    </div>
  );
}

function LoginDays({ from, to, agentCode }: { from: string; to: string; agentCode?: string }) {
  const q = useQuery({
    queryKey: ["agent-kpi", "login", agentCode, from, to],
    queryFn: () => getData<{ days: Array<{ date: string; first_login: string | null; login_s: number | null; pause_s: number | null }> }>(
      withAgent(`/api/agent/my-login?from=${from}&to=${to}`, agentCode)),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const days = q.data!.days;
  const total = days.reduce((a, d) => a + (d.login_s ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Field label="Days logged in" value={days.length} />
        <Field label="Total net login" value={fmtHoursMinutes(total)} />
        <Field label="Average / day" value={days.length ? fmtHoursMinutes(total / days.length) : "—"} />
      </div>
      {days.length === 0 ? <None /> : (
        <table className="w-full rounded-lg border text-xs">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">First login</th><th className="px-3 py-2">Net login</th></tr></thead>
          <tbody>{days.map((d) => (
            <tr key={d.date} className="border-t"><td className="px-3 py-2">{fmtDate(d.date)}</td><td className="px-3 py-2">{d.first_login ?? "—"}</td><td className="px-3 py-2">{fmtHoursMinutes(d.login_s)}</td></tr>
          ))}</tbody>
        </table>
      )}
      <p className="text-[11px] text-slate-400">Source: dialer agent productivity report (net login = wait + talk + wrap-up + pause).</p>
    </div>
  );
}

function QueueView({ from, to, agentCode, onOpen }: { from: string; to: string; agentCode?: string; onOpen: (s: DrawerSpec) => void }) {
  const q = useQuery({
    queryKey: ["agent-kpi", "queue", agentCode, from, to],
    queryFn: () => getData<QueueBlock>(withAgent(`/api/agent/my-queue?from=${from}&to=${to}`, agentCode)),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const d = q.data!;
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
        Offered and abandoned calls belong to the queue, not to one agent — an abandoned call was never connected to anyone.
        These are the totals for every campaign you handled in this period.
      </p>
      <div className="grid grid-cols-4 gap-2">
        <Field label="Offered" value={fmtNum(d.total.offered)} />
        <Field label="Answered" value={fmtNum(d.total.answered)} />
        <Field label="Abandoned" value={fmtNum(d.total.abandoned)} />
        <Field label="Abandon %" value={fmtPct(d.total.abandon_pct)} />
      </div>
      {d.byCampaign.length === 0 ? <None /> : (
        <table className="w-full rounded-lg border text-xs">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">Offered</th><th className="px-3 py-2">Answered</th><th className="px-3 py-2">Abandoned</th><th className="px-3 py-2">Abandon %</th></tr></thead>
          <tbody>{d.byCampaign.map((c) => (
            <tr key={c.campaign} className="cursor-pointer border-t hover:bg-indigo-50/50"
              onClick={() => onOpen({ kind: "calls", title: `Your calls · ${c.campaign}`, filter: { from, to, campaign: c.campaign } })}>
              <td className="px-3 py-2">{c.campaign}</td><td className="px-3 py-2">{fmtNum(c.offered)}</td><td className="px-3 py-2">{fmtNum(c.answered)}</td>
              <td className="px-3 py-2">{fmtNum(c.abandoned)}</td><td className="px-3 py-2">{fmtPct(c.abandon_pct)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function FeedbackList({ agentCode, onOpen }: { agentCode?: string; onOpen: (s: DrawerSpec) => void }) {
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ["agent-kpi", "audited", agentCode, offset],
    queryFn: () => getData<{ total_calls: number; ack_available?: boolean; calls: Array<{ call_id: number; date: string; scenario: string | null; cq_pct: number; has_fatal: boolean; acknowledgement?: AckInfo | null }> }>(
      withAgent(`/api/agent/calls-review?limit=20&offset=${offset}&sort=date`, agentCode)),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorNote error={q.error} />;
  const d = q.data!;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{fmtNum(d.total_calls)} audited calls in the last 30 days</p>
      {d.calls.length === 0 ? <None /> : (
        <table className="w-full rounded-lg border text-xs">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2">Audited call</th><th className="px-3 py-2">Scenario</th><th className="px-3 py-2">CQ</th><th className="px-3 py-2">Fatal</th><th className="px-3 py-2">Acknowledged</th></tr></thead>
          <tbody>{d.calls.map((c) => (
            <tr key={c.call_id} className="cursor-pointer border-t hover:bg-indigo-50/50" onClick={() => onOpen({ kind: "audit", auditId: Number(c.call_id) })}>
              <td className="px-3 py-2">{fmtDate(String(c.date))}</td><td className="px-3 py-2">{c.scenario ?? "—"}</td>
              <td className={`px-3 py-2 font-semibold ${c.cq_pct >= 90 ? "text-emerald-600" : c.cq_pct >= 70 ? "text-amber-600" : "text-rose-600"}`}>{fmtPct(c.cq_pct)}</td>
              <td className="px-3 py-2">{c.has_fatal ? <span className="text-rose-600">Yes</span> : "No"}</td>
              <td className="px-3 py-2">{d.ack_available === false ? <span className="text-slate-400">—</span>
                : c.acknowledgement ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={12} /> {fmtDate(c.acknowledgement.acknowledged_at)}</span>
                : <span className="inline-flex items-center gap-1 text-amber-700"><Clock size={12} /> Pending</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="flex items-center justify-between text-xs">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button>
        <button disabled={offset + 20 >= d.total_calls} onClick={() => setOffset(offset + 20)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

function titleFor(spec: DrawerSpec): string {
  switch (spec.kind) {
    case "trend": return TREND_TITLES[spec.metric];
    case "calls": return spec.title;
    case "call": return `Call #${spec.id}`;
    case "audit": return `Audited call #${spec.auditId}`;
    case "login": return "Login hours";
    case "queue": return spec.title;
    case "quality": return "Quality parameters";
    case "feedback": return "Audited calls & feedback";
  }
}

/**
 * Right-side drill-down drawer. `stack` is the navigation history inside the drawer, so clicking a
 * call inside a list opens it in place with a Back button rather than stacking dialogs.
 */
export function AgentKpiDrawer({ stack, setStack, agentCode }: { stack: DrawerSpec[]; setStack: (s: DrawerSpec[]) => void; agentCode?: string }) {
  const spec = stack[stack.length - 1];
  const open = (s: DrawerSpec) => setStack([...stack, s]);
  return (
    <Sheet open={stack.length > 0} onOpenChange={(o) => { if (!o) setStack([]); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {spec && (
          <>
            <SheetHeader className="mb-4 space-y-1 border-b pb-3">
              <div className="flex items-center gap-2">
                {stack.length > 1 && (
                  <button onClick={() => setStack(stack.slice(0, -1))} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Back">
                    <ArrowLeft size={16} />
                  </button>
                )}
                <SheetTitle className="text-base">{titleFor(spec)}</SheetTitle>
              </div>
              <SheetDescription className="text-xs">
                {agentCode ? `Agent ${agentCode} · ` : ""}Read-only view of source records
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5">
              {spec.kind === "trend" && (
                <>
                  {spec.metric === "quality" && (
                    <button onClick={() => open({ kind: "quality" })} className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-left text-xs font-semibold text-indigo-700 hover:bg-indigo-100">
                      View all score components and parameters →
                    </button>
                  )}
                  <DailyTrendView key={`${spec.metric}-${spec.from}-${spec.to}`} metric={spec.metric} from={spec.from} to={spec.to} agentCode={agentCode} onOpen={open} />
                </>
              )}
              {spec.kind === "calls" && <CallsList filter={spec.filter} agentCode={agentCode} onOpen={open} />}
              {spec.kind === "call" && <CallDetail id={spec.id} agentCode={agentCode} />}
              {spec.kind === "audit" && (
                <div className="space-y-5">
                  <AuditSections auditId={spec.auditId} agentCode={agentCode} />
                  <Section label="Workflow timeline"><None /></Section>
                  <Section label="Audit trail"><None /></Section>
                </div>
              )}
              {spec.kind === "login" && <LoginDays from={spec.from} to={spec.to} agentCode={agentCode} />}
              {spec.kind === "queue" && <QueueView from={spec.from} to={spec.to} agentCode={agentCode} onOpen={open} />}
              {spec.kind === "quality" && <MyQualityPanel agentCode={agentCode} embedded />}
              {spec.kind === "feedback" && <FeedbackList agentCode={agentCode} onOpen={open} />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

