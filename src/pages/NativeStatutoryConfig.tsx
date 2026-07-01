import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BadgePercent,
  BookOpen,
  Building2,
  Calendar,
  Info,
  Loader,
  RefreshCcw,
  Shield,
  TrendingUp,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatutoryConfigRow {
  config_key: string;
  config_value: string;
  description: string;
  updated_at: string;
}

interface StatutoryConfigResponse {
  success: boolean;
  data: StatutoryConfigRow[];
}

interface ConfigMap {
  [key: string]: StatutoryConfigRow;
}

interface TdsSlabEntry {
  key: string;
  label: string;
  value: string;
  description: string;
  updated_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(raw: string | undefined): string {
  if (raw === undefined || raw === null) return "—";
  const n = parseFloat(raw);
  return isNaN(n) ? raw : `${n}%`;
}

function fmtCurrency(raw: string | undefined): string {
  if (raw === undefined || raw === null) return "—";
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  return `₹${n.toLocaleString("en-IN")}`;
}

function fmtDate(raw: string | undefined): string {
  if (!raw) return "—";
  try {
    return new Date(raw).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return raw;
  }
}

function labelFromKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="rounded-2xl bg-slate-100 p-2.5 text-slate-700">{icon}</div>
      <div>
        <h2 className="text-base font-black text-slate-950">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function ConfigCard({
  label,
  value,
  note,
  highlight,
}: {
  label: string;
  value: string;
  note?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        highlight ? "border-blue-200 bg-blue-50/60" : "border-slate-200 bg-slate-50/60"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-black ${highlight ? "text-blue-700" : "text-slate-950"}`}>
        {value}
      </p>
      {note && <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">{note}</p>}
    </div>
  );
}

function SkeletonSection() {
  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm animate-pulse">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-10 w-10 rounded-2xl bg-slate-200" />
        <div className="space-y-2">
          <div className="h-4 w-32 rounded bg-slate-200" />
          <div className="h-3 w-48 rounded bg-slate-100" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
            <div className="h-3 w-20 rounded bg-slate-200" />
            <div className="h-8 w-24 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NativeStatutoryConfig() {
  const [rows, setRows] = useState<StatutoryConfigRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<StatutoryConfigResponse>("/api/payroll/statutory-config");
      setRows(res.data ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load statutory configuration";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // Build a fast lookup map keyed by config_key
  const cfg: ConfigMap = {};
  for (const row of rows) {
    cfg[row.config_key] = row;
  }

  // Separate TDS slab entries
  const tdsSlabs: TdsSlabEntry[] = rows
    .filter((r) => r.config_key.startsWith("tds_slab_"))
    .map((r) => ({
      key: r.config_key,
      label: labelFromKey(r.config_key.replace("tds_slab_", "")),
      value: r.config_value,
      description: r.description,
      updated_at: r.updated_at,
    }));

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* ── Page Header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
              Payroll Settings
            </p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">
              Statutory Configuration
            </h1>
            <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
              <Info className="h-4 w-4 flex-shrink-0 text-amber-500" />
              <span>
                Read-only view. Contact system administrator to update values.
              </span>
            </div>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 self-start lg:self-auto"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* ── Error Banner ─────────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* ── Loading Skeletons ─────────────────────────────────────────────── */}
        {loading && (
          <div className="space-y-5">
            {[1, 2, 3, 4].map((i) => <SkeletonSection key={i} />)}
          </div>
        )}

        {/* ── Sections (only shown when loaded) ───────────────────────────── */}
        {!loading && rows.length > 0 && (
          <div className="space-y-5">

            {/* ── Provident Fund ─────────────────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<Shield className="h-5 w-5" />}
                title="Provident Fund (PF)"
                subtitle="Deducted on Basic Salary — statutory ceiling ₹15,000"
              />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <ConfigCard
                  label="Employee Contribution"
                  value={fmtPct(cfg["pf_employee_pct"]?.config_value)}
                  note={cfg["pf_employee_pct"]?.description}
                  highlight
                />
                <ConfigCard
                  label="Employer Contribution"
                  value={fmtPct(cfg["pf_employer_pct"]?.config_value)}
                  note={cfg["pf_employer_pct"]?.description}
                />
                <ConfigCard
                  label="EPF (Employer Split)"
                  value="3.67%"
                  note="Towards EPF account of employee"
                />
                <ConfigCard
                  label="EPS (Employer Split)"
                  value="8.33%"
                  note="Employee Pension Scheme — capped at ₹15,000 EPS ceiling"
                />
              </div>
              <p className="mt-4 text-xs text-slate-400 italic">
                PF is computed on min(Basic, PF wage limit). Employer total = EPF 3.67% + EPS 8.33%.
              </p>
            </div>

            {/* ── ESIC ───────────────────────────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<BadgePercent className="h-5 w-5" />}
                title="Employees' State Insurance (ESIC)"
                subtitle="Applicable only when Gross Salary is at or below the wage limit"
              />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <ConfigCard
                  label="Employee Contribution"
                  value={fmtPct(cfg["esic_employee_pct"]?.config_value ?? "0.75")}
                  note={cfg["esic_employee_pct"]?.description ?? "0.75% of gross salary"}
                  highlight
                />
                <ConfigCard
                  label="Employer Contribution"
                  value={fmtPct(cfg["esic_employer_pct"]?.config_value ?? "3.25")}
                  note={cfg["esic_employer_pct"]?.description ?? "3.25% of gross salary"}
                />
                <ConfigCard
                  label="Gross Wage Limit"
                  value={fmtCurrency(cfg["esic_wage_limit"]?.config_value ?? "21000")}
                  note="ESIC deductions are skipped when gross exceeds this limit"
                />
              </div>
              <p className="mt-4 text-xs text-slate-400 italic">
                ESIC is calculated on full gross salary including variable allowances. Above the wage limit, no ESIC applies.
              </p>
            </div>

            {/* ── Professional Tax ────────────────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<Building2 className="h-5 w-5" />}
                title="Professional Tax (PT)"
                subtitle="State-level tax — slab varies by state and monthly gross"
              />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <ConfigCard
                  label="PT Amount (Default Slab)"
                  value={fmtCurrency(cfg["pt_amount"]?.config_value)}
                  note={cfg["pt_amount"]?.description}
                  highlight
                />
                {Object.keys(cfg)
                  .filter((k) => k.startsWith("pt_") && k !== "pt_amount")
                  .map((k) => (
                    <ConfigCard
                      key={k}
                      label={labelFromKey(k)}
                      value={fmtCurrency(cfg[k].config_value)}
                      note={cfg[k].description}
                    />
                  ))}
              </div>
            </div>

            {/* ── Gratuity ────────────────────────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<TrendingUp className="h-5 w-5" />}
                title="Gratuity"
                subtitle="Employer cost — not deducted from employee salary"
              />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <ConfigCard
                  label="Gratuity Rate"
                  value={fmtPct(cfg["gratuity_rate"]?.config_value ?? "4.81")}
                  note={cfg["gratuity_rate"]?.description ?? "Computed as 4.81% of Basic Salary per month"}
                  highlight
                />
                <div className="rounded-2xl border border-slate-200 bg-amber-50/60 p-4 col-span-1 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                    Eligibility Criteria
                  </p>
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      Minimum 5 years of continuous service with the employer
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      Formula: (Last Drawn Basic × 15 × Years of Service) / 26
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      Maximum tax-exempt gratuity: ₹20,00,000 (as per Income Tax Act)
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      Payroll provisioning: 4.81% of Basic Salary monthly (employer cost, not deducted from CTC)
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* ── LWP ─────────────────────────────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<Calendar className="h-5 w-5" />}
                title="Leave Without Pay (LWP)"
                subtitle="Controls how unpaid leave days are factored into salary calculation"
              />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <ConfigCard
                  label="LWP Basis"
                  value={cfg["lwp_basis"]?.config_value ?? "Calendar Days"}
                  note={cfg["lwp_basis"]?.description ?? "Deduction computed proportionally over working days in month"}
                  highlight
                />
              </div>
              <p className="mt-4 text-xs text-slate-400 italic">
                Salary is scaled by (working_days - lwp_days) / working_days across all fixed CTC components (Basic, HRA, Special Allowance).
                Variable allowances such as night-shift and incentives are not affected by LWP.
              </p>
            </div>

            {/* ── TDS Slabs ───────────────────────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<BookOpen className="h-5 w-5" />}
                title="TDS Slabs"
                subtitle="Income Tax deduction at source — slab-based rates"
              />
              {tdsSlabs.length === 0 ? (
                <p className="text-sm text-slate-400 italic py-4">
                  No TDS slab configuration found. Keys matching <code className="bg-slate-100 px-1 rounded">tds_slab_*</code> will appear here.
                </p>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                          Income Band
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                          Rate
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500 hidden md:table-cell">
                          Description
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500 hidden lg:table-cell">
                          Last Updated
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tdsSlabs.map((slab, idx) => (
                        <tr
                          key={slab.key}
                          className={`border-t ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}
                        >
                          <td className="px-4 py-3 font-semibold text-slate-800">{slab.label}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                              {fmtPct(slab.value)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                            {slab.description || "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-400 hidden lg:table-cell">
                            {fmtDate(slab.updated_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Raw Config Table ─────────────────────────────────────────── */}
            <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
              <div className="border-b p-5">
                <h2 className="font-black text-slate-950">All Configuration Keys</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {rows.length} key{rows.length !== 1 ? "s" : ""} — raw statutory_config table view
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3.5 font-semibold">Config Key</th>
                      <th className="px-5 py-3.5 font-semibold">Value</th>
                      <th className="px-5 py-3.5 font-semibold hidden md:table-cell">Description</th>
                      <th className="px-5 py-3.5 font-semibold text-right hidden lg:table-cell">Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr
                        key={row.config_key}
                        className={`border-t transition-colors hover:bg-slate-50/80 ${
                          idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"
                        }`}
                      >
                        <td className="px-5 py-3.5">
                          <code className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700">
                            {row.config_key}
                          </code>
                        </td>
                        <td className="px-5 py-3.5 font-bold text-slate-900">
                          {row.config_value ?? "—"}
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 hidden md:table-cell">
                          {row.description || "—"}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-xs text-slate-400 hidden lg:table-cell">
                          {fmtDate(row.updated_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* ── Empty State ──────────────────────────────────────────────────── */}
        {!loading && rows.length === 0 && !error && (
          <div className="rounded-3xl border bg-white p-16 text-center shadow-sm">
            <Shield className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-slate-500">No statutory configuration found.</p>
            <p className="mt-1 text-sm text-slate-400">
              Ensure the <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">statutory_config</code> table is seeded.
            </p>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
