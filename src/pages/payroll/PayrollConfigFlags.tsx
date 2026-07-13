import { useEffect, useState, useCallback } from "react";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const ALLOWED_ROLES = ["super_admin", "admin", "payroll_head", "payroll_branch"];

const FLAG_META: Record<string, { label: string; description: string }> = {
  weekoff_earning_required: {
    label: "Week-off earning required",
    description: "When enabled, an employee must work the configured minimum number of days in a week to earn the paid week-off. Affects LWP calculation.",
  },
  working_days_required_for_one_weekoff: {
    label: "Working days required per week-off",
    description: "Number of working days in a week an employee must complete to earn 1 paid week-off day. Typically 6. Only relevant when 'weekoff_earning_required' is true.",
  },
  new_joiner_holiday_cutoff_enabled: {
    label: "New joiner holiday cutoff enabled",
    description: "When enabled, employees who joined after the cutoff day of the month are not eligible for holidays that month. Prevents mid-month joiners from claiming holidays.",
  },
  new_joiner_cutoff_day: {
    label: "New joiner holiday cutoff day of month",
    description: "If a new joiner joins after this day of the month (e.g. day 15), they are not eligible for holidays in that month. Requires 'new_joiner_holiday_cutoff_enabled' to be true.",
  },
  holiday_payout_basis: {
    label: "Holiday work payout basis",
    description: "How holiday work extra pay is calculated. NET_DAILY = based on net daily rate; GROSS_DAILY = based on gross daily rate. Affects holiday work request payouts.",
  },
  holiday_double_pay_requires_superadmin: {
    label: "Holiday double-pay requires Super Admin approval",
    description: "When enabled, any holiday payout policy configured as 'double pay' requires Super Admin approval before it can be included in payroll.",
  },
  payroll_recalc_auto_on_regularization: {
    label: "Auto recalculate payroll on attendance regularization",
    description: "When enabled, approving an attendance regularization automatically queues the affected employee's payroll for recalculation in the current open payroll run.",
  },
  overtime_allowed: {
    label: "Overtime allowed",
    description: "Whether overtime hours can be recorded and paid for employees in this scope. Default is false (disabled). Must be enabled per process to allow OT entry.",
  },
  overtime_rate_multiplier: {
    label: "Overtime rate multiplier",
    description: "Multiplier applied to per-hour basic rate for overtime calculation. E.g. 1.5 = time-and-a-half, 2.0 = double time. Default is 1.5.",
  },
  overtime_monthly_cap_hours: {
    label: "Overtime monthly cap (hours)",
    description: "Maximum overtime hours allowed per employee per month for this scope. 0 = no cap. Prevents excessive OT entry beyond process policy.",
  },
  overtime_minimum_hours: {
    label: "Overtime minimum hours threshold",
    description: "Below this threshold, OT counts as 0. E.g. 1 means 45-min OT = 0h. Prevents trivial OT from being recorded.",
  },
  overtime_rounding_unit: {
    label: "Overtime rounding unit (floor)",
    description: "OT hours are floored to this granularity. E.g. 1 = floor to full hours (1.5h→1h), 0.5 = floor to half-hours (1.7h→1.5h).",
  },
};

const BOOL_FLAGS = new Set([
  "weekoff_earning_required",
  "new_joiner_holiday_cutoff_enabled",
  "holiday_double_pay_requires_superadmin",
  "payroll_recalc_auto_on_regularization",
  "overtime_allowed",
]);

interface ConfigFlag {
  config_key: string;
  config_value: string;
  branch_id?: number | null;
  process_id?: number | null;
  description?: string;
}

export default function PayrollConfigFlags() {
  const { roleKeys } = useWorkforceAccess();
  const [flags, setFlags] = useState<ConfigFlag[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchFlags = useCallback(() => {
    setLoading(true);
    setError(null);
    hrmsApi.get<any>("/api/payroll/config-flags")
      .then((data: any) => setFlags(Array.isArray(data) ? data : data.data ?? data.flags ?? []))
      .catch(() => setError("Failed to load config flags."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  const startEdit = (flag: ConfigFlag) => {
    setEditingKey(flag.config_key);
    setEditValue(flag.config_value);
    setSuccess(null);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue("");
  };

  const saveFlag = async (flag: ConfigFlag) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await hrmsApi.put("/api/payroll/config-flags", {
        branch_id: flag.branch_id ?? null,
        process_id: flag.process_id ?? null,
        config_key: flag.config_key,
        config_value: editValue,
        description: FLAG_META[flag.config_key]?.description ?? flag.description ?? null,
      });
      setFlags((prev) => prev.map((f) => (f.config_key === flag.config_key ? { ...f, config_value: editValue } : f)));
      setSuccess(`Saved: ${FLAG_META[flag.config_key]?.label ?? flag.config_key}`);
      setEditingKey(null);
    } catch (e: any) {
      setError(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!ALLOWED_ROLES.some(r => roleKeys.includes(r))) {
    return (
      <DashboardLayout>
        <div className="p-8 text-red-600">Access denied.</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Payroll Configuration Flags</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Global and branch/process-level switches that control payroll calculation behaviour.</p>
          </div>
          <Button size="sm" variant="outline" onClick={fetchFlags}>Refresh</Button>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
        {success && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{success}</div>}

        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 w-[40%]">Flag</th>
                <th className="text-left px-4 py-2 w-[15%]">Value</th>
                <th className="text-left px-4 py-2 w-[15%]">Scope</th>
                <th className="px-4 py-2 w-[10%]"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && flags.map((flag) => {
                const meta = FLAG_META[flag.config_key];
                return (
                  <tr key={flag.config_key} className="border-t hover:bg-muted/40 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{meta?.label ?? flag.config_key}</div>
                      {meta?.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed max-w-md">{meta.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingKey === flag.config_key ? (
                        BOOL_FLAGS.has(flag.config_key) ? (
                          <select
                            className="border rounded px-2 py-1 text-sm bg-background"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                          >
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : (
                          <Input className="w-40 h-7 text-sm" value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                        )
                      ) : (
                        <Badge
                          variant={
                            flag.config_value === "true" ? "default" :
                            flag.config_value === "false" ? "secondary" : "outline"
                          }
                        >
                          {flag.config_value}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {flag.branch_id ? `Branch ${flag.branch_id}` : flag.process_id ? `Process ${flag.process_id}` : "Global"}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                      {editingKey === flag.config_key ? (
                        <>
                          <Button size="sm" disabled={saving} onClick={() => saveFlag(flag)}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => startEdit(flag)}>Edit</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && flags.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No config flags found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
