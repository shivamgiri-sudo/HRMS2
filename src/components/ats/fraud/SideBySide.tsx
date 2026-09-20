import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import type { Cell, CompareRow, RowState, Source } from "@/lib/fraudReview";

const SOURCE_STYLE: Record<Source, string> = {
  govt: "bg-emerald-50 text-emerald-700",
  typed: "bg-slate-100 text-slate-600",
  photo: "bg-amber-50 text-amber-700",
  system: "bg-blue-50 text-blue-700",
};
const SOURCE_LABEL: Record<Source, string> = {
  govt: "Government verified",
  typed: "Typed by candidate",
  photo: "Read from photo, may be wrong",
  system: "Our records",
};

export function SourceBadge({ source }: { source: Source }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-semibold ${SOURCE_STYLE[source]}`}>
      {source === "govt" && <ShieldCheck className="h-3 w-3" aria-hidden="true" />}
      {SOURCE_LABEL[source]}
    </span>
  );
}

const STATE_STYLE: Record<RowState, string> = {
  same: "bg-emerald-50 text-emerald-700",
  diff: "bg-red-50 text-red-700",
  na: "bg-slate-100 text-slate-500",
};
const STATE_LABEL: Record<RowState, string> = { same: "Same", diff: "Different", na: "No data" };

function ValueCell({ cell }: { cell: Cell | null }) {
  if (!cell) return <span className="text-slate-400">Not available</span>;
  const isNumber = /\d/.test(cell.value);
  return (
    <div className="space-y-0.5">
      <span className={`block font-semibold text-slate-900 ${isNumber ? "font-mono" : ""}`}>{cell.value}</span>
      <SourceBadge source={cell.source} />
    </div>
  );
}

export interface ColumnHeader {
  title: string;
  sub?: string;
}

interface Props {
  left: ColumnHeader;
  right: ColumnHeader;
  rows: CompareRow[];
  /** Photos of the same people, shown above the table so faces and facts sit together. */
  photos?: ReactNode;
}

export function SideBySide({ left, right, rows, photos }: Props) {
  return (
    <section aria-label="Side by side" className="space-y-3">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Side by side</h3>
      {photos}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <SourceBadge source="govt" />
        <SourceBadge source="typed" />
        <SourceBadge source="photo" />
        <SourceBadge source="system" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
              <th className="p-2.5" />
              <th className="p-2.5">
                {left.title}
                {left.sub && <span className="block font-normal">{left.sub}</span>}
              </th>
              <th className="p-2.5">
                {right.title}
                {right.sub && <span className="block font-normal">{right.sub}</span>}
              </th>
              <th className="p-2.5 text-center" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={`border-b border-slate-100 last:border-0 ${r.state === "diff" && r.weight > 0 ? "bg-red-50/50" : ""}`}>
                <td className="w-28 p-2.5 align-top text-slate-500">{r.label}</td>
                <td className="p-2.5 align-top"><ValueCell cell={r.left} /></td>
                <td className="p-2.5 align-top"><ValueCell cell={r.right} /></td>
                <td className="w-24 p-2.5 text-center align-top">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${STATE_STYLE[r.state]}`}>{STATE_LABEL[r.state]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
