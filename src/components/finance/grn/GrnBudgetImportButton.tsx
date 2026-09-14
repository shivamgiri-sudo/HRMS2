import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import {
  BranchBudgetImportDialog,
  type ExpenseHeadOption,
} from "@/components/finance/pnl/BranchBudgetImportDialog";
import { useFinanceExpenseMasters } from "@/hooks/useFinanceExpenseMasters";
import { GrnButton } from "@/components/finance/grn/grn-ui";
import {
  budgetLineRecordToInput,
  useBranchBudgets,
  type BranchBudgetDetail,
  type BranchBudgetLineInput,
} from "@/hooks/useBranchBudget";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * "Import budget from Excel", on the GRN form.
 *
 * The dialog itself is the one the Branch Budget page uses, imported rather than reimplemented.
 * That is the whole point: the 18 column headers, the 9 required ones, the enum whitelists, the
 * manual-allocation parsing and the downloadable template are defined once, in
 * BranchBudgetImportDialog. A second copy here would read identically on the day it was written
 * and drift the first time someone edits one of them — this repo already carries a comment about
 * a bug caused by a fourth copy of the sharing-method list.
 *
 * What differs is what happens after parsing. On the Branch Budget page the dialog hands its rows
 * to an on-screen Plan Builder and the user presses "Save draft" separately. There is no Plan
 * Builder here, so this component persists them itself — see onImport below for why that is more
 * than a single POST.
 */

/** April–March, matching financialYearFromPeriod on the backend, which rejects a mismatch. */
function financialYearOf(period: string) {
  const [year, month] = period.split("-").map(Number);
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

/** Statuses saveDraft will accept. Anything else it refuses, or would silently reopen. */
const APPENDABLE_STATUSES = ["draft", "revision_required", "submitted"];

type LookupOption = { id: string; code: string; name: string };

function unwrapList(response: any): any[] {
  return response?.data ?? response?.rows ?? (Array.isArray(response) ? response : []);
}

/** Same three endpoints and the same query keys the Branch Budget page uses, so opening this
 *  dialog from either place hits one cache rather than two, and resolves against one list. */
function useLookup(key: string, url: string, enabled: boolean) {
  return useQuery({
    queryKey: [key],
    enabled,
    queryFn: () => hrmsApi.get<any>(url),
  });
}

export function GrnBudgetImportButton({
  branchId,
  period,
  disabled,
}: {
  branchId: string;
  /** "YYYY-MM" — the GRN's own bill-date month, so an import lands where the GRN will look. */
  period: string;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const ready = Boolean(branchId) && /^\d{4}-\d{2}$/.test(period);

  // Only fetched once the dialog is opened — three lookups on every GRN page load, for a button
  // most sessions never press, is not a trade worth making.
  const costCentreQuery = useLookup("budget-cost-centres", "/api/org/cost-centres?limit=500", open && ready);
  const processQuery = useLookup("budget-processes", "/api/org/processes?limit=500", open && ready);
  const vendorQuery = useLookup("budget-vendors", "/api/erp/vendors?limit=500", open && ready);

  // Filtered exactly as the Branch Budget page filters them, so a code that resolves there
  // resolves here and a code that does not, does not.
  const costCentres: LookupOption[] = unwrapList(costCentreQuery.data)
    .filter((item) => !branchId || !item.branch_id || item.branch_id === branchId)
    .map((r) => ({ id: r.id, code: r.cost_centre_code ?? r.code ?? "", name: r.cost_centre_name ?? r.name ?? "" }));
  const processes: LookupOption[] = unwrapList(processQuery.data)
    .filter((item) => Number(item.active_status ?? 1) === 1 && (!branchId || !item.branch_id || item.branch_id === branchId))
    .map((r) => ({ id: r.id, code: r.process_code ?? r.code ?? "", name: r.process_name ?? r.name ?? "" }));
  const vendors: LookupOption[] = unwrapList(vendorQuery.data)
    .filter((item) => Number(item.is_active ?? item.active_status ?? 1) === 1)
    .map((r) => ({ id: r.id, code: r.vendor_code ?? r.code ?? "", name: r.vendor_name ?? r.name ?? "" }));

  // The expense master, so Head and Sub-head are resolved rather than taken on trust. Only the
  // active heads and sub-heads: importing against a retired head would recreate spend under
  // something finance has deliberately closed.
  const { mastersQuery } = useFinanceExpenseMasters(false);
  const heads: ExpenseHeadOption[] = (mastersQuery.data ?? [])
    .filter((head) => head.activeStatus)
    .map((head) => ({
      headName: head.headName,
      subHeads: head.subHeads.filter((sub) => sub.activeStatus).map((sub) => sub.subHeadName),
    }));

  const lookupsLoading =
    costCentreQuery.isLoading || processQuery.isLoading || vendorQuery.isLoading || mastersQuery.isLoading;

  const { saveBudget } = useBranchBudgets({ branchId, period });

  /**
   * Persist the imported lines.
   *
   * saveDraft on the backend replaces a budget's lines wholesale — it DELETEs every row for the
   * branch/month and re-inserts what it was sent. Posting only the imported lines would therefore
   * silently destroy a draft someone had already built. So: read the existing budget first, and
   * send its lines back alongside the new ones.
   */
  async function handleImport(newLines: BranchBudgetLineInput[]) {
    if (!newLines.length) return;
    setSaving(true);
    try {
      const list = await hrmsApi.get<any>(
        `/api/finance/pnl/budgets?branchId=${branchId}&period=${period}`
      );
      const existingSummary = (list?.data ?? [])[0] ?? null;

      let existingLines: BranchBudgetLineInput[] = [];
      if (existingSummary) {
        if (!APPENDABLE_STATUSES.includes(String(existingSummary.status))) {
          toast({
            title: "This month's budget is already past draft",
            description:
              `The ${period} budget for this branch is "${existingSummary.status}". Imported lines were not saved — ` +
              "raise a top-up request instead, or ask for it to be sent back for revision.",
            variant: "destructive",
          });
          return;
        }
        const detail = await hrmsApi.get<{ success: boolean; data: BranchBudgetDetail }>(
          `/api/finance/pnl/budgets/${existingSummary.id}`
        );
        existingLines = (detail?.data?.lines ?? []).map(budgetLineRecordToInput);
      }

      await saveBudget.mutateAsync({
        id: existingSummary?.id,
        branchId,
        periodCode: period,
        financialYear: financialYearOf(period),
        lines: [...existingLines, ...newLines],
      });

      toast({
        title: `${newLines.length} budget line(s) imported`,
        description: existingLines.length
          ? `Added to the existing ${period} draft, which now has ${existingLines.length + newLines.length} lines. Submit it for approval before GRNs can consume it.`
          : `Saved as a new ${period} draft. Submit it for approval before GRNs can consume it.`,
      });

      // The GRN form only offers *approved* lines, so nothing appears here until this draft is
      // approved — but refresh anyway so the branch/period budget views are not stale.
      // "branch-budget-allocations" was invalidated here and is not a key any query uses — the
      // real ones are branch-budget-detail (the lines this import just wrote) and
      // available-budget-lines (what the GRN form offers once they are approved).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["branch-budgets"] }),
        queryClient.invalidateQueries({ queryKey: ["branch-budget-detail"] }),
        queryClient.invalidateQueries({ queryKey: ["available-budget-lines"] }),
      ]);
      // Close instead of letting the dialog advance to its own result step: that step's copy
      // ends "nothing is saved yet", which is true on the Branch Budget page and false here.
      setOpen(false);
    } catch (error) {
      toast({
        title: "Budget import could not be saved",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <GrnButton
        disabled={disabled || !ready || saving}
        title={ready ? `Import budget lines for ${period}` : "Select a branch and an invoice date first"}
        onClick={() => setOpen(true)}
      >
        {saving || (open && lookupsLoading)
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <FileSpreadsheet className="h-3 w-3" />}
        Import budget from Excel
      </GrnButton>

      {/* Mounted only once the lookups have arrived. Opening it early would let someone paste
          rows that fail with 'Cost centre "X" was not found' purely because the list was still
          in flight. */}
      {open && !lookupsLoading && (
        <BranchBudgetImportDialog
          open={open}
          onOpenChange={setOpen}
          costCentres={costCentres}
          processes={processes}
          vendors={vendors}
          heads={heads}
          onImport={(lines) => void handleImport(lines)}
        />
      )}
    </>
  );
}
