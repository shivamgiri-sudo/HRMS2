import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, Pencil, RefreshCw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
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
  GrnSearchInput,
  GrnTable,
  GrnTd,
  GrnTh,
} from "@/components/finance/grn/grn-ui";

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
  created_by_name?: string | null;
  submitted_at?: string | null;
  branch_head_reviewed_at?: string | null;
  branch_head_reviewed_by_name?: string | null;
  finance_head_reviewed_at?: string | null;
  finance_head_reviewed_by_name?: string | null;
  rejection_reason?: string | null;
  source_type?: 'new' | 'legacy' | null;
};

/** Longer than the redesign mock's six chips on purpose: every entry past "Rejected" is a real
 *  backend status, and dropping one removes the only way to filter for it. */
const STATUS_TABS = [
  ["_all", "All"],
  ["draft", "Draft"],
  ["submitted", "Branch Head Queue"],
  ["branch_head_approved", "Finance Head Queue"],
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

export function GrnHistoryTable({ onEdit }: { onEdit?: (grnId: string) => void } = {}) {
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number][0]>("_all");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"new" | "legacy" | "all">("new");

  const listQuery = useQuery({
    queryKey: ["grn-history", status, search, source],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (status !== "_all") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      params.set("source", source);
      const response = await hrmsApi.get<any>(`/api/finance/grns?${params}`);
      return (response?.data ?? response?.rows ?? []) as GrnHistoryRow[];
    },
  });
  const rows = listQuery.data ?? [];

  return (
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
              {onEdit && <GrnTh sticky={false} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={GRN_TR}>
                <GrnTd>
                  <p className="font-grn-mono font-bold text-grn-brand">{row.grn_number}</p>
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
                  {row.status === "rejected" && row.rejection_reason && (
                    <GrnCellSub
                      className="max-w-[160px] truncate text-grn-crit"
                      // Full text on hover — the column cannot afford the width, but the reason is
                      // the whole point of a rejected row.
                    >
                      <span title={row.rejection_reason}>{row.rejection_reason}</span>
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
                {onEdit && (
                  <GrnTd>
                    {row.status === "draft" && (
                      <GrnIconButton
                        title="Edit this GRN"
                        aria-label="Edit this GRN"
                        onClick={() => onEdit(row.id)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </GrnIconButton>
                    )}
                  </GrnTd>
                )}
              </tr>
            ))}
          </tbody>
        </GrnTable>
      )}
    </GrnCard>
  );
}
