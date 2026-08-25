import { useState } from "react";
import PerformanceScorecardTable from "@/components/performance-scorecard/PerformanceScorecardTable";
import { useWfmScopeFilter } from "@/hooks/useWfmScopeFilter";
import { Input } from "@/components/ui/input";

export default function PerformanceCommandCenter() {
  const { scopeDescription } = useWfmScopeFilter();
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="p-4 sm:p-6">
      <div className="rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white p-6 mb-6">
        <h1 className="text-2xl font-bold">Performance Scorecard</h1>
        <p className="text-white/80 text-sm mt-1">{scopeDescription}</p>
      </div>
      <div className="flex items-center gap-2 mb-4">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        <span className="text-gray-400">to</span>
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
      </div>
      <PerformanceScorecardTable dateFrom={dateFrom} dateTo={dateTo} />
    </div>
  );
}
