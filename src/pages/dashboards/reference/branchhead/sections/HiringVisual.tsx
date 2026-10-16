import { ClipboardList } from "lucide-react";
import { BarList, ChartFrame, Funnel, Meter, StackedBar, StatTile, barListTable, funnelTable, meterTable, stackedBarTable, type BarListProps, type FunnelProps, type MeterProps, type StackedBarProps, type TableSpec } from "../viz";
import type { HiringData } from "../panelTypes";
import { formatCount, formatPct } from "../format";
import { SectionShell } from "../ui";
import { extendTable, Grid, nn, selectByName, TileItem, Tiles, type VisualProps } from "./shared";

const OFFER_EXTRA = ["Not joined", "Conversion (reported)"];

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
  // Four colour slots: no-show, client round and on hold fold into "Other"; their counts stay in the table.
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

export function HiringVisual({ overview, payload, onSelect }: VisualProps) {
  return (
    <SectionShell<HiringData> title="Hiring" section={overview.hiring} emptyText="No hiring data for this date">
      {(d) => {
        const b = buildHiring(d);
        const a = d.ats;
        const pick = selectByName(payload, onSelect, "hiring");
        return (
          <div className="space-y-3">
            <Tiles label="Hiring summary">
              <TileItem><StatTile label="Open positions" value={formatCount(d.openPositions)} /></TileItem>
              <TileItem><StatTile label="Pending approval" value={formatCount(d.pendingApproval)} /></TileItem>
              {d.offers ? <TileItem><StatTile label="Joining in next 7 days" value={formatCount(d.offers.joiningNext7Days)} /></TileItem> : null}
            </Tiles>
            <Grid>
              <ChartFrame title="Hiring funnel" subtitle="Requested to fulfilled" table={b.funnelTable} height={140}>
                <Funnel {...b.funnel} />
              </ChartFrame>
              <ChartFrame title="Offer conversion" subtitle="Joined of offered" table={b.offersTable} height={96}>
                {b.offers.length ? <div className="space-y-3">{b.offers.map((m) => <Meter key={m.label} {...m} />)}</div>
                  : <p className="text-[13px] text-slate-700">No offer data.</p>}
              </ChartFrame>
            </Grid>
            <ChartFrame title="Open batches" subtitle="Open positions per batch; marker = in pipeline" table={b.batchesTable} height={96}>
              {b.batches.items.length ? (
                <BarList {...b.batches} onSelect={(id) => pick(d.batches[Number(id.slice(6))]?.process ?? "")} />
              ) : <p className="text-[13px] text-slate-700">No open batches.</p>}
            </ChartFrame>
            {a ? (
              <div className="space-y-3">
                <Tiles label="Interview pipeline">
                  <TileItem><StatTile label="Walk-ins" value={formatCount(a.walkins)} /></TileItem>
                  <TileItem><StatTile label="Tokens" value={formatCount(a.tokens)} hint={`Closed: ${formatCount(a.tokensClosed)}`} /></TileItem>
                  <TileItem><StatTile label="SLA breaches" value={`${formatCount(a.slaBreaches)} of ${formatCount(a.slaTotal)}`} /></TileItem>
                  <TileItem><StatTile label="No feedback filed" value={formatCount(a.noFeedback)} /></TileItem>
                </Tiles>
                <ChartFrame title="Interview pipeline (ATS)" subtitle="Tokens by outcome" table={b.atsTable} height={72}>
                  <StackedBar {...b.ats} />
                </ChartFrame>
              </div>
            ) : null}
            {d.pendingActions.length > 0 ? (
              <ul aria-label="Pending actions" className="flex list-none flex-wrap gap-2 p-0">
                {d.pendingActions.map((x) => (
                  <li key={x.type} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-3 text-[12px] text-slate-900">
                    <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />{`${formatCount(x.count)} ${x.label}`}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      }}
    </SectionShell>
  );
}
