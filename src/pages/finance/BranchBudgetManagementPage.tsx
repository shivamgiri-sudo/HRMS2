import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  IndianRupee,
  Loader2,
  Plus,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  budgetLineRecordToInput,
  calculateBudgetLine,
  type BranchBudgetLineInput,
  type BranchBudgetSummary,
  useBranchBudgetDetail,
  useBranchBudgets,
} from "@/hooks/useBranchBudget";
import {
  type FinanceExpenseHead,
  type FinanceExpenseSubHead,
  useFinanceExpenseMasters,
} from "@/hooks/useFinanceExpenseMasters";
import { hrmsApi } from "@/lib/hrmsApi";

const FALLBACK_UNITS = [
  "Nos",
  "Unit",
  "Seat",
  "User",
  "Employee",
  "Month",
  "Year",
  "Candidate",
  "Service",
  "Sq. Ft.",
  "Connection",
  "Device",
  "Litre",
  "Trip",
  "Shipment",
  "Campaign",
  "Event",
];
const GST_RATES = [0, 5, 12, 18, 28];
const ALLOCATION_DRIVERS = [
  ["agent_headcount", "Agent headcount"],
  ["total_manpower", "Total manpower"],
  ["revenue_share", "Revenue share"],
  ["seat_count", "Seat count"],
  ["device_count", "Device count"],
  ["floor_area", "Floor area"],
  ["usage_units", "Usage units"],
  ["hiring_volume", "Hiring volume"],
  ["direct_tagging", "Direct tagging"],
] as const;

function periodNow() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function financialYearFromPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
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

function number(value: number, digits = 2) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: digits,
  });
}

function blankLine(): BranchBudgetLineInput {
  return {
    head: "",
    subHead: "",
    itemName: "",
    itemDescription: "",
    quantity: 1,
    unit: "Unit",
    unitRate: 0,
    taxTreatment: "exclusive",
    gstRate: 18,
    gstType: "cgst_sgst",
    recoverableTaxPct: 100,
    allocationDriver: "agent_headcount",
    preferredVendorId: null,
    justification: "",
  };
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

function unwrapList(value: any): any[] {
  return value?.data ?? value ?? [];
}

function selectedHead(
  masters: FinanceExpenseHead[],
  headName: string
): FinanceExpenseHead | undefined {
  return masters.find((head) => head.headName === headName);
}

function selectedSubHead(
  masters: FinanceExpenseHead[],
  headName: string,
  subHeadName?: string | null
): FinanceExpenseSubHead | undefined {
  return selectedHead(masters, headName)?.subHeads.find(
    (subHead) => subHead.subHeadName === subHeadName
  );
}

export default function BranchBudgetManagementPage() {
  const [period, setPeriod] = useState(periodNow());
  const [branchId, setBranchId] = useState("");
  const [lines, setLines] = useState<BranchBudgetLineInput[]>([blankLine()]);
  const [savedBudgetId, setSavedBudgetId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [loadedDetailId, setLoadedDetailId] = useState<string | null>(null);

  const { budgetsQuery, saveBudget, submitBudget, reviewBudget } = useBranchBudgets({
    period,
    branchId: branchId || undefined,
  });
  const budgets = budgetsQuery.data ?? [];
  const currentBudget = budgets[0];
  const editableBudget = ["draft", "revision_required"].includes(
    currentBudget?.status ?? ""
  )
    ? currentBudget
    : undefined;
  const detailId = savedBudgetId ?? editableBudget?.id ?? null;
  const detailQuery = useBranchBudgetDetail(detailId);

  const { mastersQuery, saveHead, saveSubHead } = useFinanceExpenseMasters(true);
  const expenseMasters = mastersQuery.data ?? [];
  const activeExpenseMasters = expenseMasters.filter((head) => head.activeStatus);

  const { data: branchResponse } = useQuery({
    queryKey: ["budget-branches"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=200"),
  });
  const { data: processResponse } = useQuery({
    queryKey: ["budget-processes"],
    queryFn: () => hrmsApi.get<any>("/api/org/processes?limit=500"),
  });
  const { data: costCentreResponse } = useQuery({
    queryKey: ["budget-cost-centres"],
    queryFn: () => hrmsApi.get<any>("/api/org/cost-centres?limit=500"),
  });
  const { data: vendorResponse } = useQuery({
    queryKey: ["budget-vendors"],
    queryFn: () => hrmsApi.get<any>("/api/erp/vendors?limit=500"),
  });

  const branches = unwrapList(branchResponse).filter(
    (branch) => Number(branch.active_status ?? 1) === 1
  );
  const processes = unwrapList(processResponse).filter(
    (process) =>
      Number(process.active_status ?? 1) === 1
      && (!branchId || !process.branch_id || process.branch_id === branchId)
  );
  const costCentres = unwrapList(costCentreResponse).filter(
    (costCentre) => !branchId || !costCentre.branch_id || costCentre.branch_id === branchId
  );
  const vendors = unwrapList(vendorResponse).filter(
    (vendor) => Number(vendor.is_active ?? vendor.active_status ?? 1) === 1
  );

  useEffect(() => {
    if (!branchId) {
      setLines([blankLine()]);
      setSavedBudgetId(null);
      setLoadedDetailId(null);
      return;
    }
    if (!detailId) {
      setLines([blankLine()]);
      setLoadedDetailId(null);
    }
  }, [branchId, period, detailId]);

  useEffect(() => {
    const detail = detailQuery.data;
    if (!detail || loadedDetailId === detail.id) return;
    setSavedBudgetId(detail.id);
    setLines(
      detail.lines.length
        ? detail.lines.map(budgetLineRecordToInput)
        : [blankLine()]
    );
    setLoadedDetailId(detail.id);
  }, [detailQuery.data, loadedDetailId]);

  const totals = useMemo(
    () =>
      lines.reduce(
        (aggregate, line) => {
          const calculated = calculateBudgetLine(line);
          aggregate.base += calculated.base;
          aggregate.tax += calculated.tax;
          aggregate.gross += calculated.gross;
          aggregate.pnl += calculated.pnlCost;
          return aggregate;
        },
        { base: 0, tax: 0, gross: 0, pnl: 0 }
      ),
    [lines]
  );

  const lockedBudget = currentBudget && !editableBudget && !savedBudgetId;
  const isSaving = saveBudget.isPending || submitBudget.isPending;

  function updateLine(index: number, patch: Partial<BranchBudgetLineInput>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line
      )
    );
  }

  function applyHead(index: number, headName: string) {
    updateLine(index, {
      head: headName,
      subHead: "",
      unit: "Unit",
      taxTreatment: "exclusive",
      gstRate: 18,
      gstType: "cgst_sgst",
      recoverableTaxPct: 100,
      allocationDriver: "agent_headcount",
    });
  }

  function applySubHead(index: number, subHeadName: string) {
    const line = lines[index];
    const subHead = selectedSubHead(
      activeExpenseMasters,
      line.head,
      subHeadName
    );
    updateLine(index, {
      subHead: subHeadName,
      unit: subHead?.defaultUnit ?? line.unit,
      taxTreatment: subHead?.defaultTaxTreatment ?? line.taxTreatment,
      gstRate: subHead?.defaultGstRate ?? line.gstRate,
      gstType: subHead?.defaultGstType ?? line.gstType,
      recoverableTaxPct:
        subHead?.defaultRecoverableTaxPct ?? line.recoverableTaxPct,
      allocationDriver:
        subHead?.defaultAllocationDriver ?? line.allocationDriver,
    });
  }

  async function save(submit = false) {
    try {
      if (!branchId) throw new Error("Select branch");
      if (lockedBudget) {
        throw new Error(
          `The ${period} budget is already ${statusLabel(currentBudget.status)}`
        );
      }
      lines.forEach((line, index) => {
        if (
          !line.head
          || !line.subHead
          || !line.itemName.trim()
          || !line.unit.trim()
          || !line.justification.trim()
        ) {
          throw new Error(`Complete mandatory details in budget line ${index + 1}`);
        }
        if (Number(line.quantity) <= 0) {
          throw new Error(`Quantity must be greater than zero in line ${index + 1}`);
        }
        if (Number(line.unitRate) < 0) {
          throw new Error(`Unit rate cannot be negative in line ${index + 1}`);
        }
      });

      const result = await saveBudget.mutateAsync({
        id: savedBudgetId ?? editableBudget?.id,
        branchId,
        periodCode: period,
        financialYear: financialYearFromPeriod(period),
        lines,
      });
      setSavedBudgetId(result.id);
      setLoadedDetailId(result.id);
      if (submit) {
        await submitBudget.mutateAsync(result.id);
      }
      toast.success(
        submit ? "Budget submitted to Branch Head" : "Budget draft saved"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Budget could not be saved"
      );
    }
  }

  async function review(
    budget: BranchBudgetSummary,
    decision: "approve" | "reject" | "revision"
  ) {
    try {
      if (decision !== "approve" && !remarks.trim()) {
        throw new Error("Remarks are mandatory for rejection or revision");
      }
      await reviewBudget.mutateAsync({
        id: budget.id,
        decision,
        remarks: remarks.trim() || undefined,
      });
      toast.success(
        decision === "approve"
          ? "Budget advanced to the next approval stage"
          : "Budget decision recorded"
      );
      setRemarks("");
      if (budget.id === savedBudgetId) {
        setSavedBudgetId(null);
        setLoadedDetailId(null);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Budget review failed"
      );
    }
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.14),_transparent_26%),linear-gradient(180deg,_#f8fafc_0%,_#ffffff_44%,_#f5f7fb_100%)]">
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
            <div className="grid gap-8 p-6 lg:grid-cols-[1.5fr_0.8fr] lg:p-8">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Branch Budget Control
                </div>
                <div>
                  <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
                    Approve every cost at line-item depth before GRN consumption.
                  </h1>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
                    Branch, cost centre, process, quantity, rate, GST recovery and
                    utilization remain linked from budget approval through payment.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => void save(false)} disabled={isSaving || Boolean(lockedBudget)}>
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save draft
                  </Button>
                  <Button
                    variant="outline"
                    className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                    onClick={() => void save(true)}
                    disabled={isSaving || Boolean(lockedBudget)}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Submit to Branch Head
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="border-white/15 bg-white/5 text-white hover:bg-white/10"
                  >
                    <Link to="/finance/grn">Open GRN Management</Link>
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {[
                  ["Without tax", totals.base],
                  ["Tax budget", totals.tax],
                  ["With tax", totals.gross],
                  ["P&L cost", totals.pnl],
                ].map(([label, value]) => (
                  <Card
                    key={String(label)}
                    className="border-white/10 bg-white/5 text-white shadow-none"
                  >
                    <CardContent className="p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                        {label}
                      </p>
                      <p className="mt-2 text-2xl font-black">
                        {money(Number(value))}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </section>

          <Tabs defaultValue="create" className="space-y-5">
            <TabsList className="h-auto flex-wrap rounded-2xl bg-white p-1 shadow-sm">
              <TabsTrigger value="create">Create / resume budget</TabsTrigger>
              <TabsTrigger value="queue">Approval & utilization</TabsTrigger>
              <TabsTrigger value="masters">Expense master</TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="space-y-5">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardContent className="grid gap-4 p-5 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Period</Label>
                    <Input
                      type="month"
                      value={period}
                      onChange={(event) => {
                        setPeriod(event.target.value);
                        setSavedBudgetId(null);
                        setLoadedDetailId(null);
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Branch</Label>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={branchId}
                      onChange={(event) => {
                        setBranchId(event.target.value);
                        setSavedBudgetId(null);
                        setLoadedDetailId(null);
                      }}
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
                    <Label>Financial year</Label>
                    <Input value={financialYearFromPeriod(period)} readOnly />
                  </div>
                </CardContent>
              </Card>

              {lockedBudget && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <AlertCircle className="mt-0.5 h-4 w-4" />
                  <div>
                    <p className="font-semibold">
                      {currentBudget.budget_number} is {statusLabel(currentBudget.status)}
                    </p>
                    <p className="mt-1 text-amber-700">
                      The monthly budget is read-only until Finance requests a revision.
                    </p>
                  </div>
                </div>
              )}

              {detailQuery.isLoading && detailId ? (
                <div className="flex items-center justify-center rounded-3xl border border-slate-200 bg-white py-20">
                  <Loader2 className="h-7 w-7 animate-spin text-slate-500" />
                </div>
              ) : (
                <div className="space-y-4">
                  {lines.map((line, index) => {
                    const calculation = calculateBudgetLine(line);
                    const head = selectedHead(activeExpenseMasters, line.head);
                    const subHeads = head?.subHeads.filter(
                      (subHead) => subHead.activeStatus
                    ) ?? [];
                    const unitOptions = Array.from(
                      new Set([
                        line.unit,
                        ...subHeads.map((subHead) => subHead.defaultUnit),
                        ...FALLBACK_UNITS,
                      ])
                    ).filter(Boolean);

                    return (
                      <Card
                        key={line.id ?? index}
                        className="rounded-3xl border-slate-200 shadow-sm"
                      >
                        <CardHeader className="flex flex-row items-center justify-between">
                          <div>
                            <CardTitle className="text-base">
                              Budget line {index + 1}
                            </CardTitle>
                            <p className="mt-1 text-xs text-slate-500">
                              Every quantity and amount remains available for GRN validation.
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={Boolean(lockedBudget)}
                            onClick={() =>
                              setLines((current) =>
                                current.length === 1
                                  ? current
                                  : current.filter((_, lineIndex) => lineIndex !== index)
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4 text-rose-500" />
                          </Button>
                        </CardHeader>

                        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <div className="space-y-2">
                            <Label>Cost centre</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={line.costCentreId ?? ""}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) => {
                                const costCentre = costCentres.find(
                                  (item) => item.id === event.target.value
                                );
                                updateLine(index, {
                                  costCentreId: event.target.value || null,
                                  processId:
                                    costCentre?.process_id ?? line.processId ?? null,
                                });
                              }}
                            >
                              <option value="">Branch/common</option>
                              {costCentres.map((costCentre) => (
                                <option key={costCentre.id} value={costCentre.id}>
                                  {costCentre.cost_centre_name ?? costCentre.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label>Process</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={line.processId ?? ""}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, {
                                  processId: event.target.value || null,
                                })
                              }
                            >
                              <option value="">Shared/all processes</option>
                              {processes.map((process) => (
                                <option key={process.id} value={process.id}>
                                  {process.process_name ?? process.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label>Head *</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={line.head}
                              disabled={Boolean(lockedBudget) || mastersQuery.isLoading}
                              onChange={(event) => applyHead(index, event.target.value)}
                            >
                              <option value="">Select head</option>
                              {activeExpenseMasters.map((expenseHead) => (
                                <option key={expenseHead.id} value={expenseHead.headName}>
                                  {expenseHead.headName}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label>Sub-head *</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={line.subHead ?? ""}
                              disabled={Boolean(lockedBudget) || !line.head}
                              onChange={(event) => applySubHead(index, event.target.value)}
                            >
                              <option value="">Select sub-head</option>
                              {subHeads.map((subHead) => (
                                <option key={subHead.id} value={subHead.subHeadName}>
                                  {subHead.subHeadName}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2 xl:col-span-2">
                            <Label>Item / service *</Label>
                            <Input
                              value={line.itemName}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, { itemName: event.target.value })
                              }
                              placeholder="Specific item or service being budgeted"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Preferred vendor</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={line.preferredVendorId ?? ""}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, {
                                  preferredVendorId: event.target.value || null,
                                })
                              }
                            >
                              <option value="">Not fixed</option>
                              {vendors.map((vendor) => (
                                <option key={vendor.id} value={vendor.id}>
                                  {vendor.vendor_code ? `${vendor.vendor_code} · ` : ""}
                                  {vendor.vendor_name ?? vendor.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label>Allocation driver</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={line.allocationDriver ?? ""}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, {
                                  allocationDriver: event.target.value,
                                })
                              }
                            >
                              {ALLOCATION_DRIVERS.map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label>Quantity *</Label>
                            <Input
                              type="number"
                              min="0.0001"
                              step="0.0001"
                              value={line.quantity}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, {
                                  quantity: Number(event.target.value),
                                })
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Unit *</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={line.unit}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, { unit: event.target.value })
                              }
                            >
                              {unitOptions.map((unit) => (
                                <option key={unit} value={unit}>
                                  {unit}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label>Unit rate *</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.unitRate}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, {
                                  unitRate: Number(event.target.value),
                                })
                              }
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>Tax treatment</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={line.taxTreatment}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, {
                                  taxTreatment: event.target.value as BranchBudgetLineInput["taxTreatment"],
                                })
                              }
                            >
                              <option value="exclusive">Tax exclusive</option>
                              <option value="inclusive">Tax inclusive</option>
                              <option value="exempt">Exempt</option>
                              <option value="reverse_charge">Reverse charge</option>
                              <option value="non_gst">Non-GST</option>
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label>GST rate</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={line.gstRate}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, {
                                  gstRate: Number(event.target.value),
                                })
                              }
                            >
                              {GST_RATES.map((rate) => (
                                <option key={rate} value={rate}>
                                  {rate}%
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label>GST type</Label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              value={line.gstType}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, {
                                  gstType: event.target.value as BranchBudgetLineInput["gstType"],
                                })
                              }
                            >
                              <option value="cgst_sgst">CGST + SGST</option>
                              <option value="igst">IGST</option>
                              <option value="none">None</option>
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label>Recoverable GST %</Label>
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              value={line.recoverableTaxPct}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, {
                                  recoverableTaxPct: Number(event.target.value),
                                })
                              }
                            />
                          </div>

                          <div className="space-y-2 md:col-span-2 xl:col-span-4">
                            <Label>Description</Label>
                            <Textarea
                              value={line.itemDescription ?? ""}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, {
                                  itemDescription: event.target.value,
                                })
                              }
                              placeholder="Specifications, service period or scope"
                            />
                          </div>

                          <div className="space-y-2 md:col-span-2 xl:col-span-4">
                            <Label>Business justification *</Label>
                            <Textarea
                              value={line.justification}
                              disabled={Boolean(lockedBudget)}
                              onChange={(event) =>
                                updateLine(index, {
                                  justification: event.target.value,
                                })
                              }
                              placeholder="Explain the operational requirement and basis for quantity/rate"
                            />
                          </div>

                          <div className="grid gap-3 md:col-span-2 sm:grid-cols-4 xl:col-span-4">
                            {[
                              ["Without tax", calculation.base],
                              ["Tax", calculation.tax],
                              ["With tax", calculation.gross],
                              ["P&L cost", calculation.pnlCost],
                            ].map(([label, value]) => (
                              <div key={String(label)} className="rounded-2xl bg-slate-50 p-3">
                                <p className="text-xs text-slate-500">{label}</p>
                                <p className="font-bold">{money(Number(value))}</p>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              <Button
                variant="outline"
                className="w-full rounded-2xl border-dashed py-6"
                disabled={Boolean(lockedBudget)}
                onClick={() => setLines((current) => [...current, blankLine()])}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add budget line
              </Button>
            </TabsContent>

            <TabsContent value="queue" className="space-y-4">
              <Card className="rounded-3xl border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle>Budget approval and utilization</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    placeholder="Mandatory remarks for rejection or revision"
                    value={remarks}
                    onChange={(event) => setRemarks(event.target.value)}
                  />

                  {budgets.map((budget) => {
                    const available =
                      Number(budget.gross_budget_amount)
                      - Number(budget.reserved_amount)
                      - Number(budget.consumed_amount);
                    const canReview = [
                      "submitted",
                      "branch_head_approved",
                      "finance_head_approved",
                    ].includes(budget.status);

                    return (
                      <div
                        key={budget.id}
                        className="grid gap-4 rounded-2xl border border-slate-200 p-4 xl:grid-cols-[1.35fr_0.9fr_0.9fr_0.9fr_auto]"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">{budget.budget_number}</p>
                            <Badge variant="outline">
                              {statusLabel(budget.status)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-slate-500">
                            {budget.branch_name} · {budget.period_code} · Revision{" "}
                            {budget.revision_no} · {budget.line_count} lines
                          </p>
                        </div>
                        <MetricCell
                          label="Without tax / Tax"
                          value={`${money(Number(budget.base_budget_amount))} / ${money(
                            Number(budget.tax_budget_amount)
                          )}`}
                        />
                        <MetricCell
                          label="With tax / P&L"
                          value={`${money(Number(budget.gross_budget_amount))} / ${money(
                            Number(budget.pnl_budget_amount)
                          )}`}
                        />
                        <MetricCell
                          label="Reserved / Consumed / Available"
                          value={`${money(Number(budget.reserved_amount))} / ${money(
                            Number(budget.consumed_amount)
                          )} / ${money(available)}`}
                        />
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {canReview && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => void review(budget, "approve")}
                                disabled={reviewBudget.isPending}
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void review(budget, "revision")}
                                disabled={reviewBudget.isPending}
                              >
                                <Settings2 className="mr-1 h-3.5 w-3.5" />
                                Revision
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => void review(budget, "reject")}
                                disabled={reviewBudget.isPending}
                              >
                                <XCircle className="mr-1 h-3.5 w-3.5" />
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {!budgetsQuery.isLoading && !budgets.length && (
                    <div className="py-12 text-center text-slate-500">
                      <Building2 className="mx-auto mb-3 h-10 w-10" />
                      No budget found for the selected branch and period.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="masters" className="space-y-5">
              <ExpenseMasterPanel
                masters={expenseMasters}
                isLoading={mastersQuery.isLoading}
                isSaving={saveHead.isPending || saveSubHead.isPending}
                onSaveHead={async (payload) => {
                  try {
                    await saveHead.mutateAsync(payload);
                    toast.success("Expense head saved");
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Expense head could not be saved"
                    );
                  }
                }}
                onSaveSubHead={async (payload) => {
                  try {
                    await saveSubHead.mutateAsync(payload);
                    toast.success("Expense sub-head saved");
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Expense sub-head could not be saved"
                    );
                  }
                }}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function ExpenseMasterPanel({
  masters,
  isLoading,
  isSaving,
  onSaveHead,
  onSaveSubHead,
}: {
  masters: FinanceExpenseHead[];
  isLoading: boolean;
  isSaving: boolean;
  onSaveHead: (payload: {
    headName: string;
    headCode?: string;
    description?: string;
    displayOrder?: number;
  }) => Promise<void>;
  onSaveSubHead: (payload: {
    headId: string;
    subHeadName: string;
    subHeadCode?: string;
    defaultUnit: string;
    defaultTaxTreatment: BranchBudgetLineInput["taxTreatment"];
    defaultGstRate: number;
    defaultGstType: NonNullable<BranchBudgetLineInput["gstType"]>;
    defaultRecoverableTaxPct: number;
    defaultAllocationDriver?: string | null;
    pnlTreatment: "operating_expense";
  }) => Promise<void>;
}) {
  const [headForm, setHeadForm] = useState({
    headName: "",
    headCode: "",
    description: "",
  });
  const [subHeadForm, setSubHeadForm] = useState({
    headId: "",
    subHeadName: "",
    subHeadCode: "",
    defaultUnit: "Unit",
    defaultTaxTreatment: "exclusive" as BranchBudgetLineInput["taxTreatment"],
    defaultGstRate: 18,
    defaultGstType: "cgst_sgst" as NonNullable<BranchBudgetLineInput["gstType"]>,
    defaultRecoverableTaxPct: 100,
    defaultAllocationDriver: "agent_headcount",
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <div className="space-y-5">
        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Add expense head</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Head name</Label>
              <Input
                value={headForm.headName}
                onChange={(event) =>
                  setHeadForm((current) => ({
                    ...current,
                    headName: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Head code (optional)</Label>
              <Input
                value={headForm.headCode}
                onChange={(event) =>
                  setHeadForm((current) => ({
                    ...current,
                    headCode: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={headForm.description}
                onChange={(event) =>
                  setHeadForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            <Button
              className="w-full"
              disabled={isSaving || !headForm.headName.trim()}
              onClick={async () => {
                await onSaveHead({
                  headName: headForm.headName,
                  headCode: headForm.headCode || undefined,
                  description: headForm.description || undefined,
                });
                setHeadForm({ headName: "", headCode: "", description: "" });
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Save head
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Add expense sub-head</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Parent head</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subHeadForm.headId}
                onChange={(event) =>
                  setSubHeadForm((current) => ({
                    ...current,
                    headId: event.target.value,
                  }))
                }
              >
                <option value="">Select head</option>
                {masters.map((head) => (
                  <option key={head.id} value={head.id}>
                    {head.headName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Sub-head name</Label>
              <Input
                value={subHeadForm.subHeadName}
                onChange={(event) =>
                  setSubHeadForm((current) => ({
                    ...current,
                    subHeadName: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Default unit</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subHeadForm.defaultUnit}
                onChange={(event) =>
                  setSubHeadForm((current) => ({
                    ...current,
                    defaultUnit: event.target.value,
                  }))
                }
              >
                {FALLBACK_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Allocation driver</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subHeadForm.defaultAllocationDriver}
                onChange={(event) =>
                  setSubHeadForm((current) => ({
                    ...current,
                    defaultAllocationDriver: event.target.value,
                  }))
                }
              >
                {ALLOCATION_DRIVERS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Tax treatment</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subHeadForm.defaultTaxTreatment}
                onChange={(event) =>
                  setSubHeadForm((current) => ({
                    ...current,
                    defaultTaxTreatment: event.target
                      .value as BranchBudgetLineInput["taxTreatment"],
                  }))
                }
              >
                <option value="exclusive">Tax exclusive</option>
                <option value="inclusive">Tax inclusive</option>
                <option value="exempt">Exempt</option>
                <option value="reverse_charge">Reverse charge</option>
                <option value="non_gst">Non-GST</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>GST rate</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subHeadForm.defaultGstRate}
                onChange={(event) =>
                  setSubHeadForm((current) => ({
                    ...current,
                    defaultGstRate: Number(event.target.value),
                  }))
                }
              >
                {GST_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}%
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>GST type</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={subHeadForm.defaultGstType}
                onChange={(event) =>
                  setSubHeadForm((current) => ({
                    ...current,
                    defaultGstType: event.target.value as NonNullable<
                      BranchBudgetLineInput["gstType"]
                    >,
                  }))
                }
              >
                <option value="cgst_sgst">CGST + SGST</option>
                <option value="igst">IGST</option>
                <option value="none">None</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Recoverable GST %</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={subHeadForm.defaultRecoverableTaxPct}
                onChange={(event) =>
                  setSubHeadForm((current) => ({
                    ...current,
                    defaultRecoverableTaxPct: Number(event.target.value),
                  }))
                }
              />
            </div>
            <Button
              className="md:col-span-2"
              disabled={
                isSaving
                || !subHeadForm.headId
                || !subHeadForm.subHeadName.trim()
              }
              onClick={async () => {
                await onSaveSubHead({
                  ...subHeadForm,
                  subHeadCode: subHeadForm.subHeadCode || undefined,
                  pnlTreatment: "operating_expense",
                });
                setSubHeadForm((current) => ({
                  ...current,
                  subHeadName: "",
                  subHeadCode: "",
                }));
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Save sub-head
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-3xl border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Current Head/Sub-Head master</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            masters.map((head) => (
              <div key={head.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{head.headName}</p>
                    <p className="text-xs text-slate-500">{head.headCode}</p>
                  </div>
                  <Badge variant={head.activeStatus ? "default" : "outline"}>
                    {head.activeStatus ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {head.subHeads.map((subHead) => (
                    <div key={subHead.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{subHead.subHeadName}</p>
                        <span className="text-xs text-slate-500">
                          {subHead.defaultUnit}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {subHead.defaultTaxTreatment.replaceAll("_", " ")} ·{" "}
                        {subHead.defaultGstRate}% ·{" "}
                        {subHead.defaultAllocationDriver?.replaceAll("_", " ") ||
                          "No default allocation"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
