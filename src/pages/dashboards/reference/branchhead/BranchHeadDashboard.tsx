import { useEffect, useRef, useState } from "react";
import { useBranchHeadHealth } from "@/hooks/useBranchHeadHealth";
import { DashSkeleton } from "../../kit";
import type { HeadBranch } from "../../../../../backend/src/modules/branch-head-health/scope";
import { BranchHeadReferenceLayout } from "./BranchHeadReferenceLayout";

/** Container: owns branch/date state and fetches through the hook. The layout stays presentational. */
export function BranchHeadDashboard() {
  const [branchId, setBranchId] = useState("");
  const [date, setDate] = useState("");
  const { data, isLoading, error, refetch } = useBranchHeadHealth(branchId ? [branchId] : [], date || undefined);
  // Keep the full branch list so the switcher survives selecting a single branch.
  const options = useRef<HeadBranch[]>([]);
  useEffect(() => {
    if (!branchId && data) options.current = data.branches.map((b) => b.branch);
  }, [branchId, data]);

  if (isLoading) return <DashSkeleton />;
  if (error || !data) {
    return (
      <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-[14px] text-rose-900">
        Branch health could not be loaded. <button type="button" className="min-h-[44px] font-bold underline" onClick={() => void refetch()}>Retry</button>
      </div>
    );
  }
  const opts = !branchId ? data.branches.map((b) => b.branch) : options.current;
  return (
    <BranchHeadReferenceLayout data={data} branchOptions={opts} selectedBranchId={branchId} onBranchChange={setBranchId}
      date={date} onDateChange={setDate} onRefresh={() => void refetch()} />
  );
}
