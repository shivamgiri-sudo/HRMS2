import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  FilePlus,
  IndianRupee,
  Loader2,
  RotateCcw,
  Save,
  Send,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { calculateBudgetLine } from "@/hooks/useBranchBudget";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

type GrnType = "vendor" | "imprest";

type BudgetLine = {
  id: string;
  budget_id: string;
  budget_number: string;
  period_code: string;
  process_id: string | null;
  process_name: string | null;
  cost_centre_id: string | null;
  cost_centre_name: string | null;
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
  head: string;
  sub_head: string | null;
  item_name: string;
  unit: string;
  unit_rate: number;
  tax_treatment: "inclusive" | "exclusive" | "exempt" | "reverse_charge" | "non_gst";
  gst_rate: number;
  gst_type: "cgst_sgst" | "igst" | "none";
  recoverable_tax_pct: number;
  justification: string;
  available_quantity: number;
  available_gross_amount: number;
};

type GrnFormState = {
  grnType: GrnType;
  branchId: string;
  budgetLineId: string;
  vendorId: string;
  quantity: number;
  unitRate: number;
  billDate: string;
  paymentTermsDays: number;
  remarks: string;
};

type CreatedGrn = {
  id: string;
  grnNumber: string;
  attachmentUploaded: boolean;
  submitted: boolean;
};

const EMPTY_FORM: GrnFormState = {
  grnType: "vendor",
  branchId: "",
  budgetLineId: "",
  vendorId: "",
  quantity: 1,
  unitRate: 0,
  billDate: "",
  paymentTermsDays: 30,
  remarks: "",
};

function financialYearFromPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return "—";
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function decimal(value: number) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 4,
  });
}

function unwrapList(value: any): any[] {
  return value?.data ?? value ?? [];
}

export function BudgetLinkedGrnForm() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<GrnFormState>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [created, setCreated] = useState<CreatedGrn | null>(null);

  const period = form.billDate ? form.billDate.slice(0, 7) : "";

  const { data: branchResponse } = useQuery({
    queryKey: ["grn-budget-branches"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=200"),
  });
  const { data: vendorResponse } = useQuery({
    queryKey: ["grn-budget-vendors"],
    queryFn: () => hrmsApi.get<any>("/api/erp/vendors?limit=500"),
  });

  const branches = unwrapList(branchResponse);
  const vendors = unwrapList(vendorResponse).filter(
    (vendor) => Number(vendor.is_active ?? vendor.active_status ?? 1) === 1
  );

  const { data: lineResponse, isLoading: linesLoading } = useQuery({
    queryKey: ["available-budget-lines", form.branchId, period],
    enabled: Boolean(form.branchId && period && !created),
    queryFn: () =>
      hrmsApi.get<any>(
        `/api/finance/pnl/budget-lines/available?branchId=${encodeURIComponent(
          form.branchId
        )}&period=${encodeURIComponent(period)}`
      ),
  });

  const budgetLines = unwrapList(lineResponse) as BudgetLine[];
  const selected = budgetLines.find((line) => line.id === form.budgetLineId);
  const availableQuantity = Number(selected?.available_quantity ?? 0);
  const availableGross = Number(selected?.available_gross_amount ?? 0);

  const calculation = useMemo(
    () =>
      selected
        ? calculateBudgetLine({
            head: selected.head,
            itemName: selected.item_name,
            quantity: Number(form.quantity),
            unit: selected.unit,
            unitRate: Number(form.unitRate),
            taxTreatment: selected.tax_treatment,
            gstRate: Number(selected.gst_rate),
            gstType: selected.gst_type,
            recoverableTaxPct: Number(selected.recoverable_tax_pct),
            justification: selected.justification,
          })
        : null,
    [form.quantity, form.unitRate, selected]
  );

  function resetForm() {
    setForm(EMPTY_FORM);
    setFile(null);
    setCreated(null);
  }

  const saveMutation = useMutation({
    mutationFn: async (submit: boolean) => {
      if (!form.branchId) throw new Error("Select branch");
      if (!form.billDate) throw new Error("Bill / receipt date is required");
      if (!selected && !created) throw new Error("Select an approved budget line");
      if (submit && !file && !created?.attachmentUploaded) {
        throw new Error("Invoice / supporting attachment is mandatory before submission");
      }
      if (form.grnType === "vendor" && !form.vendorId) {
        throw new Error("Select an active vendor from Vendor Master");
      }
      if (!created) {
        if (!selected) throw new Error("Select an approved budget line");
        if (Number(form.quantity) <= 0) {
          throw new Error("Quantity must be greater than zero");
        }
        if (Number(form.quantity) > availableQuantity + 0.0001) {
          throw new Error(
            `Quantity exceeds available budget quantity ${decimal(availableQuantity)}`
          );
        }
        if (Number(form.unitRate) > Number(selected.unit_rate) + 0.0001) {
          throw new Error("Unit rate exceeds the approved budget rate");
        }
        if ((calculation?.gross ?? 0) > availableGross + 0.01) {
          throw new Error("GRN total exceeds the available approved budget");
        }
      }

      let current = created;
      if (!current) {
        const result = await hrmsApi.post<{ id: string; grnNumber: string }>(
          "/api/finance/grns",
          {
            grnType: form.grnType,
            branchId: form.branchId,
            budgetLineId: selected!.id,
            processId: selected!.process_id ?? undefined,
            costCentreId: selected!.cost_centre_id ?? undefined,
            vendorId: form.grnType === "vendor" ? form.vendorId : undefined,
            quantity: Number(form.quantity),
            unitRate: Number(form.unitRate),
            billDate: form.billDate,
            paymentTermsDays: Number(form.paymentTermsDays),
            remarks: form.remarks || undefined,
            financialYear: financialYearFromPeriod(selected!.period_code),
          }
        );
        current = {
          ...result,
          attachmentUploaded: false,
          submitted: false,
        };
        setCreated(current);
      }

      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        await hrmsApi.postForm(
          `/api/finance/grns/${current.id}/attachment`,
          formData
        );
        current = { ...current, attachmentUploaded: true };
        setCreated(current);
        setFile(null);
      }

      if (submit && !current.submitted) {
        await hrmsApi.post(`/api/finance/grns/${current.id}/submit`, {});
        current = { ...current, submitted: true };
        setCreated(current);
      }

      return current;
    },
    onSuccess: (result, submit) => {
      toast({
        title: submit ? "GRN submitted to Branch Head" : "GRN draft saved",
        description: result.grnNumber,
      });
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
      void queryClient.invalidateQueries({ queryKey: ["available-budget-lines"] });
    },
    onError: (error: Error) =>
      toast({
        title: "GRN could not be saved",
        description: error.message,
        variant: "destructive",
      }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {created && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-emerald-900">{created.grnNumber}</p>
            <p className="text-xs text-emerald-700">
              {created.submitted
                ? "Submitted to the Branch Head approval queue."
                : "Draft saved. Add proof and submit this same GRN when ready."}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={resetForm}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Start another
          </Button>
        </div>
      )}

      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="flex items-center gap-2 text-base">
            <FilePlus className="h-4 w-4 text-[#073f78]" />
            Create GRN against approved budget
          </CardTitle>
        </CardHeader>

        <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label>GRN type *</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.grnType}
              disabled={Boolean(created)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  grnType: event.target.value as GrnType,
                  vendorId: event.target.value === "vendor" ? current.vendorId : "",
                }))
              }
            >
              <option value="vendor">Vendor GRN</option>
              <option value="imprest">Imprest GRN</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label>Branch *</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.branchId}
              disabled={Boolean(created)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  branchId: event.target.value,
                  budgetLineId: "",
                }))
              }
            >
              <option value="">Select branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.branch_name ?? branch.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>Bill / receipt date *</Label>
            <Input
              type="date"
              value={form.billDate}
              disabled={Boolean(created)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  billDate: event.target.value,
                  budgetLineId: "",
                }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label>Financial year</Label>
            <Input value={financialYearFromPeriod(period)} readOnly />
          </div>

          <div className="space-y-2 md:col-span-2 xl:col-span-4">
            <div className="flex items-center justify-between">
              <Label>Approved budget line *</Label>
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link to="/finance/branch-budget">Open branch budget</Link>
              </Button>
            </div>
            <select
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              disabled={!form.branchId || !period || linesLoading || Boolean(created)}
              value={form.budgetLineId}
              onChange={(event) => {
                const line = budgetLines.find((item) => item.id === event.target.value);
                const quantity = Math.min(1, Number(line?.available_quantity ?? 1));
                setForm((current) => ({
                  ...current,
                  budgetLineId: event.target.value,
                  quantity,
                  unitRate: Number(line?.unit_rate ?? 0),
                  vendorId: line?.preferred_vendor_id ?? "",
                }));
              }}
            >
              <option value="">
                {linesLoading ? "Loading approved lines…" : "Select approved budget line"}
              </option>
              {budgetLines.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.budget_number} · {line.head} / {line.sub_head || "General"} ·{" "}
                  {line.item_name} · Qty {decimal(Number(line.available_quantity))} ·{" "}
                  {money(Number(line.available_gross_amount))}
                </option>
              ))}
            </select>
          </div>

          {form.branchId && period && !linesLoading && !budgetLines.length && !created && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 md:col-span-2 xl:col-span-4">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              No active approved budget line is available for {period}. Complete Branch
              Head, Finance Head and Accounts Head approval first.
            </div>
          )}

          {selected && !created && (
            <>
              <div className="space-y-2 xl:col-span-2">
                <Label>Budget item</Label>
                <Input
                  value={`${selected.head} / ${selected.sub_head || "General"} — ${
                    selected.item_name
                  }`}
                  readOnly
                />
              </div>
              <div className="space-y-2">
                <Label>Cost centre</Label>
                <Input value={selected.cost_centre_name ?? "Branch/common"} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Process</Label>
                <Input value={selected.process_name ?? "Shared/all processes"} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Quantity *</Label>
                <Input
                  type="number"
                  min="0.0001"
                  max={availableQuantity}
                  step="0.0001"
                  value={form.quantity}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      quantity: Number(event.target.value),
                    }))
                  }
                />
                <p className="text-[11px] text-slate-500">
                  Available: {decimal(availableQuantity)} {selected.unit}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Input value={selected.unit} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Unit rate *</Label>
                <Input
                  type="number"
                  min="0"
                  max={Number(selected.unit_rate)}
                  step="0.01"
                  value={form.unitRate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      unitRate: Number(event.target.value),
                    }))
                  }
                />
                <p className="text-[11px] text-slate-500">
                  Approved maximum: {money(Number(selected.unit_rate))}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Tax</Label>
                <Input
                  value={`${selected.tax_treatment.replaceAll("_", " ")} · ${Number(
                    selected.gst_rate
                  )}% · ${selected.gst_type.replaceAll("_", " + ")}`}
                  readOnly
                />
              </div>
            </>
          )}

          {form.grnType === "vendor" && (
            <div className="space-y-2 md:col-span-2 xl:col-span-4">
              <Label>Vendor *</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.vendorId}
                disabled={Boolean(created)}
                onChange={(event) =>
                  setForm((current) => ({ ...current, vendorId: event.target.value }))
                }
              >
                <option value="">Select active vendor from Vendor Master</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.vendor_code ? `${vendor.vendor_code} · ` : ""}
                    {vendor.vendor_name ?? vendor.name}
                  </option>
                ))}
              </select>
              {selected?.preferred_vendor_id && !created && (
                <p className="text-[11px] text-slate-500">
                  Budget preference: {selected.preferred_vendor_name ?? "Mapped vendor"}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Payment terms</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.paymentTermsDays}
              disabled={Boolean(created)}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  paymentTermsDays: Number(event.target.value),
                }))
              }
            >
              {[0, 7, 15, 30, 45, 60, 90].map((days) => (
                <option key={days} value={days}>
                  {days === 0 ? "Immediate" : `${days} days`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 md:col-span-1 xl:col-span-3">
            <Label>
              Invoice / supporting proof {created?.attachmentUploaded ? "" : "* before submit"}
            </Label>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 text-sm text-slate-600">
              <Upload className="h-4 w-4" />
              <span className="truncate">
                {created?.attachmentUploaded
                  ? "Proof uploaded"
                  : file?.name ?? "Upload PDF or image"}
              </span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                disabled={created?.submitted}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              {file && <X className="ml-auto h-4 w-4" />}
            </label>
          </div>

          <div className="space-y-2 md:col-span-2 xl:col-span-4">
            <Label>Remarks</Label>
            <Textarea
              value={form.remarks}
              disabled={Boolean(created)}
              onChange={(event) =>
                setForm((current) => ({ ...current, remarks: event.target.value }))
              }
              placeholder="Purpose, receipt details and any exception note"
            />
          </div>

          {calculation && !created && (
            <div className="grid gap-3 md:col-span-2 sm:grid-cols-4 xl:col-span-4">
              {[
                ["Without tax", calculation.base],
                ["Tax", calculation.tax],
                ["With tax", calculation.gross],
                ["P&L cost", calculation.pnlCost],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 flex items-center font-bold text-slate-900">
                    <IndianRupee className="h-3.5 w-3.5" />
                    {Number(value).toLocaleString("en-IN", {
                      maximumFractionDigits: 2,
                    })}
                  </p>
                </div>
              ))}
              <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-4">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-slate-500">Approved amount still available</span>
                  <span className="font-semibold text-slate-900">
                    {money(availableGross)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </CardContent>

        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 bg-slate-50/60 p-5">
          {!created && (
            <Button
              variant="outline"
              onClick={() => saveMutation.mutate(false)}
              disabled={saveMutation.isPending}
            >
              <Save className="mr-2 h-4 w-4" />
              Save draft
            </Button>
          )}
          {!created?.submitted && (
            <Button
              className="bg-[#073f78] hover:bg-[#052d57]"
              onClick={() => saveMutation.mutate(true)}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {created ? "Upload & submit saved draft" : "Save & submit"}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
