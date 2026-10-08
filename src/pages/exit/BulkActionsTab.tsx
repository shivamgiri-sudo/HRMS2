/**
 * Extracted from NativeExitCommandCenter.tsx (owner ruling 2026-09-26: split the 2600+
 * line page into smaller files). Shared types/consts/primitives live in ./shared.ts.
 */
import { useMemo, useState } from "react";
import {
  Building2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
  Square,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { Pill, statusFlow, type ExitRow } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Bulk Actions Tab
// ─────────────────────────────────────────────────────────────────────────────
export function BulkActionsTab({
  exitRequests,
  onRefresh,
}: {
  exitRequests: ExitRow[];
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [bulkAction, setBulkAction] = useState("");
  const [processing, setProcessing] = useState(false);
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return exitRequests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.employee_name?.toLowerCase().includes(q) &&
          !r.employee_code?.toLowerCase().includes(q) &&
          !r.branch_name?.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [exitRequests, statusFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, ExitRow[]>();
    filtered.forEach((r) => {
      const key = r.branch_name ?? "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(filtered.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  const handleBulkAction = async () => {
    if (!bulkAction || selected.size === 0) return;
    setProcessing(true);
    const ids = Array.from(selected);
    let success = 0;
    let failed = 0;
    // Why rows failed, so "0 succeeded, 5 failed" is explained instead of silent.
    const reasons = new Map<string, number>();
    const noteFailure = (msg: string) => reasons.set(msg, (reasons.get(msg) ?? 0) + 1);

    try {
      if (bulkAction === "generate_clearance") {
        // Small worker pool instead of one-at-a-time.
        let next = 0;
        const worker = async () => {
          while (next < ids.length) {
            const id = ids[next++];
            try {
              await hrmsApi.post(`/api/exit/${id}/clearance/generate`, {});
              success++;
            } catch (err) {
              failed++;
              noteFailure(err instanceof Error ? err.message : "Request failed");
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));
      } else {
        // One request for the whole selection; the server applies the same per-exit checks.
        const res = await hrmsApi.post<{
          success: boolean;
          succeeded: number;
          failed: number;
          results: Array<{ id: string; ok: boolean; message: string }>;
        }>("/api/exit/bulk-status", {
          ids,
          status: bulkAction,
          remarks: `Bulk action: ${bulkAction}`,
        });
        success = res.succeeded;
        failed = res.failed;
        res.results.filter((r) => !r.ok).forEach((r) => noteFailure(r.message));
      }
    } catch (err) {
      failed = ids.length - success;
      noteFailure(err instanceof Error ? err.message : "Request failed");
    }

    const topReasons = Array.from(reasons.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([msg, n]) => `${n} × ${msg}`)
      .join(" | ");
    toast({
      title: "Bulk action complete",
      description: `${success} succeeded, ${failed} failed${topReasons ? ` — ${topReasons}` : ""}`,
      variant: failed > 0 ? "destructive" : "default",
    });
    setSelected(new Set());
    setBulkAction("");
    setProcessing(false);
    onRefresh();
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search employee..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {statusFlow.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="revoked">Revoked</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex-1" />

          {selected.size > 0 && (
            <>
              <Badge variant="secondary" className="font-mono">
                {selected.size} selected
              </Badge>
              <Select value={bulkAction} onValueChange={setBulkAction}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Bulk action..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager_review">
                    Move to Manager Review
                  </SelectItem>
                  <SelectItem value="accepted">
                    Accept (Manager Approved)
                  </SelectItem>
                  <SelectItem value="notice_serving">Start Notice</SelectItem>
                  <SelectItem value="exited">Mark Exited</SelectItem>
                  <SelectItem value="generate_clearance">
                    Generate Clearance
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={handleBulkAction}
                disabled={!bulkAction || processing}
                className="bg-rose-600 hover:bg-rose-700"
              >
                {processing ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : null}
                Apply
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Selection Actions */}
      <div className="flex items-center gap-2 text-sm">
        <Button variant="outline" size="sm" onClick={selectAll}>
          Select All ({filtered.length})
        </Button>
        <Button variant="outline" size="sm" onClick={clearSelection}>
          Clear
        </Button>
      </div>

      {/* Grouped List */}
      <div className="space-y-3">
        {grouped.map(([branch, rows]) => (
          <div
            key={branch}
            className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden"
          >
            <button
              onClick={() =>
                setExpandedBranch(expandedBranch === branch ? null : branch)
              }
              className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Building2 className="w-5 h-5 text-slate-400" />
                <span className="font-semibold text-slate-800">{branch}</span>
                <Badge variant="secondary">{rows.length}</Badge>
              </div>
              {expandedBranch === branch ? (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-slate-400" />
              )}
            </button>
            {expandedBranch === branch && (
              <div className="border-t">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="p-3 w-10"></th>
                      <th className="p-3 text-left">Employee</th>
                      <th className="p-3 text-left">Process</th>
                      <th className="p-3 text-left">Status</th>
                      <th className="p-3 text-left">LWD</th>
                      <th className="p-3 text-left">Clearance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t hover:bg-slate-50/60">
                        <td className="p-3">
                          <button
                            onClick={() => toggleSelect(r.id)}
                            className="cursor-pointer"
                          >
                            {selected.has(r.id) ? (
                              <CheckSquare className="w-5 h-5 text-rose-600" />
                            ) : (
                              <Square className="w-5 h-5 text-slate-300" />
                            )}
                          </button>
                        </td>
                        <td className="p-3">
                          <div className="font-semibold text-slate-800">
                            {r.employee_name ?? r.employee_id}
                          </div>
                          <div className="text-xs text-slate-500 font-mono">
                            {r.employee_code}
                          </div>
                        </td>
                        <td className="p-3 text-slate-600">
                          {r.process_name ?? "—"}
                        </td>
                        <td className="p-3">
                          <Pill tone="blue">{r.status.replace(/_/g, " ")}</Pill>
                        </td>
                        <td className="p-3 font-mono text-xs text-slate-600">
                          {r.last_working_day_proposed ?? "—"}
                        </td>
                        <td className="p-3">
                          <span className="text-xs font-semibold">
                            {r.clearance_cleared ?? 0}/{r.clearance_total ?? 0}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-400">
          No exit requests match your filters
        </div>
      )}
    </div>
  );
}
