// src/components/finance/client-billing/CreateProformaSheet.tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useCostCentreList } from "@/hooks/useCostCentreManagement";
import { createProforma, type CreateProformaPayload } from "@/lib/clientBillingApi";
import { LineItemsEditor, emptyLine, type LineItemDraft } from "./LineItemsEditor";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CreateProformaSheet({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [costCentreId, setCostCentreId] = useState("");
  const [category, setCategory] = useState("");
  const [financeYear, setFinanceYear] = useState("");
  const [monthLabel, setMonthLabel] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [applyGst, setApplyGst] = useState(true);
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);

  // Reusing the same cost-centre list hook/table the Cost Centre Management page uses
  // (src/hooks/useCostCentreManagement.ts's useCostCentreList) rather than building a
  // new fetch — only "active" cost centres are billable.
  const costCentreQuery = useCostCentreList({ status: "active", limit: 500 });
  const costCentreOptions: SearchableOption[] = (costCentreQuery.data?.data ?? []).map((cc) => ({
    value: cc.id,
    label: cc.cost_centre_name || cc.cost_centre_code || cc.id,
    hint: cc.cost_centre_code,
    keywords: `${cc.client_name ?? ""} ${cc.billing_client_name ?? ""} ${cc.branch_name ?? ""}`,
  }));

  useEffect(() => {
    if (!open) {
      setCostCentreId("");
      setCategory("");
      setFinanceYear("");
      setMonthLabel("");
      setInvoiceDate(todayISO());
      setDescription("");
      setApplyGst(true);
      setLines([emptyLine()]);
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: (payload: CreateProformaPayload) => createProforma(payload),
    onSuccess: (res) => {
      toast({ title: "Proforma created", description: res.data?.proformaNo });
      void queryClient.invalidateQueries({ queryKey: ["client-billing", "proformas"] });
      onCreated();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Could not create proforma", description: error.message, variant: "destructive" });
    },
  });

  const validLines = lines.filter((l) => l.particulars.trim() && Number(l.qty) > 0 && l.rate !== "");
  const canSubmit = Boolean(
    costCentreId && category.trim() && financeYear.trim() && monthLabel.trim() && invoiceDate && validLines.length > 0
  );

  function submit() {
    createMutation.mutate({
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
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[520px] max-w-full flex-col gap-0 p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">New Proforma</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div>
            <Label className="text-xs">Cost centre *</Label>
            <SearchableSelect
              className="mt-1"
              options={costCentreOptions}
              value={costCentreId}
              onChange={setCostCentreId}
              loading={costCentreQuery.isLoading}
              placeholder="Select cost centre"
              searchPlaceholder="Search by name, code, client…"
              emptyText="No active cost centres found."
              aria-label="Cost centre"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Finance year *</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="2026-27"
                value={financeYear}
                onChange={(e) => setFinanceYear(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Month label *</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Aug-26"
                value={monthLabel}
                onChange={(e) => setMonthLabel(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Category *</Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Subscription / Non Subscription"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
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
                IGST vs CGST/SGST is decided by the cost centre&rsquo;s own GST type.
              </p>
            </div>
            <Switch checked={applyGst} onCheckedChange={setApplyGst} />
          </div>

          <LineItemsEditor lines={lines} onChange={setLines} showLineType />
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
            Create Proforma
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
