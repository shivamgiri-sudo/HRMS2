import { useMemo, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { OrgChartNodeCard } from "@/components/orgchart/OrgChartNode";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useEmployeeDirectoryMasters } from "@/hooks/useEmployees";
import type { OrgTreeResponse } from "@/types/orgChart";
import {
  Search, Users, ZoomIn, ZoomOut, Maximize2, Minimize2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function NativeOrgChart() {
  const { roleKeys, employeeId } = useWorkforceAccess();
  const isFullAccess = ["super_admin", "admin", "ceo", "hr"].some((r) => roleKeys.includes(r));

  const [processFilter, setProcessFilter] = useState<string>("all");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: masters } = useEmployeeDirectoryMasters();

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (processFilter !== "all") p.set("process_id", processFilter);
    if (branchFilter !== "all") p.set("branch_id", branchFilter);
    return p.toString();
  }, [processFilter, branchFilter]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["org-tree", processFilter, branchFilter],
    queryFn: () =>
      hrmsApi.get<OrgTreeResponse>(
        `/api/employees/org-tree${queryParams ? `?${queryParams}` : ""}`,
      ),
    staleTime: 60_000,
  });

  const treeNodes = data?.nodes ?? [];
  const totalCount = data?.totalCount ?? 0;

  // Count managers
  const stats = useMemo(() => {
    if (!totalCount) return null;
    const MANAGER_ROLES = new Set([
      "super_admin", "admin", "ceo", "hr", "branch_head",
      "process_manager", "manager", "team_leader", "tl", "assistant_manager",
    ]);
    let mgrs = 0;
    function walk(nodes: typeof treeNodes) {
      for (const n of nodes) {
        if (MANAGER_ROLES.has(n.role_key ?? "")) mgrs++;
        if (n.children?.length) walk(n.children);
      }
    }
    walk(treeNodes);
    return { total: totalCount, managers: mgrs, agents: totalCount - mgrs };
  }, [treeNodes, totalCount]);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.15, 2));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.15, 0.3));
  const handleFitView = () => setZoom(1);

  const toggleFullScreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.();
      setIsFullScreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullScreen(false);
    }
  };

  return (
    <DashboardLayout>
      <div
        ref={containerRef}
        className="relative flex flex-col h-[calc(100dvh-64px)] -mx-4 -my-5 sm:-mx-5 sm:-my-5 lg:-mx-6 lg:-my-6 bg-gradient-to-b from-slate-50 via-white to-slate-50/50"
      >
        {/* ── Top toolbar ─────────────────────────────────────────────── */}
        <div className="sticky top-0 z-30 flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-200/60 bg-white/80 backdrop-blur-md">
          {/* Left: title + stats */}
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-lg font-bold text-[#1B3A5C]">Organisation Chart</h1>
              {stats && (
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="font-semibold text-slate-700">{stats.total}</span> people
                  <span className="mx-1.5 text-slate-300">|</span>
                  <span className="font-semibold text-[#1B3A5C]">{stats.managers}</span> managers
                  <span className="mx-1.5 text-slate-300">|</span>
                  <span className="font-semibold text-slate-600">{stats.agents}</span> team members
                </p>
              )}
            </div>
          </div>

          {/* Center: search */}
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              placeholder="Search by name or designation…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm bg-slate-50 border-slate-200 rounded-xl focus:ring-[#1B3A5C]"
            />
          </div>

          {/* Right: filters + zoom */}
          <div className="flex items-center gap-2">
            {isFullAccess && (
              <>
                <Select value={processFilter} onValueChange={setProcessFilter}>
                  <SelectTrigger className="h-9 w-[140px] text-xs border-slate-200 rounded-xl">
                    <SelectValue placeholder="All Processes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Processes</SelectItem>
                    {(masters?.processes ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={branchFilter} onValueChange={setBranchFilter}>
                  <SelectTrigger className="h-9 w-[130px] text-xs border-slate-200 rounded-xl">
                    <SelectValue placeholder="All Branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branches</SelectItem>
                    {(masters?.branches ?? []).map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}

            {/* Zoom controls */}
            <div className="flex items-center gap-0.5 ml-2 bg-slate-100 rounded-xl p-0.5">
              <button
                onClick={handleZoomOut}
                className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition-all text-slate-500 hover:text-slate-800"
                title="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                onClick={handleFitView}
                className="px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-800 rounded-lg hover:bg-white transition-all"
                title="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onClick={handleZoomIn}
                className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition-all text-slate-500 hover:text-slate-800"
                title="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                onClick={toggleFullScreen}
                className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition-all text-slate-500 hover:text-slate-800"
                title="Fullscreen"
              >
                {isFullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* ── Legend bar ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-5 py-2 border-b border-slate-100 bg-white/50">
          {[
            { color: "bg-amber-500", label: "Executive" },
            { color: "bg-[#1B3A5C]", label: "Management" },
            { color: "bg-[#4CAF50]", label: "Team Lead" },
            { color: "bg-slate-400", label: "Team Member" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
              <span className="text-[11px] text-slate-500 font-medium">{label}</span>
            </div>
          ))}
        </div>

        {/* ── Tree canvas (scrollable + zoomable) ─────────────────────── */}
        <div className="flex-1 overflow-auto relative">
          {/* Loading state */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-20 bg-white/60 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[#1B3A5C]/20 border-t-[#1B3A5C]" />
                <p className="text-sm text-slate-500 font-medium">Building organisation tree…</p>
              </div>
            </div>
          )}

          {/* Error state */}
          {isError && !isLoading && (
            <div className="flex items-center justify-center h-full">
              <p className="text-slate-400 text-sm">Could not load org chart.</p>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !isError && treeNodes.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Users className="h-12 w-12 text-slate-200" />
              <p className="text-slate-400 text-sm">No employees found for this scope.</p>
            </div>
          )}

          {/* Org tree */}
          {!isLoading && !isError && treeNodes.length > 0 && (
            <div
              className="inline-flex flex-col items-center min-w-full py-8 px-10 transition-transform duration-200 origin-top"
              style={{ transform: `scale(${zoom})`, minHeight: "100%" }}
            >
              {/* Multiple roots render side by side */}
              <div className="flex items-start gap-6 flex-wrap justify-center">
                {treeNodes.map((rootNode, idx) => (
                  <OrgChartNodeCard
                    key={rootNode.id}
                    node={rootNode}
                    depth={0}
                    currentEmployeeId={employeeId}
                    isLast={idx === treeNodes.length - 1}
                    searchQuery={searchQuery}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
