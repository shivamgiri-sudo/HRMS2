// src/components/finance/client-billing/BillingScopeSelects.tsx
/**
 * Company + Branch pickers — the first two filters on every legacy I-Spark billing screen
 * (Initial Invoice, View & Approve Proforma, Invoice Approval, Download Initial Invoice).
 * Options come from GET /api/client-billing/filter-options (active MAS cost centres only),
 * and `narrowCostCentres` applies the same pair to a cost-centre list so the cost-centre
 * dropdown only offers what belongs to the chosen company / branch.
 */
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { SearchableOption } from "@/components/ui/searchable-select";
import { getBillingFilterOptions, type BillingCostCentreOption } from "@/lib/clientBillingApi";

const ALL = "_all";

export function useBillingFilterOptions() {
  return useQuery({
    queryKey: ["client-billing", "filter-options"],
    queryFn: () => getBillingFilterOptions(),
    staleTime: 5 * 60_000,
  });
}

export function narrowCostCentres(
  costCentres: BillingCostCentreOption[],
  companyName: string,
  branchId: string,
): BillingCostCentreOption[] {
  return costCentres.filter(
    (cc) => (!companyName || cc.company_name === companyName) && (!branchId || cc.branch_id === branchId),
  );
}

export function costCentreSearchOptions(costCentres: BillingCostCentreOption[]): SearchableOption[] {
  return costCentres.map((cc) => ({
    value: cc.id,
    label: cc.client_name ? `${cc.cost_centre_code} · ${cc.client_name}` : cc.cost_centre_code,
    hint: cc.branch_name ?? undefined,
    keywords: `${cc.cost_centre_name ?? ""} ${cc.client_name ?? ""} ${cc.branch_name ?? ""} ${cc.company_name ?? ""}`,
  }));
}

export function BillingScopeSelects({
  companyName, branchId, onChange, disabled = false, compact = false, labelled = false,
}: {
  companyName: string;
  branchId: string;
  onChange: (next: { companyName: string; branchId: string }) => void;
  disabled?: boolean;
  /** Toolbar size (h-8, narrow) vs form size. */
  compact?: boolean;
  /** Form layout: each select in its own cell with a label above it. */
  labelled?: boolean;
}) {
  const options = useBillingFilterOptions().data?.data;
  const companies = options?.companies ?? [];
  // Branches offered = those that have an active cost centre under the chosen company.
  const branchIds = new Set(
    (options?.costCentres ?? [])
      .filter((cc) => !companyName || cc.company_name === companyName)
      .map((cc) => cc.branch_id),
  );
  const branches = (options?.branches ?? []).filter((b) => branchIds.has(b.id));
  const trigger = (w: string) => (compact ? `h-8 ${w} text-xs` : "mt-1 h-8 w-full text-sm");
  const cell = (label: string, control: ReactNode) =>
    labelled ? <div><Label className="text-xs">{label}</Label>{control}</div> : control;

  return (
    <>
      {cell("Company", <Select
        value={companyName || ALL}
        disabled={disabled}
        onValueChange={(v) => onChange({ companyName: v === ALL ? "" : v, branchId: "" })}
      >
        <SelectTrigger className={trigger("w-44")} aria-label="Company">
          <SelectValue placeholder="Company" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All companies</SelectItem>
          {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>)}
      {cell("Branch", <Select
        value={branchId || ALL}
        disabled={disabled}
        onValueChange={(v) => onChange({ companyName, branchId: v === ALL ? "" : v })}
      >
        <SelectTrigger className={trigger("w-32")} aria-label="Branch">
          <SelectValue placeholder="Branch" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All branches</SelectItem>
          {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
        </SelectContent>
      </Select>)}
    </>
  );
}
