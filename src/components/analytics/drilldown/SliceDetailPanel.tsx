import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useDrillDown } from "./DrillDownProvider";

interface SliceDetailPanelProps {
  open: boolean;
  onClose: () => void;
  metric: "headcount" | "exits" | "shrinkage";
  reportCode: string; // "aon-bucket-headcount" | "aon-bucket-attrition" | "aon-bucket-shrinkage"
  from: string;
  to: string;
}

export function chipsToFilterParams(chips: { dimension: string; value: string }[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const chip of chips) {
    if (chip.dimension === "costCentre") params.costCentreId = chip.value;
    else if (chip.dimension === "process") params.processId = chip.value;
    else if (chip.dimension === "branch") params.branchId = chip.value;
    else if (chip.dimension === "aonBucket") params.aonBucket = chip.value;
    else if (chip.dimension === "department") params.departmentId = chip.value;
    else if (chip.dimension === "managerId") params.managerId = chip.value;
  }
  return params;
}

export function SliceDetailPanel({ open, onClose, metric, reportCode, from, to }: SliceDetailPanelProps) {
  const { chips, popToChip, openEmployeeList } = useDrillDown();
  const filterParams = chipsToFilterParams(chips);

  const q = useQuery({
    queryKey: [reportCode, "slice-detail", JSON.stringify(filterParams), from, to],
    enabled: open && chips.length > 0,
    queryFn: async () => {
      const qs = new URLSearchParams({ ...filterParams, from, to, limit: "500", offset: "0" });
      const res = await hrmsApi.get<{ data?: Record<string, unknown>[] }>(
        `/api/reports/suite/${reportCode}?${qs.toString()}`,
        60_000,
      );
      return res.data ?? [];
    },
  });

  const rows = q.data ?? [];
  const valueKey = metric === "exits" ? "exits" : metric === "shrinkage" ? "shrinkage" : "headcount";
  const total = rows.reduce((a, r) => a + Number(r[valueKey] ?? 0), 0);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Slice Detail</SheetTitle>
        </SheetHeader>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip, i) => (
            <span
              key={chip.dimension}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
            >
              {chip.label}
              <button
                type="button"
                onClick={() => popToChip(i)}
                className="ml-0.5 rounded-full hover:bg-slate-200"
                aria-label={`Remove ${chip.label} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        {q.isLoading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : q.error ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {(q.error as Error).message || "Failed to load this slice."}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {metric === "exits" ? "Exits" : metric === "shrinkage" ? "Shrinkage" : "Headcount"} in this slice
              </p>
              <p className="text-xl font-bold text-slate-900">
                {metric === "shrinkage" ? `${total.toFixed(1)}%` : total.toLocaleString("en-IN")}
              </p>
            </div>

            <Button onClick={openEmployeeList} className="w-full">
              View employees
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
