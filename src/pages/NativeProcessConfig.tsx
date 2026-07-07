import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ChevronDown, ExternalLink, Loader,
  RefreshCcw, Save, Settings,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Process {
  id: string;
  process_code: string;
  process_name: string;
}

interface KpiProcessConfig {
  metric_id: string;
  metric_name: string;
  target_value: number;
}

interface PayrollStructure {
  id: string;
  structure_name: string;
  structure_code: string;
}

interface StatutoryConfig {
  [key: string]: number | string;
}

interface ShiftTemplate {
  id: string;
  shift_code: string;
  shift_name: string;
  start_time: string;
  end_time: string;
}

interface RosterCycle {
  id: string;
  week_start_date: string;
  week_end_date: string;
  status: string;
}

interface LeaveType {
  id: string;
  leave_code: string;
  leave_name: string;
  max_days_per_year: number;
  carry_forward: number;
  requires_approval: number;
  paid_leave: number;
}

type TabKey = "kpi" | "payroll" | "roster" | "leave" | "sla";

const TABS: { key: TabKey; label: string }[] = [
  { key: "kpi",     label: "KPI Targets" },
  { key: "payroll", label: "Payroll Rules" },
  { key: "roster",  label: "Roster Settings" },
  { key: "leave",   label: "Leave Policy" },
  { key: "sla",     label: "Client SLA" },
];

const PT_STATES = [
  { code: "AP", name: "Andhra Pradesh" },
  { code: "AS", name: "Assam" },
  { code: "BR", name: "Bihar" },
  { code: "CG", name: "Chhattisgarh" },
  { code: "GA", name: "Goa" },
  { code: "GJ", name: "Gujarat" },
  { code: "HR", name: "Haryana" },
  { code: "HP", name: "Himachal Pradesh" },
  { code: "JH", name: "Jharkhand" },
  { code: "KA", name: "Karnataka" },
  { code: "KL", name: "Kerala" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "MH", name: "Maharashtra" },
  { code: "ML", name: "Meghalaya" },
  { code: "OD", name: "Odisha" },
  { code: "PB", name: "Punjab" },
  { code: "RJ", name: "Rajasthan" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "TS", name: "Telangana" },
  { code: "TR", name: "Tripura" },
  { code: "UK", name: "Uttarakhand" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "WB", name: "West Bengal" },
  { code: "DL", name: "Delhi" },
  { code: "PY", name: "Puducherry" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InfoBadge({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}

function SectionNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
      <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <span>{text}</span>
    </div>
  );
}

// ─── KPI Tab ──────────────────────────────────────────────────────────────────

function KpiTab({ processId }: { processId: string }) {
  const navigate = useNavigate();
  const [configs, setConfigs] = useState<KpiProcessConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!processId) return;
    setLoading(true);
    setMessage("");
    hrmsApi
      .get<{ success: boolean; data: KpiProcessConfig[] }>(
        `/api/kpi/process-config/${processId}`
      )
      .then((r) => setConfigs(r.data ?? []))
      .catch((err: unknown) =>
        setMessage(err instanceof Error ? err.message : "Failed to load KPI overrides")
      )
      .finally(() => setLoading(false));
  }, [processId]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-black text-slate-900">KPI Targets</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Process-specific KPI target overrides. Global targets are managed in KPI Configuration.
          </p>
        </div>
        <button
          onClick={() => navigate("/kpi-config")}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
        >
          Configure KPI Targets
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      {message && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
      )}

      <div className="grid grid-cols-1 gap-3">
        <InfoBadge
          label="Process-specific overrides"
          value={loading ? "Loading…" : `${configs.length} metric${configs.length !== 1 ? "s" : ""} overridden`}
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader className="h-4 w-4 animate-spin" /> Loading overrides…
        </div>
      ) : configs.length === 0 ? (
        <SectionNote text="No process-specific KPI overrides yet. All metrics use global targets. Click 'Configure KPI Targets' to add overrides." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Metric", "Process Target"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {configs.map((c) => (
                <tr key={c.metric_id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">{c.metric_name}</td>
                  <td className="px-4 py-3 text-slate-700 font-semibold">{c.target_value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Payroll Rules Tab ────────────────────────────────────────────────────────

function PayrollRulesTab({ processId }: { processId: string }) {
  const [structures, setStructures] = useState<PayrollStructure[]>([]);
  const [statutory, setStatutory] = useState<StatutoryConfig>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [workingDays, setWorkingDays] = useState("26");
  const [ptState, setPtState] = useState("MH");
  const [structureId, setStructureId] = useState("");

  useEffect(() => {
    if (!processId) return;
    setLoading(true);
    Promise.all([
      hrmsApi.get<{ success: boolean; data: PayrollStructure[] }>("/api/payroll/structures"),
      hrmsApi.get<{ success: boolean; data: StatutoryConfig }>(
        `/api/processes/${processId}/configuration`
      ),
    ])
      .then(([structRes, statRes]) => {
        setStructures(structRes.data ?? []);
        const cfg = statRes.data ?? {};
        setStatutory(cfg);
        setWorkingDays(String(cfg.workingDays ?? 26));
        setPtState(String(cfg.ptState ?? "MH"));
        setStructureId(String(cfg.defaultSalaryStructureId ?? ""));
      })
      .catch((err: unknown) =>
        setMessage({ text: err instanceof Error ? err.message : "Failed to load payroll config", ok: false })
      )
      .finally(() => setLoading(false));
  }, [processId]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await hrmsApi.put(`/api/processes/${processId}/configuration`, {
        values: {
          workingDays: Number(workingDays),
          ptState,
          defaultSalaryStructureId: structureId || null,
        },
      });
      setMessage({ text: "Payroll rules saved.", ok: true });
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Save failed", ok: false });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <Loader className="h-4 w-4 animate-spin" /> Loading payroll config…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-black text-slate-900">Payroll Rules</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Per-process payroll defaults stored in statutory config.
        </p>
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm ${message.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Working Days / Month
          </label>
          <input
            type="number"
            min={20}
            max={31}
            value={workingDays}
            onChange={(e) => setWorkingDays(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-slate-400">
            Saved for this process: {statutory.workingDays ?? 26}
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            PT State Code
          </label>
          <div className="relative">
            <select
              value={ptState}
              onChange={(e) => setPtState(e.target.value)}
              className="w-full appearance-none rounded-xl border border-slate-200 pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PT_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          </div>
          <p className="mt-1 text-xs text-slate-400">Determines which PT slab applies</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Default Salary Structure
          </label>
          <div className="relative">
            <select
              value={structureId}
              onChange={(e) => setStructureId(e.target.value)}
              className="w-full appearance-none rounded-xl border border-slate-200 pl-3 pr-8 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— None —</option>
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.structure_name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Payroll Rules
        </button>
      </div>
    </div>
  );
}

// ─── Roster Settings Tab ──────────────────────────────────────────────────────

function RosterSettingsTab({ processId }: { processId: string }) {
  const navigate = useNavigate();
  const [shifts, setShifts] = useState<ShiftTemplate[]>([]);
  const [cycles, setCycles] = useState<RosterCycle[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [minHc, setMinHc] = useState("0");
  const [weeklyOff, setWeeklyOff] = useState<"5" | "6">("5");
  const [gracePeriod, setGracePeriod] = useState("15");
  const [pubSla, setPubSla] = useState("3");

  useEffect(() => {
    if (!processId) return;
    setLoading(true);
    setMessage(null);
    Promise.all([
      hrmsApi
        .get<{ data: ShiftTemplate[] }>(`/api/roster-gov/shifts/templates?process_id=${processId}&active_status=1`)
        .then((r) => setShifts(r.data ?? []))
        .catch((err: unknown) => {
          setShifts([]);
          console.warn("Failed to load shifts:", err);
        }),
      hrmsApi
        .get<{ data: RosterCycle[] }>(`/api/roster-gov/cycles?process_id=${processId}`)
        .then((r) => setCycles(r.data ?? []))
        .catch((err: unknown) => {
          setCycles([]);
          console.warn("Failed to load cycles:", err);
        }),
      hrmsApi
        .get<{ success: boolean; data: StatutoryConfig }>(
          `/api/processes/${processId}/configuration`
        )
        .then((r) => {
          const cfg = r.data ?? {};
          setMinHc(String(cfg.minimumHeadcount ?? 0));
          setWeeklyOff((String(cfg.weeklyOffDays ?? "5") as "5" | "6"));
          setGracePeriod(String(cfg.gracePeriodMinutes ?? 15));
          setPubSla(String(cfg.publicationSlaDays ?? 3));
        })
        .catch((err: unknown) => {
          console.warn("Failed to load process configuration:", err);
          setMessage({ text: err instanceof Error ? err.message : "Failed to load roster configuration", ok: false });
        }),
    ]).finally(() => setLoading(false));
  }, [processId]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await hrmsApi.put(`/api/processes/${processId}/configuration`, {
        values: {
          minimumHeadcount: Number(minHc),
          weeklyOffDays: Number(weeklyOff),
          gracePeriodMinutes: Number(gracePeriod),
          publicationSlaDays: Number(pubSla),
        },
      });
      setMessage({ text: "Roster settings saved.", ok: true });
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Save failed", ok: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-black text-slate-900">Roster Settings</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Per-process roster defaults. Shift templates and cycles are managed in WFM.
          </p>
        </div>
        <button
          onClick={() => navigate("/wfm/roster")}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          Configure via WFM
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm ${message.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader className="h-4 w-4 animate-spin" /> Loading roster data…
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <InfoBadge label="Shift templates" value={`${shifts.length} template${shifts.length !== 1 ? "s" : ""}`} />
          <InfoBadge label="Roster cycles" value={`${cycles.length} cycle${cycles.length !== 1 ? "s" : ""}`} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Min Headcount</label>
          <input
            type="number"
            min={0}
            value={minHc}
            onChange={(e) => setMinHc(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Weekly Off Pattern</label>
          <div className="flex gap-2">
            {(["5", "6"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setWeeklyOff(v)}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition-colors ${
                  weeklyOff === v
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {v}-day
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Grace Period (min)</label>
          <input
            type="number"
            min={0}
            value={gracePeriod}
            onChange={(e) => setGracePeriod(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Publication SLA (days)</label>
          <input
            type="number"
            min={1}
            value={pubSla}
            onChange={(e) => setPubSla(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-slate-400">Days before week start</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Roster Settings
        </button>
      </div>
    </div>
  );
}

// ─── Leave Policy Tab ─────────────────────────────────────────────────────────

function LeavePolicyTab() {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setLoading(true);
    hrmsApi
      .get<{ success: boolean; data: LeaveType[] }>("/api/leave/types")
      .then((r) => setTypes(r.data ?? []))
      .catch((err: unknown) =>
        setMessage(err instanceof Error ? err.message : "Failed to load leave types")
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-black text-slate-900">Leave Policy</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Global leave types and their settings. Per-process overrides are coming in Phase 4.
        </p>
      </div>

      {message && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
      )}

      <SectionNote text="Leave type overrides per process coming in Phase 4. Showing global leave types below." />

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader className="h-4 w-4 animate-spin" /> Loading leave types…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Code", "Name", "Max Days / Year", "Carry Forward", "Requires Approval", "Paid"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {types.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{t.leave_code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{t.leave_name}</td>
                  <td className="px-4 py-3 text-slate-700">{t.max_days_per_year}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.carry_forward ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {t.carry_forward ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.requires_approval ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
                      {t.requires_approval ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.paid_leave ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
                      {t.paid_leave ? "Paid" : "Unpaid"}
                    </span>
                  </td>
                </tr>
              ))}
              {types.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">
                    No leave types configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Client SLA Tab ───────────────────────────────────────────────────────────

function ClientSlaTab({ processId }: { processId: string }) {
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [breachThreshold, setBreachThreshold] = useState("85");
  const [sharingEnabled, setSharingEnabled] = useState(false);

  useEffect(() => {
    if (!processId) return;
    setLoading(true);
    hrmsApi
      .get<{ success: boolean; data: StatutoryConfig }>(
        `/api/processes/${processId}/configuration`
      )
      .then((r) => {
        const cfg = r.data ?? {};
        setBreachThreshold(String(cfg.clientSlaThreshold ?? 85));
        setSharingEnabled(Boolean(cfg.clientSlaSharing));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [processId]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await hrmsApi.put(`/api/processes/${processId}/configuration`, {
        values: {
          clientSlaThreshold: Number(breachThreshold),
          clientSlaSharing: sharingEnabled,
        },
      });
      setMessage({ text: "Client SLA settings saved.", ok: true });
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Save failed", ok: false });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <Loader className="h-4 w-4 animate-spin" /> Loading SLA config…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-black text-slate-900">Client SLA</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Configure which metrics are shared with the client portal and alert thresholds.
        </p>
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm ${message.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            SLA Breach Threshold (%)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={breachThreshold}
            onChange={(e) => setBreachThreshold(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-slate-400">
            Client alert fires when KPI score falls below this threshold
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            KPI Sharing with Client Portal
          </label>
          <button
            onClick={() => setSharingEnabled((v) => !v)}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold w-full transition-colors ${
              sharingEnabled
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-600"
            }`}
          >
            <span
              className={`inline-block h-5 w-10 rounded-full transition-colors ${sharingEnabled ? "bg-emerald-500" : "bg-slate-300"}`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${sharingEnabled ? "translate-x-5" : "translate-x-0"}`}
              />
            </span>
            {sharingEnabled ? "Sharing enabled" : "Sharing disabled"}
          </button>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save SLA Settings
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NativeProcessConfig() {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [selectedProcessId, setSelectedProcessId] = useState("");
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("kpi");
  const [message, setMessage] = useState("");

  const loadProcesses = () => {
    setLoadingProcesses(true);
    setMessage("");
    hrmsApi
      .get<Process[] | { data: Process[] }>("/api/processes")
      .then((res) => {
        const list = Array.isArray(res) ? res : (res as { data: Process[] }).data ?? [];
        setProcesses(list);
        if (list.length > 0 && !selectedProcessId) {
          setSelectedProcessId(list[0].id);
        }
      })
      .catch((err: unknown) =>
        setMessage(err instanceof Error ? err.message : "Failed to load processes")
      )
      .finally(() => setLoadingProcesses(false));
  };

  useEffect(() => {
    loadProcesses();
  }, []);

  const selectedProcess = processes.find((p) => p.id === selectedProcessId);

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50 p-6">
        {/* Header */}
        <div className="mb-6 flex items-start gap-4">
          <div className="rounded-2xl bg-slate-950 p-3">
            <Settings className="h-6 w-6 text-white" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Configuration</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Process Config</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Per-process KPI targets, payroll rules, roster settings, leave policy, and client SLA.
            </p>
          </div>
        </div>

        {message && (
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Process Selector */}
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
          <label className="text-sm font-black text-slate-700">Process:</label>
          {loadingProcesses ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="relative">
              <select
                value={selectedProcessId}
                onChange={(e) => setSelectedProcessId(e.target.value)}
                className="min-w-[220px] appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-4 pr-10 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.process_code} — {p.process_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            </div>
          )}
          {selectedProcess && (
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              {selectedProcess.process_name}
            </span>
          )}
          <button
            onClick={loadProcesses}
            className="ml-auto rounded-xl border border-slate-200 p-2 hover:bg-slate-50 transition-colors"
            title="Refresh process list"
          >
            <RefreshCcw className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        {!selectedProcessId ? (
          <div className="rounded-3xl bg-white border border-slate-200 p-12 text-center text-slate-400 shadow-sm">
            <Settings className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">Select a process to configure</p>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="mb-4 flex flex-wrap gap-1 rounded-2xl bg-white border border-slate-200 p-1 shadow-sm w-fit">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                    activeTab === tab.key
                      ? "bg-slate-950 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="rounded-3xl bg-white border border-slate-200 p-6 shadow-sm">
              {activeTab === "kpi"     && <KpiTab processId={selectedProcessId} />}
              {activeTab === "payroll" && <PayrollRulesTab processId={selectedProcessId} />}
              {activeTab === "roster"  && <RosterSettingsTab processId={selectedProcessId} />}
              {activeTab === "leave"   && <LeavePolicyTab />}
              {activeTab === "sla"     && <ClientSlaTab processId={selectedProcessId} />}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
