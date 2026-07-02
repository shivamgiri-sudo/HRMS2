import React, { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertCircle, X } from "lucide-react";

export interface DashboardDrilldownDrawerProps {
  open: boolean;
  onClose: () => void;
  metricCode: string;
  metricName: string;
  dashboardCode: string;
}

interface DrilldownData {
  summary?: Record<string, string | number>;
  records: Record<string, string | number | null>[];
}

export function DashboardDrilldownDrawer({
  open,
  onClose,
  metricCode,
  metricName,
  dashboardCode,
}: DashboardDrilldownDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DrilldownData | null>(null);

  useEffect(() => {
    if (!open || !metricCode || !dashboardCode) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/dashboards/${dashboardCode}/metric/${metricCode}/drilldown`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Failed to load drilldown data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, metricCode, dashboardCode]);

  const columns =
    data?.records && data.records.length > 0
      ? Object.keys(data.records[0])
      : [];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-lg font-semibold">{metricName}</SheetTitle>
          <SheetDescription className="text-xs text-slate-400 uppercase tracking-wide">
            {dashboardCode} / {metricCode}
          </SheetDescription>
        </SheetHeader>

        {/* Summary header */}
        {!loading && !error && data?.summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            {Object.entries(data.summary).map(([key, val]) => (
              <div key={key} className="rounded-lg border bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500 capitalize">{key.replace(/_/g, " ")}</p>
                <p className="text-base font-semibold text-slate-900">{val ?? "—"}</p>
              </div>
            ))}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Records table */}
        {!loading && !error && data && (
          <>
            {data.records.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">No records found.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      {columns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                        >
                          {col.replace(/_/g, " ")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b last:border-0 hover:bg-slate-50 transition-colors"
                      >
                        {columns.map((col) => (
                          <td key={col} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                            {row[col] !== null && row[col] !== undefined
                              ? String(row[col])
                              : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div className="mt-6 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-1" />
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
