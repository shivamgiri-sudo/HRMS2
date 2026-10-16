import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ProcessPnlData, ProcessPnlRow, SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import { formatInr, formatPct } from "./format";
import { Note, SectionShell, Table, Td, type Col } from "./ui";

const VISIBLE = 8;
const STATUS = {
  "loss-making": { label: "Loss-making", Icon: AlertOctagon, cls: "text-rose-900" },
  "at-risk": { label: "At risk", Icon: AlertTriangle, cls: "text-amber-900" },
  profitable: { label: "Profitable", Icon: CheckCircle2, cls: "text-emerald-900" },
} as const;

const COLS: Col[] = [
  { label: "Process" }, { label: "Status" }, { label: "Revenue", right: true }, { label: "People cost", right: true },
  { label: "Other cost", right: true }, { label: "Operating profit", right: true }, { label: "OP %", right: true },
  { label: "Seat fill", right: true }, { label: "Receivable", right: true },
];

function StatusLabel({ status }: { status: ProcessPnlRow["status"] }) {
  const { label, Icon, cls } = STATUS[status];
  return <span className={`inline-flex items-center gap-1 font-semibold ${cls}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</span>;
}

const Row = ({ r }: { r: ProcessPnlRow }) => (
  <tr>
    <Td strong>{r.processName}{r.clientName ? <span className="block text-[12px] font-normal text-slate-700">{r.clientName}</span> : null}</Td>
    <Td><StatusLabel status={r.status} /></Td>
    <Td right>{formatInr(r.revenue)}</Td><Td right>{formatInr(r.peopleCost)}</Td><Td right>{formatInr(r.otherCost)}</Td>
    <Td right strong>{formatInr(r.operatingProfit)}</Td><Td right>{formatPct(r.opPct)}</Td>
    <Td right>{formatPct(r.seatFillPct)}</Td><Td right>{formatInr(r.outstandingReceivable)}</Td>
  </tr>
);

export function ProcessPnlPanel({ section }: { section?: SectionResult<ProcessPnlData> }) {
  const period = section?.status === "ok" && section.data ? section.data.period : "";
  return (
    <SectionShell<ProcessPnlData>
      title={`Process P&L - P&L pages basis, ${period || "current month"}`} section={section}
      emptyText="No process P&L for this branch" errorName="Process P&L"
    >
      {(d) => {
        // Rows with no revenue and no cost (billing mirrors etc.) are noise: folded away below the table.
        const idle = (r: ProcessPnlRow) => r.revenue === 0 && r.peopleCost === 0 && r.otherCost === 0;
        const active = d.rows.filter((r) => !idle(r));
        const idleRows = d.rows.filter(idle);
        const first = active.slice(0, VISIBLE);
        const rest = active.slice(VISIBLE);
        const t = d.totals;
        const people = active.reduce((a, r) => a + r.peopleCost, 0);
        const other = active.reduce((a, r) => a + r.otherCost, 0);
        return (
          <>
            <p className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-semibold text-slate-900">
              <span className="inline-flex items-center gap-1 text-rose-900"><AlertOctagon className="h-4 w-4" aria-hidden="true" />{t.loss} loss-making</span>
              <span className="inline-flex items-center gap-1 text-amber-900"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{t.atRisk} at risk</span>
              <span className="inline-flex items-center gap-1 text-emerald-900"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t.profitable} profitable</span>
            </p>
            <Table
              caption="Process P&L, worst operating profit first" cols={COLS} minWidth={860}
              foot={(
                <tr className="font-bold text-slate-900">
                  <Td strong>Total ({active.length} processes)<span className="block text-[12px] font-normal">Total cost {formatInr(people + other)}</span></Td><Td>{" "}</Td><Td right>{formatInr(t.revenue)}</Td>
                  <Td right>{formatInr(people)}</Td><Td right>{formatInr(other)}</Td><Td right strong>{formatInr(t.operatingProfit)}</Td>
                  <Td right>{formatPct(t.opPct)}</Td><Td>{" "}</Td><Td right>{formatInr(t.outstandingReceivable)}</Td>
                </tr>
              )}
            >
              {first.map((r) => <Row key={r.processId} r={r} />)}
            </Table>
            {rest.length > 0 ? (
              <details className="mt-3 rounded-lg border border-slate-200">
                <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-[13px] font-bold text-slate-900">Show all {active.length} processes</summary>
                <div className="p-3">
                  <Table caption="Remaining processes, continuing the order above" cols={COLS} minWidth={860}>
                    {rest.map((r) => <Row key={r.processId} r={r} />)}
                  </Table>
                </div>
              </details>
            ) : null}
            {idleRows.length > 0 ? (
              <details className="mt-3 text-[13px] text-slate-900">
                <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold">
                  {idleRows.length} {idleRows.length === 1 ? "process has" : "processes have"} no P&amp;L activity this month
                </summary>
                <ul className="list-disc pl-6">{idleRows.map((r) => <li key={r.processId}>{r.processName}</li>)}</ul>
              </details>
            ) : null}
            <Note>Uses the same calculation as the Process P&amp;L pages, so it can differ from the month-to-date running figures above.</Note>
          </>
        );
      }}
    </SectionShell>
  );
}
