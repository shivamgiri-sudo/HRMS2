import { useEffect, useState, type ReactNode } from "react";
import { X, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatINR } from "./DashboardKit";
import { fmtDate, fmtN } from "./lpCallShared";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";

export interface PeriodTarget { label: string; from: string; to: string }

interface Integrity {
  saleRows: number; uniqueOrders: number; duplicateRows: number;
  grossRevenue: number; revenue: number; duplicateRevenue: number; blankOrderIdRows: number;
}
interface PeriodDetail {
  from: string; to: string; userType: string;
  byUserType: Array<{ userType: string; overall: number; unique: number; frtPct: number; repeat24: number }>;
  byTl: Array<{ tlName: string; overall: number; unique: number; frtPct: number }>;
  byAgent: Array<{ agent: string; empId: string; overall: number; unique: number; frtPct: number }>;
  integrity: Integrity | null;
  duplicateOrders: Array<{ orderId: string; date: string; amount: number; rows: number; extraRevenue: number }>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </section>
  );
}
const None = () => <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold tracking-tight text-slate-800">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function SimpleTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Small "Clear N filter(s)" pill, shown above a table only once a column filter is active. */
function ClearFiltersButton({ filters }: { filters: { activeCount: number; clearAll: () => void } }) {
  if (filters.activeCount === 0) return null;
  return (
    <div className="mb-2 flex justify-end">
      <button type="button" onClick={filters.clearAll} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
        Clear {filters.activeCount} filter{filters.activeCount > 1 ? "s" : ""}
      </button>
    </div>
  );
}

type ByUserTypeRow = PeriodDetail["byUserType"][number];
type ByTlRow = PeriodDetail["byTl"][number];
type ByAgentRow = PeriodDetail["byAgent"][number];
type DupOrderRow = PeriodDetail["duplicateOrders"][number];

interface Col<T> { key: string; label: string; get: (r: T) => string | number | null; cell: (r: T) => ReactNode }
const thCls = (i: number) => `px-3 py-2 font-semibold ${i === 0 ? "" : "text-right"}`;

const USERTYPE_COLS: Array<Col<ByUserTypeRow>> = [
  { key: "userType", label: "User type", get: (r) => r.userType, cell: (r) => r.userType },
  { key: "overall", label: "Chats", get: (r) => r.overall, cell: (r) => fmtN(r.overall) },
  { key: "unique", label: "Unique", get: (r) => r.unique, cell: (r) => fmtN(r.unique) },
  { key: "frtPct", label: "FRT %", get: (r) => r.frtPct, cell: (r) => `${r.frtPct}%` },
  { key: "repeat24", label: "Repeat 24h", get: (r) => r.repeat24, cell: (r) => fmtN(r.repeat24) },
];
const USERTYPE_FILTER_COLS: Array<FilterColumn<ByUserTypeRow>> = USERTYPE_COLS.map((c) => ({ key: c.key, get: c.get }));
const userTypeColGetter = (r: ByUserTypeRow, key: string) => USERTYPE_COLS.find((c) => c.key === key)?.get(r);

const DUP_ORDER_COLS: Array<Col<DupOrderRow>> = [
  { key: "orderId", label: "Order id", get: (r) => r.orderId, cell: (r) => r.orderId },
  { key: "date", label: "Date", get: (r) => r.date, cell: (r) => fmtDate(r.date) },
  { key: "amount", label: "Amount", get: (r) => r.amount, cell: (r) => formatINR(r.amount) },
  { key: "rows", label: "Rows", get: (r) => r.rows, cell: (r) => r.rows },
  { key: "extraRevenue", label: "Extra revenue", get: (r) => r.extraRevenue, cell: (r) => formatINR(r.extraRevenue) },
];
const DUP_ORDER_FILTER_COLS: Array<FilterColumn<DupOrderRow>> = DUP_ORDER_COLS.map((c) => ({ key: c.key, get: c.get }));
const dupOrderColGetter = (r: DupOrderRow, key: string) => DUP_ORDER_COLS.find((c) => c.key === key)?.get(r);

const TL_COLS: Array<Col<ByTlRow>> = [
  { key: "tlName", label: "TL", get: (r) => r.tlName, cell: (r) => r.tlName },
  { key: "overall", label: "Chats", get: (r) => r.overall, cell: (r) => fmtN(r.overall) },
  { key: "unique", label: "Unique", get: (r) => r.unique, cell: (r) => fmtN(r.unique) },
  { key: "frtPct", label: "FRT %", get: (r) => r.frtPct, cell: (r) => `${r.frtPct}%` },
];
const TL_FILTER_COLS: Array<FilterColumn<ByTlRow>> = TL_COLS.map((c) => ({ key: c.key, get: c.get }));
const tlColGetter = (r: ByTlRow, key: string) => TL_COLS.find((c) => c.key === key)?.get(r);

const AGENT_COLS: Array<Col<ByAgentRow>> = [
  { key: "agent", label: "Agent", get: (r) => r.agent, cell: () => null },
  { key: "overall", label: "Chats", get: (r) => r.overall, cell: (r) => fmtN(r.overall) },
  { key: "unique", label: "Unique", get: (r) => r.unique, cell: (r) => fmtN(r.unique) },
  { key: "frtPct", label: "FRT %", get: (r) => r.frtPct, cell: (r) => `${r.frtPct}%` },
];
const AGENT_FILTER_COLS: Array<FilterColumn<ByAgentRow>> = AGENT_COLS.map((c) => ({ key: c.key, get: c.get }));
const agentColGetter = (r: ByAgentRow, key: string) => AGENT_COLS.find((c) => c.key === key)?.get(r);

export function BellavitaChatPeriodDrawer({
  apiPath, target, userType, onClose,
}: { apiPath: string; target: PeriodTarget; userType: string; onClose: () => void }) {
  const [data, setData] = useState<PeriodDetail | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    hrmsApi
      .get<{ success: boolean; data: PeriodDetail }>(
        `${apiPath}/overview/detail?from=${target.from}&to=${target.to}&userType=${encodeURIComponent(userType)}`,
      )
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the detail."); });
    return () => { cancelled = true; };
  }, [apiPath, target.from, target.to, userType]);

  const range = target.from === target.to ? fmtDate(target.from) : `${fmtDate(target.from)} to ${fmtDate(target.to)}`;

  // Excel-style: every header sorts (click) and filters (funnel icon); one independent pair of hooks per table.
  const userTypeFilters = useColumnFilters(data?.byUserType ?? [], USERTYPE_FILTER_COLS);
  const { sorted: sortedUserType, sortKey: userTypeSortKey, sortDir: userTypeSortDir, toggleSort: toggleUserTypeSort } = useSortableRows(userTypeFilters.filtered, userTypeColGetter);

  const dupOrderFilters = useColumnFilters(data?.duplicateOrders ?? [], DUP_ORDER_FILTER_COLS);
  const { sorted: sortedDupOrders, sortKey: dupOrderSortKey, sortDir: dupOrderSortDir, toggleSort: toggleDupOrderSort } = useSortableRows(dupOrderFilters.filtered, dupOrderColGetter);

  const tlFilters = useColumnFilters(data?.byTl ?? [], TL_FILTER_COLS);
  const { sorted: sortedTl, sortKey: tlSortKey, sortDir: tlSortDir, toggleSort: toggleTlSort } = useSortableRows(tlFilters.filtered, tlColGetter);

  const agentFilters = useColumnFilters(data?.byAgent ?? [], AGENT_FILTER_COLS);
  const { sorted: sortedAgents, sortKey: agentSortKey, sortDir: agentSortDir, toggleSort: toggleAgentSort } = useSortableRows(agentFilters.filtered, agentColGetter);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${target.label} detail`}>
      <button
        type="button" aria-label="Close detail" onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <aside className={`relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <header className="flex items-start justify-between gap-3 bg-gradient-to-br from-rose-600 via-pink-600 to-rose-700 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">Bellavita Chat · {userType}</p>
            <h3 className="truncate text-lg font-bold">{target.label}</h3>
            <p className="mt-0.5 text-[11px] text-white/80">{range}</p>
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="rounded-lg p-1.5 text-white/85 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {!data && !error && (
            <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
          {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          {data && (
            <>
              <Section title="By user type">
                {data.byUserType.length === 0 ? <None /> : (
                  <>
                    <ClearFiltersButton filters={userTypeFilters} />
                    <SimpleTable head={USERTYPE_COLS.map((c, i) => (
                      <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={userTypeSortKey} sortDir={userTypeSortDir} onSort={toggleUserTypeSort} filters={userTypeFilters} className={thCls(i)} />
                    ))}>
                      {sortedUserType.map((r) => (
                        <tr key={r.userType} className="border-t border-slate-50">
                          <td className="px-3 py-2 font-medium text-slate-700">{r.userType}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.overall)}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.unique)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-800">{r.frtPct}%</td>
                          <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.repeat24)}</td>
                        </tr>
                      ))}
                    </SimpleTable>
                  </>
                )}
              </Section>

              <Section title="Order integrity (bella_vita_order_id)">
                {!data.integrity ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
                    Not available for this user type — the sales table has no Kenaz/Bevzilla split.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Stat label="Sale rows" value={fmtN(data.integrity.saleRows)} sub="one per line item" />
                      <Stat label="Unique orders" value={fmtN(data.integrity.uniqueOrders)} sub="counted as sales" />
                      <Stat label="Duplicate rows" value={fmtN(data.integrity.duplicateRows)} sub="ignored" />
                      <Stat label="Revenue (unique)" value={formatINR(data.integrity.revenue)} sub="one amount per order" />
                      <Stat label="Duplicate revenue" value={formatINR(data.integrity.duplicateRevenue)} sub="excluded" />
                      <Stat label="Without order id" value={fmtN(data.integrity.blankOrderIdRows)} sub="can't be de-duplicated" />
                    </div>
                    {data.duplicateOrders.length === 0 ? <None /> : (
                      <>
                        <ClearFiltersButton filters={dupOrderFilters} />
                        <SimpleTable head={DUP_ORDER_COLS.map((c, i) => (
                          <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={dupOrderSortKey} sortDir={dupOrderSortDir} onSort={toggleDupOrderSort} filters={dupOrderFilters} className={thCls(i)} />
                        ))}>
                          {sortedDupOrders.map((o) => (
                            <tr key={o.orderId} className="border-t border-slate-50">
                              <td className="px-3 py-2 font-medium text-slate-700">{o.orderId}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{fmtDate(o.date)}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{formatINR(o.amount)}</td>
                              <td className="px-3 py-2 text-right font-semibold text-slate-800">{o.rows}</td>
                              <td className="px-3 py-2 text-right text-rose-600">{formatINR(o.extraRevenue)}</td>
                            </tr>
                          ))}
                        </SimpleTable>
                      </>
                    )}
                  </div>
                )}
              </Section>

              <Section title="TL-wise">
                {data.byTl.length === 0 ? <None /> : (
                  <>
                    <ClearFiltersButton filters={tlFilters} />
                    <SimpleTable head={TL_COLS.map((c, i) => (
                      <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={tlSortKey} sortDir={tlSortDir} onSort={toggleTlSort} filters={tlFilters} className={thCls(i)} />
                    ))}>
                      {sortedTl.map((r) => (
                        <tr key={r.tlName} className="border-t border-slate-50">
                          <td className="px-3 py-2 font-medium text-slate-700">{r.tlName}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.overall)}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.unique)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-800">{r.frtPct}%</td>
                        </tr>
                      ))}
                    </SimpleTable>
                  </>
                )}
              </Section>

              <Section title="Agent-wise">
                {data.byAgent.length === 0 ? <None /> : (
                  <>
                    <ClearFiltersButton filters={agentFilters} />
                    <SimpleTable head={AGENT_COLS.map((c, i) => (
                      <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={agentSortKey} sortDir={agentSortDir} onSort={toggleAgentSort} filters={agentFilters} className={thCls(i)} />
                    ))}>
                      {sortedAgents.map((r) => (
                        <tr key={`${r.empId}-${r.agent}`} className="border-t border-slate-50">
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-700">{r.agent}</div>
                            <div className="text-[10px] text-slate-400">{r.empId || "—"}</div>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.overall)}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{fmtN(r.unique)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-800">{r.frtPct}%</td>
                        </tr>
                      ))}
                    </SimpleTable>
                  </>
                )}
              </Section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
