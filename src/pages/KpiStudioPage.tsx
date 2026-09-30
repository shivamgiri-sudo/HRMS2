import { useRef, useState, type KeyboardEvent } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { KpiStudioBuilder } from "@/components/kpi-studio/KpiStudioBuilder";
import { DataSourceManager } from "@/components/kpi-studio/DataSourceManager";
import { KpiDefinitionList } from "@/components/kpi-studio/KpiDefinitionList";
import { KpiComputePanel } from "@/components/kpi-studio/KpiComputePanel";
import type { DefinitionDraft } from "@/components/kpi-studio/definition-model";
import { isOrgWide, useScopeOptions } from "@/hooks/useKpiStudio";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { Database, Eye, FlaskConical, Info, ListChecks, Play, Plus } from "lucide-react";

/**
 * KPI Studio — build a metric without a developer.
 *
 * Authoring a formula decides what appears on somebody's appraisal, so the write tabs are shown
 * only to the roles that hold KPI config rights, and Compute to the narrower set that may run it.
 * Hiding a tab is a courtesy, not the boundary: the router enforces the same roles server-side, and
 * additionally refuses anything outside the caller's own processes.
 */

type TabKey = "definitions" | "build" | "sources" | "compute";

const CONFIG_ROLES = ["super_admin", "admin", "hr", "process_manager", "qa", "tq_head"];
const COMPUTE_ROLES = ["super_admin", "admin", "hr", "process_manager"];

const TABS: Array<{ key: TabKey; label: string; icon: typeof FlaskConical; hint: string }> = [
  { key: "definitions", label: "Definitions", icon: ListChecks, hint: "Every KPI configured, who it applies to, and whether it is current" },
  { key: "build", label: "Build a KPI", icon: FlaskConical, hint: "Pick a metric, a source and a formula" },
  { key: "sources", label: "Data Sources", icon: Database, hint: "Where the numbers are read from" },
  { key: "compute", label: "Compute", icon: Play, hint: "Run a day or a range, and preview before anything is saved" },
];

export default function KpiStudioPage() {
  const [tab, setTab] = useState<TabKey>("definitions");
  const [draft, setDraft] = useState<DefinitionDraft | null>(null);
  // Bumped on every edit/copy so choosing the same row twice still resets the form.
  const [draftNonce, setDraftNonce] = useState(0);
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});

  const access = useWorkforceAccess();
  const scopeOptions = useScopeOptions();

  const canConfigure = access.hasAnyRole(...CONFIG_ROLES);
  const canCompute = access.hasAnyRole(...COMPUTE_ROLES);
  const viewOnly = !access.isLoading && !canConfigure && !canCompute;

  const tabs = TABS.filter((entry) => {
    if (entry.key === "definitions") return true;
    if (entry.key === "compute") return canCompute;
    return canConfigure;
  });
  // A tab that stops being allowed (roles still loading, or changed) falls back to Definitions.
  const activeTab: TabKey = tabs.some((entry) => entry.key === tab) ? tab : "definitions";

  const processCount = scopeOptions.data?.processes.length ?? 0;
  const showScopeNotice = Boolean(scopeOptions.data) && !isOrgWide(scopeOptions.data) && (canConfigure || canCompute);

  function handleEdit(next: DefinitionDraft) {
    setDraft(next);
    setDraftNonce((value) => value + 1);
    setTab("build");
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let target = -1;
    if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") target = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = tabs.length - 1;
    if (target < 0) return;
    event.preventDefault();
    const key = tabs[target].key;
    setTab(key);
    tabRefs.current[key]?.focus();
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 sm:p-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900">KPI Studio</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Define a metric, point it at where the data lives, and describe the calculation,
            without a code change. Formulas are checked as you type and a computation can be
            previewed before it saves anything.
          </p>

          {showScopeNotice && (
            <p className="mt-3 flex items-start gap-2 text-sm text-slate-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              {processCount === 0
                ? "You do not manage any process yet, so there is nothing you can build or compute KPIs for."
                : `You can ${canCompute ? "build and compute" : "build"} KPIs for ${processCount} process${
                    processCount === 1 ? "" : "es"
                  } you manage.`}
            </p>
          )}
          {viewOnly && (
            <p className="mt-3 flex items-start gap-2 text-sm text-slate-700">
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              You can view KPI definitions here. Building, editing and computing them is limited to
              HR, admins, process managers and the quality team.
            </p>
          )}
        </header>

        <div role="tablist" aria-label="KPI Studio sections" className="flex flex-wrap gap-x-2 gap-y-1 border-b border-slate-200">
          {tabs.map((entry, index) => {
            const Icon = entry.icon;
            const active = activeTab === entry.key;
            return (
              <button
                key={entry.key}
                ref={(element) => {
                  tabRefs.current[entry.key] = element;
                }}
                type="button"
                role="tab"
                id={`kpi-studio-tab-${entry.key}`}
                aria-selected={active}
                aria-controls={`kpi-studio-panel-${entry.key}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(entry.key)}
                onKeyDown={(event) => handleTabKey(event, index)}
                className={`-mb-px flex min-h-[44px] cursor-pointer items-center gap-2 rounded-t-md border-b-2 px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                  active
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-600 hover:text-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {entry.label}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`kpi-studio-panel-${activeTab}`}
          aria-labelledby={`kpi-studio-tab-${activeTab}`}
          tabIndex={0}
          className="space-y-4 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-4"
        >
          <p className="text-xs text-slate-500">{TABS.find((entry) => entry.key === activeTab)?.hint}</p>

          {activeTab === "definitions" && <KpiDefinitionList canConfigure={canConfigure} onEdit={handleEdit} />}

          {activeTab === "build" && (
            <>
              {draft && (
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Start a new KPI instead
                </button>
              )}
              <KpiStudioBuilder
                key={draft ? `${draft.mode}-${draft.source_definition_id}-${draftNonce}` : "new"}
                initial={draft ?? undefined}
                mode={draft?.mode ?? "new"}
                onSaved={() => {
                  setDraft(null);
                  setTab("definitions");
                }}
              />
            </>
          )}

          {activeTab === "sources" && <DataSourceManager />}
          {activeTab === "compute" && <KpiComputePanel />}
        </div>
      </div>
    </DashboardLayout>
  );
}
