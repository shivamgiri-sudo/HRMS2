import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Info, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { usePnlCostLeakage, type LeakageBucket, type LeakageSeverity } from "@/hooks/usePnlCostLeakage";
import { PnlDrilldownDrawer } from "@/components/finance/pnl/PnlDrilldownDrawer";
import type { PnlDrilldownParams } from "@/hooks/usePnlDrilldown";
import { useCostLeakageCostCentre } from "@/hooks/useCostLeakageCostCentre";

/**
 * Cost Leakage Review.
 *
 * Answers a different question from the Reconciliation panel beside it. Reconciliation asks whether
 * the counted numbers agree with their sources; this asks what never reaches a process line at all,
 * and so quietly flatters every Operating Profit % on the other tabs.
 *
 * Two deliberate presentation decisions:
 *
 *   1. Actionable and context buckets are separated, and only actionable ones are summed into the
 *      headline. The largest number on this screen by far is 80,625 migrated pre-2026 GRNs worth
 *      Rs 101 crore, which is not missing money. Adding it to a headline would make the Rs 84 lakh
 *      that IS actionable unreadable, which is how the existing unlinked-GRN list ended up unworked.
 *   2. Every bucket says plainly that being listed here means detected, not fixed. Nothing on this
 *      screen changes a reported figure.
 */

const TONE: Record<LeakageSeverity, { card: string; badge: string; icon: typeof AlertTriangle }> = {
  critical: {
    card: "border-rose-200 bg-rose-50/60",
    badge: "border-rose-300 bg-rose-100 text-rose-800",
    icon: ShieldAlert,
  },
  warning: {
    card: "border-amber-200 bg-amber-50/60",
    badge: "border-amber-300 bg-amber-100 text-amber-800",
    icon: AlertTriangle,
  },
  info: {
    card: "border-slate-200 bg-slate-50/60",
    badge: "border-slate-300 bg-slate-100 text-slate-700",
    icon: Info,
  },
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

/**
 * Which buckets have rows that resolve to a real transaction set.
 *
 * Only the staffless-cost-centre bucket does: its row id IS a cost centre id, so the spend behind
 * it can be opened directly. The others are keyed by period, sub-head or year — real groupings, but
 * not scopes the drilldown accepts — so their rows stay non-clickable rather than opening something
 * that does not correspond to the number clicked.
 */
function costCentreIdForRow(bucket: LeakageBucket, rowId: string): string | null {
  return bucket.code === "STAFFLESS_COST_CENTRE" ? rowId : null;
}

function BucketCard({
  bucket,
  onDrill,
}: {
  bucket: LeakageBucket;
  onDrill: (costCentreId: string, label: string) => void;
}) {
  const [open, setOpen] = useState(bucket.actionable);
  const tone = TONE[bucket.severity];
  const Icon = tone.icon;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className={`rounded-2xl border shadow-sm transition-shadow duration-200 hover:shadow-md ${tone.card}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-start gap-3 p-4 text-left"
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/70">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-gray-900">{bucket.title}</span>
            <Badge variant="outline" className={`text-[10px] font-bold uppercase tracking-wide ${tone.badge}`}>
              {bucket.actionable ? "Action needed" : "Context"}
            </Badge>
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-slate-600">{bucket.detail}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-right">
          <span>
            <span className="block text-base font-bold tabular-nums text-gray-900">{money(bucket.amount)}</span>
            <span className="block text-[11px] text-slate-500">
              {bucket.count.toLocaleString("en-IN")} {bucket.count === 1 ? "record" : "records"}
            </span>
          </span>
          <Chevron className="h-4 w-4 text-slate-400" aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div className="border-t border-white/70 px-4 pb-4 pt-3">
          {bucket.rows.length === 0 ? (
            <p className="text-xs text-slate-500">None — nothing in this category for the period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-2 pr-3 font-semibold uppercase tracking-wide">Item</th>
                    <th className="pb-2 pr-3 text-right font-semibold uppercase tracking-wide">Records</th>
                    <th className="pb-2 text-right font-semibold uppercase tracking-wide">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {bucket.rows.map((row) => {
                    const target = costCentreIdForRow(bucket, row.id);
                    return (
                      <tr
                        key={row.id}
                        className={`border-t border-white/80 align-top ${
                          target
                            ? "cursor-pointer transition-colors duration-200 hover:bg-white/80"
                            : ""
                        }`}
                        onClick={target ? () => onDrill(target, row.label) : undefined}
                        title={target ? "View the spend behind this cost centre" : undefined}
                      >
                        <td className="py-2 pr-3">
                          <div className="font-semibold text-gray-800">{row.label}</div>
                          {row.detail ? <div className="text-[11px] text-slate-500">{row.detail}</div> : null}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                          {row.count.toLocaleString("en-IN")}
                        </td>
                        <td className="py-2 text-right font-bold tabular-nums text-gray-900">{money(row.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function PnlCostLeakagePanel({ period }: { period: string }) {
  const { data, isLoading, isError, error } = usePnlCostLeakage(period);
  const [drilldown, setDrilldown] = useState<{ costCentreId: string; label: string } | null>(null);
  const detail = useCostLeakageCostCentre(period, drilldown?.costCentreId ?? null);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        {(error as Error)?.message || "Could not load the cost leakage review."}
      </div>
    );
  }

  const actionable = data.buckets.filter((b) => b.actionable);
  const context = data.buckets.filter((b) => !b.actionable);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/60 bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-blue-100">
          Cost leakage · {data.financeYear} to date
        </p>
        <p className="mt-1 text-3xl font-bold tabular-nums">{money(data.actionableAmount)}</p>
        <p className="mt-1 text-sm text-blue-50">
          Committed spend that currently reaches no process P&amp;L line, so process Operating Profit %
          reads better than the business actually performed.
        </p>
        <p className="mt-2 text-xs text-blue-100">
          Detected, not fixed — nothing on this screen changes a reported figure. Amounts below are
          shown against {data.periodFrom} onwards.
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Needs action</h3>
        {actionable.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            None — no leakage detected this financial year.
          </p>
        ) : (
          actionable.map((bucket) => (
            <BucketCard
              key={bucket.code}
              bucket={bucket}
              onDrill={(costCentreId, label) => setDrilldown({ costCentreId, label })}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Context — correct as it stands, shown so it stays a decision
        </h3>
        {context.map((bucket) => (
          <BucketCard
            key={bucket.code}
            bucket={bucket}
            onDrill={(costCentreId, label) => setDrilldown({ costCentreId, label })}
          />
        ))}
      </section>

      <PnlDrilldownDrawer
        params={null}
        title="Spend on this cost centre"
        scopeLabel={drilldown?.label}
        supplied={{
          rows: detail.data?.rows ?? [],
          total: detail.data?.total ?? 0,
          isLoading: detail.isLoading,
          note: `${data.financeYear} to ${period}`,
        }}
        open={Boolean(drilldown)}
        onOpenChange={(next) => { if (!next) setDrilldown(null); }}
      />
    </div>
  );
}
