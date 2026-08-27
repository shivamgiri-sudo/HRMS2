// src/components/finance/client-billing/CreateCreditNoteSheet.tsx
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import {
  createCreditNote, type CreateCreditNotePayload, type InvoiceRow,
} from "@/lib/clientBillingApi";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { LineItemsEditor, emptyLine, type LineItemDraft } from "./LineItemsEditor";
import { money } from "./shared";
import {
  BILLING_CATEGORY_OPTIONS, currentFinanceYear, financeYearOptions, monthLabelOptions, todayLocalISO,
} from "./billingFieldOptions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Approved invoices only — a credit note can only be issued against `invoice_status='approved'`
   *  (client-billing-credit-note.service.ts's own guard). Sourced from the Invoices tab's own
   *  query rather than a second fetch, per the design doc's "searchable select over the Invoices
   *  tab's own data". */
  approvedInvoices: InvoiceRow[];
  onCreated: () => void;
}


export function CreateCreditNoteSheet({ open, onOpenChange, approvedInvoices, onCreated }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [invoiceId, setInvoiceId] = useState("");
  const [category, setCategory] = useState("");
  const [financeYear, setFinanceYear] = useState(currentFinanceYear());
  const [monthLabel, setMonthLabel] = useState("");
  const [creditDate, setCreditDate] = useState(todayLocalISO());
  const [description, setDescription] = useState("");
  const [applyGst, setApplyGst] = useState(true);
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);

  const invoiceOptions: SearchableOption[] = approvedInvoices.map((inv) => ({
    value: inv.id,
    label: inv.bill_no || inv.proforma_no || inv.id,
    hint: money(inv.grand_total),
    keywords: `${inv.category} ${inv.month_label} ${inv.finance_year}`,
  }));

  useEffect(() => {
    if (!open) {
      setInvoiceId("");
      setCategory("");
      setFinanceYear(currentFinanceYear());
      setMonthLabel("");
      setCreditDate(todayLocalISO());
      setDescription("");
      setApplyGst(true);
      setLines([emptyLine()]);
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: (payload: CreateCreditNotePayload) => createCreditNote(payload),
    onSuccess: (res) => {
      toast({ title: "Credit note created", description: res.data?.creditNo ?? undefined });
      void queryClient.invalidateQueries({ queryKey: ["client-billing", "credit-notes"] });
      onCreated();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Could not create credit note", description: error.message, variant: "destructive" });
    },
  });

  const validLines = lines.filter((l) => l.particulars.trim() && Number(l.qty) > 0 && l.rate !== "");
  const canSubmit = Boolean(
    invoiceId && category.trim() && financeYear.trim() && monthLabel.trim() && creditDate && validLines.length > 0
  );

  function submit() {
    createMutation.mutate({
      invoiceId,
      category: category.trim(),
      financeYear: financeYear.trim(),
      monthLabel: monthLabel.trim(),
      creditDate,
      description: description.trim() || undefined,
      applyGst,
      lines: validLines.map((l) => ({
        particulars: l.particulars.trim(),
        qty: Number(l.qty),
        rate: Number(l.rate),
      })),
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[520px] max-w-full flex-col gap-0 p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">New Credit Note</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div>
            <Label className="text-xs">Against invoice *</Label>
            <SearchableSelect
              className="mt-1"
              options={invoiceOptions}
              value={invoiceId}
              onChange={setInvoiceId}
              placeholder="Select approved invoice"
              searchPlaceholder="Search by bill no, category, month…"
              emptyText="No approved invoices found."
              aria-label="Invoice"
            />
            {approvedInvoices.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                No approved invoices yet — approve a proforma first.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Closed sets, same reasoning as CreateProformaSheet — see
                billingFieldOptions.ts. The credit-note number is scoped by finance year
                too, so a typo here restarts that counter as well. */}
            <div>
              <Label className="text-xs">Finance year *</Label>
              <Select
                value={financeYear}
                onValueChange={(v) => { setFinanceYear(v); setMonthLabel(""); }}
              >
                <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Finance year">
                  <SelectValue placeholder="Select finance year" />
                </SelectTrigger>
                <SelectContent>
                  {financeYearOptions().map((fy) => (
                    <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Month label *</Label>
              <Select value={monthLabel} onValueChange={setMonthLabel} disabled={!financeYear}>
                <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Month label">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {monthLabelOptions(financeYear).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Category *</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Credit date *</Label>
              <Input
                type="date"
                className="mt-1 h-8 text-sm"
                value={creditDate}
                onChange={(e) => setCreditDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Description</Label>
            <Textarea
              className="mt-1 min-h-[56px] text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Apply GST</p>
              <p className="text-xs text-muted-foreground">
                IGST vs CGST/SGST is decided by the underlying cost centre&rsquo;s GST type.
              </p>
            </div>
            <Switch checked={applyGst} onCheckedChange={setApplyGst} />
          </div>

          <LineItemsEditor lines={lines} onChange={setLines} />
        </div>

        <SheetFooter className="border-t px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit || createMutation.isPending}
            onClick={submit}
          >
            {createMutation.isPending
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Send className="mr-1.5 h-3.5 w-3.5" />}
            Create Credit Note
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
