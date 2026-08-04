import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GitBranch, Loader2, RefreshCw, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import { dateLabel, money } from "@/components/finance/grn/grn-format";
import {
  GRN_TR,
  GrnButton,
  GrnCard,
  GrnCardHeader,
  GrnCellSub,
  GrnEmptyState,
  GrnIconButton,
  GrnSelect,
  GrnTable,
  GrnTd,
  GrnTh,
} from "@/components/finance/grn/grn-ui";
import { hrmsApi } from "@/lib/hrmsApi";

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

export function GrnLobAttributionQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedGrnId, setSelectedGrnId] = useState("");
  const [selections, setSelections] = useState<Record<string, string>>( {} );
  const selectedCardRef = useRef<HTMLButtonElement | null>(null);

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

  // The list is capped at 520px and scrolls internally, so the GRN auto-selected after a save
  // can easily be below the fold. Without this the queue looks like it did nothing.
  useEffect(() => {
    selectedCardRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedGrnId]);

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
        queryClient.invalidateQueries({ queryKey: ["grn-summary"] }),
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
    <div className="grid items-start gap-4 min-[900px]:grid-cols-[320px_minmax(0,1fr)]">
      <GrnCard>
        <GrnCardHeader
          title="Pending attribution"
          description="Draft GRNs with process-linked allocation rows that do not yet have an exact LOB."
          action={
            <GrnIconButton
              onClick={() => void pendingQuery.refetch()}
              disabled={pendingQuery.isFetching}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${pendingQuery.isFetching ? "animate-spin" : ""}`} />
            </GrnIconButton>
          }
        />
        {pendingQuery.isLoading ? (
          <div className="flex items-center justify-center py-12 text-[12.5px] text-grn-ink-soft">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading GRNs
          </div>
        ) : (pendingQuery.data ?? []).length === 0 ? (
          <GrnEmptyState
            icon={<CheckCircle2 className="h-9 w-9 text-grn-ok" />}
            title="No pending LOB mappings"
            description="All process-linked draft allocations are attributed."
          />
        ) : (
          // Capped rather than full-height: the right pane grows with the page, and a list that
          // grew with it would push the allocation table off screen.
          <div className="flex max-h-[520px] flex-col gap-2 overflow-y-auto p-3.5">
            {(pendingQuery.data ?? []).map((item) => {
              const selected = selectedGrnId === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  ref={selected ? selectedCardRef : undefined}
                  onClick={() => setSelectedGrnId(item.id)}
                  className={`w-full rounded-[10px] border px-3 py-[11px] text-left transition-colors ${
                    selected
                      ? "border-grn-brand bg-grn-brand-soft"
                      : "border-grn-line bg-grn-card hover:border-grn-brand"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-grn-mono text-[12.5px] font-bold text-grn-brand">{item.grn_number}</span>
                    <StatusStamp tone="warn">{item.missing_lob_count} missing</StatusStamp>
                  </div>
                  <p className="mt-[3px] text-[11px] text-grn-ink-soft">
                    {item.vendor_name || "Imprest / no vendor"}
                  </p>
                  <p className="mt-[3px] line-clamp-2 text-[11px] text-grn-ink-soft">
                    {item.process_names || "Shared branch allocation"} · {dateLabel(item.bill_date)}
                  </p>
                  <p className="mt-1.5 font-grn-mono text-[12px] font-semibold text-grn-ink">
                    {money(item.amount_with_tax ?? item.amount)}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </GrnCard>

      <GrnCard>
        {!selectedGrnId ? (
          <GrnEmptyState
            icon={<GitBranch className="h-9 w-9" />}
            title="Select a pending GRN"
            description="Map each process-linked budget allocation to the correct LOB."
          />
        ) : workspaceQuery.isLoading ? (
          <div className="flex items-center justify-center py-16 text-[12.5px] text-grn-ink-soft">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading allocation workspace
          </div>
        ) : workspace ? (
          <>
            <GrnCardHeader
              title={<span className="font-grn-mono text-grn-brand">{workspace.grn.grn_number}</span>}
              description={
                <>
                  {workspace.grn.vendor_name || "Imprest / no vendor"} ·{" "}
                  {workspace.grn.branch_name || "Branch unavailable"} · recognition date{" "}
                  {dateLabel(workspace.effectiveDate)}
                </>
              }
              action={
                <div className="text-right">
                  <div className="font-grn-mono text-[15px] font-bold text-grn-ink">
                    {money(workspace.grn.amount_with_tax ?? workspace.grn.amount)}
                  </div>
                  <GrnCellSub>Gross amount</GrnCellSub>
                </div>
              }
            />
            <GrnTable minWidth={960}>
              <thead>
                <tr>
                  <GrnTh sticky={false}>#</GrnTh>
                  <GrnTh sticky={false}>Budget item</GrnTh>
                  <GrnTh sticky={false}>Process / cost centre</GrnTh>
                  <GrnTh sticky={false} align="right">P&amp;L cost</GrnTh>
                  <GrnTh sticky={false} align="right">Gross</GrnTh>
                  <GrnTh sticky={false}>LOB attribution</GrnTh>
                </tr>
              </thead>
              <tbody>
                {workspace.allocations.map((allocation) => {
                  const options = workspace.lobs.filter(
                    (lob) => lob.process_id === allocation.process_id
                  );
                  return (
                    <tr key={allocation.id} className={GRN_TR}>
                      <GrnTd className="font-grn-mono text-grn-ink-soft">{allocation.sequence_no}</GrnTd>
                      <GrnTd>
                        <p className="font-semibold">{allocation.item_name}</p>
                        <GrnCellSub>
                          {allocation.head}{allocation.sub_head ? ` / ${allocation.sub_head}` : ""}
                        </GrnCellSub>
                      </GrnTd>
                      <GrnTd>
                        <p className="font-semibold">{allocation.process_name || "Shared branch cost"}</p>
                        <GrnCellSub>{allocation.cost_centre_name || "No cost centre"}</GrnCellSub>
                      </GrnTd>
                      <GrnTd align="right" className="font-semibold">{money(allocation.pnl_cost_amount)}</GrnTd>
                      <GrnTd align="right">{money(allocation.amount_with_tax)}</GrnTd>
                      <GrnTd className="min-w-[240px]">
                        {allocation.process_id ? (
                          <div className="space-y-1.5">
                            <GrnSelect
                              small
                              className="w-full"
                              value={selections[allocation.id] ?? ""}
                              aria-label={`LOB for ${allocation.item_name}`}
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
                            </GrnSelect>
                            {!options.length ? (
                              <p className="text-[10.5px] font-semibold text-grn-crit">
                                No approved effective LOB exists for this process.
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <StatusStamp tone="neutral">Shared branch pool</StatusStamp>
                        )}
                      </GrnTd>
                    </tr>
                  );
                })}
              </tbody>
            </GrnTable>
            {/* Pinned to the viewport bottom while the card is taller than it: with the page in
                document flow a long allocation table would otherwise push Save out of reach. */}
            <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-grn-line-soft bg-grn-card px-4 py-3">
              <p className={`text-[11.5px] font-semibold ${unresolved.length ? "text-grn-warn" : "text-grn-ok"}`}>
                {unresolved.length
                  ? `${unresolved.length} process-linked allocation(s) still require a LOB.`
                  : "All process-linked allocations are ready."}
              </p>
              <GrnButton
                variant="primary"
                disabled={saveMutation.isPending || unresolved.length > 0}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save attribution
              </GrnButton>
            </div>
          </>
        ) : (
          <div className="px-4 py-16 text-center text-[12.5px] font-semibold text-grn-crit">
            The selected GRN attribution workspace could not be loaded.
          </div>
        )}
      </GrnCard>
    </div>
  );
}
