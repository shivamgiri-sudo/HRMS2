import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, GitBranch, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hrmsApi } from "@/lib/hrmsApi";

interface AllocationRow {
  grn_allocation_id: string;
  sequence_no: number;
  process_id: string | null;
  process_lob_id: string | null;
  process_name: string | null;
  lob_code: string | null;
  lob_name: string | null;
  cost_centre_name: string | null;
  pnl_bucket: string;
  recognition_period: string;
  pnl_cost_amount: number;
  gross_amount: number;
}

interface AttributionResponse {
  payment: Record<string, unknown>;
  allocations: AllocationRow[];
  reconciliation: {
    allocationAvailable: boolean;
    allocationCount?: number;
    missingLobCount?: number;
    recognitionPeriods?: string[];
    allocatedPnlCost: number;
    allocatedGrossAmount: number;
    dueAmount: number;
    paidAmount: number;
    balanceAmount: number;
    grossVariance: number;
    reconciled: boolean;
    reason?: string;
  };
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function title(value: unknown) {
  return String(value ?? "—")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function VendorPaymentLobAttributionCard({ paymentId }: { paymentId: string }) {
  const query = useQuery({
    queryKey: ["vendor-payment-lob-attribution", paymentId],
    enabled: Boolean(paymentId),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: AttributionResponse }>(
        `/api/finance/pnl/lobs/vendor-payment-attribution/${paymentId}`
      );
      return response.data;
    },
  });

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10 text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading LOB attribution
        </CardContent>
      </Card>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="border-rose-200 bg-rose-50/50">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">LOB attribution unavailable</p>
            <p className="mt-1 text-xs">{query.error instanceof Error ? query.error.message : "Unable to load allocation lineage"}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { reconciliation, allocations } = query.data;
  return (
    <Card className={reconciliation.reconciled ? "border-emerald-200" : "border-amber-200"}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="h-4 w-4 text-violet-600" /> P&amp;L and LOB attribution
            </CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Accrued P&amp;L cost follows GRN allocation lines; cash paid remains on the payment ledger.
            </p>
          </div>
          <Badge
            variant="outline"
            className={reconciliation.reconciled
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700"}
          >
            {reconciliation.reconciled ? "Reconciled" : "Review required"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">P&amp;L cost</p>
            <p className="mt-1 text-sm font-bold text-slate-900">{money(reconciliation.allocatedPnlCost)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Gross allocated</p>
            <p className="mt-1 text-sm font-bold text-slate-900">{money(reconciliation.allocatedGrossAmount)}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Cash paid</p>
            <p className="mt-1 text-sm font-bold text-emerald-800">{money(reconciliation.paidAmount)}</p>
          </div>
          <div className="rounded-lg bg-amber-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Outstanding</p>
            <p className="mt-1 text-sm font-bold text-amber-800">{money(reconciliation.balanceAmount)}</p>
          </div>
        </div>

        {!reconciliation.allocationAvailable ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {reconciliation.reason || "Allocation data is not available."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-xs">
              <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">#</th>
                  <th className="px-3 py-2.5">Process / LOB</th>
                  <th className="px-3 py-2.5">Cost centre</th>
                  <th className="px-3 py-2.5">P&amp;L bucket</th>
                  <th className="px-3 py-2.5">Recognition</th>
                  <th className="px-3 py-2.5 text-right">P&amp;L cost</th>
                  <th className="px-3 py-2.5 text-right">Gross</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {allocations.map((row) => (
                  <tr key={row.grn_allocation_id}>
                    <td className="px-3 py-3 font-mono text-slate-500">{row.sequence_no}</td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-slate-800">{row.process_name || "Shared branch cost"}</p>
                      <p className={`mt-0.5 ${row.process_id && !row.process_lob_id ? "font-semibold text-rose-600" : "text-slate-500"}`}>
                        {row.process_id
                          ? row.process_lob_id
                            ? `${row.lob_code} — ${row.lob_name}`
                            : "LOB missing"
                          : "Branch/shared pool"}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{row.cost_centre_name || "—"}</td>
                    <td className="px-3 py-3">{title(row.pnl_bucket)}</td>
                    <td className="px-3 py-3 font-mono">{row.recognition_period}</td>
                    <td className="px-3 py-3 text-right font-semibold">{money(row.pnl_cost_amount)}</td>
                    <td className="px-3 py-3 text-right">{money(row.gross_amount)}</td>
                  </tr>
                ))}
                {!allocations.length ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No allocation rows were found for this vendor payment.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}

        {!reconciliation.reconciled ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Reconciliation exception</p>
              <p className="mt-1">
                Gross variance: {money(reconciliation.grossVariance)} · Missing LOB rows: {reconciliation.missingLobCount ?? 0}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Allocation gross matches the vendor payable and every process line has a LOB.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
