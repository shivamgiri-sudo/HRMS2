import { useMemo, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";
import { money } from "@/components/finance/grn/grn-format";
import { useHasRole } from "@/hooks/useUserRole";
import {
  useBelowTheLineCostMutations,
  useBelowTheLineCosts,
  type BelowTheLineCostType,
  type BelowTheLineEntry,
} from "@/hooks/useBelowTheLineCost";

const WRITE_ROLES = ["super_admin", "admin", "finance", "finance_head", "accounts_head", "payroll_head"] as const;

const CATEGORIES: { value: BelowTheLineCostType; label: string; hint: string }[] = [
  { value: "depreciation", label: "Depreciation", hint: "Computers, furniture, vehicles etc. — from your asset register" },
  { value: "finance_cost", label: "Finance cost", hint: "Interest on term loans and the working-capital limit" },
  { value: "tax", label: "Tax provision", hint: "Provision for income tax on profit" },
];

function inr(value: number) {
  return money(value, 0);
}

interface RowFormState {
  amountInr: string;
  description: string;
  sourceReference: string;
}

function emptyRowForm(): RowFormState {
  return { amountInr: "", description: "", sourceReference: "" };
}

/**
 * Below-the-line costs — Depreciation, Finance Cost and Tax Provision, entered by Finance once a
 * month so Live P&L can show a "True Bottom Line (PAT)" alongside its Operating Profit %.
 *
 * This app doesn't calculate these — Finance already computes them from the asset register and
 * loan schedule outside this app. This screen is just where that already-computed total gets
 * recorded, company-wide (never split across branches or cost centres). See
 * backend/src/modules/process-pnl/pnl-reconciliation.service.ts's readBelowTheLine().
 */
export function BelowTheLinePanel() {
  const canWrite = useHasRole(...WRITE_ROLES);
  const today = new Date();
  const [period, setPeriod] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const entriesQuery = useBelowTheLineCosts(period);
  const { save } = useBelowTheLineCostMutations();

  const [editing, setEditing] = useState<BelowTheLineCostType | null>(null);
  const [forms, setForms] = useState<Record<BelowTheLineCostType, RowFormState>>({
    depreciation: emptyRowForm(),
    finance_cost: emptyRowForm(),
    tax: emptyRowForm(),
  });

  const entries = entriesQuery.data ?? [];
  const byType = useMemo(
    () => new Map(entries.map((e) => [e.costType, e])) as Map<BelowTheLineCostType, BelowTheLineEntry>,
    [entries],
  );
  const total = entries.reduce((sum, e) => sum + e.amountInr, 0);

  function startEdit(type: BelowTheLineCostType) {
    const existing = byType.get(type);
    setForms((current) => ({
      ...current,
      [type]: existing
        ? { amountInr: String(existing.amountInr), description: existing.description, sourceReference: existing.sourceReference ?? "" }
        : emptyRowForm(),
    }));
    setEditing(type);
  }

  async function saveRow(type: BelowTheLineCostType) {
    const form = forms[type];
    const amountInr = Number(form.amountInr);
    if (!Number.isFinite(amountInr) || amountInr < 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!form.description.trim()) {
      toast.error("A short description is required");
      return;
    }
    try {
      await save.mutateAsync({
        id: byType.get(type)?.id,
        periodCode: period,
        costType: type,
        description: form.description.trim(),
        amountInr,
        sourceReference: form.sourceReference.trim() || null,
      });
      toast.success(`${CATEGORIES.find((c) => c.value === type)?.label} saved for ${period}`);
      setEditing(null);
    } catch (error: any) {
      toast.error(error?.response?.data?.message ?? "Could not save this entry");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Below-the-line costs</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Depreciation, finance cost and tax, entered once a month, company-wide — the figures behind Live P&L's
          "True Bottom Line (PAT)". This app doesn't calculate these; type in what your asset register and loan
          schedule already say. Never split across branches or cost centres.
        </p>
        <div className="mt-3">
          <Label className="text-xs">Period</Label>
          <MonthYearPicker value={period} onChange={setPeriod} className="mt-1 w-48" />
        </div>

        {entriesQuery.isLoading ? (
          <Skeleton className="mt-4 h-32 w-full" />
        ) : (
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Description / source</TableHead>
                {canWrite && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {CATEGORIES.map((cat) => {
                const existing = byType.get(cat.value);
                const isEditing = editing === cat.value;
                const form = forms[cat.value];
                return (
                  <TableRow key={cat.value}>
                    <TableCell className="align-top text-xs font-medium">
                      {cat.label}
                      <p className="mt-0.5 text-[11px] font-normal text-slate-400">{cat.hint}</p>
                    </TableCell>
                    {isEditing ? (
                      <>
                        <TableCell className="align-top">
                          <Input
                            type="number"
                            className="h-8 w-32 text-xs"
                            value={form.amountInr}
                            onChange={(e) => setForms((c) => ({ ...c, [cat.value]: { ...c[cat.value], amountInr: e.target.value } }))}
                            placeholder="Amount (Rs)"
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Textarea
                            className="h-14 text-xs"
                            value={form.description}
                            onChange={(e) => setForms((c) => ({ ...c, [cat.value]: { ...c[cat.value], description: e.target.value } }))}
                            placeholder="e.g. As per depreciation schedule, FY26-27"
                          />
                          <Input
                            className="mt-1 h-7 text-xs"
                            value={form.sourceReference}
                            onChange={(e) => setForms((c) => ({ ...c, [cat.value]: { ...c[cat.value], sourceReference: e.target.value } }))}
                            placeholder="Source reference (optional)"
                          />
                        </TableCell>
                        <TableCell className="text-right align-top">
                          <span className="inline-flex items-center gap-1">
                            <Button size="sm" onClick={() => saveRow(cat.value)} disabled={save.isPending}>
                              {save.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                          </span>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="align-top text-xs">{existing ? inr(existing.amountInr) : <span className="text-slate-400">Not entered</span>}</TableCell>
                        <TableCell className="align-top max-w-sm truncate text-xs text-slate-500" title={existing?.description ?? ""}>
                          {existing?.description ?? "—"}
                        </TableCell>
                        {canWrite && (
                          <TableCell className="text-right align-top">
                            <Button size="sm" variant="ghost" onClick={() => startEdit(cat.value)}>
                              <Pencil className="mr-1 h-3.5 w-3.5" /> {existing ? "Edit" : "Enter"}
                            </Button>
                          </TableCell>
                        )}
                      </>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <div className="mt-3 rounded-md border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Total for {period}: <span className="font-semibold text-slate-700 dark:text-slate-200">{inr(total)}</span> — this is subtracted from
          Operating Profit on the Live P&L page to show True Bottom Line (PAT). It never changes any branch or cost-centre figure.
        </div>
      </div>
    </div>
  );
}
