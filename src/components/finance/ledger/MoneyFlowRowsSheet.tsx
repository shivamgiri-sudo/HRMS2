// src/components/finance/ledger/MoneyFlowRowsSheet.tsx
/** The rows behind one Money Flow figure, with a total that must equal the figure, and CSV export. */
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DRAWER_60VW_CLASS, money } from "@/components/finance/client-billing/shared";
import { getMoneyFlowRows, type DrillKey, type DrillResult, type MoneyFlowFilters } from "@/lib/moneyFlowApi";

type Col = { key: string; label: string; money?: boolean };

const COLS: Record<DrillResult["kind"], Col[]> = {
  bills: [
    { key: "billNo", label: "Bill no." }, { key: "invoiceDate", label: "Bill date" }, { key: "dueDate", label: "Due" },
    { key: "client", label: "Client" }, { key: "branch", label: "Branch" },
    { key: "grandTotal", label: "Bill total", money: true }, { key: "received", label: "Received", money: true },
    { key: "tds", label: "TDS", money: true }, { key: "deduction", label: "Deduction", money: true },
    { key: "credited", label: "Credit notes", money: true }, { key: "outstanding", label: "Outstanding", money: true },
    { key: "daysOverdue", label: "Days overdue" },
  ],
  pipeline: [
    { key: "ref", label: "Reference" }, { key: "date", label: "Date" }, { key: "client", label: "Client" },
    { key: "costCentre", label: "Cost centre" }, { key: "branch", label: "Branch" }, { key: "amount", label: "Amount", money: true },
  ],
  payables: [
    { key: "grnNumber", label: "GRN" }, { key: "vendor", label: "Vendor" }, { key: "branch", label: "Branch" },
    { key: "dueDate", label: "Due" }, { key: "amount", label: "Owed", money: true },
  ],
};

/** Which column the figure on the page is the sum of. */
function totalColumn(key: DrillKey, kind: DrillResult["kind"]): string {
  if (kind !== "bills") return "amount";
  if (key === "billed" || key === "paid") return "grandTotal";
  if (key === "received") return "received";
  return "outstanding";
}

function csv(cols: Col[], rows: Array<Record<string, unknown>>): string {
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map((c) => c.label).join(","), ...rows.map((r) => cols.map((c) => cell(r[c.key])).join(","))].join("\n");
}

export function MoneyFlowRowsSheet({
  drill, filters, onClose,
}: {
  drill: { key: DrillKey; title: string } | null;
  filters: MoneyFlowFilters;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ["money-flow-rows", drill?.key, filters],
    queryFn: () => getMoneyFlowRows(drill!.key, filters),
    enabled: !!drill,
  });
  const kind = q.data?.kind ?? "bills";
  const cols = COLS[kind];
  const rows = (q.data?.rows ?? []) as unknown as Array<Record<string, unknown>>;
  const sumKey = drill ? totalColumn(drill.key, kind) : "amount";
  const totalPaise = rows.reduce((s, r) => s + Math.round(Number(r[sumKey] ?? 0) * 100), 0);

  const exportCsv = () => {
    const blob = new Blob([csv(cols, rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `money-flow-${drill?.key}-${filters.financeYear ?? ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Sheet open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className={DRAWER_60VW_CLASS}>
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{drill?.title}</SheetTitle>
          <SheetDescription>
            {q.isLoading ? "Loading…" : `${rows.length} row${rows.length === 1 ? "" : "s"} · total ${money(totalPaise / 100)}`}
          </SheetDescription>
          <div>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length} className="cursor-pointer">
              <Download className="mr-1.5 h-4 w-4" /> Export CSV
            </Button>
          </div>
        </SheetHeader>
        {q.isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading rows…</div>
        ) : q.isError ? (
          <p className="p-6 text-sm text-rose-700">Could not load the rows: {(q.error as Error).message}</p>
        ) : !rows.length ? (
          <p className="p-6 text-sm text-slate-600">Nothing here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} className={`whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-600 ${c.money ? "text-right" : "text-left"}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r.id)} className="border-t border-slate-100 hover:bg-slate-50">
                    {cols.map((c) => (
                      <td key={c.key} className={`whitespace-nowrap px-3 py-1.5 ${c.money ? "text-right tabular-nums" : ""}`}>
                        {c.money ? money(Number(r[c.key] ?? 0)) : String(r[c.key] ?? "—")}
                        {c.key === "billNo" && r.settlementSource === "client_payments" && (
                          <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] text-slate-600" title="Paid figures from the Client Payments screen / I-Spark, no HRMS receipt yet">CP</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
