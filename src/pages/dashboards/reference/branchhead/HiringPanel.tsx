import type { SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import type { HiringData, OfferWindow } from "./panelTypes";
import { formatCount, formatPct } from "./format";
import { SectionShell, Stat, Stats, SubHead, Table, Td } from "./ui";

const offerRow = (label: string, w: OfferWindow) => (
  <tr key={label}><Td strong>{label}</Td><Td right>{w.offered}</Td><Td right>{w.joined}</Td><Td right>{w.notJoined}</Td><Td right>{formatPct(w.conversionPct)}</Td></tr>
);

export function HiringPanel({ section }: { section?: SectionResult<unknown> }) {
  return (
    <SectionShell<HiringData> title="Hiring" section={section} emptyText="No hiring data for this date">
      {(d) => (
        <>
          <Stats label="Hiring summary">
            <Stat label="Open positions" value={formatCount(d.openPositions)} />
            <Stat label="In pipeline" value={formatCount(d.inPipeline)} />
            <Stat label="Selected" value={formatCount(d.selected)} />
            <Stat label="Requested" value={formatCount(d.requested)} hint={`Fulfilled: ${formatCount(d.fulfilled)}`} />
            <Stat label="Pending approval" value={formatCount(d.pendingApproval)} />
          </Stats>
          <SubHead>Open batches</SubHead>
          {d.batches.length === 0 ? <p className="text-[13px] text-slate-700">No open batches.</p> : (
            <Table caption="Open hiring batches" cols={[{ label: "Process" }, { label: "Designation" }, { label: "Priority" }, { label: "Requested", right: true }, { label: "Fulfilled", right: true }, { label: "Open", right: true }, { label: "In pipeline", right: true }, { label: "Selected", right: true }, { label: "Delivery" }, { label: "Batch" }]} minWidth={760}>
              {d.batches.map((b, i) => (
                <tr key={i}><Td strong>{b.process}</Td><Td>{b.designation}</Td><Td>{b.priority}</Td><Td right>{b.requested}</Td><Td right>{b.fulfilled}</Td><Td right>{b.openPositions}</Td><Td right>{b.inPipeline}</Td><Td right>{b.selected}</Td><Td>{b.deliveryDate} ({b.daysToDelivery} days)</Td><Td>{b.plannedBatch ?? "—"}</Td></tr>
              ))}
            </Table>
          )}
          {d.offers ? (
            <>
              <SubHead>Offer conversion</SubHead>
              <Table caption="Offer conversion by window" cols={[{ label: "Window" }, { label: "Offered", right: true }, { label: "Joined", right: true }, { label: "Not joined", right: true }, { label: "Conversion", right: true }]} minWidth={400}>
                {[offerRow("Last 30 days", d.offers.last30), offerRow("Month to date", d.offers.mtd)]}
              </Table>
              <p className="mt-2 text-[13px] text-slate-800">Joining in next 7 days: <strong>{formatCount(d.offers.joiningNext7Days)}</strong></p>
            </>
          ) : null}
          {d.ats ? (
            <>
              <SubHead>Interview pipeline (ATS)</SubHead>
              <Stats label="ATS aggregates">
                <Stat label="Walk-ins" value={formatCount(d.ats.walkins)} />
                <Stat label="Tokens" value={formatCount(d.ats.tokens)} hint={`Closed: ${formatCount(d.ats.tokensClosed)}`} />
                <Stat label="Selected" value={formatCount(d.ats.selected)} />
                <Stat label="Rejected" value={formatCount(d.ats.rejected)} />
                <Stat label="No-show" value={formatCount(d.ats.noShow)} />
                <Stat label="Client round" value={formatCount(d.ats.clientRound)} />
                <Stat label="On hold" value={formatCount(d.ats.hold)} />
                <Stat label="Open, no outcome" value={formatCount(d.ats.open)} />
                <Stat label="No feedback filed" value={formatCount(d.ats.noFeedback)} />
                <Stat label="SLA breaches" value={`${formatCount(d.ats.slaBreaches)} of ${formatCount(d.ats.slaTotal)}`} />
              </Stats>
            </>
          ) : null}
          {d.pendingActions.length > 0 ? (
            <>
              <SubHead>Pending actions</SubHead>
              <ul className="space-y-1 text-[13px] text-slate-800">{d.pendingActions.map((a) => <li key={a.type}><strong>{a.count}</strong> {a.label}</li>)}</ul>
            </>
          ) : null}
        </>
      )}
    </SectionShell>
  );
}
