import { useState } from "react";
import { ChevronDown, ChevronRight, Info, Loader2 } from "lucide-react";
import { useFullWaterfall } from "@/hooks/useFullWaterfall";

/**
 * Full P&L Waterfall — supplementary detail, never the headline number.
 *
 * This card sums the SAME per-process contribution/EBITDA/depreciation/amortization/EBIT/finance
 * cost/PBT/tax/PAT fields the per-process detail page already shows (bpo-pnl-full-waterfall.
 * service.ts), across a branch's or the whole company's active processes. It is deliberately
 * placed and worded to read as supplementary detail, not as a competing headline: collapsed by
 * default, visually distinct from the KPI tiles above it, with an explicit note about why it can
 * differ from the Operating Profit figure shown elsewhere on this page.
 *
 * It never replaces, recomputes, or reads from CEO Overview's own Operating Profit calculation —
 * that number is a separate, simpler figure reconciled against the business's real reported P&L
 * Excel file, and stays exactly as it was before this card existed.
 */

const lakh = (v: number) => `₹${(v / 100000).toFixed(2)} L`;
const pctStr = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

function money(value: number, hasData: boolean) {
  if (!hasData) {
    return (
      <span
        className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400"
        title="No row has ever been entered in process_pnl_cost_component for this cost type/period — not a confirmed ₹0, simply never configured."
      >
        Not yet configured
      </span>
    );
  }
  return <span className="tabular-nums">{lakh(value)}</span>;
}

export interface PnlFullWaterfallCardProps {
  period: string;
  /** Omit (or null) for the company-wide total. */
  branchId?: string | null;
  branchName?: string | null;
  /** Collapsed by default so this never visually competes with the headline Operating Profit figures. */
  defaultOpen?: boolean;
}

export function PnlFullWaterfallCard({ period, branchId, branchName, defaultOpen = false }: PnlFullWaterfallCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { data, isLoading, error } = useFullWaterfall(period, branchId, open);
  const scopeLabel = branchId ? branchName ?? "This branch" : "Company-wide";

  return (
    <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 shadow-sm dark:border-slate-700 dark:bg-slate-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Full P&amp;L Waterfall <span className="font-normal text-slate-500">— {scopeLabel} · detailed view</span>
          </h3>
        </div>
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          Supplementary
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <p className="mb-3 flex gap-2 rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-[12.5px] text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This is a more detailed breakdown using the full BPO cost-bucket methodology — the same
              per-process contribution/EBITDA/EBIT/PBT/PAT figures each process's own detail page
              shows, added up across {branchId ? "this branch's" : "every branch's"} active processes.
              It may differ slightly from the headline Operating Profit figure above, which is
              reconciled against the official monthly P&amp;L report and is calculated separately.
              Both are real, correctly-computed numbers on different bases.
            </span>
          </p>

          {isLoading && (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
              Could not load the full waterfall for {period}.
            </div>
          )}
          {data && (
            <>
              <div className="mb-2 text-[11.5px] text-slate-500">
                {data.processCount} active process{data.processCount === 1 ? "" : "es"} contributed to this total.
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-4">
                <dt className="text-slate-500">Contribution</dt>
                <dd className="text-right font-medium tabular-nums">{lakh(data.contribution)}</dd>
                <dt className="text-slate-500">Contribution margin</dt>
                <dd className="text-right font-medium">{pctStr(data.contributionMarginPct)}</dd>

                <dt className="text-slate-500">EBITDA</dt>
                <dd className={`text-right font-medium tabular-nums ${data.ebitda >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{lakh(data.ebitda)}</dd>
                <dt className="text-slate-500">EBITDA margin</dt>
                <dd className="text-right font-medium">{pctStr(data.ebitdaMarginPct)}</dd>

                <dt className="text-slate-500">Depreciation</dt>
                <dd className="text-right font-medium">{money(data.depreciation, data.hasDepreciationData)}</dd>
                <dt className="text-slate-500">Amortization</dt>
                <dd className="text-right font-medium">{money(data.amortization, data.hasAmortizationData)}</dd>

                <dt className="text-slate-500">EBIT / Operating profit</dt>
                <dd className={`text-right font-medium tabular-nums ${data.ebit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{lakh(data.ebit)}</dd>
                <dt className="text-slate-500">Operating profit margin</dt>
                <dd className="text-right font-medium">{pctStr(data.operatingProfitPct)}</dd>

                <dt className="text-slate-500">Finance cost</dt>
                <dd className="text-right font-medium">{money(data.financeCost, data.hasFinanceCostData)}</dd>
                <dt className="text-slate-500">PBT</dt>
                <dd className={`text-right font-medium tabular-nums ${data.pbt >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{lakh(data.pbt)}</dd>

                <dt className="text-slate-500">Tax</dt>
                <dd className="text-right font-medium">{money(data.tax, data.hasTaxData)}</dd>
                <dt className="text-slate-500">PAT</dt>
                <dd className={`text-right font-medium tabular-nums ${data.pat >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{lakh(data.pat)}</dd>
              </dl>
            </>
          )}
        </div>
      )}
    </section>
  );
}
