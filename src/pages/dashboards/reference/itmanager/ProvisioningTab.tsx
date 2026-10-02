import { ReferencePanel } from "../../ReferenceDashboardUI";
import { arrayAt, asNumber, asRecord, asString, formatValue } from "../../reference-dashboard-model";

// ── Tab: Provisioning ─────────────────────────────────────────────────────────

/**
 * `available` distinguishes "the provisioning source failed" from "there is nothing
 * pending". Both render as an empty task list, and defaulting the counts to zero presents a
 * failed fetch as a clean queue — the one reading an IT manager is most likely to act on by
 * doing nothing. The distinction existed before the comprehensive-IT-dashboard rewrite
 * dropped it; role-dashboard-live-data.contract.test.ts has been failing on it since.
 */
export function ProvisioningTab({ it, itProv, available }: {
  it: Record<string, unknown>;
  itProv: Record<string, unknown>;
  available: boolean;
}) {
  // Left undefined rather than coerced, so a missing count is never rendered as a real 0.
  const taskBreakdown = [
    { label: "Domain / Login",   value: asNumber(it.pending_domain),    color: "#3b82f6" },
    { label: "Email Setup",      value: asNumber(it.pending_email),     color: "#8b5cf6" },
    { label: "Asset Assignment", value: asNumber(it.pending_asset ?? itProv.pending_asset), color: "#f59e0b" },
    { label: "Biometric Enroll", value: asNumber(it.pending_biometric ?? itProv.pending_biometric), color: "#06b6d4" },
  ].filter((t): t is { label: string; value: number; color: string } =>
    typeof t.value === "number" && t.value > 0);
  const maxTask = Math.max(...taskBreakdown.map(t => t.value), 1);
  const pendingJoiners = arrayAt(it, "pending_joiners").slice(0, 10);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <ReferencePanel title="Task Breakdown" bodyClassName="p-4">
        {!available ? (
          <p className="py-6 text-center text-sm text-[#a0aec0]">Provisioning source unavailable</p>
        ) : taskBreakdown.length > 0 ? (
          <div className="space-y-3">
            {taskBreakdown.map(task => (
              <div key={task.label} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-right text-xs text-[#61708a]">{task.label}</span>
                <div className="flex-1 overflow-hidden rounded-full bg-[#f1f5f9] h-3">
                  <div className="h-3 rounded-full transition-all" style={{ width: `${Math.round((task.value / maxTask) * 100)}%`, backgroundColor: task.color }} />
                </div>
                <span className="w-6 text-xs font-semibold text-[#0b1f44]">{task.value}</span>
              </div>
            ))}
          </div>
        ) : <p className="py-6 text-center text-sm text-[#a0aec0]">No pending provisioning tasks</p>}
      </ReferencePanel>

      <ReferencePanel title="New Joiners Awaiting IT Setup" action={<span className="text-xs text-[#61708a]">{pendingJoiners.length} pending</span>} bodyClassName="p-0">
        {pendingJoiners.length > 0 ? (
          <div className="divide-y divide-[#edf1f6]">
            {pendingJoiners.map((row, i) => {
              const slaTime = row.sla_due_at ? new Date(String(row.sla_due_at)) : null;
              const hoursLeft = slaTime ? Math.round((slaTime.getTime() - Date.now()) / 3_600_000) : null;
              const isOverdue = hoursLeft !== null && hoursLeft < 0;
              return (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[#0b1f44]">{String(row.employee_name ?? "New Joiner")}</p>
                    <p className="text-xs text-[#61708a]">{String(row.employee_code ?? "")}{row.task_code ? ` · ${String(row.task_code).replace(/_/g, " ")}` : ""}</p>
                  </div>
                  {hoursLeft !== null && (
                    <span className={`ml-3 shrink-0 text-xs font-semibold ${isOverdue ? "text-red-600" : "text-amber-600"}`}>
                      {isOverdue ? `${Math.abs(hoursLeft)}h overdue` : `${hoursLeft}h left`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">No pending provisioning tasks</p>}
      </ReferencePanel>
    </div>
  );
}
