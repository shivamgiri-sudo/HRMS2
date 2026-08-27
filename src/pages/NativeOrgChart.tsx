import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { OrgChartNodeCard } from "@/components/orgchart/OrgChartNode";
import { OrgNodeDetailsDrawer } from "@/components/org-chart/OrgNodeDetailsDrawer";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useEmployeeDirectoryMasters } from "@/hooks/useEmployees";
import type { OrgTreeNode, OrgTreeResponse } from "@/types/orgChart";
import {
  Search, Users, ZoomIn, ZoomOut, Maximize2, Minimize2, Crosshair,
  ChevronsDownUp, ChevronsUpDown, AlertTriangle, UserX, X, Move,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";


interface NodeIndexEntry {
  node: OrgTreeNode;
  parentId: string | null;
  depth: number;
}

/** Flattens the forest once so lookups, ancestry walks and search stay O(1) per node. */
function indexTree(roots: OrgTreeNode[]): Map<string, NodeIndexEntry> {
  const index = new Map<string, NodeIndexEntry>();
  const walk = (nodes: OrgTreeNode[], parentId: string | null, depth: number) => {
    for (const node of nodes) {
      index.set(node.id, { node, parentId, depth });
      if (node.children.length) walk(node.children, node.id, depth + 1);
    }
  };
  walk(roots, null, 0);
  return index;
}

function ancestorsOf(index: Map<string, NodeIndexEntry>, id: string): string[] {
  const chain: string[] = [];
  let cursor = index.get(id)?.parentId ?? null;
  while (cursor) {
    chain.push(cursor);
    cursor = index.get(cursor)?.parentId ?? null;
  }
  return chain;
}

export default function NativeOrgChart() {
  const { roleKeys, employeeId } = useWorkforceAccess();
  const isFullAccess = ["super_admin", "admin", "ceo", "hr"].some((r) => roleKeys.includes(r));

  const [processFilter, setProcessFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(0.85);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [drilldownId, setDrilldownId] = useState<string | null>(null);

  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const didAutoFocus = useRef(false);
  const panState = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

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

  const treeNodes = useMemo(() => data?.nodes ?? [], [data]);
  const unassigned = useMemo(() => data?.unassigned ?? [], [data]);
  const dataIssues = useMemo(() => data?.dataIssues ?? [], [data]);
  const selfId = data?.selfEmployeeId ?? employeeId ?? null;

  const index = useMemo(() => indexTree(treeNodes), [treeNodes]);

  const maxDepth = useMemo(() => {
    let deepest = 0;
    for (const entry of index.values()) deepest = Math.max(deepest, entry.depth);
    return deepest;
  }, [index]);

  const stats = useMemo(() => {
    const withoutDesignation = [...index.values()].filter((e) => !e.node.designation).length
      + unassigned.filter((n) => !n.designation).length;
    const withoutPhoto = [...index.values()].filter((e) => !e.node.avatar_url).length
      + unassigned.filter((n) => !n.avatar_url).length;
    return {
      total: data?.totalCount ?? 0,
      inChart: data?.renderedCount ?? index.size,
      unassigned: unassigned.length,
      withoutDesignation,
      withoutPhoto,
    };
  }, [data, index, unassigned]);

  const scrollNodeIntoView = useCallback((id: string) => {
    // Two frames: one for the expansion state to commit, one for layout to settle before
    // measuring. A single frame lands on the pre-expansion position.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        canvasRef.current
          ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      });
    });
  }, []);

  /** Opens every branch between a root and `id`, then centres the viewport on that card. */
  const revealNode = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      for (const ancestorId of ancestorsOf(index, id)) next.add(ancestorId);
      const entry = index.get(id);
      if (entry?.node.children.length) next.add(id);
      return next;
    });
    scrollNodeIntoView(id);
  }, [index, scrollNodeIntoView]);

  // On first load, open the chart on the viewer rather than at an arbitrary root — "where do
  // I sit" is the question this page exists to answer.
  //
  // Deliberately narrow: opening every branch two levels deep sounds friendlier but on the
  // live tree that is six roots times up to twelve visible reports, a row roughly 15,000px
  // wide that opens scrolled to the middle of nowhere. One open path beats a wall of cards.
  useEffect(() => {
    if (didAutoFocus.current || index.size === 0) return;
    didAutoFocus.current = true;

    const seed = new Set<string>();
    if (selfId && index.has(selfId)) {
      for (const ancestorId of ancestorsOf(index, selfId)) seed.add(ancestorId);
      if (index.get(selfId)!.node.children.length) seed.add(selfId);
    } else if (treeNodes.length > 0) {
      // Roots arrive sorted largest-first, so this opens the main hierarchy and leaves the
      // smaller ones as single cards the viewer can open themselves.
      seed.add(treeNodes[0].id);
    }
    setExpandedIds(seed);
    if (selfId && index.has(selfId)) scrollNodeIntoView(selfId);
  }, [index, selfId, treeNodes, scrollNodeIntoView]);

  // Filter changes rebuild the forest, so the focus pass has to run again for the new tree.
  useEffect(() => { didAutoFocus.current = false; }, [processFilter, branchFilter]);

  const toggleNode = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = () => {
    const all = new Set<string>();
    for (const entry of index.values()) if (entry.node.children.length) all.add(entry.node.id);
    setExpandedIds(all);
  };

  const collapseAll = () => setExpandedIds(new Set<string>());

  const expandToDepth = (depth: number) => {
    const next = new Set<string>();
    for (const entry of index.values()) {
      if (entry.depth < depth && entry.node.children.length) next.add(entry.node.id);
    }
    setExpandedIds(next);
  };

  // ── Search ──────────────────────────────────────────────────────────────────
  const query = searchQuery.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (query.length < 2) return [];
    const hits: OrgTreeNode[] = [];
    const matches = (n: OrgTreeNode) =>
      n.name.toLowerCase().includes(query)
      || (n.designation ?? "").toLowerCase().includes(query)
      || (n.department_name ?? "").toLowerCase().includes(query)
      || (n.employee_code ?? "").toLowerCase().includes(query);
    for (const entry of index.values()) if (matches(entry.node)) hits.push(entry.node);
    return hits.slice(0, 40);
  }, [query, index]);

  /**
   * Matches plus their ancestors. Dimming the ancestors too would break the visual line back
   * up to the root, which is the context that makes a hit meaningful.
   */
  const matchIds = useMemo(() => {
    if (query.length < 2) return null;
    const ids = new Set<string>();
    for (const hit of searchResults) {
      ids.add(hit.id);
      for (const ancestorId of ancestorsOf(index, hit.id)) ids.add(ancestorId);
    }
    return ids;
  }, [query, searchResults, index]);

  // Opening the path to every hit keeps matches reachable instead of buried in a closed branch.
  useEffect(() => {
    if (searchResults.length === 0) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      for (const hit of searchResults) for (const a of ancestorsOf(index, hit.id)) next.add(a);
      return next;
    });
  }, [searchResults, index]);

  // ── Canvas pan / zoom ───────────────────────────────────────────────────────
  const zoomIn = () => setZoom((z) => Math.min(+(z + 0.1).toFixed(2), 1.6));
  const zoomOut = () => setZoom((z) => Math.max(+(z - 0.1).toFixed(2), 0.25));

  const onPanStart = (e: React.MouseEvent) => {
    // Left-drag on empty canvas pans. Cards handle their own clicks and stop here.
    if (e.button !== 0 || !canvasRef.current) return;
    if ((e.target as HTMLElement).closest("[data-node-id],button,a,input")) return;
    panState.current = {
      x: e.clientX, y: e.clientY,
      left: canvasRef.current.scrollLeft, top: canvasRef.current.scrollTop,
    };
    setIsPanning(true);
  };

  useEffect(() => {
    if (!isPanning) return;
    const move = (e: MouseEvent) => {
      const start = panState.current;
      if (!start || !canvasRef.current) return;
      canvasRef.current.scrollLeft = start.left - (e.clientX - start.x);
      canvasRef.current.scrollTop = start.top - (e.clientY - start.y);
    };
    const up = () => { panState.current = null; setIsPanning(false); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [isPanning]);

  const toggleFullScreen = () => {
    if (!shellRef.current) return;
    if (!document.fullscreenElement) {
      shellRef.current.requestFullscreen?.();
      setIsFullScreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullScreen(false);
    }
  };

  const canFindMe = !!selfId && index.has(selfId);

  return (
    <DashboardLayout>
      <div
        ref={shellRef}
        className="relative -mx-4 -my-5 flex h-[calc(100dvh-64px)] flex-col bg-slate-50 sm:-mx-5 sm:-my-5 lg:-mx-6 lg:-my-6"
      >
        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        <div className="z-30 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/90 px-5 py-3 backdrop-blur-md">
          <div className="mr-auto">
            <h1 className="text-[17px] font-bold tracking-tight text-[#1B3A5C]">Organisation Chart</h1>
            <p className="mt-0.5 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">{stats.inChart}</span> in the hierarchy
              {stats.unassigned > 0 && (
                <>
                  <span className="mx-1.5 text-slate-300">|</span>
                  <button
                    onClick={() => setShowUnassigned((v) => !v)}
                    className="font-semibold text-amber-600 underline-offset-2 hover:underline"
                  >
                    {stats.unassigned} unplaced
                  </button>
                </>
              )}
              <span className="mx-1.5 text-slate-300">|</span>
              <span className="font-semibold text-slate-700">{maxDepth + 1}</span> levels
            </p>
          </div>

          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search name, code, designation, department…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-xl border-slate-200 bg-slate-50 pl-9 pr-8 text-sm focus:ring-[#1B3A5C]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}

            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-11 z-40 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                {searchResults.map((hit) => (
                  <button
                    key={hit.id}
                    onClick={() => revealNode(hit.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1B3A5C]/10 text-[10px] font-bold text-[#1B3A5C]">
                      {hit.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-slate-800">{hit.name}</span>
                      <span className="block truncate text-[10px] text-slate-500">
                        {hit.designation || "Designation not set"} · {hit.department_name || "No department"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {isFullAccess && (
            <>
              <Select value={processFilter} onValueChange={setProcessFilter}>
                <SelectTrigger className="h-9 w-[150px] rounded-xl border-slate-200 text-xs">
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
                <SelectTrigger className="h-9 w-[140px] rounded-xl border-slate-200 text-xs">
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

          {canFindMe && (
            <button
              onClick={() => revealNode(selfId!)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#1B3A5C] px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#16304c]"
            >
              <Crosshair className="h-3.5 w-3.5" />
              Find me
            </button>
          )}

          <div className="flex items-center gap-0.5 rounded-xl bg-slate-100 p-0.5">
            <button onClick={expandAll} title="Expand every branch"
              className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-white hover:text-slate-800 hover:shadow-sm">
              <ChevronsUpDown className="h-4 w-4" />
            </button>
            <button onClick={collapseAll} title="Collapse every branch"
              className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-white hover:text-slate-800 hover:shadow-sm">
              <ChevronsDownUp className="h-4 w-4" />
            </button>
            <span className="mx-0.5 h-4 w-px bg-slate-300" />
            {[1, 2, 3].map((d) => (
              <button key={d} onClick={() => expandToDepth(d)} title={`Show ${d} level${d > 1 ? "s" : ""}`}
                className="rounded-lg px-1.5 py-1 text-[10px] font-bold text-slate-500 transition-all hover:bg-white hover:text-slate-800">
                L{d}
              </button>
            ))}
            <span className="mx-0.5 h-4 w-px bg-slate-300" />
            <button onClick={zoomOut} title="Zoom out"
              className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-white hover:text-slate-800 hover:shadow-sm">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button onClick={() => setZoom(0.85)} title="Reset zoom"
              className="rounded-lg px-1.5 py-1 text-[10px] font-bold text-slate-500 transition-all hover:bg-white hover:text-slate-800">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={zoomIn} title="Zoom in"
              className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-white hover:text-slate-800 hover:shadow-sm">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button onClick={toggleFullScreen} title="Fullscreen"
              className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-white hover:text-slate-800 hover:shadow-sm">
              {isFullScreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* ── Data-quality strip ──────────────────────────────────────────── */}
        {(dataIssues.length > 0 || stats.withoutDesignation > 0 || stats.withoutPhoto > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-amber-100 bg-amber-50/70 px-5 py-1.5 text-[11px] text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {dataIssues.length > 0 && (
              <button onClick={() => setShowIssues((v) => !v)} className="font-semibold underline-offset-2 hover:underline">
                {dataIssues.length} reporting-line issue{dataIssues.length === 1 ? "" : "s"}
              </button>
            )}
            {stats.withoutDesignation > 0 && <span>{stats.withoutDesignation} without a designation</span>}
            {stats.withoutPhoto > 0 && <span>{stats.withoutPhoto} without a photo</span>}
          </div>
        )}

        {showIssues && dataIssues.length > 0 && (
          <div className="max-h-44 overflow-y-auto border-b border-amber-100 bg-white px-5 py-2">
            <table className="w-full text-[11px]">
              <tbody>
                {dataIssues.map((issue) => (
                  <tr
                    key={`${issue.type}-${issue.employeeId}`}
                    onClick={() => setDrilldownId(issue.employeeId)}
                    className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50"
                  >
                    <td className="py-1 pr-3 font-mono text-slate-400">{issue.employeeCode}</td>
                    <td className="py-1 pr-3 font-semibold text-slate-700">{issue.name}</td>
                    <td className="py-1 text-slate-500">{issue.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Legend ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-center gap-5 border-b border-slate-100 bg-white px-5 py-1.5">
          {["Level 1", "Level 2", "Level 3", "Level 4", "Level 5+"].map((label, i) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className={`h-2 w-4 rounded-full ${["bg-amber-500", "bg-[#1B3A5C]", "bg-[#4CAF50]", "bg-violet-500", "bg-slate-400"][i]}`} />
              <span className="text-[10px] font-medium text-slate-500">{label}</span>
            </div>
          ))}
          <span className="ml-3 inline-flex items-center gap-1 text-[10px] text-slate-400">
            <Move className="h-3 w-3" /> drag to pan
          </span>
        </div>

        {/* ── Canvas ──────────────────────────────────────────────────────── */}
        <div
          ref={canvasRef}
          onMouseDown={onPanStart}
          className={[
            "relative flex-1 overflow-auto",
            isPanning ? "cursor-grabbing" : "cursor-grab",
          ].join(" ")}
          style={{
            backgroundImage: "radial-gradient(circle, rgb(203 213 225 / 0.55) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        >
          {isLoading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[#1B3A5C]/20 border-t-[#1B3A5C]" />
                <p className="text-sm font-medium text-slate-500">Building organisation tree…</p>
              </div>
            </div>
          )}

          {isError && !isLoading && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-slate-400">Could not load the org chart.</p>
            </div>
          )}

          {!isLoading && !isError && treeNodes.length === 0 && unassigned.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <Users className="h-12 w-12 text-slate-200" />
              <p className="text-sm text-slate-400">No employees found for this scope.</p>
            </div>
          )}

          {!isLoading && !isError && treeNodes.length > 0 && (
            <div
              className="inline-flex min-w-full flex-col items-center px-12 py-10"
              style={{ transform: `scale(${zoom})`, transformOrigin: "top center", minHeight: "100%" }}
            >
              <div className="flex flex-wrap items-start justify-center gap-10">
                {treeNodes.map((root) => (
                  <OrgChartNodeCard
                    key={root.id}
                    node={root}
                    depth={0}
                    selfEmployeeId={selfId}
                    expandedIds={expandedIds}
                    onToggle={toggleNode}
                    matchIds={matchIds}
                    onSelect={(node) => setDrilldownId(node.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Unplaced tray ───────────────────────────────────────────────── */}
        {unassigned.length > 0 && (
          <div className="border-t border-slate-200 bg-white">
            <button
              onClick={() => setShowUnassigned((v) => !v)}
              className="flex w-full items-center gap-2 px-5 py-2 text-left text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              <UserX className="h-3.5 w-3.5 text-amber-500" />
              {unassigned.length} employees with no reporting manager and no reports
              <span className="ml-auto text-slate-400">{showUnassigned ? "Hide" : "Show"}</span>
            </button>
            {showUnassigned && (
              <div className="max-h-52 overflow-y-auto border-t border-slate-100 px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  {unassigned.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => setDrilldownId(person.id)}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left transition-colors hover:border-[#1B3A5C]/40 hover:bg-white"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-[9px] font-bold text-white">
                        {person.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-semibold text-slate-700">{person.name}</span>
                        <span className="block truncate text-[9px] text-slate-500">
                          {person.designation || "Designation not set"} · {person.branch_name || "—"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Drill-down drawer ───────────────────────────────────────────
            CLAUDE.md drill-down mandate: a row/card click opens a right-side slide-over with
            the full record, its reporting chain, its direct reports and its data-quality
            issues — not a summary of what the card already showed. */}
        <OrgNodeDetailsDrawer
          employeeId={drilldownId}
          isOpen={!!drilldownId}
          onClose={() => setDrilldownId(null)}
          onJumpToManager={(managerId) => { setDrilldownId(null); revealNode(managerId); }}
          onJumpToEmployee={(id) => { setDrilldownId(null); revealNode(id); }}
        />

      </div>
    </DashboardLayout>
  );
}
