import {
  CheckCircle2,
  Clock,
  Monitor,
  Package,
  Server,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

import {
  ReferenceHeader,
  ReferenceListRow,
  ReferenceMetricGrid,
  ReferencePanel,
  ReferenceQuickLink,
} from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import {
  arrayAt,
  asNumber,
  formatValue,
} from "../reference-dashboard-model";

export function ItManagerReferenceLayout({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const it = data.itProvisioning ?? {};
  const sourceAvailable = data.itProvisioningAvailable !== false;

  // Counters from /api/provisioning/it/stats — fallback to 0 when endpoint not yet live
  const pendingTotal = sourceAvailable ? asNumber(it.pending_total ?? m.onb?.value) : null;
  const pendingDomain = sourceAvailable ? asNumber(it.pending_domain) : null;
  const pendingEmail = sourceAvailable ? asNumber(it.pending_email) : null;
  const pendingAsset = sourceAvailable ? asNumber(it.pending_asset ?? m.assets?.value) : null;
  const pendingBiometric = sourceAvailable ? asNumber(it.pending_biometric) : null;
  const completedToday = sourceAvailable ? asNumber(it.completed_today) : null;

  const pendingJoiners = arrayAt(it, "pending_joiners").slice(0, 8);
  const recentCompleted = arrayAt(it, "recent_completed").slice(0, 5);

  const taskBreakdown = [
    { label: "Domain / Login", value: pendingDomain ?? -1, color: "#3b82f6" },
    { label: "Email Setup", value: pendingEmail ?? -1, color: "#8b5cf6" },
    { label: "Asset Assignment", value: pendingAsset ?? -1, color: "#f59e0b" },
    { label: "Biometric Enroll", value: pendingBiometric ?? -1, color: "#06b6d4" },
  ].filter((t) => sourceAvailable && t.value > 0);
  const maxTask = Math.max(...taskBreakdown.map((t) => t.value), 1);

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader
        title="IT Department Dashboard"
        subtitle="Provisioning queue, asset assignment and new joiner IT setup"
        badge="IT Manager View"
      />

      <ReferenceMetricGrid
        columns={4}
        loading={data.loading}
        metrics={[
          {
            label: "Pending Provisioning",
            value: pendingTotal,
            helper: "new joiners awaiting IT setup",
            icon: Clock,
            tone: pendingTotal === null ? "slate" : pendingTotal > 10 ? "red" : pendingTotal > 5 ? "amber" : "green",
          },
          {
            label: "Assets Pending",
            value: pendingAsset,
            helper: "unassigned to new joiners",
            icon: Package,
            tone: pendingAsset === null ? "slate" : "amber",
          },
          {
            label: "Biometric Pending",
            value: pendingBiometric,
            helper: "enrolment not done",
            icon: ShieldCheck,
            tone: pendingBiometric === null ? "slate" : pendingBiometric > 0 ? "amber" : "green",
          },
          {
            label: "Completed Today",
            value: completedToday,
            helper: "provisioning tasks closed",
            icon: CheckCircle2,
            tone: completedToday === null ? "slate" : "green",
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <ReferencePanel title="Task Breakdown" bodyClassName="p-4">
          {taskBreakdown.length > 0 ? (
            <div className="space-y-3">
              {taskBreakdown.map((task) => {
                const pct = Math.round((task.value / maxTask) * 100);
                return (
                  <div key={task.label} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-right text-xs text-[#61708a]">{task.label}</span>
                    <div className="flex-1 overflow-hidden rounded-full bg-[#f1f5f9] h-3">
                      <div
                        className="h-3 rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: task.color }}
                      />
                    </div>
                    <span className="w-8 text-xs font-semibold text-[#0b1f44]">{formatValue(task.value)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-[#a0aec0]">
              {sourceAvailable ? "No pending provisioning tasks" : "Provisioning source unavailable"}
            </p>
          )}
        </ReferencePanel>

        <ReferencePanel
          title="New Joiners Awaiting IT Setup"
          action={<span className="text-xs text-[#61708a]">{formatValue(pendingJoiners.length)} pending</span>}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            {pendingJoiners.length > 0 ? pendingJoiners.map((row, i) => (
              <ReferenceListRow
                key={i}
                left={String(row.employee_name ?? row.name ?? "New Joiner")}
                right={String(row.joining_date ?? row.doj ?? "")}
                sub={String(row.process ?? row.department ?? row.designation ?? "")}
                badge={row.pending_step ? String(row.pending_step) : undefined}
                badgeTone="amber"
              />
            )) : (
              <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">
                {sourceAvailable ? "No pending provisioning tasks" : "Provisioning source unavailable"}
              </p>
            )}
          </div>
        </ReferencePanel>
      </div>

      {recentCompleted.length > 0 && (
        <ReferencePanel
          title="Recently Completed"
          action={<span className="text-xs text-[#61708a]">{formatValue(recentCompleted.length)} tasks</span>}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            {recentCompleted.map((row, i) => (
              <ReferenceListRow
                key={i}
                left={String(row.employee_name ?? row.name ?? "Employee")}
                right={String(row.completed_at ?? row.date ?? "")}
                sub={String(row.task_type ?? row.step ?? "")}
                badge="Done"
                badgeTone="green"
              />
            ))}
          </div>
        </ReferencePanel>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReferenceQuickLink href="/provisioning/it" title="IT Provisioning Queue" icon={Server} />
        <ReferenceQuickLink href="/provisioning/admin" title="Admin Provisioning" icon={UserPlus} />
        <ReferenceQuickLink href="/employees" title="Employee Directory" icon={Monitor} />
        <ReferenceQuickLink href="/settings" title="Settings" icon={ShieldCheck} />
      </div>
    </div>
  );
}
