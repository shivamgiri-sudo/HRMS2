// src/components/finance/client-billing/PoPicker.tsx
/**
 * PO No. on the proforma: picked from the cost centre's POs whose period covers the invoice date
 * and that still have balance (never typed), at most four, with a live coverage check against the
 * grand total. The server re-checks the same rule on save and again under locks at approval.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { checkPo, listAvailablePos } from "@/lib/clientBillingApi";
import { money } from "./shared";

export function PoPicker({ costCentreId, invoiceDate, grandTotal, value, onChange }: {
  costCentreId: string;
  invoiceDate: string;
  grandTotal: number;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const pos = useQuery({
    queryKey: ["client-billing", "po-available", costCentreId, invoiceDate],
    queryFn: () => listAvailablePos(costCentreId, invoiceDate),
    enabled: Boolean(costCentreId && invoiceDate),
  });
  const check = useQuery({
    queryKey: ["client-billing", "po-check", costCentreId, invoiceDate, grandTotal, value],
    queryFn: () => checkPo({ costCentreId, invoiceDate, grandTotal, poNumbers: value }),
    enabled: Boolean(costCentreId && invoiceDate && value.length > 0 && grandTotal > 0),
  });
  const available = pos.data?.data ?? [];
  const options = available
    .filter((p) => !value.includes(p.po_number))
    .map((p) => ({
      value: p.po_number,
      label: p.po_number,
      hint: `${String(p.period_from).slice(0, 10)} → ${String(p.period_to).slice(0, 10)} · balance ${money(p.balance_amount)}`,
    }));
  const result = check.data?.data;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {value.map((po) => (
          <span key={po} className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-900 ring-1 ring-sky-200">
            {po}
            <button type="button" aria-label={`Remove PO ${po}`} className="cursor-pointer rounded hover:bg-sky-100" onClick={() => onChange(value.filter((v) => v !== po))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      {value.length < 4 && (
        <SearchableSelect
          options={options}
          value=""
          onChange={(v) => v && onChange([...value, v])}
          placeholder={!costCentreId ? "Pick cost centre first" : pos.isLoading ? "Loading POs…" : available.length ? "Add PO…" : "No PO covers this date"}
          searchPlaceholder="Search PO number…"
          emptyText="No PO with balance covers the invoice date."
          disabled={!costCentreId || !invoiceDate}
          aria-label="PO No."
        />
      )}
      {result && !result.ok && (
        <p className="flex items-start gap-1 text-xs text-rose-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{result.errors.join("; ")}</p>
      )}
      {result?.ok && (
        <p className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3 w-3" />PO balance {money(result.totalBalance)} covers this bill</p>
      )}
    </div>
  );
}
