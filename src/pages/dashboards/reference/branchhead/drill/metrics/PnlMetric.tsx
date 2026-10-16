import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ProcessPnlData, ProcessPnlRow } from "../../../../../../../backend/src/modules/branch-head-health/types";
import { formatInr, formatPct } from "../../format";
import { pnlSelect } from "../../sections/ProcessPnlVisual";
import { branchProcesses } from "../../sections/shared";
import { SectionGate } from "../parts";
import { ariaSort, sortPnlRows, type PnlSortKey, type SortDir } from "./pnlSort";
import type { MetricProps } from "./common";

const STATUS_WORD: Record<ProcessPnlRow["status"], string> = { "loss-making": "Loss-making", "at-risk": "At risk", profitable: "Profitable" };
const COLS: Array<[PnlSortKey, string, (r: ProcessPnlRow) => string]> = [
  ["revenue", "Revenue", (r) => formatInr(r.revenue)],
  ["people", "People cost", (r) => formatInr(r.peopleCost)],
  ["other", "Other cost", (r) => formatInr(r.otherCost)],
  ["op", "Operating profit", (r) => formatInr(r.operatingProfit)],
  ["opPct", "OP %", (r) => formatPct(r.opPct)],
  ["status", "Status", (r) => STATUS_WORD[r.status] ?? r.status],
];
const BTN = "inline-flex min-h-[44px] items-center gap-1 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

/** Every process row, sortable by any money column or status (worst operating profit first by default). */
export function PnlTable({ rows, onPick }: { rows: ProcessPnlRow[]; onPick: (row: ProcessPnlRow) => void }) {
  const [sort, setSort] = useState<{ key: PnlSortKey; dir: SortDir }>({ key: "op", dir: "asc" });
  const sorted = sortPnlRows(rows, sort.key, sort.dir);
  const flip = (key: PnlSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "op" || key === "opPct" || key === "status" ? "asc" : "desc" }));
  return (
    <div className="bh-table-wrap overflow-x-auto">
      <table className="bh-table w-full min-w-[640px]">
        <caption>Process P&amp;L, all processes (select a header to sort, a process to open it)</caption>
        <thead>
          <tr>
            <th scope="col">Process</th>
            {COLS.map(([key, label]) => {
              const state = ariaSort(key, sort.key, sort.dir);
              const Icon = state === "ascending" ? ArrowUp : state === "descending" ? ArrowDown : ArrowUpDown;
              return (
                <th key={key} scope="col" aria-sort={state}><button type="button" className={BTN} onClick={() => flip(key)}>
                  {label}<Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </button></th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length ? sorted.map((r) => (
            <tr key={r.processId}>
              <th scope="row"><button type="button" className={`${BTN} text-left underline-offset-2 hover:underline`} onClick={() => onPick(r)}>{r.processName}</button></th>
              {COLS.map(([key, , fmt]) => <td key={key}>{fmt(r)}</td>)}
            </tr>
          )) : <tr><td colSpan={COLS.length + 1}>No processes</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function PnlMetric(props: MetricProps) {
  const branchId = props.overview.branch.branchId;
  const scoped = branchProcesses(props.payload, branchId);
  return (
    <SectionGate<ProcessPnlData> name="Process P&L" section={props.overview.processPnl} empty="No process P&L for this branch">
      {(d) => <PnlTable rows={d.rows} onPick={(row) => pnlSelect(row, scoped, props.onOpen, branchId)} />}
    </SectionGate>
  );
}
