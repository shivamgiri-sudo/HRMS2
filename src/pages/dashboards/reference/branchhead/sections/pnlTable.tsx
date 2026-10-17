import type { ProcessPnlRow } from "../../../../../../backend/src/modules/branch-head-health/types";
import { formatInr, formatPct } from "../format";
import { AccentCard, BarCell, Chip, NavyTable, PAL, type ChipTone } from "../look";

const STATUS: Record<ProcessPnlRow["status"], { word: string; tone: ChipTone }> = {
  "loss-making": { word: "Loss-making", tone: "crit" }, "at-risk": { word: "At risk", tone: "warn" }, profitable: { word: "Profitable", tone: "ok" },
};

/** Every active process's P&L in the navy table look, worst first; a row opens the process drawer. */
export function PnlTable({ rows, onOpen }: { rows: ProcessPnlRow[]; onOpen: (processId: string) => void }) {
  return (
    <AccentCard title="Process P&L table" chip={`${rows.length} processes · worst first`} accent="violet">
      <NavyTable<ProcessPnlRow> caption="Process P&L by process, worst operating profit first" rows={rows} limit={10} empty="No active processes"
        onRowClick={(r) => onOpen(r.processId)} rowLabel={(r) => r.processName}
        columns={[
          { key: "p", label: "Process", render: (r) => <span className="font-semibold">{r.processName}</span> },
          { key: "c", label: "Client", render: (r) => r.clientName ?? "—" },
          { key: "s", label: "Status", render: (r) => <Chip tone={STATUS[r.status].tone}>{STATUS[r.status].word}</Chip> },
          { key: "r", label: "Revenue", num: true, render: (r) => formatInr(r.revenue) },
          { key: "pc", label: "People cost", num: true, render: (r) => formatInr(r.peopleCost) },
          { key: "oc", label: "Other cost", num: true, render: (r) => formatInr(r.otherCost) },
          { key: "op", label: "Operating profit", num: true, render: (r) => <strong>{formatInr(r.operatingProfit)}</strong> },
          { key: "pct", label: "OP %", num: true, render: (r) => formatPct(r.opPct) },
          { key: "f", label: "Seat fill", num: true, render: (r) => <BarCell pct={r.seatFillPct} text={formatPct(r.seatFillPct)} color={PAL.s1} /> },
          { key: "o", label: "Receivable", num: true, render: (r) => formatInr(r.outstandingReceivable) },
        ]} />
    </AccentCard>
  );
}
