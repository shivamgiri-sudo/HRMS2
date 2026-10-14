// src/components/finance/client-billing/InvoiceReferencesFields.tsx
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { checkPo, listAvailablePos } from "@/lib/clientBillingApi";
import { money } from "./shared";

export const MAX_PO_NUMBERS = 4;

export interface InvoiceReferencesDraft {
  poNumbers: string[];
  grnNo: string;
  grnDate: string;
  jccNo: string;
  jccDate: string;
  rcmApplicable: boolean;
}

export function emptyReferences(): InvoiceReferencesDraft {
  return {
    poNumbers: [],
    grnNo: "",
    grnDate: "",
    jccNo: "",
    jccDate: "",
    rcmApplicable: false,
  };
}

interface Props {
  value: InvoiceReferencesDraft;
  onChange: (next: InvoiceReferencesDraft) => void;
  costCentreId: string;
  invoiceDate: string;
  /** When the invoice total is already known (edit mode) the coverage rule is checked live. */
  grandTotal?: number;
}

/**
 * PO / GRN / JCC / RCM block for the proforma form. PO numbers are picked from the cost
 * centre's own POs whose period covers the invoice date (never typed), at most four. The
 * server re-checks every rule on save (period, remaining balance, max 4) and again under row
 * locks at approval, so the hints here are advisory.
 */
export function InvoiceReferencesFields({
  value,
  onChange,
  costCentreId,
  invoiceDate,
  grandTotal,
}: Props) {
  const posQuery = useQuery({
    queryKey: ["client-billing", "po-available", costCentreId, invoiceDate],
    queryFn: () => listAvailablePos(costCentreId, invoiceDate),
    enabled: Boolean(costCentreId && invoiceDate),
  });
  const available = posQuery.data?.data ?? [];

  const checkQuery = useQuery({
    queryKey: [
      "client-billing",
      "po-check",
      costCentreId,
      invoiceDate,
      grandTotal,
      value.poNumbers.join(","),
    ],
    queryFn: () =>
      checkPo({
        costCentreId,
        invoiceDate,
        grandTotal: grandTotal as number,
        poNumbers: value.poNumbers,
      }),
    enabled: Boolean(
      costCentreId &&
      invoiceDate &&
      grandTotal !== undefined &&
      value.poNumbers.length > 0,
    ),
  });
  const check = checkQuery.data?.data;

  const optionFor = (po: (typeof available)[number]): SearchableOption => ({
    value: po.po_number,
    label: po.po_number,
    hint: `${money(po.balance_amount)} left · to ${String(po.period_to).slice(0, 10)}`,
  });

  function optionsForSlot(slot: number): SearchableOption[] {
    const taken = new Set(value.poNumbers.filter((_, i) => i !== slot));
    const base = available
      .filter((po) => !taken.has(po.po_number))
      .map(optionFor);
    const current = value.poNumbers[slot];
    // A PO already saved on the invoice stays visible even if it no longer shows as available.
    return current && !base.some((o) => o.value === current)
      ? [{ value: current, label: current, hint: "as saved" }, ...base]
      : base;
  }

  const patch = (next: Partial<InvoiceReferencesDraft>) =>
    onChange({ ...value, ...next });
  const setPo = (slot: number, po: string) =>
    patch({ poNumbers: value.poNumbers.map((p, i) => (i === slot ? po : p)) });
  const removePo = (slot: number) =>
    patch({ poNumbers: value.poNumbers.filter((_, i) => i !== slot) });

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          PO · GRN · JCC
        </Label>
        {value.poNumbers.length < MAX_PO_NUMBERS && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!costCentreId || !invoiceDate}
            onClick={() => patch({ poNumbers: [...value.poNumbers, ""] })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add PO
          </Button>
        )}
      </div>

      {!costCentreId && (
        <p className="text-xs text-muted-foreground">
          Pick a cost centre to choose its purchase orders.
        </p>
      )}

      {value.poNumbers.map((po, slot) => (
        <div key={slot} className="flex items-center gap-2">
          <SearchableSelect
            className="flex-1"
            options={optionsForSlot(slot)}
            value={po}
            onChange={(v) => setPo(slot, v)}
            loading={posQuery.isLoading}
            placeholder="Select PO number"
            searchPlaceholder="Search PO number…"
            emptyText="No PO covers this invoice date for the cost centre."
            aria-label={`PO number ${slot + 1}`}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-rose-600"
            aria-label={`Remove PO ${slot + 1}`}
            onClick={() => removePo(slot)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      {costCentreId &&
        invoiceDate &&
        !posQuery.isLoading &&
        available.length === 0 &&
        value.poNumbers.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No purchase order with a balance covers {invoiceDate} for this cost
            centre.
          </p>
        )}

      {check && (
        <p
          className={`flex items-center gap-1 text-xs ${check.ok ? "text-emerald-700" : "text-rose-700"}`}
        >
          {check.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          {check.ok
            ? `PO balance ${money(check.totalBalance)} covers the invoice total.`
            : check.errors.join("; ")}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">GRN no.</Label>
          <Input
            aria-label="GRN no."
            className="mt-1 h-8 text-sm"
            maxLength={60}
            value={value.grnNo}
            onChange={(e) => patch({ grnNo: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs">GRN date</Label>
          <Input
            aria-label="GRN date"
            type="date"
            className="mt-1 h-8 text-sm"
            value={value.grnDate}
            onChange={(e) => patch({ grnDate: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs">JCC no.</Label>
          <Input
            aria-label="JCC no."
            className="mt-1 h-8 text-sm"
            maxLength={60}
            value={value.jccNo}
            onChange={(e) => patch({ jccNo: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-xs">JCC date</Label>
          <Input
            aria-label="JCC date"
            type="date"
            className="mt-1 h-8 text-sm"
            value={value.jccDate}
            onChange={(e) => patch({ jccDate: e.target.value })}
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <div>
          <p className="text-sm font-medium">Tax payable under RCM</p>
          <p className="text-xs text-muted-foreground">
            Prints YES on the invoice when the client pays GST under reverse
            charge.
          </p>
        </div>
        <Switch
          checked={value.rcmApplicable}
          onCheckedChange={(v) => patch({ rcmApplicable: v })}
          aria-label="Tax payable under RCM"
        />
      </div>
    </div>
  );
}

/** Draft -> API payload fields (blank text becomes undefined; blank PO slots are dropped). */
export function referencesToPayload(draft: InvoiceReferencesDraft) {
  return {
    poNumbers: draft.poNumbers.map((p) => p.trim()).filter(Boolean),
    grnNo: draft.grnNo.trim() || undefined,
    grnDate: draft.grnDate || undefined,
    jccNo: draft.jccNo.trim() || undefined,
    jccDate: draft.jccDate || undefined,
    rcmApplicable: draft.rcmApplicable,
  };
}
