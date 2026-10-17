import type { TableSpec } from "../viz";
import type { HiringData } from "../panelTypes";
import { formatCount, formatPct } from "../format";
import { AccentCard, BarCell, BarsChart, ChartCard, Chip, EmptyLine, NavyTable, PAL, type ChipTone } from "../look";
import { nn } from "./shared";

type Batch = HiringData["batches"][number];

const PRIORITY: Record<string, ChipTone> = { high: "crit", critical: "crit", urgent: "crit", medium: "warn", low: "mute" };
export const fillPct = (b: Pick<Batch, "fulfilled" | "requested">) => (nn(b.requested) > 0 ? (nn(b.fulfilled) / nn(b.requested)) * 100 : null);

/** Email section 8: open hiring batches with a fill progress bar, pipeline cover and delivery. */
export function BatchesTable({ d, onProcess }: { d: HiringData; onProcess: (name: string) => void }) {
  const list = [...(d.batches ?? [])].sort((a, b) => a.daysToDelivery - b.daysToDelivery);
  return (
    <AccentCard title="Open hiring batches" chip={`${list.length} batches · ${formatCount(d.openPositions)} open`} accent="blue">
      <NavyTable<Batch> caption="Open hiring batches whose delivery date is still ahead" rows={list} limit={10} empty="No open batches"
        onRowClick={(b) => onProcess(b.process)} rowLabel={(b) => `${b.process} ${b.designation}`}
        columns={[
          { key: "p", label: "Process", render: (b) => <span className="font-semibold">{b.process}</span> },
          { key: "d", label: "Role", render: (b) => b.designation },
          { key: "pr", label: "Priority", render: (b) => <Chip tone={PRIORITY[String(b.priority).toLowerCase()] ?? "mute"}>{b.priority}</Chip> },
          { key: "f", label: "Filled", num: true, render: (b) => <BarCell pct={fillPct(b)} text={`${formatCount(b.fulfilled)} / ${formatCount(b.requested)}`} color={PAL.s3} /> },
          { key: "o", label: "Open", num: true, render: (b) => formatCount(b.openPositions) },
          { key: "pi", label: "Pipeline", num: true, render: (b) => formatCount(b.inPipeline) },
          { key: "s", label: "Selected", num: true, render: (b) => formatCount(b.selected) },
          { key: "c", label: "Cover", render: (b) => {
            const short = nn(b.openPositions) - nn(b.inPipeline);
            return short > 0 ? <Chip tone="warn">Short by {formatCount(short)}</Chip> : <Chip tone="ok">Covered</Chip>;
          } },
          { key: "dl", label: "Delivery", render: (b) => <span className="tabular-nums">{b.deliveryDate} ({b.daysToDelivery} d)</span> },
          { key: "b", label: "Batch", render: (b) => b.plannedBatch ?? "—" },
        ]} />
    </AccentCard>
  );
}

/** Offers made vs joined per window (the People tab carries the same windows as section 7's table). */
export function OffersCard({ d, offersTable }: { d: HiringData; offersTable: TableSpec }) {
  const o = d.offers;
  return (
    <ChartCard title="Offers made and joined" chip={o ? `${formatCount(o.joiningNext7Days)} joining in 7 days` : "no offers"} accent="violet" table={offersTable}>
      {o ? (
        <BarsChart label="Offered, joined and not joined by window, with the conversion %" xKey="window" height={240} rightFormat={(v) => `${v}%`}
          data={[{ window: "Last 30 days", ...o.last30 }, { window: "Month to date", ...o.mtd }].map((w) => ({ window: w.window, offered: w.offered, joined: w.joined, notJoined: w.notJoined, conv: w.conversionPct }))}
          series={[{ key: "offered", label: "Offered", color: PAL.s1 }, { key: "joined", label: "Joined", color: PAL.s3 }, { key: "notJoined", label: "Not joined", color: PAL.s2 },
            { key: "conv", label: "Conversion %", color: PAL.s4, kind: "line", axis: "right" }]} />
      ) : <EmptyLine text="No offer data" />}
      {o ? <p className="bhl-note">Conversion: last 30 days {formatPct(o.last30.conversionPct)}, month to date {formatPct(o.mtd.conversionPct)}.</p> : null}
    </ChartCard>
  );
}
