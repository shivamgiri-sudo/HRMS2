import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { useHasRole } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import {
  dateTimeLabel,
  grnStatusTone,
  labelStatus,
  money,
} from "@/components/finance/grn/grn-format";
import {
  GRN_TR,
  GrnCard,
  GrnCardHeader,
  GrnCellSub,
  GrnChip,
  GrnEmptyState,
  GrnIconButton,
  GrnInput,
  GrnSearchInput,
  GrnTable,
  GrnTd,
  GrnTh,
} from "@/components/finance/grn/grn-ui";
// Same pattern BudgetLinkedGrnForm uses for its vendor picker: vendor_master holds ~1.8k rows,
// so it is searched server-side rather than dumped into the DOM as a plain <select>.
import { SearchableSelect } from "@/components/ui/searchable-select";
import { GrnDetailDrawer } from "@/components/finance/grn/GrnDetailDrawer";

function unwrapList<T>(response: any): T[] {
  return (response?.data?.data ?? response?.data ?? response ?? []) as T[];
}

type GrnHistoryRow = {
  id: string;
  grn_number: string;
  grn_type: "vendor" | "imprest";
  branch_name?: string | null;
  vendor_name?: string | null;
  amount?: number | null;
  amount_with_tax?: number | null;
  status: string;
  created_at?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  submitted_at?: string | null;
  branch_head_reviewed_at?: string | null;
  branch_head_reviewed_by_name?: string | null;
  finance_head_reviewed_at?: string | null;
  finance_head_reviewed_by_name?: string | null;
  rejection_reason?: string | null;
  source_type?: 'new' | 'legacy' | null;
  /** db_bill never captured WHY a GRN was rejected (verified: 0 of 2,107 rejected vendor rows
   *  across its full history carry a RejectRemarks value) — only who and when. Shown alongside
   *  rejection_reason rather than folded into it, since one can be present without the other. */
  legacy_rejected_by_name?: string | null;
};

/** Longer than the redesign mock's six chips on purpose: every entry past "Rejected" is a real
 *  backend status, and dropping one removes the only way to filter for it.
 *  returned_to_* are written by the backend but omitted from the GrnStatus union type; they appear
 *  here so they can be isolated and acted on. */
const STATUS_TABS = [
  ["_all", "All"],
  ["draft", "Draft"],
  ["submitted", "Branch Head Queue"],
  ["branch_head_approved", "Finance Head Queue"],
  ["returned_to_raiser", "Returned to You"],
  ["returned_to_branch_head", "Returned to BH"],
  ["pending_accounts_payment", "Accounts Payment"],
  ["payment_scheduled", "Payment Scheduled"],
  ["partially_paid", "Partially Paid"],
  ["paid", "Paid"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["cancelled", "Cancelled"],
  ["consumption_reversed", "Consumption Reversed"],
] as const;

/** A stage cell: who, and when — or an em dash once it's clear the stage was never reached.
 *  "Pending" and "—" are not interchangeable: one is waiting, the other never will be. */
function StageCell({ name, at, reachable }: { name?: string | null; at?: string | null; reachable: boolean }) {
  const when = dateTimeLabel(at);
  if (!when) {
    return <span className="text-grn-ink-soft">{reachable ? "Pending" : "—"}</span>;
  }
  return (
    <div>
      <p className="font-semibold text-grn-ink">{name?.trim() || "—"}</p>
      <GrnCellSub>{when}</GrnCellSub>
    </div>
  );
}

const GRN_TYPE_TABS = [
  ["_all", "All types"],
  ["vendor", "Vendor"],
  ["imprest", "Imprest"],
] as const;

export function GrnHistoryTable({ onEdit }: { onEdit?: (grnId: string) => void } = {}) {
  const { user } = useAuth();
  const isSuperAdmin = useHasRole("super_admin");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number][0]>("_all");
  const [grnType, setGrnType] = useState<(typeof GRN_TYPE_TABS)[number][0]>("_all");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"new" | "legacy" | "all">("new");
  const [billDateFrom, setBillDateFrom] = useState("");
  const [billDateTo, setBillDateTo] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [vendorSearch, setVendorSearch] = useState("");
  const [detailGrnId, setDetailGrnId] = useState<string | null>(null);

  // Server-side searched, same endpoint and pattern as the GRN creation form's vendor picker.
  const { data: vendorResponse, isFetching: vendorsLoading } = useQuery({
    queryKey: ["grn-history-vendor-search", vendorSearch],
    queryFn: () =>
      hrmsApi.get<any>(
        `/api/erp/vendors?is_active=1&limit=50&q=${encodeURIComponent(vendorSearch.trim())}`
      ),
  });
  const vendors = unwrapList<{ id: string; vendor_name?: string; name?: string }>(vendorResponse);

  const listQuery = useQuery({
    queryKey: ["grn-history", status, grnType, search, source, billDateFrom, billDateTo, vendorId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (status !== "_all") params.set("status", status);
      if (grnType !== "_all") params.set("grnType", grnType);
      if (search.trim()) params.set("search", search.trim());
      if (billDateFrom) params.set("billDateFrom", billDateFrom);
      if (billDateTo) params.set("billDateTo", billDateTo);
      if (vendorId) params.set("vendorId", vendorId);
      params.set("source", source);
      const response = await hrmsApi.get<any>(`/api/finance/grns?${params}`);
      return (response?.data ?? response?.rows ?? []) as GrnHistoryRow[];
    },
  });
  const rows = listQuery.data ?? [];
  const activeFilterCount = [billDateFrom, billDateTo, vendorId].filter(Boolean).length;

  // Draft-only, creator-only (or super_admin) — see backend deleteDraftGrn for why this is a
  // real hard delete rather than the cancel-to-'cancelled' path used everywhere else.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.delete(`/api/finance/grns/${id}`),
    onSuccess: () => {
      toast({ title: "Draft deleted" });
      void queryClient.invalidateQueries({ queryKey: ["grn-history"] });
    },
    onError: (error: Error) =>
      toast({ title: "Delete failed", description: error.message, variant: "destructive" }),
  });

  function canDelete(row: GrnHistoryRow) {
    if (row.status !== "draft") return false;
    if (isSuperAdmin) return true;
    return Boolean(user?.id) && String(row.created_by ?? "") === String(user?.id);
  }

  function handleDelete(row: GrnHistoryRow) {
    if (window.confirm(`Permanently delete draft ${row.grn_number}? This cannot be undone.`)) {
      deleteMutation.mutate(row.id);
    }
  }

  return (
    <>
    <GrnDetailDrawer
      grnId={detailGrnId}
      onClose={() => setDetailGrnId(null)}
      onReopened={() => {
        setDetailGrnId(null);
        void queryClient.invalidateQueries({ queryKey: ["grn-history"] });
      }}
      onEditRequested={onEdit ? (id) => { setDetailGrnId(null); onEdit(id); } : undefined}
    />
    <GrnCard>
      <GrnCardHeader
        title="GRN History"
        description="Every GRN with its full approval timeline — raised, Branch Head decision, Finance Head decision."
      />

      <div className="flex flex-wrap items-center gap-2 px-[16px] py-[12px]">
        <GrnSearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search GRN, vendor, head or description"
        />
        {/* Bill date range — filters g.bill_date server-side (billDateFrom/billDateTo), the same
            columns GRN Search already uses. Applies to both new and legacy rows. */}
        <div className="flex items-center gap-1">
          <GrnInput
            type="date"
            aria-label="Bill date from"
            className="h-7 w-[136px] text-xs"
            value={billDateFrom}
            onChange={(e) => setBillDateFrom(e.target.value)}
          />
          <span className="text-xs text-grn-ink-soft">to</span>
          <GrnInput
            type="date"
            aria-label="Bill date to"
            className="h-7 w-[136px] text-xs"
            value={billDateTo}
            onChange={(e) => setBillDateTo(e.target.value)}
          />
        </div>
        <SearchableSelect
          aria-label="Vendor"
          className="h-7 w-[180px] text-xs"
          loading={vendorsLoading}
          options={vendors.map((vendor) => ({
            value: vendor.id,
            label: (vendor.vendor_name ?? vendor.name ?? "").trim(),
          }))}
          value={vendorId}
          onChange={setVendorId}
          placeholder="Any vendor"
          searchPlaceholder="Type a vendor name…"
          emptyText={vendorSearch.trim() ? "No vendor matches." : "Start typing to search."}
          search={vendorSearch}
          onSearchChange={setVendorSearch}
        />
        {activeFilterCount > 0 && (
          <GrnIconButton
            aria-label="Clear date and vendor filters"
            title="Clear date and vendor filters"
            onClick={() => { setBillDateFrom(""); setBillDateTo(""); setVendorId(""); setVendorSearch(""); }}
          >
            ×
          </GrnIconButton>
        )}
        <GrnIconButton onClick={() => void listQuery.refetch()} title="Refresh" aria-label="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`} />
        </GrnIconButton>
      </div>

      <div className="flex items-center gap-2 px-[16px] pb-2 pt-1">
        <span className="text-xs font-medium text-grn-ink-soft">Source:</span>
        {(["new", "legacy", "all"] as const).map((s) => (
          <GrnChip key={s} active={source === s} onClick={() => setSource(s)}>
            {s === "new" ? "New HRMS" : s === "legacy" ? "Legacy (db_bill)" : "All"}
          </GrnChip>
        ))}
        <span className="ml-3 text-xs font-medium text-grn-ink-soft">Type:</span>
        {GRN_TYPE_TABS.map(([value, label]) => (
          <GrnChip key={value} active={grnType === value} onClick={() => setGrnType(value)}>
            {label}
          </GrnChip>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-grn-line-soft px-4 pb-3">
        {STATUS_TABS.map(([value, label]) => (
          <GrnChip key={value} active={status === value} onClick={() => setStatus(value)}>
            {label}
          </GrnChip>
        ))}
      </div>

      {listQuery.isLoading ? (
        <div className="flex justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-grn-ink-soft" />
        </div>
      ) : !rows.length ? (
        <GrnEmptyState icon={<Clock className="h-9 w-9" />} title="No GRNs match the filters" />
      ) : (
        // Header is not sticky: with the page in document flow there is no scrolling ancestor for
        // it to stick inside, so it would only paint an extra layer.
        <GrnTable minWidth={1080}>
          <thead>
            <tr>
              <GrnTh sticky={false}>GRN</GrnTh>
              <GrnTh sticky={false}>Branch / Vendor</GrnTh>
              <GrnTh sticky={false} align="right">Amount</GrnTh>
              <GrnTh sticky={false}>Status</GrnTh>
              <GrnTh sticky={false}>Raised</GrnTh>
              <GrnTh sticky={false}>Branch Head</GrnTh>
              <GrnTh sticky={false}>Finance Head</GrnTh>
              {(onEdit || rows.some(canDelete)) && <GrnTh sticky={false} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`${GRN_TR} cursor-pointer`}
                onClick={() => setDetailGrnId(row.id)}
              >
                <GrnTd>
                  {row.grn_number ? (
                    <p className="font-grn-mono font-bold text-grn-brand">{row.grn_number}</p>
                  ) : (
                    <p className="font-grn-mono text-xs text-grn-ink-soft italic">Draft — not yet numbered</p>
                  )}
                  <GrnCellSub className="uppercase tracking-[0.05em]">
                    {row.grn_type}
                    {row.source_type === "legacy" && (
                      <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700">
                        Legacy
                      </span>
                    )}
                  </GrnCellSub>
                </GrnTd>
                <GrnTd>
                  <p>{row.branch_name ?? "—"}</p>
                  <GrnCellSub>{row.vendor_name || "Imprest / no vendor"}</GrnCellSub>
                </GrnTd>
                <GrnTd align="right" className="font-semibold">
                  {money(row.amount_with_tax ?? row.amount, 0)}
                </GrnTd>
                <GrnTd>
                  <StatusStamp tone={grnStatusTone(row.status)}>{labelStatus(row.status)}</StatusStamp>
                  {/* Legacy-rejected rows land on status='cancelled', not 'rejected' — db_bill's
                      migration mapped both to one terminal state (migrate-grn-from-dbbill.ts's
                      resolveStatus). Gated on the data actually being present, not the status
                      label, so this never claims a reason/rejector that isn't there. */}
                  {(row.rejection_reason || row.legacy_rejected_by_name) && (
                    <GrnCellSub className="max-w-[160px] text-grn-crit">
                      {row.legacy_rejected_by_name && (
                        <span className="block truncate">Rejected by {row.legacy_rejected_by_name}</span>
                      )}
                      {row.rejection_reason && (
                        // Full text on hover — the column cannot afford the width, but the reason
                        // is the whole point of a rejected row.
                        <span className="block truncate" title={row.rejection_reason}>{row.rejection_reason}</span>
                      )}
                    </GrnCellSub>
                  )}
                </GrnTd>
                <GrnTd>
                  <StageCell name={row.created_by_name} at={row.created_at} reachable />
                </GrnTd>
                <GrnTd>
                  <StageCell
                    name={row.branch_head_reviewed_by_name}
                    at={row.branch_head_reviewed_at}
                    reachable={row.status !== "draft"}
                  />
                </GrnTd>
                <GrnTd>
                  <StageCell
                    name={row.finance_head_reviewed_by_name}
                    at={row.finance_head_reviewed_at}
                    reachable={Boolean(row.branch_head_reviewed_at) && row.status !== "rejected"}
                  />
                </GrnTd>
                {(onEdit || rows.some(canDelete)) && (
                  <GrnTd>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {onEdit && row.status === "draft" && (
                        <GrnIconButton
                          title="Edit this GRN"
                          aria-label="Edit this GRN"
                          onClick={() => onEdit(row.id)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </GrnIconButton>
                      )}
                      {canDelete(row) && (
                        <GrnIconButton
                          title="Delete this draft"
                          aria-label="Delete this draft"
                          disabled={deleteMutation.isPending}
                          onClick={() => handleDelete(row)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-grn-crit" />
                        </GrnIconButton>
                      )}
                    </div>
                  </GrnTd>
                )}
              </tr>
            ))}
          </tbody>
        </GrnTable>
      )}
    </GrnCard>
    </>
  );
}
