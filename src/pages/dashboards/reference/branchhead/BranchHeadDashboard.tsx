import { useRef, useState } from "react";
import { useBranchHeadHealth } from "@/hooks/useBranchHeadHealth";
import { DashSkeleton } from "../../kit";
import type { HeadBranch } from "../../../../../backend/src/modules/branch-head-health/scope";
import { BranchHeadControls } from "./BranchHeadControls";
import { BranchHeadReferenceLayout } from "./BranchHeadReferenceLayout";

/** Container: owns branch/date state and fetches through the hook. Controls stay mounted in every state. */
export function BranchHeadDashboard() {
  const [branchId, setBranchId] = useState("");
  const [date, setDate] = useState("");
  const { data, isLoading, isFetching, error, refetch } = useBranchHeadHealth(branchId ? [branchId] : [], date || undefined);
  // Keep the full branch list so the switcher survives selecting a single branch.
  const options = useRef<HeadBranch[]>([]);
  if (!branchId && data) options.current = data.branches.map((b) => b.branch);

  const common = {
    branchOptions: options.current, selectedBranchId: branchId, onBranchChange: setBranchId,
    date, onDateChange: setDate, onRefresh: () => void refetch(),
  };
  if (!data) {
    return (
      <div className="space-y-4">
        <BranchHeadControls options={options.current} selectedBranchId={branchId} onBranchChange={setBranchId}
          date={date} onDateChange={setDate} onRefresh={() => void refetch()} stale={isFetching} />
        {isLoading ? <DashSkeleton /> : (
          <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-[14px] text-rose-900">
            {error?.message || "Branch health could not be loaded."} Change the date or try again.
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {error ? <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-[13px] text-rose-900">The latest request failed: {error.message}. Showing the previous results.</div> : null}
      <BranchHeadReferenceLayout data={data} {...common} stale={isFetching} />
    </div>
  );
}
