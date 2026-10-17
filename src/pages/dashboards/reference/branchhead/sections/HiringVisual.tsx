import { Briefcase, ClipboardCheck, Footprints, Hourglass, Ticket, Timer, UserCheck, UserPlus } from "lucide-react";
import { barListTable, funnelTable, meterTable, stackedBarTable, type BarListProps, type FunnelProps, type MeterProps, type StackedBarProps, type TableSpec } from "../viz";
import type { HiringData } from "../panelTypes";
import { formatCount, formatPct } from "../format";
import { BarsChart, ChartCard, EmptyLine, GradientKpi, KpiCell, KpiGrid, PAL, SectionGate } from "../look";
import { BatchesTable, OffersCard } from "./hiringParts";
import { extendTable, nn, selectByName, type VisualProps } from "./shared";

const OFFER_EXTRA = ["Not joined", "Conversion (reported)"];

/** Batch bar id -> its process name (the bars are keyed by index, so names can repeat). */
export function batchProcessIndex(items: ReadonlyArray<{ id: string }>, batches: HiringData["batches"]): Map<string, string> {
  return new Map(items.map((it, i) => [it.id, batches[i]?.process ?? ""]));
}

/** Chart props and table twins: funnel, offer meters, batches (open vs pipeline) and ATS outcomes. */
export function buildHiring(d: HiringData) {
  const funnel: FunnelProps = {
    label: "Hiring funnel",
    stages: [
      { id: "requested", label: "Requested", value: nn(d.requested) },
      { id: "pipeline", label: "In pipeline", value: nn(d.inPipeline) },
      { id: "selected", label: "Selected", value: nn(d.selected) },
      { id: "fulfilled", label: "Fulfilled", value: nn(d.fulfilled) },
    ],
  };
  const windows = d.offers ? [["Offer conversion, last 30 days", d.offers.last30], ["Offer conversion, month to date", d.offers.mtd]] as const : [];
  const offers: MeterProps[] = windows.map(([label, w]) => ({ label, value: nn(w.joined), limit: nn(w.offered), format: formatCount }));
  const offersTable: TableSpec = {
    caption: "Offer conversion by window",
    columns: ["Measure", "Joined", "Offered", "Share", "Status", ...OFFER_EXTRA],
    rows: offers.map((m, i) => [...meterTable(m).rows[0], formatCount(windows[i][1].notJoined), formatPct(windows[i][1].conversionPct)]),
  };
  const list = d.batches ?? [];
  const batches: BarListProps = {
    label: "Open positions by batch, with the pipeline as a marker",
    markerLabel: "In pipeline",
    format: formatCount,
    items: list.map((b, i) => {
      const short = nn(b.openPositions) - nn(b.inPipeline);
      const due = `due ${b.deliveryDate} (${b.daysToDelivery} days), ${b.priority} priority`;
      return {
        id: `batch-${i}`, label: `${b.process} - ${b.designation}`, value: nn(b.openPositions), marker: nn(b.inPipeline),
        note: short > 0 ? `Pipeline short by ${formatCount(short)}, ${due}` : `Pipeline covers open positions, ${due}`,
      };
    }),
  };
  const batchesTable = extendTable(barListTable(batches), ["Requested", "Fulfilled", "Selected", "Delivery", "Batch"],
    (i) => [formatCount(list[i].requested), formatCount(list[i].fulfilled), formatCount(list[i].selected), `${list[i].deliveryDate} (${list[i].daysToDelivery} days)`, list[i].plannedBatch ?? "—"]);
  const a = d.ats;
  const ats: StackedBarProps = {
    label: "Interview tokens by outcome",
    series: [
      { key: "selected", label: "Selected" }, { key: "rejected", label: "Rejected" }, { key: "open", label: "Open" },
      { key: "noShow", label: "No-show" }, { key: "clientRound", label: "Client round" }, { key: "hold", label: "On hold" },
    ],
    rows: a ? [{ id: "tokens", label: "Tokens", segments: [
      { key: "selected", value: nn(a.selected) }, { key: "rejected", value: nn(a.rejected) }, { key: "open", value: nn(a.open) },
      { key: "noShow", value: nn(a.noShow) }, { key: "clientRound", value: nn(a.clientRound) }, { key: "hold", value: nn(a.hold) },
    ] }] : [],
  };
  const atsTable = extendTable(stackedBarTable(ats), ["No-show", "Client round", "On hold"], () => (a ? [formatCount(a.noShow), formatCount(a.clientRound), formatCount(a.hold)] : []));
  return { funnel, funnelTable: funnelTable(funnel), offers, offersTable, batches, batchesTable, ats, atsTable };
}

/** Email section 4 outcome order: decided, then still with someone, then closure pending and no feedback. */
export function atsOutcomes(a: NonNullable<HiringData["ats"]>) {
  return [
    { outcome: "Selected", count: nn(a.selected), group: "decided" }, { outcome: "Rejected", count: nn(a.rejected), group: "decided" },
    { outcome: "No-show", count: nn(a.noShow), group: "decided" }, { outcome: "Client round", count: nn(a.clientRound), group: "waiting" },
    { outcome: "On hold", count: nn(a.hold), group: "waiting" }, { outcome: "Other closed", count: nn(a.otherClosed), group: "decided" },
    { outcome: "Closure pending", count: nn(a.open), group: "waiting" }, { outcome: "No feedback", count: nn(a.noFeedback), group: "waiting" },
  ];
}

/** Hiring tab: email sections 4 (ATS today) and 8 (open hiring batches), plus offers and open positions. */
export function HiringVisual(props: VisualProps) {
  const { overview } = props;
  return (
    <SectionGate<HiringData> title="Hiring" section={overview.hiring} emptyText="No hiring data for this date" accent="cyan">
      {(d) => {
        const b = buildHiring(d);
        const a = d.ats;
        const pick = selectByName(props, "hiring");
        const outcomes = a ? atsOutcomes(a) : [];
        return (
          <div className="space-y-4">
            <KpiGrid label="Hiring summary">
              <KpiCell><GradientKpi icon={Briefcase} hue="navy" label="Open positions" value={formatCount(d.openPositions)} sub={`${formatCount(d.requested)} requested, ${formatCount(d.fulfilled)} fulfilled`} /></KpiCell>
              <KpiCell><GradientKpi icon={Hourglass} hue="violet" label="In pipeline" value={formatCount(d.inPipeline)} sub={`${formatCount(d.selected)} selected · ${formatCount(d.pendingApproval)} pending approval`} /></KpiCell>
              <KpiCell><GradientKpi icon={UserPlus} hue="emerald" label="Joining in next 7 days" value={d.offers ? formatCount(d.offers.joiningNext7Days) : "—"}
                sub={d.offers ? `MTD conversion ${formatPct(d.offers.mtd.conversionPct)}` : "No offer data"} /></KpiCell>
              <KpiCell><GradientKpi icon={Timer} hue="orange" label="SLA breaches today" value={a ? `${formatCount(a.slaBreaches)} / ${formatCount(a.slaTotal)}` : "—"}
                sub={a ? `${formatCount(a.noFeedback)} with no feedback filed` : "No ATS data"} status={a && a.slaBreaches > 0 ? "warning" : null} /></KpiCell>
            </KpiGrid>
            {a ? (
              <KpiGrid label="Interview pipeline today" cols={4}>
                <KpiCell><GradientKpi icon={Footprints} hue="cyan" label="Walk-ins" value={formatCount(a.walkins)} sub="Came in today" /></KpiCell>
                <KpiCell><GradientKpi icon={Ticket} hue="indigo" label="Tokens" value={formatCount(a.tokens)} sub={`Closed: ${formatCount(a.tokensClosed)}`} /></KpiCell>
                <KpiCell><GradientKpi icon={UserCheck} hue="teal" label="Selected" value={formatCount(a.selected)} sub={`${formatCount(a.rejected)} rejected · ${formatCount(a.noShow)} no-show`} /></KpiCell>
                <KpiCell><GradientKpi icon={ClipboardCheck} hue="amber" label="Closure pending" value={formatCount(a.open)} sub={`${formatCount(a.openQueueCompleted)} completed from the open queue`} /></KpiCell>
              </KpiGrid>
            ) : null}
            <div className="bhl-grid bhl-grid-3">
              <ChartCard title="ATS today: tokens by outcome" chip={a ? `${formatCount(a.tokens)} tokens` : "no ATS data"} accent="cyan" className="bhl-span-2"
                table={{ caption: "Interview tokens by outcome today", columns: ["Outcome", "Count"], rows: outcomes.map((o) => [o.outcome, formatCount(o.count)]) }}>
                {a ? (
                  <BarsChart label={`Tokens by outcome: ${outcomes.map((o) => `${o.outcome} ${o.count}`).join(", ")}`} xKey="outcome" height={260}
                    data={outcomes.map((o) => ({ outcome: o.outcome, decided: o.group === "decided" ? o.count : null, waiting: o.group === "waiting" ? o.count : null }))}
                    series={[{ key: "decided", label: "Decided", color: PAL.s1, stack: "o" }, { key: "waiting", label: "Still open", color: PAL.s4, stack: "o" }]} />
                ) : <EmptyLine text="No ATS activity for this date" />}
              </ChartCard>
              <ChartCard title="Hiring funnel" chip="Requested to fulfilled" accent="emerald" table={b.funnelTable}>
                <BarsChart label={`${b.funnel.label}: ${b.funnel.stages.map((x) => `${x.label} ${x.value}`).join(", ")}`} xKey="stage" horizontal height={240}
                  data={b.funnel.stages.map((x) => ({ stage: x.label, count: x.value }))} series={[{ key: "count", label: "Positions", color: PAL.s1 }]} />
              </ChartCard>
            </div>
            <BatchesTable d={d} onProcess={pick} />
            <div className="bhl-grid bhl-grid-2">
              <ChartCard title="Open positions vs pipeline by batch" chip={`${d.batches.length} batches`} accent="orange" table={b.batchesTable}>
                {d.batches.length ? (
                  <BarsChart label={b.batches.label} xKey="batch" height={240}
                    data={d.batches.map((x) => ({ batch: x.process, open: x.openPositions, pipeline: x.inPipeline, selected: x.selected }))}
                    series={[{ key: "open", label: "Open", color: PAL.s2 }, { key: "pipeline", label: "In pipeline", color: PAL.s1 }, { key: "selected", label: "Selected", color: PAL.s3 }]} />
                ) : <EmptyLine text="No open batches" />}
              </ChartCard>
              <OffersCard d={d} offersTable={b.offersTable} />
            </div>
          </div>
        );
      }}
    </SectionGate>
  );
}
