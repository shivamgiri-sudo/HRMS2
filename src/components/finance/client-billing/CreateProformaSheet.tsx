// src/components/finance/client-billing/CreateProformaSheet.tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Send } from "lucide-react";
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
import { useCostCentreList } from "@/hooks/useCostCentreManagement";
import {
  createProforma,
  getProforma,
  updateProforma,
  type CreateProformaPayload,
  type InvoiceDetail,
} from "@/lib/clientBillingApi";
import {
  LineItemsEditor,
  emptyLine,
  type LineItemDraft,
} from "./LineItemsEditor";
import { PeriodCategoryFields } from "./PeriodCategoryFields";
import {
  InvoiceReferencesFields,
  emptyReferences,
  referencesToPayload,
  type InvoiceReferencesDraft,
} from "./InvoiceReferencesFields";
import { currentFinanceYear, todayLocalISO } from "./billingFieldOptions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  /** When set the sheet edits this PROFORMA (header + lines + PO/GRN/JCC) instead of creating one. */
  editInvoiceId?: string | null;
}

const toDateInput = (value: string | null | undefined) =>
  value ? String(value).slice(0, 10) : "";

function referencesFromInvoice(invoice: InvoiceDetail): InvoiceReferencesDraft {
  return {
    poNumbers: (invoice.po_numbers ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
    grnNo: invoice.grn_no ?? "",
    grnDate: toDateInput(invoice.grn_date),
    jccNo: invoice.jcc_no ?? "",
    jccDate: toDateInput(invoice.jcc_date),
    rcmApplicable: Boolean(invoice.rcm_applicable),
  };
}

function hasAnyReference(draft: InvoiceReferencesDraft): boolean {
  return Boolean(
    draft.poNumbers.some((p) => p.trim()) ||
    draft.grnNo.trim() ||
    draft.grnDate ||
    draft.jccNo.trim() ||
    draft.jccDate ||
    draft.rcmApplicable,
  );
}

export function CreateProformaSheet({
  open,
  onOpenChange,
  onCreated,
  editInvoiceId = null,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = Boolean(editInvoiceId);

  const [costCentreId, setCostCentreId] = useState("");
  const [category, setCategory] = useState("");
  const [financeYear, setFinanceYear] = useState(currentFinanceYear());
  const [monthLabel, setMonthLabel] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayLocalISO());
  const [description, setDescription] = useState("");
  const [applyGst, setApplyGst] = useState(true);
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [references, setReferences] =
    useState<InvoiceReferencesDraft>(emptyReferences());

  // Reusing the same cost-centre list hook/table the Cost Centre Management page uses
  // (src/hooks/useCostCentreManagement.ts's useCostCentreList) rather than building a
  // new fetch — only "active" cost centres are billable.
  const costCentreQuery = useCostCentreList({ status: "active", limit: 500 });
  const costCentreOptions: SearchableOption[] = (
    costCentreQuery.data?.data ?? []
  ).map((cc) => ({
    value: cc.id,
    label: cc.cost_centre_name || cc.cost_centre_code || cc.id,
    hint: cc.cost_centre_code,
    keywords: `${cc.client_name ?? ""} ${cc.billing_client_name ?? ""} ${cc.branch_name ?? ""}`,
  }));

  const detailQuery = useQuery({
    queryKey: ["client-billing", "proforma-edit", editInvoiceId],
    queryFn: () => getProforma(editInvoiceId as string),
    enabled: open && isEdit,
  });
  const editing = detailQuery.data?.data;

  useEffect(() => {
    if (!open) {
      setCostCentreId("");
      setCategory("");
      setFinanceYear(currentFinanceYear());
      setMonthLabel("");
      setInvoiceDate(todayLocalISO());
      setDescription("");
      setApplyGst(true);
      setLines([emptyLine()]);
      setReferences(emptyReferences());
    }
  }, [open]);

  useEffect(() => {
    if (!editing) return;
    setCostCentreId(editing.cost_centre_id);
    setCategory(editing.category);
    setFinanceYear(editing.finance_year);
    setMonthLabel(editing.month_label);
    setInvoiceDate(toDateInput(editing.invoice_date));
    setDescription(editing.description ?? "");
    setApplyGst(Boolean(editing.apply_gst));
    setLines(
      editing.lines.length > 0
        ? editing.lines.map((l) => ({
            particulars: l.particulars,
            qty: String(l.qty),
            rate: String(l.rate),
            lineType: l.line_type,
          }))
        : [emptyLine()],
    );
    setReferences(referencesFromInvoice(editing));
  }, [editing]);

  const saveMutation = useMutation({
    mutationFn: async (payload: CreateProformaPayload) => {
      if (isEdit && editInvoiceId) {
        const { costCentreId: _ignored, ...rest } = payload;
        void _ignored;
        return updateProforma(editInvoiceId, rest);
      }
      return createProforma(payload);
    },
    onSuccess: (res) => {
      if (isEdit) {
        const data = res.data as { changed?: string[] };
        toast({
          title: "Proforma updated",
          description: data.changed?.length
            ? `${data.changed.length} change(s) recorded in the audit log`
            : undefined,
        });
      } else {
        toast({
          title: "Proforma created",
          description: (res.data as { proformaNo?: string }).proformaNo,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
      onCreated();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: isEdit
          ? "Could not update proforma"
          : "Could not create proforma",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const validLines = lines.filter(
    (l) => l.particulars.trim() && Number(l.qty) > 0 && l.rate !== "",
  );
  const canSubmit = Boolean(
    costCentreId &&
    category.trim() &&
    financeYear.trim() &&
    monthLabel.trim() &&
    invoiceDate &&
    validLines.length > 0,
  );

  function submit() {
    const refPayload =
      hasAnyReference(references) || isEdit
        ? referencesToPayload(references)
        : {};
    saveMutation.mutate({
      costCentreId,
      category: category.trim(),
      financeYear: financeYear.trim(),
      monthLabel: monthLabel.trim(),
      invoiceDate,
      description: description.trim() || undefined,
      applyGst,
      lines: validLines.map((l) => ({
        particulars: l.particulars.trim(),
        qty: Number(l.qty),
        rate: Number(l.rate),
        lineType: l.lineType,
      })),
      ...refPayload,
    });
  }

  const loadingEdit = isEdit && detailQuery.isLoading;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:w-[min(60vw,1200px)] sm:max-w-none"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">
            {isEdit
              ? `Edit Proforma ${editing?.proforma_no ?? ""}`
              : "New Proforma"}
          </SheetTitle>
        </SheetHeader>

        {loadingEdit ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            <div>
              <Label className="text-xs">Cost centre *</Label>
              <SearchableSelect
                className="mt-1"
                options={costCentreOptions}
                value={costCentreId}
                onChange={setCostCentreId}
                loading={costCentreQuery.isLoading}
                disabled={isEdit}
                placeholder="Select cost centre"
                searchPlaceholder="Search by name, code, client…"
                emptyText="No active cost centres found."
                aria-label="Cost centre"
              />
              {isEdit && (
                <p className="mt-1 text-xs text-muted-foreground">
                  The cost centre is fixed once a proforma number has been
                  issued.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Finance year, month and category are closed sets, not free text — see
                  billingFieldOptions.ts for why a typo in any of the three corrupts data
                  rather than merely looking untidy. */}
              <PeriodCategoryFields
                financeYear={financeYear}
                monthLabel={monthLabel}
                category={category}
                onFinanceYearChange={setFinanceYear}
                onMonthLabelChange={setMonthLabel}
                onCategoryChange={setCategory}
              />
              <div>
                <Label className="text-xs">Invoice date *</Label>
                <Input
                  type="date"
                  className="mt-1 h-8 text-sm"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
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
                  IGST vs CGST/SGST is derived from our state and the
                  client&rsquo;s GSTIN state (place of supply).
                </p>
              </div>
              <Switch
                checked={applyGst}
                onCheckedChange={setApplyGst}
                aria-label="Apply GST"
              />
            </div>

            <InvoiceReferencesFields
              value={references}
              onChange={setReferences}
              costCentreId={costCentreId}
              invoiceDate={invoiceDate}
              grandTotal={editing ? Number(editing.grand_total) : undefined}
            />

            <LineItemsEditor lines={lines} onChange={setLines} showLineType />
          </div>
        )}

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
            disabled={!canSubmit || saveMutation.isPending || loadingEdit}
            onClick={submit}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : isEdit ? (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            {isEdit ? "Save changes" : "Create Proforma"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
