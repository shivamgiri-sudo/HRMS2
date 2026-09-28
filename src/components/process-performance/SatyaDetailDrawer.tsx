import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatINR } from "./DashboardKit";
import { ComboTrend, fmtNum } from "./NeemansCharts";
import {
  callsMade, filtersQuery, fmtDMY, fmtInt, fmtRatio, outcomeLabel, ratio,
  type SatyaDetail, type SatyaDetailType, type SatyaFilters,
} from "./satyaReportModel";

export interface SatyaDetailTarget { type: SatyaDetailType; key: string }

const TYPE_LABEL: Record<SatyaDetailType, string> = { agent: "Agent", beat: "Beat", warehouse: "Warehouse" };
const TYPE_BADGE: Record<SatyaDetailType, string> = {
  agent: "bg-violet-100 text-violet-700",
  beat: "bg-teal-100 text-teal-700",
  warehouse: "bg-amber-100 text-amber-700",
};

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{children}</p>;
}
function None({ text = "None" }: { text?: string }) {
  return <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-400">{text}</p>;
}
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
      <p className="text-lg font-bold leading-tight text-slate-800">{value}</p>
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}
function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
            {head.map((h, i) => <th key={h} className={`px-3 py-2 font-semibold ${i > 0 ? "text-right" : ""}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * Slide-over for one agent / beat / warehouse row. Fetches its own detail
 * (GET /satya-retail-report/detail) with the same filters as the list it was
 * opened from, so the totals here equal the row that was clicked.
 */
export function SatyaDetailDrawer({
  target, filters, onClose,
}: { target: SatyaDetailTarget | null; filters: SatyaFilters; onClose: () => void }) {
  const [detail, setDetail] = useState<SatyaDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setDetail(null);
    setError("");
    setLoading(true);
    hrmsApi
      .get<{ success: boolean; data: SatyaDetail }>(
        `/api/process-performance/satya-retail-report/detail?type=${target.type}&key=${encodeURIComponent(target.key)}&${filtersQuery(filters)}`,
        90000,
      )
      .then((res) => { if (!cancelled) setDetail(res.data); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the detail."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target, filters]);

  const c = detail?.counts;

  return (
    <Sheet open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        <SheetHeader className="space-y-1 border-b border-slate-100 bg-gradient-to-br from-amber-50 to-white p-5 pr-12 text-left">
          <div className="flex flex-wrap items-center gap-2">
            {target && <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TYPE_BADGE[target.type]}`}>{TYPE_LABEL[target.type]}</span>}
            <span className="text-[11px] text-slate-400">
              {fmtDMY(filters.from)} – {fmtDMY(filters.to)}
              {filters.warehouse ? ` · ${filters.warehouse}` : ""}{filters.roster ? ` · ${filters.roster}` : ""}
            </span>
          </div>
          <SheetTitle className="text-lg font-bold text-slate-900">{detail?.title ?? target?.key ?? "Details"}</SheetTitle>
          <SheetDescription className="text-xs text-slate-500">
            {detail ? `${detail.subtitle} · active ${fmtDMY(detail.firstDate)} – ${fmtDMY(detail.lastDate)}` : "Loading…"}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 p-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading details…
            </div>
          )}
          {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          {detail && c && (
            <>
              <section>
                <SectionLabel>Summary</SectionLabel>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Allocation" value={fmtInt(c.allocation)} sub={`${fmtInt(c.morning)} morning · ${fmtInt(c.absentee)} absentee`} />
                  <Stat label="Calls made" value={fmtInt(callsMade(c))} sub={`${fmtInt(c.unique)} unique · ${fmtInt(c.repeat)} repeat`} />
                  <Stat label="Connected" value={fmtInt(c.connected)} sub={`${fmtRatio(ratio(c.connected, c.connected + c.notConnected))} of dialled`} />
                  <Stat label="Not connected" value={fmtInt(c.notConnected)} sub={c.pending ? `${fmtInt(c.pending)} pending` : undefined} />
                  <Stat label="Orders placed" value={fmtInt(c.orders)} sub={`${fmtInt(c.ordersUnique)} unique · ${fmtInt(c.orders - c.ordersUnique)} repeat`} />
                  <Stat label="Conversion" value={fmtRatio(ratio(c.orders, callsMade(c)))} sub="orders ÷ calls made" />
                  <Stat label="Order revenue" value={formatINR(c.revenue)} />
                  <Stat label="Avg order value" value={c.orders ? formatINR(Math.round(c.revenue / c.orders)) : "—"} />
                </div>
              </section>

              <section>
                <SectionLabel>Daily activity</SectionLabel>
                {detail.daily.length === 0 ? <None /> : (
                  <>
                    <ComboTrend
                      height={190}
                      data={detail.daily}
                      series={[
                        { key: "allocation", name: "Allocation", kind: "bar", color: "#f59e0b" },
                        { key: "connected", name: "Connected", kind: "line", color: "#10b981" },
                        { key: "orders", name: "Orders", kind: "line", color: "#7c3aed" },
                      ]}
                    />
                    <div className="mt-3 max-h-56 overflow-y-auto rounded-xl">
                      <Table head={["Date", "Allocation", "Connected", "Orders", "Revenue"]}>
                        {detail.daily.map((d) => (
                          <tr key={d.date} className="border-b border-slate-50 last:border-0">
                            <td className="px-3 py-1.5 font-medium text-slate-700">{fmtDMY(d.date)}</td>
                            <td className="px-3 py-1.5 text-right text-slate-600">{fmtInt(d.allocation)}</td>
                            <td className="px-3 py-1.5 text-right text-slate-600">{fmtInt(d.connected)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{fmtInt(d.orders)}</td>
                            <td className="px-3 py-1.5 text-right text-slate-600">{formatINR(d.revenue)}</td>
                          </tr>
                        ))}
                      </Table>
                    </div>
                  </>
                )}
              </section>

              <section>
                <SectionLabel>Call outcomes</SectionLabel>
                {detail.dispositions.length === 0 ? <None /> : (
                  <Table head={["Disposition", "Outcome", "Count", "Share"]}>
                    {detail.dispositions.map((d) => (
                      <tr key={`${d.disposition}|${d.subDisposition}`} className="border-b border-slate-50 last:border-0">
                        <td className="px-3 py-1.5 text-slate-500">{d.disposition}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-slate-700">{outcomeLabel(d.subDisposition)}</td>
                        <td className="px-3 py-1.5 text-right text-slate-600">{fmtInt(d.count)}</td>
                        <td className="px-3 py-1.5 text-right text-slate-500">{fmtRatio(ratio(d.count, c.allocation))}</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </section>

              <section>
                <SectionLabel>{detail.breakdownLabel}</SectionLabel>
                {detail.breakdown.length === 0 ? <None /> : (
                  <Table head={[detail.type === "beat" ? "Agent" : "Beat", "Allocation", "Connected", "Orders", "Revenue"]}>
                    {detail.breakdown.map((b) => (
                      <tr key={b.name} className="border-b border-slate-50 last:border-0">
                        <td className="px-3 py-1.5 font-medium text-slate-700">{b.name}</td>
                        <td className="px-3 py-1.5 text-right text-slate-600">{fmtInt(b.counts.allocation)}</td>
                        <td className="px-3 py-1.5 text-right text-slate-600">{fmtInt(b.counts.connected)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{fmtInt(b.counts.orders)}</td>
                        <td className="px-3 py-1.5 text-right text-slate-600">{formatINR(b.counts.revenue)}</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </section>

              <section>
                <SectionLabel>Orders placed ({fmtNum(detail.ordersTotal)})</SectionLabel>
                {detail.orders.length === 0 ? <None text="No orders in this range" /> : (
                  <>
                    <Table head={["Date", "Shop", "Beat", "Agent", "Roster", "Amount"]}>
                      {detail.orders.map((o, i) => (
                        <tr key={`${o.date}-${o.shop}-${i}`} className="border-b border-slate-50 last:border-0">
                          <td className="px-3 py-1.5 text-slate-600">{fmtDMY(o.date)}</td>
                          <td className="px-3 py-1.5 text-right font-medium text-slate-700">{o.shop}</td>
                          <td className="px-3 py-1.5 text-right text-slate-500">{o.beat}</td>
                          <td className="px-3 py-1.5 text-right text-slate-500">{o.agent}</td>
                          <td className="px-3 py-1.5 text-right text-slate-500">{o.roster}</td>
                          <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{formatINR(o.amount)}</td>
                        </tr>
                      ))}
                    </Table>
                    {detail.ordersTotal > detail.orders.length && (
                      <p className="mt-1.5 text-[11px] text-slate-400">Showing the latest {detail.orders.length} of {fmtNum(detail.ordersTotal)} orders.</p>
                    )}
                  </>
                )}
              </section>

              <section>
                <SectionLabel>Dial attempts (call log)</SectionLabel>
                {detail.calls.attempts === 0 ? <None text="No dial attempts logged" /> : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Attempts" value={fmtInt(detail.calls.attempts)} />
                    <Stat label="Connected" value={fmtInt(detail.calls.connected)} sub={fmtRatio(ratio(detail.calls.connected, detail.calls.attempts))} />
                    <Stat label="Order-placing calls" value={fmtInt(detail.calls.orderCalls)} />
                    <Stat label="Avg attempt no." value={String(detail.calls.avgAttempt)} />
                  </div>
                )}
              </section>

              <section>
                <SectionLabel>Documents &amp; approvals</SectionLabel>
                <None />
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
