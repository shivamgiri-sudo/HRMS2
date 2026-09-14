import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BudgetLineAllocationTable } from "@/components/finance/pnl/BudgetLineAllocationTable";
import type { BranchBudgetLineRecord } from "@/hooks/useBranchBudget";

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

/** Grid Matrix's drill-down drawer (PR 9) — mirrors ProcessPnlRowDrawer.tsx's Sheet pattern. */
export function BranchBudgetLineDrawer({
  line,
  onOpenChange,
}: {
  line: BranchBudgetLineRecord;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b border-slate-200 pb-4 pr-8">
          <SheetTitle>{line.item_name}</SheetTitle>
          <SheetDescription>
            {line.head}
            {line.sub_head ? ` / ${line.sub_head}` : ""}
            {" · "}
            {line.planning_level === "branch" ? "Branch common" : line.cost_centre_name ?? "Direct to cost centre"}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          <section>
            <h3 className="text-sm font-semibold text-slate-950">Amount summary</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              {[
                ["Without tax", money(Number(line.base_amount))],
                ["Tax", money(Number(line.tax_amount))],
                ["With tax", money(Number(line.gross_amount))],
                ["P&L cost", money(Number(line.pnl_cost_amount))],
                ["Quantity", `${line.quantity} ${line.unit}`],
                ["Unit rate", money(Number(line.unit_rate))],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                  <dd className="mt-1 text-sm font-bold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-950">Tax and sharing</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline">{line.tax_treatment.replaceAll("_", " ")}</Badge>
              <Badge variant="outline">{line.gst_rate}% GST</Badge>
              <Badge variant="outline">{line.gst_type.replaceAll("_", " ")}</Badge>
              {line.allocation_driver && (
                <Badge variant="outline">{line.allocation_driver.replaceAll("_", " ")}</Badge>
              )}
              {line.preferred_vendor_name && <Badge variant="outline">{line.preferred_vendor_name}</Badge>}
            </div>
          </section>

          {line.justification && (
            <section>
              <h3 className="text-sm font-semibold text-slate-950">Business justification</h3>
              <p className="mt-2 text-sm text-slate-600">{line.justification}</p>
            </section>
          )}

          {line.planning_level === "branch" && Boolean(line.allocations?.length) && (
            <section>
              <h3 className="text-sm font-semibold text-slate-950">Cost-centre allocation</h3>
              <div className="mt-3">
                <BudgetLineAllocationTable allocations={line.allocations ?? []} />
              </div>
            </section>
          )}

          <section>
            <h3 className="text-sm font-semibold text-slate-950">Utilization</h3>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              {[
                ["Reserved", money(Number(line.reserved_amount))],
                ["Consumed", money(Number(line.consumed_amount))],
                ["Available", money(Number(line.available_gross_amount))],
                ["Available quantity", String(line.available_quantity)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                  <dd className="mt-1 text-sm font-bold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
