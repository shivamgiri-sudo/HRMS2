import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Node,
  type Edge,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { OrgChartNode } from "@/components/orgchart/OrgChartNode";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useEmployeeDirectoryMasters } from "@/hooks/useEmployees";
import type { OrgTreeNode, OrgTreeResponse } from "@/types/orgChart";
import {
  Search, Users, ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Constants ────────────────────────────────────────────────────────────────
const NODE_W = 130;
const NODE_H = 170;

// nodeTypes MUST be defined outside the component to prevent React Flow remounting
const nodeTypes = { portraitCard: OrgChartNode };

const DEPTH_COLORS = [
  { color: "#F59E0B", label: "Executive" },
  { color: "#6366F1", label: "Management" },
  { color: "#8B5CF6", label: "Team Lead" },
  { color: "#94A3B8", label: "Agent" },
];

const MANAGER_ROLES = new Set([
  "super_admin", "admin", "ceo", "hr",
  "branch_head", "process_manager", "manager",
  "team_leader", "tl", "assistant_manager",
]);

// ── Dagre layout ─────────────────────────────────────────────────────────────
function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (!nodes.length) return nodes;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 90, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

// ── Tree → React Flow nodes/edges ────────────────────────────────────────────
function treeToFlow(
  treeNodes: OrgTreeNode[],
  depth = 0,
  currentEmpId?: string | null,
  rfNodes: Node[] = [],
  rfEdges: Edge[] = [],
): { rfNodes: Node[]; rfEdges: Edge[] } {
  for (const node of treeNodes) {
    rfNodes.push({
      id: node.id,
      type: "portraitCard",
      position: { x: 0, y: 0 },
      data: {
        ...node,
        depth,
        isCurrentUser: node.id === currentEmpId,
      },
    });
    for (const child of node.children ?? []) {
      rfEdges.push({
        id: `e-${node.id}-${child.id}`,
        source: node.id,
        target: child.id,
        type: "smoothstep",
        style: { stroke: "#C7D2FE", strokeWidth: 1.5 },
      });
    }
    treeToFlow(node.children ?? [], depth + 1, currentEmpId, rfNodes, rfEdges);
  }
  return { rfNodes, rfEdges };
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function NativeOrgChart() {
  const { roleKeys, employeeId } = useWorkforceAccess();

  const isFullAccess = ["super_admin", "admin", "ceo", "hr"].some((r) =>
    roleKeys.includes(r),
  );

  const [processFilter, setProcessFilter] = useState<string>("all");
  const [branchFilter, setBranchFilter]   = useState<string>("all");
  const [searchQuery, setSearchQuery]     = useState("");
  const [showFilters, setShowFilters]     = useState(false);

  const { data: masters } = useEmployeeDirectoryMasters();

  // Build query params
  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (processFilter !== "all") p.set("process_id", processFilter);
    if (branchFilter !== "all")  p.set("branch_id", branchFilter);
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

  // Convert API tree data → React Flow nodes/edges with Dagre layout
  const { layoutedNodes, layoutedEdges, stats } = useMemo(() => {
    const treeNodes = data?.nodes ?? [];
    if (!treeNodes.length) {
      return { layoutedNodes: [], layoutedEdges: [], stats: null };
    }
    const { rfNodes, rfEdges } = treeToFlow(treeNodes, 0, employeeId);
    const positioned = applyDagreLayout(rfNodes, rfEdges);

    const managerCount = rfNodes.filter((n) =>
      MANAGER_ROLES.has((n.data as any).role_key ?? ""),
    ).length;

    return {
      layoutedNodes: positioned,
      layoutedEdges: rfEdges,
      stats: {
        total: rfNodes.length,
        managers: managerCount,
        agents: rfNodes.length - managerCount,
      },
    };
  }, [data, employeeId]);

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  // Sync when new data arrives
  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  // Client-side search — dims non-matching nodes
  const displayNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.map((n) => ({
      ...n,
      style: {
        ...(n.style ?? {}),
        opacity: (n.data as any).name?.toLowerCase().includes(q) ||
          (n.data as any).designation?.toLowerCase().includes(q)
          ? 1
          : 0.2,
      },
    }));
  }, [nodes, searchQuery]);

  return (
    <DashboardLayout>
      {/* Cancel DashboardLayout padding; fill remaining viewport height */}
      <div
        className="-mx-4 -my-5 sm:-mx-5 sm:-my-5 lg:-mx-6 lg:-my-6 relative select-none"
        style={{ height: "calc(100dvh - 64px)" }}
      >
        {/* Gradient canvas background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 pointer-events-none" />

        {/* ── Floating controls — top-right ─────────────────────────────── */}
        <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <Input
              placeholder="Search people…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 w-52 text-xs bg-white/90 backdrop-blur-sm border-slate-200 shadow-sm rounded-full"
            />
          </div>

          {/* Filter toggle (full access only) */}
          {isFullAccess && (
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={() => setShowFilters((v) => !v)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/90 backdrop-blur-sm border border-slate-200 shadow-sm text-xs text-slate-600 hover:bg-white transition-colors"
              >
                Filters
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${showFilters ? "rotate-180" : ""}`}
                />
              </button>
              {showFilters && (
                <div className="flex gap-2">
                  <Select value={processFilter} onValueChange={setProcessFilter}>
                    <SelectTrigger className="h-8 w-40 text-xs bg-white/90 backdrop-blur-sm border-slate-200 shadow-sm rounded-xl">
                      <SelectValue placeholder="All Processes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Processes</SelectItem>
                      {(masters?.processes ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={branchFilter} onValueChange={setBranchFilter}>
                    <SelectTrigger className="h-8 w-36 text-xs bg-white/90 backdrop-blur-sm border-slate-200 shadow-sm rounded-xl">
                      <SelectValue placeholder="All Branches" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Branches</SelectItem>
                      {(masters?.branches ?? []).map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {/* Level legend */}
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl border border-slate-200/80 px-3 py-2.5 shadow-sm">
            <p className="text-[9px] font-black text-slate-400 tracking-widest mb-2 uppercase">
              Levels
            </p>
            {DEPTH_COLORS.map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2 mb-1 last:mb-0">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-[10px] text-slate-600">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Stats pill — bottom-center ────────────────────────────────── */}
        {stats && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <div className="flex items-center gap-2.5 bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 border border-slate-200/80 shadow-md text-xs">
              <Users className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-slate-700 font-semibold">{stats.total} total</span>
              <span className="text-slate-300">·</span>
              <span className="text-indigo-600 font-semibold">{stats.managers} managers</span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-600 font-medium">{stats.agents} agents</span>
            </div>
          </div>
        )}

        {/* ── Loading state ─────────────────────────────────────────────── */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-30 bg-white/50 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-indigo-100 border-t-indigo-500" />
              <p className="text-sm text-slate-500 font-medium">Building org chart…</p>
            </div>
          </div>
        )}

        {/* ── Error state ───────────────────────────────────────────────── */}
        {isError && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="text-center">
              <p className="text-slate-400 text-sm">Could not load org chart.</p>
            </div>
          </div>
        )}

        {/* ── Empty state ───────────────────────────────────────────────── */}
        {!isLoading && !isError && layoutedNodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="text-center">
              <Users className="h-10 w-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">No employees found for this scope.</p>
            </div>
          </div>
        )}

        {/* ── React Flow canvas ─────────────────────────────────────────── */}
        {!isLoading && !isError && layoutedNodes.length > 0 && (
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.12, includeHiddenNodes: false }}
            onInit={(rf) => rf.fitView({ padding: 0.12 })}
            minZoom={0.05}
            maxZoom={2.5}
            nodesDraggable={false}
            elementsSelectable={false}
            className="w-full h-full"
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="#CBD5E1"
              style={{ opacity: 0.35 }}
            />
            <Controls
              position="bottom-right"
              showInteractive={false}
              className="!border-slate-200/80 !bg-white/90 !shadow-sm !backdrop-blur-sm !rounded-xl"
            />
            <MiniMap
              nodeColor={(n) => {
                const depth = (n.data as any).depth ?? 3;
                return DEPTH_COLORS[Math.min(depth, 3)]?.color ?? "#94A3B8";
              }}
              maskColor="rgba(248,250,252,0.7)"
              position="bottom-left"
              className="!border-slate-200/80 !bg-white/90 !rounded-2xl !shadow-sm"
            />
          </ReactFlow>
        )}
      </div>
    </DashboardLayout>
  );
}
