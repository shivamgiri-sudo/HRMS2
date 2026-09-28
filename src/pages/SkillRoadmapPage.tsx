import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, Circle, X, ChevronRight, Plus, AlertTriangle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Roadmap { id: string; label: string; description: string; node_count: number }
interface RoadmapNode { id: string; node_slug: string; label: string; description: string }
interface SkillState { node_id: string; label: string; node_slug: string; status: "none" | "in_progress" | "done"; updated_at: string }
interface SkillSummary { total: number; done: number; inprog: number; pct: number }
interface Employee { id: string; name: string; employee_code: string; designation?: string; designation_id?: string; branch?: string }

type SkillStatus = "none" | "in_progress" | "done";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<SkillStatus, { label: string; chipCls: string; icon: typeof Circle }> = {
  done:        { label: "Completed",   chipCls: "bg-emerald-100 text-emerald-800 border border-emerald-200", icon: CheckCircle2 },
  in_progress: { label: "In Progress", chipCls: "bg-amber-100 text-amber-800 border border-amber-200",     icon: Clock3 },
  none:        { label: "Not Started", chipCls: "bg-slate-100 text-slate-600 border border-slate-200",     icon: Circle },
};

function SkillChip({
  node, status, onClick
}: { node: RoadmapNode; status: SkillStatus; onClick: () => void }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all hover:-translate-y-px ${meta.chipCls}`}
    >
      <Icon className="w-3 h-3 flex-shrink-0" />
      {node.label}
    </button>
  );
}

// ─── Skill Detail Drawer ──────────────────────────────────────────────────────

function SkillDrawer({
  node, roadmapLabel, currentStatus, employeeId, onClose, onUpdate
}: {
  node: RoadmapNode;
  roadmapLabel: string;
  currentStatus: SkillStatus;
  employeeId: string;
  onClose: () => void;
  onUpdate: (nodeId: string, status: SkillStatus) => void;
}) {
  const [notes, setNotes] = useState("");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between p-5 border-b border-slate-200 bg-slate-50">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Skill Detail</p>
          <h2 className="font-semibold text-slate-800 text-lg leading-tight">{node.label}</h2>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-200 hover:bg-slate-300 flex items-center justify-center text-slate-600 flex-shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Status</p>
          <div className="flex gap-2 flex-wrap">
            {(["done", "in_progress", "none"] as SkillStatus[]).map((s) => {
              const m = STATUS_META[s];
              const active = currentStatus === s;
              return (
                <button
                  key={s}
                  onClick={() => onUpdate(node.id, s)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors border ${active ? m.chipCls + " !bg-opacity-100" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Roadmap</p>
          <span className="text-sm text-slate-700 bg-slate-100 px-2 py-0.5 rounded">{roadmapLabel}</span>
        </div>

        {node.description && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Description</p>
            <p className="text-sm text-slate-700 leading-relaxed">{node.description}</p>
          </div>
        )}

        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Notes</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Add a note…"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Assign Roadmap Drawer ────────────────────────────────────────────────────

function AssignDrawer({
  allRoadmaps, assignedIds, employeeId, onClose, onAssign
}: {
  allRoadmaps: Roadmap[];
  assignedIds: Set<string>;
  employeeId: string;
  onClose: () => void;
  onAssign: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const visible = allRoadmaps.filter((r) =>
    r.label.toLowerCase().includes(filter.toLowerCase()) ||
    r.id.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between p-5 border-b border-slate-200 bg-slate-50">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Assign Roadmap</p>
          <h2 className="font-semibold text-slate-800 text-lg">Select a Skill Roadmap</h2>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-200 hover:bg-slate-300 flex items-center justify-center">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <p className="text-xs text-slate-500 mb-3">{allRoadmaps.length} roadmaps available from roadmap.sh</p>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter roadmaps…"
          className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-slate-50"
        />
        <div className="space-y-1">
          {visible.map((r) => {
            const assigned = assignedIds.has(r.id);
            return (
              <div
                key={r.id}
                onClick={() => !assigned && onAssign(r.id)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${assigned ? "bg-indigo-50 cursor-default" : "hover:bg-slate-50 cursor-pointer"}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${assigned ? "bg-indigo-500" : "bg-slate-300"}`} />
                  <span className="text-sm text-slate-700 truncate">{r.label}</span>
                  <span className="text-xs text-slate-400 flex-shrink-0">{r.node_count} nodes</span>
                </div>
                {assigned && <span className="text-xs text-indigo-600 font-medium flex-shrink-0 ml-2">Assigned</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SkillRoadmapPage() {
  const qc = useQueryClient();

  // Demo: use logged-in user's employee record. In real usage pass from employee profile context.
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [activeRoadmapId, setActiveRoadmapId] = useState<string | null>(null);
  const [openDrawer, setOpenDrawer] = useState<"skill" | "assign" | null>(null);
  const [selectedNode, setSelectedNode] = useState<RoadmapNode | null>(null);

  // Fetch all employees (simplified — in production this is the employee picker)
  const { data: empData } = useQuery({
    queryKey: ["skill-roadmap-employees"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: Employee[] }>("/employees?status=active&limit=50"),
  });
  const employees: Employee[] = (empData as any)?.data ?? [];

  const activeEmployee = employees.find((e) => e.id === selectedEmployeeId) ?? employees[0] ?? null;
  const effectiveEmpId = activeEmployee?.id ?? "";

  // All roadmaps catalogue
  const { data: catalogueData } = useQuery({
    queryKey: ["skill-roadmap-catalogue"],
    queryFn: () => hrmsApi.get("/skill-roadmap/catalogue"),
    enabled: true,
  });
  const allRoadmaps: Roadmap[] = (catalogueData as any)?.data ?? [];

  // Employee's assigned roadmaps
  const { data: assignedData, refetch: refetchAssigned } = useQuery({
    queryKey: ["skill-roadmap-assigned", effectiveEmpId],
    queryFn: () => hrmsApi.get(`/skill-roadmap/employee/${effectiveEmpId}`),
    enabled: !!effectiveEmpId,
  });
  const assignedRoadmaps: Roadmap[] = (assignedData as any)?.data ?? [];
  const assignedIds = useMemo(() => new Set(assignedRoadmaps.map((r) => r.id)), [assignedRoadmaps]);

  const activeRoadmap = assignedRoadmaps[0]
    ? (assignedRoadmaps.find((r) => r.id === activeRoadmapId) ?? assignedRoadmaps[0])
    : null;

  // Nodes for active roadmap
  const { data: nodesData } = useQuery({
    queryKey: ["skill-roadmap-nodes", activeRoadmap?.id],
    queryFn: () => hrmsApi.get(`/skill-roadmap/nodes/${activeRoadmap!.id}`),
    enabled: !!activeRoadmap,
  });
  const nodes: RoadmapNode[] = (nodesData as any)?.data ?? [];

  // Skill states for active roadmap
  const { data: statesData, refetch: refetchStates } = useQuery({
    queryKey: ["skill-roadmap-states", effectiveEmpId, activeRoadmap?.id],
    queryFn: () => hrmsApi.get(`/skill-roadmap/employee/${effectiveEmpId}/states/${activeRoadmap!.id}`),
    enabled: !!effectiveEmpId && !!activeRoadmap,
  });
  const stateMap = useMemo(() => {
    const states: SkillState[] = (statesData as any)?.data?.states ?? [];
    return new Map(states.map((s) => [s.node_id, s.status as SkillStatus]));
  }, [statesData]);
  const summary: SkillSummary = (statesData as any)?.data?.summary ?? { total: 0, done: 0, inprog: 0, pct: 0 };

  // Mutations
  const assignMutation = useMutation({
    mutationFn: (roadmapId: string) =>
      hrmsApi.post(`/skill-roadmap/employee/${effectiveEmpId}/assign`, { roadmap_id: roadmapId }),
    onSuccess: () => { refetchAssigned(); setOpenDrawer(null); },
  });

  const stateMutation = useMutation({
    mutationFn: ({ nodeId, status }: { nodeId: string; status: SkillStatus }) =>
      hrmsApi.patch(`/skill-roadmap/employee/${effectiveEmpId}/state`, { node_id: nodeId, status }),
    onSuccess: () => refetchStates(),
  });

  function handleSkillUpdate(nodeId: string, status: SkillStatus) {
    stateMutation.mutate({ nodeId, status });
    setOpenDrawer(null);
  }

  const selectedNodeStatus = selectedNode ? (stateMap.get(selectedNode.id) ?? "none") : "none";

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-64px)] overflow-hidden">

        {/* Sidebar: Employee list */}
        <aside className="w-64 bg-white border-r border-slate-200 flex-shrink-0 flex flex-col">
          <div className="p-3 border-b border-slate-100">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 px-1 mb-2">Employees</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {employees.slice(0, 30).map((e) => (
              <div
                key={e.id}
                onClick={() => { setSelectedEmployeeId(e.id); setActiveRoadmapId(null); }}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${
                  (activeEmployee?.id === e.id) ? "bg-indigo-50 border-l-2 border-indigo-500" : ""
                }`}
              >
                <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {e.name?.charAt(0)?.toUpperCase() ?? "?"}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{e.name}</p>
                  <p className="text-xs text-slate-500 truncate">{e.employee_code}</p>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-slate-50 p-6">
          {!activeEmployee ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">Select an employee</div>
          ) : (
            <>
              {/* Employee header */}
              <div className="mb-5 flex items-start gap-4">
                <div className="w-14 h-14 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-lg flex-shrink-0">
                  {activeEmployee.name?.charAt(0)?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl font-semibold text-slate-800">{activeEmployee.name}</h1>
                  <p className="text-sm text-slate-500">{activeEmployee.designation ?? "–"} · {activeEmployee.branch ?? "–"} · {activeEmployee.employee_code}</p>
                  <div className="flex gap-2 mt-2">
                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">Skills</span>
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">Active</span>
                  </div>
                </div>
                <button
                  onClick={() => setOpenDrawer("assign")}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex-shrink-0"
                >
                  <Plus className="w-4 h-4" /> Assign Roadmap
                </button>
              </div>

              {assignedRoadmaps.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
                  <p className="text-slate-400 text-sm mb-3">No roadmaps assigned yet.</p>
                  <button
                    onClick={() => setOpenDrawer("assign")}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
                  >
                    Assign First Roadmap
                  </button>
                </div>
              ) : (
                <>
                  {/* Roadmap card */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-5 overflow-hidden">
                    {/* Tabs */}
                    <div className="flex border-b border-slate-200 overflow-x-auto">
                      {assignedRoadmaps.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setActiveRoadmapId(r.id)}
                          className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                            activeRoadmap?.id === r.id
                              ? "border-indigo-500 text-indigo-700"
                              : "border-transparent text-slate-500 hover:text-slate-700"
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-4 divide-x divide-slate-100 border-b border-slate-100">
                      {[
                        { label: "Total Skills", value: summary.total, cls: "text-slate-800" },
                        { label: "Completed", value: summary.done, cls: "text-emerald-600" },
                        { label: "In Progress", value: summary.inprog, cls: "text-amber-600" },
                        { label: "Completion", value: summary.pct + "%", cls: "text-indigo-600" },
                      ].map((s) => (
                        <div key={s.label} className="p-4 text-center">
                          <div className={`text-2xl font-bold ${s.cls}`}>{s.value}</div>
                          <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Progress bar */}
                    <div className="px-5 py-3 flex items-center gap-3 border-b border-slate-100">
                      <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: summary.pct + "%" }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-slate-500 w-8 text-right">{summary.pct}%</span>
                    </div>

                    {/* Skill chips */}
                    <div className="p-4 flex flex-wrap gap-2 min-h-[100px]">
                      {nodes.length === 0 && (
                        <p className="text-xs text-slate-400 italic">No nodes loaded — import via Admin.</p>
                      )}
                      {nodes.map((node) => (
                        <SkillChip
                          key={node.id}
                          node={node}
                          status={stateMap.get(node.id) ?? "none"}
                          onClick={() => { setSelectedNode(node); setOpenDrawer("skill"); }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Gap card */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                      Skills Not Yet Started
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {nodes.filter((n) => (stateMap.get(n.id) ?? "none") === "none").slice(0, 20).map((n) => (
                        <button
                          key={n.id}
                          onClick={() => { setSelectedNode(n); setOpenDrawer("skill"); }}
                          className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors"
                        >
                          <Circle className="w-3 h-3" />
                          {n.label}
                        </button>
                      ))}
                      {nodes.filter((n) => (stateMap.get(n.id) ?? "none") === "none").length === 0 && (
                        <span className="text-sm text-emerald-600 font-medium">✓ All skills covered</span>
                      )}
                    </div>
                    {nodes.filter((n) => (stateMap.get(n.id) ?? "none") === "none").length > 0 && (
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-xs text-slate-500">
                          {nodes.filter((n) => (stateMap.get(n.id) ?? "none") === "none").length} skills not started
                        </span>
                        <button className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 font-medium">
                          Push to LMS Training Plan
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </main>

        {/* Drawers */}
        {openDrawer && (
          <div className="fixed inset-0 bg-black/20 z-20" onClick={() => setOpenDrawer(null)} />
        )}

        {/* Skill detail drawer */}
        <div
          className={`fixed inset-y-0 right-0 w-[460px] bg-white border-l border-slate-200 shadow-2xl z-30 transition-transform duration-250 ${
            openDrawer === "skill" ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {selectedNode && activeRoadmap && (
            <SkillDrawer
              node={selectedNode}
              roadmapLabel={activeRoadmap.label}
              currentStatus={selectedNodeStatus}
              employeeId={effectiveEmpId}
              onClose={() => setOpenDrawer(null)}
              onUpdate={handleSkillUpdate}
            />
          )}
        </div>

        {/* Assign roadmap drawer */}
        <div
          className={`fixed inset-y-0 right-0 w-[420px] bg-white border-l border-slate-200 shadow-2xl z-30 transition-transform duration-250 ${
            openDrawer === "assign" ? "translate-x-0" : "translate-x-full"
          }`}
        >
          {openDrawer === "assign" && (
            <AssignDrawer
              allRoadmaps={allRoadmaps}
              assignedIds={assignedIds}
              employeeId={effectiveEmpId}
              onClose={() => setOpenDrawer(null)}
              onAssign={(id) => assignMutation.mutate(id)}
            />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
