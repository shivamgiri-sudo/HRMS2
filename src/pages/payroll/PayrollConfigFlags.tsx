import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const ALLOWED_ROLES = ["super_admin", "admin", "payroll_head", "payroll_branch"];

const FLAG_LABELS: Record<string, string> = {
  weekoff_earning_required: "Week-off earning required (work 6 days for 1 week-off)",
  working_days_required_for_one_weekoff: "Working days required per week-off",
  new_joiner_holiday_cutoff_enabled: "New joiner holiday cutoff enabled",
  new_joiner_cutoff_day: "New joiner holiday cutoff day of month",
  holiday_payout_basis: "Holiday work payout basis (NET_DAILY/GROSS_DAILY)",
  holiday_double_pay_requires_superadmin: "Holiday double-pay requires Super Admin approval",
  payroll_recalc_auto_on_regularization: "Auto recalculate payroll on attendance regularization",
};

const BOOL_FLAGS = new Set([
  "weekoff_earning_required",
  "new_joiner_holiday_cutoff_enabled",
  "holiday_double_pay_requires_superadmin",
  "payroll_recalc_auto_on_regularization",
]);

interface ConfigFlag {
  config_key: string;
  config_value: string;
  branch_id?: number | null;
  process_id?: number | null;
  description?: string;
}

export default function PayrollConfigFlags() {
  const { user } = useAuth();
  const [flags, setFlags] = useState<ConfigFlag[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const role = user?.role ?? "";
  if (!ALLOWED_ROLES.includes(role)) {
    return <div className="p-8 text-red-600">Access denied.</div>;
  }

  useEffect(() => {
    const token = localStorage.getItem("token");
    fetch("/api/payroll/config-flags", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => setFlags(Array.isArray(data) ? data : data.flags ?? []))
      .catch(() => setError("Failed to load config flags."));
  }, []);

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
    const token = localStorage.getItem("token");
    try {
      const res = await fetch("/api/payroll/config-flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          branch_id: flag.branch_id ?? null,
          process_id: flag.process_id ?? null,
          config_key: flag.config_key,
          config_value: editValue,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Save failed");
      setFlags((prev) => prev.map((f) => (f.config_key === flag.config_key ? { ...f, config_value: editValue } : f)));
      setSuccess(`Saved: ${flag.config_key}`);
      setEditingKey(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Payroll Configuration Flags</h1>
      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      {success && <div className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{success}</div>}
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2">Flag</th>
              <th className="text-left px-4 py-2">Value</th>
              <th className="text-left px-4 py-2">Scope</th>
              <th className="text-left px-4 py-2">Description</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.config_key} className="border-t hover:bg-muted/40">
                <td className="px-4 py-2 font-medium whitespace-nowrap">{FLAG_LABELS[flag.config_key] ?? flag.config_key}</td>
                <td className="px-4 py-2">
                  {editingKey === flag.config_key ? (
                    BOOL_FLAGS.has(flag.config_key) ? (
                      <select
                        className="border rounded px-2 py-1 text-sm"
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
                    <Badge variant={flag.config_value === "true" ? "default" : flag.config_value === "false" ? "secondary" : "outline"}>
                      {flag.config_value}
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {flag.branch_id ? `Branch ${flag.branch_id}` : flag.process_id ? `Process ${flag.process_id}` : "Global"}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{flag.description ?? "—"}</td>
                <td className="px-4 py-2 text-right space-x-1">
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
            ))}
            {flags.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No config flags found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
