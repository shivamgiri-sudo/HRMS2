import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { OrgChartNodeCard } from "@/components/orgchart/OrgChartNode";
import { OrgScopeSelector, type OrgChartScope } from "@/components/org-chart/OrgScopeSelector";
import { OrgDataQualityPanel } from "@/components/org-chart/OrgDataQualityPanel";
import { OrgChartFilters, type OrgChartFilterValues } from "@/components/org-chart/OrgChartFilters";
import { OrgNodeDetailsDrawer } from "@/components/org-chart/OrgNodeDetailsDrawer";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import {
  Search, Users, ZoomIn, ZoomOut, Maximize2, Minimize2, Settings as SettingsIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface OrgTreeResponse {
  scope: {
    scope_type: string;
    scope_id: string | null;
    scope_name: string;
  };
  nodes: any[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    relationship_type: string;
  }>;
  data_quality: {
    confidence_score: number;
    missing_manager_count: number;
    inactive_manager_count: number;
    circular_mapping_count: number;
    unmapped_count: number;
  };
}

interface ScopesResponse {
  available_scopes: Array<{
    value: OrgChartScope;
    label: string;
    count: number;
    can_export: boolean;
    can_see_data_quality: boolean;
  }>;
  default_scope: OrgChartScope;
  current_employee: {
    id: string;
    name: string | null;
    designation: string | null;
    branch: string | null;
    process: string | null;
  } | null;
}

export default function NativeOrgChartEnhanced() {
  const { employeeId } = useWorkforceAccess();
  const navigate = useNavigate();

  // Scopes
  const { data: scopesData } = useQuery({
    queryKey: ["org-chart-scopes"],
    queryFn: () => hrmsApi.get<ScopesResponse>("/api/org-chart/scopes"),
    staleTime: 300_000, // 5 min
  });

  const [currentScope, setCurrentScope] = useState<OrgChartScope>("my-chain");
  const [filters, setFilters] = useState<OrgChartFilterValues>({ status: "active" });
  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Set default scope from API
  useEffect(() => {
    if (scopesData?.default_scope) {
      setCurrentScope(scopesData.default_scope);
    }
  }, [scopesData]);

  // Build query params
  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("scope", currentScope);
    if (filters.branch_id) p.set("branch_id", filters.branch_id);
    if (filters.process_id) p.set("process_id", filters.process_id);
    if (filters.department_id) p.set("department_id", filters.department_id);
    if (filters.designation_id) p.set("designation_id", filters.designation_id);
    if (filters.status) p.set("status", filters.status);
    return p.toString();
  }, [currentScope, filters]);

  // Fetch org tree
  const { data: treeData, isLoading, isError } = useQuery({
    queryKey: ["org-chart-tree", queryParams],
    queryFn: () => hrmsApi.get<OrgTreeResponse>(`/api/org-chart/tree?${queryParams}`),
    staleTime: 60_000,
    enabled: !!scopesData,
  });

  // Fetch data quality (HR/Admin only)
  const canSeeDataQuality = scopesData?.available_scopes.some((s) => s.value === currentScope && s.can_see_data_quality);
  const { data: qualityData, refetch: refetchQuality } = useQuery({
    queryKey: ["org-chart-data-quality", currentScope],
    queryFn: () => hrmsApi.get("/api/org-chart/data-quality"),
    staleTime: 120_000,
    enabled: !!canSeeDataQuality,
  });

  const treeNodes = treeData?.nodes ?? [];
  const dataQuality = treeData?.data_quality;

  // Stats
  const stats = useMemo(() => {
    if (!treeNodes.length) return null;
    let total = 0;
    let managers = 0;
    function walk(nodes: any[]) {
      for (const n of nodes) {
        total++;
        if (n.direct_report_count > 0) managers++;
        if (n.children?.length) walk(n.children);
      }
    }
    walk(treeNodes);
    return { total, managers, agents: total - managers };
  }, [treeNodes]);

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

  const handleNodeClick = (nodeId: string) => {
    setSelectedEmployeeId(nodeId);
    setDrawerOpen(true);
  };

  const showAllFilters = ["company", "branch", "process"].includes(currentScope);

  return (
    <DashboardLayout>
      <div
        ref={containerRef}
        className="relative flex flex-col h-[calc(100dvh-64px)] -mx-4 -my-5 sm:-mx-5 sm:-my-5 lg:-mx-6 lg:-my-6 bg-gradient-to-b from-slate-50 via-white to-slate-50/50"
      >
        {/* Top toolbar */}
        <div className="sticky top-0 z-30 flex flex-col gap-2 px-5 py-3 border-b border-slate-200/60 bg-white/80 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            {/* Left: title + stats */}
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-lg font-bold text-[#1B3A5C]">Organisation Chart</h1>
                {stats && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    <span className="font-semibold text-slate-700">{stats.total}</span> people
                    {dataQuality && (
                      <>
                        <span className="mx-1.5 text-slate-300">|</span>
                        <span className="font-semibold text-slate-600">{dataQuality.confidence_score}%</span> quality
                      </>
                    )}
                  </p>
                )}
              </div>
            </div>

            {/* Center: scope selector */}
            {scopesData && (
              <OrgScopeSelector
                availableScopes={scopesData.available_scopes}
                currentScope={currentScope}
                onScopeChange={setCurrentScope}
                disabled={isLoading}
              />
            )}

            {/* Right: search + zoom + settings */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <Input
                  placeholder="Search…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 w-48 text-sm bg-slate-50 border-slate-200 rounded-xl"
                />
              </div>

              {/* Zoom controls */}
              <div className="flex items-center gap-0.5 bg-slate-100 rounded-xl p-0.5">
                <button
                  onClick={handleZoomOut}
                  className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition-all"
                  title="Zoom out"
                >
                  <ZoomOut className="h-4 w-4 text-slate-500" />
                </button>
                <button
                  onClick={handleFitView}
                  className="px-2 py-1 text-[10px] font-bold text-slate-500 rounded-lg hover:bg-white"
                  title="Reset"
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  onClick={handleZoomIn}
                  className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition-all"
                  title="Zoom in"
                >
                  <ZoomIn className="h-4 w-4 text-slate-500" />
                </button>
                <button
                  onClick={toggleFullScreen}
                  className="p-1.5 rounded-lg hover:bg-white hover:shadow-sm transition-all"
                  title="Fullscreen"
                >
                  {isFullScreen ? <Minimize2 className="h-4 w-4 text-slate-500" /> : <Maximize2 className="h-4 w-4 text-slate-500" />}
                </button>
              </div>

              <Button
                onClick={() => navigate("/org-chart/settings")}
                variant="outline"
                size="sm"
                className="h-9"
              >
                <SettingsIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Filters row */}
          {showAllFilters && (
            <OrgChartFilters
              filters={filters}
              onFiltersChange={setFilters}
              availableBranches={[]}
              availableProcesses={[]}
              availableDepartments={[]}
              availableDesignations={[]}
              disabled={isLoading}
              showAllFilters={showAllFilters}
            />
          )}
        </div>

        {/* Data quality panel */}
        {canSeeDataQuality && qualityData && (
          <div className="px-5 pt-4">
            <OrgDataQualityPanel data={qualityData} onRefresh={() => refetchQuality()} />
          </div>
        )}

        {/* Tree canvas */}
        <div className="flex-1 overflow-auto relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-20 bg-white/60 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[#1B3A5C]/20 border-t-[#1B3A5C]" />
                <p className="text-sm text-slate-500 font-medium">Building tree…</p>
              </div>
            </div>
          )}

          {isError && (
            <div className="flex items-center justify-center h-full">
              <p className="text-slate-400 text-sm">Could not load org chart.</p>
            </div>
          )}

          {!isLoading && !isError && treeNodes.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Users className="h-12 w-12 text-slate-200" />
              <p className="text-slate-400 text-sm">No employees found for this scope.</p>
            </div>
          )}

          {!isLoading && !isError && treeNodes.length > 0 && (
            <div
              className="inline-flex flex-col items-center min-w-full py-8 px-10 transition-transform duration-200 origin-top"
              style={{ transform: `scale(${zoom})`, minHeight: "100%" }}
            >
              <div className="flex items-start gap-6 flex-wrap justify-center">
                {treeNodes.map((rootNode, idx) => (
                  <OrgChartNodeCard
                    key={rootNode.id}
                    node={rootNode}
                    depth={0}
                    currentEmployeeId={employeeId}
                    isLast={idx === treeNodes.length - 1}
                    searchQuery={searchQuery}
                    onClick={() => handleNodeClick(rootNode.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Details drawer */}
      <OrgNodeDetailsDrawer
        employeeId={selectedEmployeeId}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onJumpToEmployee={(id) => setSelectedEmployeeId(id)}
      />
    </DashboardLayout>
  );
}
