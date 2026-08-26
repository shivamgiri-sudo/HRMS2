import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi, getHrmsApiErrorStatus, type HrmsEnvelope } from "@/lib/hrmsApi";
import { ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import KpiCellDetail from "./KpiCellDetail";

/**
 * Process → manager → agent, one KPI cell layout at every depth.
 *
 * Sub-rows are fetched only when a row is actually expanded. Fetching the whole
 * org tree up front would mean three round trips over ~1,100 employees and 40
 * processes before the first paint, for rows most users never open.
 */

export type Availability = "ok" | "no_data" | "not_tracked";

export interface SectionValue {
  key: string;
  label: string;
  unit: "percent" | "count" | "seconds" | "currency" | null;
  value: number | null;
  availability: Availability;
  note?: string;
  direction: "higher_is_better" | "lower_is_better" | null;
  hasRootCause: boolean;
}

export interface PerformanceRow {
  grain: "process" | "manager" | "agent";
  id: string;
  name: string;
  subtitle: string | null;
  childCount: number | null;
  sections: SectionValue[];
}

export interface PerfQuery {
  from: string;
  to: string;
  processId?: string | null;
  managerId?: string | null;
}

function qs(p: Record<string, string | null | undefined>) {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v) s.set(k, v); });
  return s.toString();
}

function formatValue(s: SectionValue): string {
  if (s.value === null) return "—";
  switch (s.unit) {
    case "percent": return `${s.value}%`;
    case "seconds": return `${s.value}s`;
    case "currency": return `₹${Math.round(s.value).toLocaleString("en-IN")}`;
    default: return String(s.value);
  }
}

/**
 * "Not tracked" must not look like a bad score.
 *
 * A metric this process does not measure is a statement about configuration; a
 * red cell is a statement about performance. They are given deliberately
 * different treatments — muted and italic versus toned — so the two cannot be
 * confused at a glance.
 */
function cellTone(s: SectionValue): string {
  if (s.availability === "not_tracked") return "text-slate-300 italic";
  if (s.availability === "no_data") return "text-slate-400";
  if (!s.direction || s.value === null) return "text-slate-800";
  // Only percent metrics carry a shared sense of good/bad; a raw count or a
  // duration has no universal threshold, so those stay neutral rather than
  // being coloured against an invented benchmark.
  if (s.unit !== "percent") return "text-slate-800 font-semibold";
  const good = s.direction === "higher_is_better" ? s.value >= 80 : s.value <= 10;
  const bad = s.direction === "higher_is_better" ? s.value < 50 : s.value > 30;
  return good ? "text-emerald-700 font-semibold" : bad ? "text-red-600 font-semibold" : "text-amber-600 font-semibold";
}

function KpiCells({
  row, onOpen,
}: { row: PerformanceRow; onOpen: (s: SectionValue) => void }) {
  return (
    <>
      {row.sections.map((s) => {
        const interactive = s.availability === "ok";
        return (
          <td key={s.key} className="px-2 py-2 text-right whitespace-nowrap">
            <button
              type="button"
              disabled={!interactive}
              onClick={() => interactive && onOpen(s)}
              title={s.note ?? `${s.label}${interactive ? " — open detail" : ""}`}
              className={`text-xs tabular-nums rounded px-1.5 py-0.5 ${cellTone(s)} ${
                interactive ? "cursor-pointer hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-300" : "cursor-default"
              }`}
            >
              {s.availability === "not_tracked" ? "not tracked" : formatValue(s)}
            </button>
          </td>
        );
      })}
    </>
  );
}

function SubRows({
  grain, query, depth, onOpenCell,
}: {
  grain: "manager" | "agent";
  query: PerfQuery;
  depth: number;
  onOpenCell: (row: PerformanceRow, s: SectionValue) => void;
}) {
  const endpoint = grain === "manager" ? "managers" : "agents";
  const { data, isLoading, error } = useQuery({
    queryKey: ["process-performance", endpoint, query],
    queryFn: () => hrmsApi.get<HrmsEnvelope<PerformanceRow[]>>(
      `/api/process-performance/${endpoint}?${qs({ ...query })}`,
    ),
  });

  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) {
    return (
      <tr><td colSpan={99} className="px-6 py-3 text-xs text-slate-400">
        <Loader2 className="inline h-3 w-3 animate-spin mr-1.5" />Loading…
      </td></tr>
    );
  }
  if (error) {
    const status = getHrmsApiErrorStatus(error);
    return (
      <tr><td colSpan={99} className="px-6 py-3 text-xs text-slate-500">
        {status === 403
          ? "This level isn't available for your role."
          : "Couldn't load this level."}
      </td></tr>
    );
  }

  const rows = data?.data ?? [];
  if (!rows.length) {
    return <tr><td colSpan={99} className="px-6 py-3 text-xs text-slate-400">No records at this level.</td></tr>;
  }

  return (
    <>
      {rows.map((r) => {
        const open = expanded === r.id;
        const canExpand = grain === "manager";
        return (
          <Fragment key={`${grain}-${r.id}`}>
            <tr className="bg-slate-50/60 hover:bg-indigo-50/40">
              <td className="px-2 py-2 sticky left-0 bg-inherit" style={{ paddingLeft: depth * 18 + 12 }}>
                <div className="flex items-center gap-1.5">
                  {canExpand ? (
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : r.id)}
                      aria-expanded={open}
                      aria-label={open ? `Collapse ${r.name}` : `Expand ${r.name}`}
                      className="p-0.5 rounded hover:bg-slate-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                  ) : <span className="w-4" />}
                  <span className="text-xs text-slate-700">{r.name}</span>
                  {r.subtitle && <span className="text-[10px] font-mono text-slate-400">{r.subtitle}</span>}
                </div>
              </td>
              <KpiCells row={r} onOpen={(s) => onOpenCell(r, s)} />
            </tr>
            {open && canExpand && (
              <SubRows
                grain="agent"
                depth={depth + 1}
                query={{ ...query, managerId: r.id }}
                onOpenCell={onOpenCell}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

export default function ProcessPerformanceTable({ query }: { query: PerfQuery }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["process-performance", "processes", query],
    queryFn: () => hrmsApi.get<HrmsEnvelope<PerformanceRow[]>>(
      `/api/process-performance/processes?${qs({ ...query })}`,
    ),
  });

  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ row: PerformanceRow; section: SectionValue } | null>(null);

  if (isLoading) return <div className="p-6 text-sm text-slate-500">Loading process performance…</div>;

  if (error) {
    const status = getHrmsApiErrorStatus(error);
    // A 403 here is an intentional, correctly-enforced role restriction — the
    // same calm treatment the employee scorecard uses, not a red error box.
    if (status === 403) {
      return (
        <div className="p-6 text-sm text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
          Process Performance isn't available for your role — contact your administrator if you believe this is incorrect.
        </div>
      );
    }
    return (
      <div className="p-6 text-sm text-red-600 bg-red-50 rounded-2xl border border-red-200">
        Failed to load process performance. Please try again.
      </div>
    );
  }

  const rows = data?.data ?? [];
  const sections = rows[0]?.sections ?? [];

  if (!rows.length) {
    return (
      <div className="p-6 text-sm text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
        No processes in your scope for this period.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gradient-to-r from-blue-700 to-indigo-700">
              <th className="sticky left-0 z-10 bg-blue-700 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-white">
                Process
              </th>
              {sections.map((s) => (
                <th key={s.key} className="px-2 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-white whitespace-nowrap">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const open = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <tr className="hover:bg-indigo-50/40">
                    <td className="px-3 py-2.5 sticky left-0 bg-white">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : r.id)}
                          aria-expanded={open}
                          aria-label={open ? `Collapse ${r.name}` : `Expand ${r.name}`}
                          className="p-0.5 rounded hover:bg-slate-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        >
                          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        <span className="font-semibold text-slate-800">{r.name}</span>
                        {r.childCount != null && (
                          <span className="text-[10px] text-slate-400">
                            {r.childCount} manager{r.childCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    </td>
                    <KpiCells row={r} onOpen={(s) => setDetail({ row: r, section: s })} />
                  </tr>
                  {open && (
                    <SubRows
                      grain="manager"
                      depth={1}
                      query={{ ...query, processId: r.id }}
                      onOpenCell={(row, s) => setDetail({ row, section: s })}
                    />
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && (
        <KpiCellDetail
          open
          onClose={() => setDetail(null)}
          section={detail.section}
          row={detail.row}
          baseQuery={query}
        />
      )}
    </>
  );
}
