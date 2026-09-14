import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { KpiStudioBuilder } from "@/components/kpi-studio/KpiStudioBuilder";
import { DataSourceManager } from "@/components/kpi-studio/DataSourceManager";
import { KpiDefinitionList } from "@/components/kpi-studio/KpiDefinitionList";
import { KpiComputePanel } from "@/components/kpi-studio/KpiComputePanel";
import { FlaskConical, Database, ListChecks, Play } from "lucide-react";

/**
 * KPI Studio — build a metric without a developer.
 *
 * The components behind these tabs were written and tested but never reachable:
 * they arrived on 2026-09-02 inside a broad merge titled "async bulk approval +
 * attendance diagnostics", and both the router mount and this page were lost in
 * it. The backend migrations were applied on 2026-09-03. Nothing here is new
 * work — this page and the `/api/kpi-studio` mount are what was missing.
 *
 * Authoring a formula decides what appears on somebody's appraisal, so the write
 * tabs are gated to the roles that already hold KPI config rights; the router
 * enforces the same set again server-side, which is the real boundary.
 */

type TabKey = "definitions" | "build" | "sources" | "compute";

const TABS: Array<{ key: TabKey; label: string; icon: typeof FlaskConical; hint: string }> = [
  { key: "definitions", label: "Definitions", icon: ListChecks, hint: "Every KPI configured, and whether it is receiving data" },
  { key: "build", label: "Build a KPI", icon: FlaskConical, hint: "Pick a metric, a source and a formula" },
  { key: "sources", label: "Data Sources", icon: Database, hint: "Where the numbers are read from" },
  { key: "compute", label: "Compute", icon: Play, hint: "Run a day, preview before writing" },
];

export default function KpiStudioPage() {
  const [tab, setTab] = useState<TabKey>("definitions");

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900">KPI Studio</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Define a metric, point it at where the data lives, and describe the calculation —
            without a code change. Formulas are validated as you type and a computation can be
            previewed before it writes anything.
          </p>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-slate-200">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                title={t.hint}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-slate-500">{TABS.find((t) => t.key === tab)?.hint}</p>

        <div>
          {tab === "definitions" && <KpiDefinitionList />}
          {tab === "build" && <KpiStudioBuilder onSaved={() => setTab("definitions")} />}
          {tab === "sources" && <DataSourceManager />}
          {tab === "compute" && <KpiComputePanel />}
        </div>
      </div>
    </DashboardLayout>
  );
}
