import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { fmtDate, fmtN } from "./lpCallShared";
import {
  DataTable, None, Section, Stat, fmtHrs, fmtInr, fmtNum, fmtPct, fmtSecs, fmtStamp, hms, type Col,
} from "./AppreciateWealthShared";

/**
 * Right-side slide-over for every Appreciate Wealth table row. Each target
 * fetches its OWN detail endpoint (never the list payload):
 *   agent / day / billing / group / call / agentDay / mandate / source
 */
export type DrawerTarget =
  | { kind: "agent"; key: string }
  | { kind: "day"; from: string; to: string; label: string }
  | { kind: "billing"; key: string }
  | { kind: "group"; source: "inbound" | "cdr"; dim: string; value: string }
  | { kind: "call"; source: "inbound" | "cdr"; id: number }
  | { kind: "agentDay"; source: "billing" | "out"; id: number }
  | { kind: "mandate"; id: number }
  | { kind: "source"; table: string };

const BASE = "/api/process-performance/appreciate-wealth";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function urlFor(t: DrawerTarget, from: string, to: string): string {
  const range = `from=${from}&to=${to}`;
  switch (t.kind) {
    case "agent": return `${BASE}/agent/${encodeURIComponent(t.key)}?${range}`;
    case "day": return `${BASE}/day/${t.from}?to=${t.to}`;
    case "billing": return `${BASE}/billing-type/${encodeURIComponent(t.key)}?${range}`;
    case "group": return `${BASE}/group/${t.source}/${t.dim}?value=${encodeURIComponent(t.value)}&${range}`;
    case "call": return `${BASE}/call/${t.source}/${t.id}`;
    case "agentDay": return `${BASE}/agent-day/${t.source}/${t.id}`;
    case "mandate": return `${BASE}/mandate/${t.id}`;
    case "source": return `${BASE}/source/${t.table}`;
  }
}

function titleFor(t: DrawerTarget): { title: string; badge: string } {
  switch (t.kind) {
    case "agent": return { title: `Agent ${t.key}`, badge: "Agent" };
    case "day": return { title: t.label, badge: t.from === t.to ? "Day" : "Period" };
    case "billing": return { title: t.key, badge: "Billing type / segment" };
    case "group": return { title: t.value, badge: `${t.source === "inbound" ? "Inbound" : "Dialer"} · ${t.dim}` };
    case "call": return { title: `Call record #${t.id}`, badge: t.source === "inbound" ? "Inbound CDR" : "Dialer CDR" };
    case "agentDay": return { title: `Agent-day record #${t.id}`, badge: t.source === "billing" ? "Billing" : "Outbound sales" };
    case "mandate": return { title: `Mandate record #${t.id}`, badge: "Mandate" };
    case "source": return { title: t.table, badge: "Source table" };
  }
}

const Grid2 = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>;

function Fields({ fields }: { fields: Array<{ field: string; value: string }> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-100">
      <table className="w-full text-xs">
        <tbody>
          {fields.map((f) => (
            <tr key={f.field} className="border-t border-slate-50 first:border-t-0">
              <td className="w-2/5 bg-slate-50/70 px-3 py-1.5 font-medium text-slate-500">{f.field}</td>
              <td className="break-all px-3 py-1.5 text-slate-800">{f.value === "" ? <span className="text-slate-300">(blank)</span> : f.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTable({ rows }: { rows: Array<{ batch: string; rows: number; insertedAt: string | null; uploadedBy: string | null; table?: string }> }) {
  return (
    <DataTable
      rows={rows} rowKey={(r, i) => `${r.batch}${i}`}
      cols={[
        ...(rows.some((r) => r.table) ? [{ key: "t", header: "Table", render: (r: typeof rows[number]) => r.table ?? "" } as Col<typeof rows[number]>] : []),
        { key: "b", header: "Upload batch", render: (r) => <span className="font-mono text-[10px]">{r.batch}</span> },
        { key: "n", header: "Rows", align: "right", render: (r) => fmtNum(r.rows) },
        { key: "t2", header: "Uploaded", render: (r) => fmtStamp(r.insertedAt) },
        { key: "u", header: "By (user id)", render: (r) => r.uploadedBy ?? "—" },
      ]}
    />
  );
}

export function AppreciateWealthDrawer({
  target, from, to, onClose, onOpen,
}: { target: DrawerTarget | null; from: string; to: string; onClose: () => void; onOpen: (t: DrawerTarget) => void }) {
  const [data, setData] = useState<Any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const key = target ? JSON.stringify(target) + from + to : "";

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setData(null); setError(""); setLoading(true);
    hrmsApi.get<{ success: boolean; data: Any }>(urlFor(target, from, to))
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load this record."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const head = target ? titleFor(target) : { title: "", badge: "" };
  const created: string | null =
    data?.audit?.[0]?.insertedAt ?? data?.insertedAt ?? data?.batches?.[0]?.insertedAt ?? null;
  const status: string | null = data?.status ?? (data?.superseded === true ? "Superseded" : data?.superseded === false ? "Current" : null);

  return (
    <Sheet open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-slate-100 bg-white px-5 py-4 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700">{head.badge}</span>
            {status && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{status}</span>}
            <SheetTitle className="text-base font-bold text-slate-800">{head.title}</SheetTitle>
          </div>
          <SheetDescription className="text-[11px] text-slate-400">
            {created ? `Created ${fmtStamp(created)} · ` : ""}Read-only detail from the uploaded MASMIS tables.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-5 py-4">
          {loading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
          {error && <p className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
          {data && target && <Body target={target} d={data} onOpen={onOpen} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Body({ target, d, onOpen }: { target: DrawerTarget; d: Any; onOpen: (t: DrawerTarget) => void }) {
  switch (target.kind) {
    case "agent": return <AgentBody d={d} onOpen={onOpen} />;
    case "day": return <DayBody d={d} onOpen={onOpen} />;
    case "billing": return <BillingBody d={d} onOpen={onOpen} />;
    case "group": return <GroupBody d={d} onOpen={onOpen} target={target} />;
    case "call": return <CallBody d={d} onOpen={onOpen} />;
    case "agentDay": return <AgentDayBody d={d} onOpen={onOpen} />;
    case "mandate": return <MandateBody d={d} onOpen={onOpen} />;
    case "source": return <SourceBody d={d} />;
  }
}

type P = { d: Any; onOpen: (t: DrawerTarget) => void };

function AgentBody({ d, onOpen }: P) {
  const k = d.kpis;
  return (
    <>
      <Section title="Identity">
        <Grid2>
          <Stat label="Agent" value={d.name} sub={`Dialer id ${d.agentId}`} /><Stat label="Employee id" value={d.empId || "—"} />
          <Stat label="Segments" value={d.segments.join(" / ") || "—"} sub={d.billingTypes.join(", ")} />
        </Grid2>
      </Section>
      <Section title={`Performance ${fmtDate(d.from)} – ${fmtDate(d.to)}`}>
        <Grid2>
          <Stat label="Agent-days" value={fmtNum(k.agentDays)} /><Stat label="Calls" value={fmtNum(k.calls)} sub={`${fmtNum(k.connected)} connected`} />
          <Stat label="Connect %" value={fmtPct(k.connectPct)} /><Stat label="Net login" value={fmtHrs(k.netHrs)} sub={`login ${fmtHrs(k.loginHrs)}`} />
          <Stat label="ACHT" value={fmtSecs(k.acht)} /><Stat label="Net occupancy" value={fmtPct(k.netOccPct)} />
          <Stat label="Late logins" value={`${k.lateDays} of ${k.agentDays}`} sub={fmtPct(k.latePct)} />
          <Stat label="Sales (LRS / Trade / MF)" value={fmtInr(k.lrsA + k.trA + k.mfA)} sub={`${fmtInr(k.lrsA)} · ${fmtInr(k.trA)} · ${fmtInr(k.mfA)}`} />
          <Stat label="Dialer legs" value={fmtNum(k.dialerLegs)} sub={`${fmtNum(k.dialerAnswered)} answered`} />
          <Stat label="Inbound-file calls" value={fmtNum(k.inboundCalls)} sub={`${fmtNum(k.inboundAnswered)} answered`} />
        </Grid2>
      </Section>
      <Section title="Day by day (click a row for the full record)">
        <DataTable
          rows={d.daily as Any[]} rowKey={(r: Any) => r.date}
          onRow={(r: Any) => { if (r.billingId) onOpen({ kind: "agentDay", source: "billing", id: r.billingId }); else if (r.outId) onOpen({ kind: "agentDay", source: "out", id: r.outId }); else onOpen({ kind: "day", from: r.date, to: r.date, label: fmtDate(r.date) }); }}
          cols={[
            { key: "d", header: "Date", render: (r: Any) => fmtDate(r.date) }, { key: "s", header: "Segment", render: (r: Any) => r.segment || "—" },
            { key: "c", header: "Calls", align: "right", render: (r: Any) => fmtNum(r.calls) }, { key: "cn", header: "Conn.", align: "right", render: (r: Any) => fmtNum(r.connected) },
            { key: "n", header: "Net h", align: "right", render: (r: Any) => r.netHrs ?? "—" }, { key: "l", header: "Late", render: (r: Any) => (r.late === null ? "—" : r.late ? "Yes" : "No") },
            { key: "sa", header: "Sales", align: "right", render: (r: Any) => (r.salesTotal === null ? "—" : fmtInr(r.salesTotal)) },
            { key: "cd", header: "CDR legs", align: "right", render: (r: Any) => fmtNum(r.cdrLegs) },
          ]}
        />
      </Section>
      <Section title="AUX time (hours)">
        {d.aux.length ? <DataTable rows={d.aux as Any[]} rowKey={(r: Any) => r.label} cols={[{ key: "l", header: "Code", render: (r: Any) => r.label }, { key: "h", header: "Hours", align: "right", render: (r: Any) => r.hours }]} /> : <None />}
      </Section>
      <Section title="Dialer dispositions (category)">
        {d.dispositions.length ? (
          <DataTable rows={d.dispositions as Any[]} rowKey={(r: Any) => r.name} onRow={(r: Any) => onOpen({ kind: "group", source: "cdr", dim: "category", value: r.name })}
            cols={[{ key: "n", header: "Category", render: (r: Any) => r.name }, { key: "l", header: "Legs", align: "right", render: (r: Any) => fmtNum(r.legs) }]} />
        ) : <None />}
      </Section>
      <Section title="Audit trail (upload batches)">{d.audit.length ? <AuditTable rows={d.audit} /> : <None />}</Section>
    </>
  );
}

function DayBody({ d, onOpen }: P) {
  const k = d.kpis;
  return (
    <>
      <Section title="Period">
        <Grid2>
          <Stat label="Agent-days" value={fmtNum(k.agentDays)} /><Stat label="Calls" value={fmtNum(k.calls)} sub={`${fmtNum(k.connected)} connected · ${fmtPct(k.connectPct)}`} />
          <Stat label="Net login" value={fmtHrs(k.netHrs)} /><Stat label="Late-login %" value={fmtPct(k.latePct)} />
          <Stat label="Sales" value={fmtInr(k.salesTotal)} /><Stat label="Inbound file" value={fmtNum(k.inboundCalls)} sub={`${fmtNum(k.inboundAnswered)} answered`} />
          <Stat label="Dialer legs" value={fmtNum(k.dialerLegs)} sub={`${fmtNum(k.dialerAnswered)} answered`} />
        </Grid2>
      </Section>
      <Section title="Agents (agent-day report)">
        <DataTable rows={d.agents as Any[]} rowKey={(r: Any) => String(r.id)} onRow={(r: Any) => onOpen({ kind: "agentDay", source: "billing", id: r.id })}
          cols={[
            { key: "a", header: "Agent", render: (r: Any) => r.agent }, { key: "s", header: "Segment", render: (r: Any) => r.segment }, { key: "b", header: "Billing type", render: (r: Any) => r.billingType },
            { key: "c", header: "Calls", align: "right", render: (r: Any) => fmtNum(r.calls) }, { key: "n", header: "Net h", align: "right", render: (r: Any) => r.netHrs }, { key: "l", header: "Late", render: (r: Any) => (r.late ? "Yes" : "No") },
          ]} />
      </Section>
      <Section title="Sales (Outbound)">
        {d.sales.length ? (
          <DataTable rows={d.sales as Any[]} rowKey={(r: Any) => String(r.id)} onRow={(r: Any) => onOpen({ kind: "agentDay", source: "out", id: r.id })}
            cols={[{ key: "a", header: "Agent", render: (r: Any) => r.agent }, { key: "l", header: "LRS", align: "right", render: (r: Any) => fmtInr(r.lrsA) }, { key: "t", header: "Trade", align: "right", render: (r: Any) => fmtInr(r.trA) }, { key: "m", header: "MF", align: "right", render: (r: Any) => fmtInr(r.mfA) }]} />
        ) : <None />}
      </Section>
      <Section title="Call volume by hour">
        {d.hours.length ? <DataTable rows={d.hours as Any[]} rowKey={(r: Any) => String(r.hour)} onRow={(r: Any) => onOpen({ kind: "group", source: "cdr", dim: "hour", value: `${String(r.hour).padStart(2, "0")}:00` })}
          cols={[{ key: "h", header: "Hour", render: (r: Any) => `${String(r.hour).padStart(2, "0")}:00` }, { key: "i", header: "Inbound file", align: "right", render: (r: Any) => fmtNum(r.inbound) }, { key: "d", header: "Dialer", align: "right", render: (r: Any) => fmtNum(r.dialer) }]} /> : <None />}
      </Section>
      <Section title="Workflow / audit">
        <None />
      </Section>
    </>
  );
}

function BillingBody({ d, onOpen }: P) {
  const k = d.kpis;
  return (
    <>
      <Section title={`Summary ${fmtDate(d.from)} – ${fmtDate(d.to)}`}>
        <Grid2>
          <Stat label="Agents" value={fmtNum(k.agents)} sub={d.segments.join(" / ")} /><Stat label="Agent-days" value={fmtNum(k.agentDays)} /><Stat label="Calls" value={fmtNum(k.calls)} sub={`${fmtNum(k.connected)} connected`} />
          <Stat label="Connect %" value={fmtPct(k.connectPct)} /><Stat label="Net login" value={fmtHrs(k.netHrs)} /><Stat label="ACHT" value={fmtSecs(k.acht)} />
          <Stat label="Net occupancy" value={fmtPct(k.netOccPct)} /><Stat label="Late-login %" value={fmtPct(k.latePct)} /><Stat label="Break % of login" value={fmtPct(k.breakPct)} />
        </Grid2>
      </Section>
      <Section title="Agents">
        <DataTable rows={d.agents as Any[]} rowKey={(r: Any) => r.agentId} onRow={(r: Any) => onOpen({ kind: "agent", key: r.agentId })}
          cols={[{ key: "n", header: "Agent", render: (r: Any) => r.name }, { key: "d", header: "Days", align: "right", render: (r: Any) => r.agentDays }, { key: "c", header: "Calls", align: "right", render: (r: Any) => fmtNum(r.calls) }, { key: "h", header: "Net h", align: "right", render: (r: Any) => r.netHrs }, { key: "l", header: "Late days", align: "right", render: (r: Any) => r.lateDays }]} />
      </Section>
      <Section title="Day by day">
        <DataTable rows={d.daily as Any[]} rowKey={(r: Any) => r.date} onRow={(r: Any) => onOpen({ kind: "day", from: r.date, to: r.date, label: fmtDate(r.date) })}
          cols={[{ key: "d", header: "Date", render: (r: Any) => fmtDate(r.date) }, { key: "a", header: "Agents", align: "right", render: (r: Any) => r.agents }, { key: "c", header: "Calls", align: "right", render: (r: Any) => fmtNum(r.calls) }, { key: "h", header: "Net h", align: "right", render: (r: Any) => r.netHrs }]} />
      </Section>
      <Section title="Mandate rows for this billing type">
        {d.mandate.length ? (
          <DataTable rows={d.mandate as Any[]} rowKey={(r: Any) => String(r.id)} onRow={(r: Any) => onOpen({ kind: "mandate", id: r.id })}
            cols={[{ key: "m", header: "Month", render: (r: Any) => r.month }, { key: "f", header: "Mandate", align: "right", render: (r: Any) => r.mandate }, { key: "r", header: "Rate", align: "right", render: (r: Any) => fmtInr(r.rate) }, { key: "h", header: "Hours/FTE", render: (r: Any) => r.hoursRaw }, { key: "s", header: "Status", render: (r: Any) => (r.superseded ? "Superseded" : "Current") }]} />
        ) : <None />}
      </Section>
    </>
  );
}

function GroupBody({ d, onOpen, target }: P & { target: Extract<DrawerTarget, { kind: "group" }> }) {
  const k = d.kpis;
  const small = (rows: Any[], label: string, dim?: string) => (
    <DataTable rows={rows} rowKey={(r: Any) => r.name}
      onRow={dim ? (r: Any) => onOpen({ kind: "group", source: target.source, dim, value: r.name }) : (r: Any) => onOpen({ kind: "group", source: target.source, dim: label === "Hour" ? "hour" : "disposition", value: r.name })}
      cols={[{ key: "n", header: label, render: (r: Any) => r.name }, { key: "c", header: "Calls", align: "right", render: (r: Any) => fmtNum(r.calls) }, { key: "a", header: "Answered", align: "right", render: (r: Any) => fmtNum(r.answered) }]} />
  );
  return (
    <>
      <Section title={`Summary ${fmtDate(d.from)} – ${fmtDate(d.to)}`}>
        <Grid2>
          <Stat label="Calls" value={fmtNum(k.calls)} /><Stat label="Answered" value={fmtNum(k.answered)} sub={fmtPct(k.answerPct)} /><Stat label="Talk time" value={fmtHrs(k.talkHrs)} />
          <Stat label="Avg talk" value={fmtSecs(k.avgTalk)} /><Stat label="Avg handling" value={fmtSecs(k.avgHandling)} /><Stat label="Unique numbers" value={fmtNum(k.uniqueCallers)} />
        </Grid2>
      </Section>
      <Section title="By agent">{small(d.byAgent, "Agent", "agent")}</Section>
      <Section title="By disposition">{small(d.byDisposition, "Disposition", "disposition")}</Section>
      <Section title="By hour">{small(d.byHour, "Hour", "hour")}</Section>
      <Section title={`Calls${d.truncated ? " (latest 100)" : ""}`}>
        <DataTable rows={d.calls as Any[]} rowKey={(r: Any) => String(r.id)} onRow={(r: Any) => onOpen({ kind: "call", source: target.source, id: r.id })}
          cols={[{ key: "d", header: "Date", render: (r: Any) => fmtDate(r.date) }, { key: "t", header: "Start", render: (r: Any) => hms(r.startS) }, { key: "a", header: "Agent", render: (r: Any) => r.agent }, { key: "s", header: "Status", render: (r: Any) => r.status }, { key: "p", header: "Disposition", render: (r: Any) => r.disposition }, { key: "k", header: "Talk", align: "right", render: (r: Any) => `${r.talkS}s` }]} />
      </Section>
    </>
  );
}

function CallBody({ d, onOpen }: P) {
  return (
    <>
      <Section title="Call summary">
        <Grid2>
          <Stat label="Status" value={d.status || "—"} /><Stat label="Agent" value={d.agent || "(none)"} /><Stat label="Start time" value={d.summary.startTime ?? "—"} />
          <Stat label="Talk" value={fmtSecs(d.summary.talkTimeS)} /><Stat label="Handling" value={fmtSecs(d.summary.handlingS)} /><Stat label="Hold / wrap-up" value={`${fmtSecs(d.summary.holdS)} / ${fmtSecs(d.summary.wrapupS)}`} />
        </Grid2>
        <p className="text-[11px] text-slate-500">Disposition: <b className="text-slate-700">{d.disposition || "(blank)"}</b></p>
      </Section>
      <Section title="Recording">
        {d.recordingUrl ? (
          <div className="space-y-2">
            <audio controls preload="none" src={d.recordingUrl} className="w-full" />
            <a href={d.recordingUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-sky-600 hover:underline">View / Download</a>
          </div>
        ) : <None />}
      </Section>
      <Section title="Every stored field"><Fields fields={d.fields} /></Section>
      <Section title="Other rows with the same call id (agent legs / re-uploads)">
        <DataTable rows={d.sameCallId as Any[]} rowKey={(r: Any) => String(r.id)} onRow={(r: Any) => onOpen({ kind: "call", source: d.source, id: r.id })}
          cols={[{ key: "i", header: "Row", render: (r: Any) => r.id }, { key: "a", header: "Agent", render: (r: Any) => r.agent || "—" }, { key: "s", header: "Status", render: (r: Any) => r.status }, { key: "d", header: "Date (raw)", render: (r: Any) => r.callDate }, { key: "t", header: "Start (raw)", render: (r: Any) => r.startTime }]} />
      </Section>
      <Section title="Audit trail (upload batch)">{d.audit.length ? <AuditTable rows={d.audit} /> : <None />}</Section>
    </>
  );
}

function AgentDayBody({ d, onOpen }: P) {
  const rowsCols = (rows: Any[], table: string, source: "billing" | "out") => (
    <DataTable rows={rows} rowKey={(r: Any) => String(r.id)} onRow={(r: Any) => onOpen({ kind: "agentDay", source, id: r.id })}
      cols={[{ key: "i", header: `${table} row`, render: (r: Any) => r.id }, { key: "c", header: "Calls", align: "right", render: (r: Any) => r.total_calls }, { key: "k", header: "Connected", align: "right", render: (r: Any) => r.connected_calls }, { key: "b", header: "Batch", render: (r: Any) => <span className="font-mono text-[10px]">{String(r.upload_batch_id).slice(0, 8)}</span> }, { key: "t", header: "Uploaded", render: (r: Any) => fmtStamp(r.inserted_at) }]} />
  );
  const other: "billing" | "out" = d.source === "billing" ? "out" : "billing";
  return (
    <>
      <Section title="Record">
        <Grid2><Stat label="Agent" value={d.agent} sub={`Dialer id ${d.agentId}`} /><Stat label="Employee id" value={d.empId || "—"} /><Stat label="Date" value={fmtDate(d.date)} /></Grid2>
        <button type="button" className="text-xs font-semibold text-sky-600 hover:underline" onClick={() => onOpen({ kind: "agent", key: d.agentId })}>Open agent {d.agent}</button>
      </Section>
      <Section title="Every stored field"><Fields fields={d.fields} /></Section>
      <Section title="Same agent-day, all uploads (this table)">{rowsCols(d.sameAgentDayRows, d.source === "billing" ? "aw_billing" : "aw_out", d.source)}</Section>
      <Section title={`Same agent-day in ${d.linkedOtherTable.table}`}>{d.linkedOtherTable.rows.length ? rowsCols(d.linkedOtherTable.rows, d.linkedOtherTable.table, other) : <None />}</Section>
      <Section title="Call-level CDR for this agent-day">
        <Grid2><Stat label="Dialer CDR legs" value={fmtNum(d.cdrLegs.legs)} /><Stat label="Answered" value={fmtNum(d.cdrLegs.answered)} /></Grid2>
      </Section>
      <Section title="Audit trail (upload batch)">{d.audit.length ? <AuditTable rows={d.audit} /> : <None />}</Section>
    </>
  );
}

function MandateBody({ d, onOpen }: P) {
  const x = d.derived;
  return (
    <>
      <Section title="Derived for the month">
        <Grid2>
          <Stat label="Contract value" value={fmtInr(x.contractValue)} sub="mandate × rate per FTE" /><Stat label="Mandated hours" value={x.mandatedHrs === null ? "—" : fmtHrs(x.mandatedHrs)} />
          <Stat label="Delivered net hours" value={fmtHrs(x.deliveredHrs)} sub={`${fmtNum(x.agents)} agents · ${fmtNum(x.agentDays)} agent-days`} /><Stat label="FTE-equivalent" value={x.fteEq === null ? "—" : String(x.fteEq)} />
        </Grid2>
      </Section>
      <Section title="Every stored field"><Fields fields={d.fields} /></Section>
      <Section title="Same month + billing type (history of uploads)">
        <DataTable rows={d.sameMonthRows as Any[]} rowKey={(r: Any) => String(r.id)} onRow={(r: Any) => onOpen({ kind: "mandate", id: r.id })}
          cols={[{ key: "i", header: "Row", render: (r: Any) => r.id }, { key: "m", header: "Mandate", align: "right", render: (r: Any) => r.mandate }, { key: "r", header: "Rate", align: "right", render: (r: Any) => fmtInr(r.rate) }, { key: "h", header: "Hours/FTE", render: (r: Any) => r.hoursRaw }, { key: "mo", header: "Month (raw)", render: (r: Any) => r.monthRaw }, { key: "s", header: "Status", render: (r: Any) => (r.superseded ? "Superseded" : "Current") }, { key: "t", header: "Uploaded", render: (r: Any) => fmtStamp(r.insertedAt) }]} />
      </Section>
      <Section title="Audit trail (upload batch)">{d.audit.length ? <AuditTable rows={d.audit} /> : <None />}</Section>
    </>
  );
}

function SourceBody({ d }: { d: Any }) {
  return (
    <>
      <Section title="Table"><Grid2><Stat label="Rows" value={fmtN(d.rows)} /><Stat label="Date column" value={d.dateColumn} /><Stat label="Upload batches" value={String(d.batches.length)} /></Grid2></Section>
      <Section title="Upload batches (audit trail)">
        <DataTable rows={d.batches as Any[]} rowKey={(r: Any) => r.batch}
          cols={[
            { key: "b", header: "Batch", render: (r: Any) => <span className="font-mono text-[10px]">{r.batch}</span> }, { key: "n", header: "Rows", align: "right", render: (r: Any) => fmtNum(r.rows) },
            { key: "t", header: "Uploaded", render: (r: Any) => fmtStamp(r.insertedAt) }, { key: "f", header: "First date", render: (r: Any) => (r.firstDate ? fmtDate(r.firstDate) : "—") }, { key: "l", header: "Last date", render: (r: Any) => (r.lastDate ? fmtDate(r.lastDate) : "—") },
            { key: "s", header: "Serial dates", align: "right", render: (r: Any) => fmtNum(r.serialDateRows) }, { key: "x", header: "Text dates", align: "right", render: (r: Any) => fmtNum(r.textDateRows) }, { key: "u", header: "Unparsed", align: "right", render: (r: Any) => fmtNum(r.unparsedDates) },
          ]} />
      </Section>
      <Section title="Columns - blank rate">
        <DataTable rows={d.columns as Any[]} rowKey={(r: Any) => r.name} maxHeight="max-h-[520px]"
          cols={[{ key: "c", header: "Column", render: (r: Any) => r.name }, { key: "t", header: "Type", render: (r: Any) => r.type }, { key: "b", header: "Blank rows", align: "right", render: (r: Any) => fmtNum(r.blankRows) }, { key: "p", header: "Blank %", align: "right", render: (r: Any) => fmtPct(r.blankPct) }]} />
      </Section>
    </>
  );
}
