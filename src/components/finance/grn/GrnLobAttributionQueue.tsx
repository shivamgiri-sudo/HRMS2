import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

interface PendingGrn {
  id: string;
  grn_number: string;
  vendor_name: string | null;
  bill_date: string | null;
  service_period_end: string | null;
  amount_with_tax: number | null;
  amount: number | null;
  branch_name: string | null;
  allocation_count: number;
  missing_lob_count: number;
  process_names: string | null;
}

interface AttributionAllocation {
  id: string;
  sequence_no: number;
  budget_line_id: string;
  process_id: string | null;
  process_lob_id: string | null;
  budget_process_lob_id: string | null;
  item_name: string;
  head: string;
  sub_head: string | null;
  process_name: string | null;
  cost_centre_name: string | null;
  pnl_cost_amount: number;
  amount_with_tax: number;
  lob_code: string | null;
  lob_name: string | null;
}

interface AttributionLob {
  id: string;
  process_id: string;
  lob_code: string;
  lob_name: string;
}

interface Workspace {
  grn: PendingGrn & { status: string };
  effectiveDate: string;
  allocations: AttributionAllocation[];
  lobs: AttributionLob[];
}

function dataOf<T>(response: any): T {
  return (response?.data ?? response) as T;
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function dateLabel(value: unknown) {
  const text = String(value ?? "").slice(0, 10);
  if (!text) return "—";
  return new Date(`${text}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function GrnLobAttributionQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedGrnId, setSelectedGrnId] = useState("");
  const [selections, setSelections] = useState<Record<string, string>>( {} );

  const pendingQuery = useQuery({
    queryKey: ["pending-grn-lob-attribution"],
    queryFn: async () => {
      const response = await hrmsApi.get<any>(
        "/api/finance/pnl/lobs/grn-attribution/pending?limit=200"
      );
      return dataOf<PendingGrn[]>(response);
    },
  });

  useEffect(() => {
    if (!selectedGrnId && pendingQuery.data?.[0]?.id) {
      setSelectedGrnId(pendingQuery.data[0].id);
    }
  }, [pendingQuery.data, selectedGrnId]);

  const workspaceQuery = useQuery({
    queryKey: ["grn-lob-attribution-workspace", selectedGrnId],
    enabled: Boolean(selectedGrnId),
    queryFn: async () => {
      const response = await hrmsApi.get<any>(
        `/api/finance/pnl/lobs/grn-attribution/${selectedGrnId}`
      );
      return dataOf<Workspace>(response);
    },
  });

  useEffect(() => {
    const workspace = workspaceQuery.data;
    if (!workspace) return;
    setSelections(
      Object.fromEntries(
        workspace.allocations.map((allocation) => [
          allocation.id,
          allocation.process_lob_id ?? allocation.budget_process_lob_id ?? "",
        ])
      )
    );
  }, [workspaceQuery.data]);

  const workspace = workspaceQuery.data;
  const unresolved = useMemo(
    () => (workspace?.allocations ?? []).filter(
      (allocation) => allocation.process_id && !selections[allocation.id]
    ),
    [selections, workspace?.allocations]
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!workspace) throw new Error("Select a GRN first");
      if (unresolved.length) {
        throw new Error(`${unresolved.length} process-linked allocation(s) still need a LOB`);
      }
      await hrmsApi.put(
        `/api/finance/pnl/lobs/grn-attribution/${workspace.grn.id}`,
        {
          allocations: workspace.allocations.map((allocation) => ({
            budgetLineId: allocation.budget_line_id,
            processLobId: allocation.process_id
              ? selections[allocation.id] || null
              : null,
          })),
        }
      );
      await hrmsApi.post(`/api/finance/grns/${workspace.grn.id}/revalidate`, {});
    },
    onSuccess: async () => {
      toast({
        title: "LOB attribution saved",
        description: "The GRN can now proceed through validation and approval.",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pending-grn-lob-attribution"] }),
        queryClient.invalidateQueries({ queryKey: ["grn-lob-attribution-workspace"] }),
        queryClient.invalidateQueries({ queryKey: ["smart-grn-workspace"] }),
      ]);
      const remaining = pendingQuery.data?.filter((item) => item.id !== selectedGrnId) ?? [];
      setSelectedGrnId(remaining[0]?.id ?? "");
    },
    onError: (error: Error) => {
      toast({
        title: "LOB attribution could not be saved",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" /> Pending attribution
            </CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void pendingQuery.refetch()}
              disabled={pendingQuery.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${pendingQuery.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Draft GRNs with process-linked allocation rows that do not yet have an exact LOB.
          </p>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-2">
          {pendingQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading GRNs
            </div>
          ) : (pendingQuery.data ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <CheckCircle2 className="mb-3 h-9 w-9 text-emerald-500" />
              <p className="font-semibold text-slate-800">No pending LOB mappings</p>
              <p className="mt-1 text-xs text-slate-500">All process-linked draft allocations are attributed.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(pendingQuery.data ?? []).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setSelectedGrnId(item.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${
                    selectedGrnId === item.id
                      ? "border-blue-300 bg-blue-50"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{item.grn_number}</p>
                      <p className="text-xs text-slate-500">{item.vendor_name || "Imprest / no vendor"}</p>
                    </div>
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                      {item.missing_lob_count} missing
                    </Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-slate-600">{item.process_names || "Shared branch allocation"}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>{dateLabel(item.bill_date)}</span>
                    <span className="font-semibold text-slate-700">{money(item.amount_with_tax ?? item.amount)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-col overflow-hidden">
        {!selectedGrnId ? (
          <CardContent className="flex flex-1 flex-col items-center justify-center text-center">
            <GitBranch className="mb-3 h-10 w-10 text-slate-400" />
            <p className="font-semibold text-slate-800">Select a pending GRN</p>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Map each process-linked budget allocation to the correct LOB.
            </p>
          </CardContent>
        ) : workspaceQuery.isLoading ? (
          <CardContent className="flex flex-1 items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading allocation workspace
          </CardContent>
        ) : workspace ? (
          <>
            <CardHeader className="border-b pb-3">
              <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
                <div>
                  <CardTitle className="text-base">{workspace.grn.grn_number}</CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    {workspace.grn.vendor_name || "Imprest / no vendor"} · {workspace.grn.branch_name || "Branch unavailable"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Recognition reference date: {dateLabel(workspace.effectiveDate)}
                  </p>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-lg font-bold text-slate-950">{money(workspace.grn.amount_with_tax ?? workspace.grn.amount)}</p>
                  <p className="text-xs text-slate-500">GRN gross amount</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-auto p-0">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">#</th>
                    <th className="px-4 py-2">Budget item</th>
                    <th className="px-4 py-2">Process / cost centre</th>
                    <th className="px-4 py-2">P&amp;L cost</th>
                    <th className="px-4 py-2">Gross</th>
                    <th className="px-4 py-2">LOB attribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {workspace.allocations.map((allocation) => {
                    const options = workspace.lobs.filter(
                      (lob) => lob.process_id === allocation.process_id
                    );
                    return (
                      <tr key={allocation.id} className="align-top hover:bg-slate-50/70">
                        <td className="px-4 py-2 font-mono text-xs text-slate-500">{allocation.sequence_no}</td>
                        <td className="px-4 py-2">
                          <p className="font-semibold text-slate-900">{allocation.item_name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {allocation.head}{allocation.sub_head ? ` / ${allocation.sub_head}` : ""}
                          </p>
                        </td>
                        <td className="px-4 py-2">
                          <p className="font-medium text-slate-800">{allocation.process_name || "Shared branch cost"}</p>
                          <p className="mt-1 text-xs text-slate-500">{allocation.cost_centre_name || "No cost centre"}</p>
                        </td>
                        <td className="px-4 py-2 font-semibold">{money(allocation.pnl_cost_amount)}</td>
                        <td className="px-4 py-2">{money(allocation.amount_with_tax)}</td>
                        <td className="px-4 py-2">
                          {allocation.process_id ? (
                            <div className="space-y-1.5">
                              <select
                                className={selectClass}
                                value={selections[allocation.id] ?? ""}
                                onChange={(event) => setSelections((current) => ({
                                  ...current,
                                  [allocation.id]: event.target.value,
                                }))}
                              >
                                <option value="">Select exact LOB</option>
                                {options.map((lob) => (
                                  <option key={lob.id} value={lob.id}>
                                    {lob.lob_code} — {lob.lob_name}
                                  </option>
                                ))}
                              </select>
                              {!options.length ? (
                                <p className="text-xs font-medium text-rose-600">
                                  No approved effective LOB exists for this process.
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <Badge variant="outline">Shared branch pool</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
            <div className="flex items-center justify-between gap-3 border-t bg-white p-4">
              <p className={`text-sm ${unresolved.length ? "text-amber-700" : "text-emerald-700"}`}>
                {unresolved.length
                  ? `${unresolved.length} process-linked allocation(s) still require a LOB.`
                  : "All process-linked allocations are ready."}
              </p>
              <Button
                disabled={saveMutation.isPending || unresolved.length > 0}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save attribution
              </Button>
            </div>
          </>
        ) : (
          <CardContent className="flex flex-1 items-center justify-center text-sm text-rose-600">
            The selected GRN attribution workspace could not be loaded.
          </CardContent>
        )}
      </Card>
    </div>
  );
}
