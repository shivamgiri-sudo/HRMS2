// src/components/finance/client-billing/CreateCreditNoteSheet.tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import {
  createCreditNote,
  listProformas,
  type CreateCreditNotePayload,
  type InvoiceRow,
} from "@/lib/clientBillingApi";
import { PeriodCategoryFields } from "./PeriodCategoryFields";
import {
  LineItemsEditor,
  emptyLine,
  type LineItemDraft,
} from "./LineItemsEditor";
import { InlineError, money } from "./shared";
import { currentFinanceYear, todayLocalISO } from "./billingFieldOptions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  /** Pre-selected invoice ("Raise credit note" on a Download Initial Invoice row). */
  initialInvoice?: InvoiceRow | null;
}

export function CreateCreditNoteSheet({
  open,
  onOpenChange,
  onCreated,
  initialInvoice = null,
}: Props) {
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

  // Server-side search over every approved invoice (bill no., proforma no., client) — a
  // credit note is only allowed against invoice_status='approved' (credit-note service guard).
  // The old picker preloaded 200 rows and silently could not find anything older.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search.trim(), 300);
  const [selected, setSelected] = useState<InvoiceRow | null>(null);
  const invoicesQuery = useQuery({
    queryKey: ["client-billing", "credit-note-invoice-picker", debouncedSearch],
    queryFn: () => listProformas({ status: "approved", search: debouncedSearch || undefined, limit: 50 }),
    enabled: open,
  });
  const found = invoicesQuery.data?.data ?? [];
  const pickerRows = selected && !found.some((r) => r.id === selected.id) ? [selected, ...found] : found;
  const invoiceOptions: SearchableOption[] = pickerRows.map((inv) => ({
    value: inv.id,
    label: inv.bill_no || inv.proforma_no || inv.id,
    hint: `${inv.cost_centre_display_name ?? ""} ${money(inv.grand_total)}`.trim(),
    keywords: `${inv.category} ${inv.month_label} ${inv.finance_year}`,
  }));

  useEffect(() => {
    if (open && initialInvoice) {
      setSelected(initialInvoice);
      setInvoiceId(initialInvoice.id);
    }
  }, [open, initialInvoice]);


  const createMutation = useMutation({
    mutationFn: (payload: CreateCreditNotePayload) => createCreditNote(payload),
    onSuccess: (res) => {
      toast({
        title: "Credit note created",
        description: res.data?.creditNo ?? undefined,
      });
      void queryClient.invalidateQueries({
        queryKey: ["client-billing", "credit-notes"],
      });
      onCreated();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not create credit note",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSelected(null);
      createMutation.reset();
      setInvoiceId("");
      setCategory("");
      setFinanceYear(currentFinanceYear());
      setMonthLabel("");
      setCreditDate(todayLocalISO());
      setDescription("");
      setApplyGst(true);
      setLines([emptyLine()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const validLines = lines.filter(
    (l) => l.particulars.trim() && Number(l.qty) > 0 && l.rate !== "",
  );
  const canSubmit = Boolean(
    invoiceId &&
    category.trim() &&
    financeYear.trim() &&
    monthLabel.trim() &&
    creditDate &&
    validLines.length > 0,
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
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:w-[min(60vw,1200px)] sm:max-w-none"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">
            New Credit Note
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div>
            <Label className="text-xs">Against invoice *</Label>
            <SearchableSelect
              className="mt-1"
              options={invoiceOptions}
              value={invoiceId}
              onChange={(id) => {
                setInvoiceId(id);
                setSelected(pickerRows.find((r) => r.id === id) ?? null);
              }}
              search={search}
              onSearchChange={setSearch}
              loading={invoicesQuery.isFetching}
              placeholder="Select approved invoice"
              searchPlaceholder="Search bill no., proforma no., client…"
              emptyText={invoicesQuery.isError ? "Could not load invoices." : "No approved invoice matches."}
              aria-label="Invoice"
            />
            {invoicesQuery.isError && (
              <p className="mt-1 text-xs text-rose-700">
                Could not search invoices: {(invoicesQuery.error as Error).message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Closed sets, same reasoning as CreateProformaSheet — see
                billingFieldOptions.ts. The credit-note number is scoped by finance year
                too, so a typo here restarts that counter as well. */}
            <PeriodCategoryFields
              financeYear={financeYear}
              monthLabel={monthLabel}
              category={category}
              onFinanceYearChange={setFinanceYear}
              onMonthLabelChange={setMonthLabel}
              onCategoryChange={setCategory}
            />
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
                IGST vs CGST/SGST is decided by the underlying cost
                centre&rsquo;s GST type.
              </p>
            </div>
            <Switch checked={applyGst} onCheckedChange={setApplyGst} />
          </div>

          <LineItemsEditor lines={lines} onChange={setLines} />
          {createMutation.isError && (
            <InlineError title="Could not create credit note" message={createMutation.error.message} />
          )}
        </div>

        <SheetFooter className="border-t px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit || createMutation.isPending}
            onClick={submit}
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            Create Credit Note
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
