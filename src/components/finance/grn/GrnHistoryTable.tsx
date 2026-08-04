import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, FileClock, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hrmsApi } from "@/lib/hrmsApi";
import { StatusStamp, type StampTone } from "@/components/finance/grn/StatusStamp";

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
};

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

function labelStatus(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string): StampTone {
  if (["paid", "approved", "pending_accounts_payment", "payment_scheduled", "partially_paid"].includes(status)) {
    return "ok";
  }
  if (["rejected", "cancelled"].includes(status)) return "crit";
  if (status === "consumption_reversed") return "info";
  if (["submitted", "branch_head_approved"].includes(status)) return "warn";
  return "neutral";
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

/** Date + time, unlike the date-only labels used elsewhere in this module — the point of this
 *  view is exactly the timestamps, not just the day. */
function dateTimeLabel(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A stage cell: who, and when — or an em dash once it's clear the stage was never reached. */
function StageCell({ name, at, reachable }: { name?: string | null; at?: string | null; reachable: boolean }) {
  const when = dateTimeLabel(at);
  if (!when) {
    return <span className="text-slate-400">{reachable ? "Pending" : "—"}</span>;
  }
  return (
    <div>
      <p className="font-medium text-slate-800">{name?.trim() || "—"}</p>
      <p className="text-[11px] text-slate-500">{when}</p>
    </div>
  );
}

export function GrnHistoryTable() {
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number][0]>("_all");
  const [search, setSearch] = useState("");

  const listQuery = useQuery({
    queryKey: ["grn-history", status, search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (status !== "_all") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const response = await hrmsApi.get<any>(`/api/finance/grns?${params}`);
      return (response?.data ?? response?.rows ?? []) as GrnHistoryRow[];
    },
  });
  const rows = listQuery.data ?? [];

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-950">
            <FileClock className="h-4 w-4 text-slate-400" />GRN History
          </h2>
          <p className="mt-1 text-xs text-slate-500">Every GRN with its full approval timeline — raised, Branch Head decision, Finance Head decision.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="w-56 pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search GRN, vendor, Head…" />
          </div>
          <Button variant="outline" size="icon" onClick={() => void listQuery.refetch()}>
            <RefreshCw className={`h-4 w-4 ${listQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map(([value, label]) => (
          <button
            type="button"
            key={value}
            onClick={() => setStatus(value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${status === value ? "border-[#073f78] bg-[#073f78] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-[#073f78]/40 hover:text-[#073f78]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <div className="flex justify-center rounded-xl border border-slate-200 bg-white py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : !rows.length ? (
        <div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
          <Clock className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No GRNs match the filters</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1080px] text-xs">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b">
                <th className="h-8 px-3 text-left font-medium text-slate-500">GRN</th>
                <th className="h-8 px-3 text-left font-medium text-slate-500">Branch / Vendor</th>
                <th className="h-8 px-3 text-right font-medium text-slate-500">Amount</th>
                <th className="h-8 px-3 text-left font-medium text-slate-500">Status</th>
                <th className="h-8 px-3 text-left font-medium text-slate-500">Raised</th>
                <th className="h-8 px-3 text-left font-medium text-slate-500">Branch Head</th>
                <th className="h-8 px-3 text-left font-medium text-slate-500">Finance Head</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                return (
                  <tr key={row.id} className="align-top hover:bg-slate-50/70">
                    <td className="px-3 py-2.5">
                      <p className="font-mono font-semibold text-[#073f78]">{row.grn_number}</p>
                      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400">{row.grn_type}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-slate-800">{row.branch_name ?? "—"}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">{row.vendor_name || "Imprest / no vendor"}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-medium text-slate-900">
                      {money(row.amount_with_tax ?? row.amount)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusStamp tone={statusTone(row.status)}>{labelStatus(row.status)}</StatusStamp>
                      {row.status === "rejected" && row.rejection_reason && (
                        <p className="mt-1 max-w-[160px] text-[11px] text-rose-600" title={row.rejection_reason}>
                          {row.rejection_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StageCell name={row.created_by_name} at={row.created_at} reachable />
                    </td>
                    <td className="px-3 py-2.5">
                      <StageCell
                        name={row.branch_head_reviewed_by_name}
                        at={row.branch_head_reviewed_at}
                        reachable={row.status !== "draft"}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <StageCell
                        name={row.finance_head_reviewed_by_name}
                        at={row.finance_head_reviewed_at}
                        reachable={Boolean(row.branch_head_reviewed_at) && row.status !== "rejected"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
