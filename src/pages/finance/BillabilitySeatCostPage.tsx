import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  IndianRupee,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  SplitSquareHorizontal,
  UserSearch,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hrmsApi } from "@/lib/hrmsApi";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";

const today = () => new Date().toISOString().slice(0, 10);
/** First of the current month — the sensible default for a rule that governs a P&L period. */
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n));

type MatrixRow = {
  processId: string;
  processName: string | null;
  clientName: string | null;
  designationId: string;
  designationName: string | null;
  headcount: number;
  ruleId: string | null;
  /** null means no rule — the default applies. Deliberately tri-state, not a boolean. */
  isBillable: boolean | null;
  seatRateMonthly: number | null;
  effectiveFrom: string | null;
  changeReason: string | null;
};

type SeatRateRow = {
  id: string;
  cost_centre_id: string;
  cost_centre_code: string;
  cost_centre_name: string;
  designation_id: string | null;
  designation_name: string | null;
  seat_rate_monthly: string | number;
  billing_model: "per_seat" | "not_seat_billed" | "unknown";
  effective_from: string;
  effective_to: string | null;
  active_headcount: number;
};

type CostCentre = {
  id: string;
  cost_centre_code: string;
  cost_centre_name: string;
  client_name: string | null;
  active_headcount: number;
};

type SplitCandidate = {
  employee_id: string;
  employee_code: string | null;
  full_name: string;
  dept_name: string | null;
  designation_name: string | null;
  branch_name: string | null;
  cost_centre_id: string | null;
  cost_centre_name: string | null;
  allocation_rows: number;
  allocation_total: string | number | null;
};

type Exceptions = {
  activeEmployees: number;
  noProcess: number;
  noDesignation: number;
  noCostCentre: number;
  unresolvableByMatrix: number;
  costCentresWithStaff: number;
  costCentresWithRate: number;
  unbalancedAllocations: Array<{ employeeId: string; total: number }>;
  unresolvableEmployees: Array<{
    employeeId: string; employeeCode: string | null; fullName: string | null; branchName: string | null;
    missingProcess: boolean; missingDesignation: boolean; missingCostCentre: boolean;
  }>;
  noCostCentreEmployees: Array<{ employeeId: string; employeeCode: string | null; fullName: string | null; branchName: string | null }>;
  costCentresWithoutRate: Array<{
    costCentreId: string; costCentreCode: string | null; costCentreName: string | null;
    staffCount: number; likelyInternalOverhead: boolean;
  }>;
  costCentresNeedingRealRate: number;
};

type EmployeeLookupResult = {
  employeeId: string;
  employeeCode: string | null;
  fullName: string | null;
  activeStatus: boolean;
  processId: string | null;
  processName: string | null;
  clientName: string | null;
  designationId: string | null;
  designationName: string | null;
  costCentreId: string | null;
  costCentreName: string | null;
  billability: { isBillable: boolean; source: string; ruleId: string | null };
  seatRate: { seatRateMonthly: number; source: string; ruleId: string | null } | null;
  allocation: { rows: Array<{ costCentreId: string; costCentreName?: string | null; allocationPct: number }>; percentTotal: number; balanced: boolean } | null;
};

const BILLABILITY_SOURCE_LABEL: Record<string, string> = {
  employee_rule: "Explicit rule for this employee",
  process_designation: "Rule for this process + role",
  process: "Rule for this process",
  designation: "Rule for this role",
  default_bucket: "Default (matches P&L classification, no rule saved)",
  unresolved: "Unresolved — no process or role to reach a rule",
};

/**
 * Billability & Seat Cost.
 *
 * Three things are maintained here, and they answer three different questions:
 *   1. Which roles does the client pay for, on which process?
 *   2. What do we receive per billable seat?
 *   3. For support staff serving several cost centres, how does their cost divide?
 *
 * The first tab is the important one and is deliberately NOT a blank form. Every live
 * process x designation pair is listed with its headcount and what the system would
 * already conclude, so the job is to correct the exceptions rather than to enter 126 rows.
 */
export default function BillabilitySeatCostPage() {
  const [loading, setLoading] = useState(true);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [seatRates, setSeatRates] = useState<SeatRateRow[]>([]);
  const [costCentres, setCostCentres] = useState<CostCentre[]>([]);
  const [candidates, setCandidates] = useState<SplitCandidate[]>([]);
  const [exceptions, setExceptions] = useState<Exceptions | null>(null);
  const [search, setSearch] = useState("");
  const [applyingDefaults, setApplyingDefaults] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [m, r, cc, sc, ex] = await Promise.all([
        hrmsApi.get<{ data: MatrixRow[] }>("/api/finance/billability/matrix"),
        hrmsApi.get<{ data: SeatRateRow[] }>("/api/finance/billability/seat-rates"),
        hrmsApi.get<{ data: CostCentre[] }>("/api/finance/billability/cost-centres"),
        hrmsApi.get<{ data: SplitCandidate[] }>("/api/finance/billability/split-candidates"),
        hrmsApi.get<{ data: Exceptions }>("/api/finance/billability/exceptions"),
      ]);
      setMatrix(m.data ?? []);
      setSeatRates(r.data ?? []);
      setCostCentres(cc.data ?? []);
      setCandidates(sc.data ?? []);
      setExceptions(ex.data ?? null);
    } catch {
      toast.error("Could not load billability configuration.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  const defaultRowCount = useMemo(() => matrix.filter((r) => r.isBillable === null).length, [matrix]);

  /**
   * "Default" is not a blank — it's the answer the P&L already computes (agent role = billable),
   * just never saved as an explicit rule. This persists that existing answer in bulk, for every
   * cell still unresolved, so the exceptions list stops growing with rows nobody actually
   * disagrees about. Cells where staff disagree on their P&L bucket are left alone.
   */
  async function applyDefaults() {
    setApplyingDefaults(true);
    try {
      const res = await hrmsApi.post<{ applied: number; skipped: Array<{ processName: string | null; designationName: string | null; reason: string }> }>(
        "/api/finance/billability/matrix/apply-defaults", {}
      );
      const { applied, skipped } = res as any;
      if (applied > 0) {
        toast.success(`Saved the existing default for ${applied} cell(s).${skipped?.length ? ` ${skipped.length} left for manual review.` : ""}`);
      } else if (skipped?.length) {
        toast.warning(`Nothing could be auto-filled — all ${skipped.length} remaining cell(s) need manual review.`);
      } else {
        toast.success("Nothing left to fill in.");
      }
      void loadAll();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not apply defaults.");
    } finally {
      setApplyingDefaults(false);
    }
  }

  const filteredMatrix = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return matrix;
    return matrix.filter((row) =>
      [row.processName, row.designationName, row.clientName]
        .some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [matrix, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, MatrixRow[]>();
    for (const row of filteredMatrix) {
      const key = `${row.processName ?? "(no process)"}||${row.clientName ?? ""}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries());
  }, [filteredMatrix]);

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Billability &amp; Seat Cost</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Which roles the client pays for on each process, what we receive per billable
              seat, and how non-billable support cost divides across the cost centres it serves.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </header>

        <ExceptionBanner exceptions={exceptions} loading={loading} />

        <Tabs defaultValue="matrix">
          <TabsList>
            <TabsTrigger value="matrix"><Users className="mr-2 h-4 w-4" />Who is billable</TabsTrigger>
            <TabsTrigger value="rates"><IndianRupee className="mr-2 h-4 w-4" />Seat rates</TabsTrigger>
            <TabsTrigger value="splits"><SplitSquareHorizontal className="mr-2 h-4 w-4" />Support cost splits</TabsTrigger>
            <TabsTrigger value="lookup"><UserSearch className="mr-2 h-4 w-4" />Employee lookup</TabsTrigger>
          </TabsList>

          <TabsContent value="matrix" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Process &times; role</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Every combination that currently has staff. <strong>Default</strong> means no rule
                  has been set and the system treats the role as the P&amp;L already classifies it —
                  front-line agents billable, team leaders, quality auditors and managers not. Set a
                  rule only where this client pays differently.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <div className="relative max-w-sm flex-1 min-w-[220px]">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="Filter by process, client or role…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {defaultRowCount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void applyDefaults()}
                      disabled={applyingDefaults}
                      title="Saves the already-computed default (agent role = billable) as an explicit rule for every cell still showing Default. Cells where staff disagree are skipped for manual review."
                    >
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      {applyingDefaults ? "Filling in…" : `Fill in the obvious ones (${defaultRowCount})`}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {loading ? <Skeleton className="h-64 w-full" /> : (
                  <div className="overflow-x-auto">
                    {grouped.length === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No process/role combinations match.
                      </p>
                    )}
                    {grouped.map(([key, rows]) => {
                      const [processName, clientName] = key.split("||");
                      return (
                        <div key={key} className="mb-6">
                          <div className="mb-2 flex items-baseline gap-2">
                            <h3 className="text-sm font-semibold">{processName}</h3>
                            {clientName && (
                              <span className="text-xs text-muted-foreground">{clientName}</span>
                            )}
                          </div>
                          <table className="w-full min-w-[720px] text-sm">
                            <thead>
                              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                                <th className="py-2 pr-3 font-medium">Role</th>
                                <th className="py-2 pr-3 text-right font-medium">Staff</th>
                                <th className="py-2 pr-3 font-medium">Client pays?</th>
                                <th className="py-2 pr-3 text-right font-medium">Role seat rate</th>
                                <th className="py-2 pr-3 font-medium">Reason</th>
                                <th className="py-2 font-medium" />
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row) => (
                                <MatrixRowEditor
                                  key={`${row.processId}-${row.designationId}`}
                                  row={row}
                                  onSaved={() => void loadAll()}
                                />
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rates" className="mt-4">
            <SeatRatesTab
              rates={seatRates}
              costCentres={costCentres}
              loading={loading}
              onSaved={() => void loadAll()}
            />
          </TabsContent>

          <TabsContent value="splits" className="mt-4">
            <SplitsTab
              candidates={candidates}
              costCentres={costCentres}
              loading={loading}
              onSaved={() => void loadAll()}
            />
          </TabsContent>

          <TabsContent value="lookup" className="mt-4">
            <EmployeeLookupTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

/**
 * The gaps, stated up front.
 *
 * A configuration screen that shows only what IS set lets an unconfigured hole read as
 * completeness. These counts are the difference between "we know" and "we assumed".
 */
/** One expandable line in the exception banner — the count plus, on click, who/what it names. */
function GapDisclosure({ label, count, children }: { label: React.ReactNode; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-start gap-1 text-left hover:underline"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
        <span>{label}</span>
      </button>
      {open && <div className="mt-1.5 ml-5">{children}</div>}
    </li>
  );
}

function ExceptionBanner({ exceptions, loading }: { exceptions: Exceptions | null; loading: boolean }) {
  if (loading || !exceptions) return null;
  const { unresolvableByMatrix, activeEmployees, noCostCentre,
          costCentresWithStaff, costCentresWithRate, unbalancedAllocations,
          unresolvableEmployees, noCostCentreEmployees, costCentresWithoutRate,
          costCentresNeedingRealRate } = exceptions;
  const pct = activeEmployees ? Math.round((unresolvableByMatrix / activeEmployees) * 100) : 0;
  const clean = unresolvableByMatrix === 0 && unbalancedAllocations.length === 0
    && costCentresNeedingRealRate === 0;

  if (clean) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
        <CheckCircle2 className="h-4 w-4" />
        Every active employee can be resolved, every staffed cost centre that needs a rate has one, and all splits balance.
      </div>
    );
  }

  const overheadCostCentres = costCentresWithoutRate.filter((c) => c.likelyInternalOverhead);
  const realRateGaps = costCentresWithoutRate.filter((c) => !c.likelyInternalOverhead);

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" />
        What this configuration cannot answer yet
      </div>
      <ul className="mt-1.5 space-y-2 pl-1 text-[13px]">
        <GapDisclosure
          label={<>
            <strong>{unresolvableByMatrix} of {activeEmployees} active employees ({pct}%)</strong> have
            no process or no designation, so no rule can reach them. They are treated as not
            billable and excluded from seat revenue — never guessed. Click to see who.
          </>}
          count={unresolvableByMatrix}
        >
          <ul className="space-y-0.5 max-h-48 overflow-y-auto">
            {unresolvableEmployees.map((e) => (
              <li key={e.employeeId} className="text-xs">
                <span className="font-medium">{e.fullName ?? "(no name)"}</span>{" "}
                <span className="text-muted-foreground">
                  {e.employeeCode ?? ""}{e.branchName ? ` · ${e.branchName}` : ""} — missing{" "}
                  {[e.missingProcess && "process", e.missingDesignation && "designation"].filter(Boolean).join(" & ")}
                </span>
              </li>
            ))}
          </ul>
        </GapDisclosure>

        <GapDisclosure
          label={<>{noCostCentre} active employees have no cost centre, so their cost cannot be attributed. Click to see who.</>}
          count={noCostCentre}
        >
          <ul className="space-y-0.5 max-h-48 overflow-y-auto">
            {noCostCentreEmployees.map((e) => (
              <li key={e.employeeId} className="text-xs">
                <span className="font-medium">{e.fullName ?? "(no name)"}</span>{" "}
                <span className="text-muted-foreground">{e.employeeCode ?? ""}{e.branchName ? ` · ${e.branchName}` : ""}</span>
              </li>
            ))}
          </ul>
        </GapDisclosure>

        {costCentresNeedingRealRate > 0 && (
          <GapDisclosure
            label={<>
              <strong>{costCentresNeedingRealRate}</strong> cost centre(s) with staff have no seat rate and
              are not obviously internal overhead. Their billable employees earn no revenue until Finance
              sets a real rate from the contract. Click to see which.
            </>}
            count={costCentresNeedingRealRate}
          >
            <ul className="space-y-0.5">
              {realRateGaps.map((c) => (
                <li key={c.costCentreId} className="text-xs">
                  <span className="font-medium">{c.costCentreName ?? c.costCentreCode}</span>{" "}
                  <span className="text-muted-foreground">{c.staffCount} staff — {c.costCentreCode}</span>
                </li>
              ))}
            </ul>
          </GapDisclosure>
        )}

        {overheadCostCentres.length > 0 && (
          <GapDisclosure
            label={<>
              {overheadCostCentres.length} more cost centre(s) also have no seat rate, but look like
              internal overhead (Management/Finance/IT-style, no "BSS/" delivery code) — likely never
              billable to a client. Not counted as a real gap above; click to confirm.
            </>}
            count={overheadCostCentres.length}
          >
            <ul className="space-y-0.5">
              {overheadCostCentres.map((c) => (
                <li key={c.costCentreId} className="text-xs">
                  <span className="font-medium">{c.costCentreName ?? c.costCentreCode}</span>{" "}
                  <span className="text-muted-foreground">{c.staffCount} staff — {c.costCentreCode}</span>
                </li>
              ))}
            </ul>
          </GapDisclosure>
        )}

        {unbalancedAllocations.length > 0 && (
          <li>
            {unbalancedAllocations.length} employee split(s) do not total 100%. The remainder is
            reported as unallocated rather than silently redistributed.
          </li>
        )}
      </ul>
    </div>
  );
}

function MatrixRowEditor({ row, onSaved }: { row: MatrixRow; onSaved: () => void }) {
  const [billable, setBillable] = useState<"default" | "yes" | "no">(
    row.isBillable === null ? "default" : row.isBillable ? "yes" : "no");
  const [rate, setRate] = useState(row.seatRateMonthly === null ? "" : String(row.seatRateMonthly));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const dirty = billable !== (row.isBillable === null ? "default" : row.isBillable ? "yes" : "no")
    || rate !== (row.seatRateMonthly === null ? "" : String(row.seatRateMonthly));

  async function save() {
    if (billable === "default") {
      toast.error("Choose Yes or No. 'Default' means no rule is stored — there is nothing to save.");
      return;
    }
    if (!reason.trim()) {
      toast.error("Give a reason — it is what explains this number when the period is reviewed.");
      return;
    }
    setSaving(true);
    try {
      await hrmsApi.post("/api/finance/billability/matrix", {
        processId: row.processId,
        designationId: row.designationId,
        isBillable: billable === "yes",
        seatRateMonthly: rate.trim() === "" ? null : Number(rate),
        effectiveFrom: monthStart(),
        changeReason: reason.trim(),
      });
      toast.success(`Saved — ${row.designationName} on ${row.processName}`);
      setReason("");
      onSaved();
    } catch {
      toast.error("Could not save this rule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3">{row.designationName ?? "(no designation)"}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{row.headcount}</td>
      <td className="py-2 pr-3">
        <select
          className={selectClass}
          value={billable}
          onChange={(e) => setBillable(e.target.value as "default" | "yes" | "no")}
        >
          <option value="default">Default</option>
          <option value="yes">Yes — client pays</option>
          <option value="no">No — we absorb</option>
        </select>
      </td>
      <td className="py-2 pr-3">
        <Input
          className="h-9 text-right"
          inputMode="numeric"
          placeholder="Cost centre rate"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          disabled={billable === "no"}
          title="Leave blank to use the cost centre's rate. Set only if this role is priced differently."
        />
      </td>
      <td className="py-2 pr-3">
        <Input
          className="h-9"
          placeholder="Why?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </td>
      <td className="py-2">
        <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
          <Save className="mr-1.5 h-3.5 w-3.5" />Save
        </Button>
      </td>
    </tr>
  );
}

function SeatRatesTab({ rates, costCentres, loading, onSaved }: {
  rates: SeatRateRow[]; costCentres: CostCentre[]; loading: boolean; onSaved: () => void;
}) {
  const [costCentreId, setCostCentreId] = useState("");
  const [model, setModel] = useState<"per_seat" | "not_seat_billed">("per_seat");
  const [rate, setRate] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!costCentreId) { toast.error("Choose a cost centre."); return; }
    if (!reason.trim()) { toast.error("Give a reason."); return; }
    if (model === "per_seat" && !(Number(rate) > 0)) {
      toast.error("A per-seat cost centre needs a rate above zero. If the client does not pay per seat, choose 'Not seat-billed'.");
      return;
    }
    setSaving(true);
    try {
      await hrmsApi.post("/api/finance/billability/seat-rates", {
        costCentreId,
        seatRateMonthly: model === "per_seat" ? Number(rate) : 0,
        billingModel: model,
        effectiveFrom: monthStart(),
        contractReference: reference.trim() || null,
        changeReason: reason.trim(),
      });
      toast.success("Seat rate saved.");
      setRate(""); setReference(""); setReason("");
      onSaved();
    } catch {
      toast.error("Could not save the seat rate.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Set a rate</CardTitle>
          <p className="text-sm text-muted-foreground">
            Applies from the 1st of this month. A previous rate is end-dated, not overwritten,
            so an earlier period can still be explained.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Cost centre</Label>
            <select className={selectClass} value={costCentreId} onChange={(e) => setCostCentreId(e.target.value)}>
              <option value="">Select…</option>
              {costCentres.map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {cc.cost_centre_name} — {cc.active_headcount} staff
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Only cost centres with active staff are listed.
            </p>
          </div>
          <div>
            <Label className="text-xs">How does the client pay?</Label>
            <select className={selectClass} value={model} onChange={(e) => setModel(e.target.value as "per_seat" | "not_seat_billed")}>
              <option value="per_seat">Per seat — a rate per person</option>
              <option value="not_seat_billed">Not per seat — outcome or transaction based</option>
            </select>
            {model === "not_seat_billed" && (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                Seat revenue will not be computed here. Reconciliation showed seats &times; rate is
                simply the wrong model for outcome-billed work, so the P&amp;L will say so rather
                than publish a wrong number.
              </p>
            )}
          </div>
          {model === "per_seat" && (
            <div>
              <Label className="text-xs">Monthly rate per seat (₹)</Label>
              <Input inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 25000" />
            </div>
          )}
          <div>
            <Label className="text-xs">Contract reference (optional)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO / agreement no." />
          </div>
          <div>
            <Label className="text-xs">Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this rate, and from when" />
          </div>
          <Button className="w-full" onClick={() => void save()} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />Save rate
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Current rates</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-48 w-full" /> : rates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No seat rates set yet. Until one exists, billable employees fall back to the cost
              centre's monthly budget driver, and where there is none they earn no revenue.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Cost centre</th>
                    <th className="py-2 pr-3 font-medium">Role</th>
                    <th className="py-2 pr-3 text-right font-medium">Rate</th>
                    <th className="py-2 pr-3 font-medium">Model</th>
                    <th className="py-2 font-medium">From</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{r.cost_centre_name}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{r.designation_name ?? "All roles"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {r.billing_model === "not_seat_billed" ? "—" : `₹${inr(Number(r.seat_rate_monthly))}`}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={r.billing_model === "per_seat" ? "secondary" : "outline"}>
                          {r.billing_model === "per_seat" ? "Per seat" : "Not seat-billed"}
                        </Badge>
                      </td>
                      <td className="py-2 text-muted-foreground">{String(r.effective_from).slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SplitsTab({ candidates, costCentres, loading, onSaved }: {
  candidates: SplitCandidate[]; costCentres: CostCentre[]; loading: boolean; onSaved: () => void;
}) {
  const [selected, setSelected] = useState<SplitCandidate | null>(null);
  const [rows, setRows] = useState<Array<{ costCentreId: string; allocationPct: string }>>([]);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const total = rows.reduce((sum, r) => sum + (Number(r.allocationPct) || 0), 0);
  const balanced = Math.abs(total - 100) <= 0.01;

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) =>
      [c.full_name, c.employee_code, c.designation_name, c.dept_name, c.branch_name, c.cost_centre_name]
        .some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [candidates, search]);

  function pick(candidate: SplitCandidate) {
    setSelected(candidate);
    setRows([{ costCentreId: candidate.cost_centre_id ?? "", allocationPct: "100" }]);
    setReason("");
  }

  async function save() {
    if (!selected) return;
    if (!balanced) { toast.error(`The split totals ${total.toFixed(2)}% — it must be exactly 100%.`); return; }
    if (!reason.trim()) { toast.error("Give a reason."); return; }
    if (rows.some((r) => !r.costCentreId)) { toast.error("Every line needs a cost centre."); return; }
    setSaving(true);
    try {
      await hrmsApi.post(`/api/finance/billability/allocations/${selected.employee_id}`, {
        effectiveFrom: monthStart(),
        allocations: rows.map((r) => ({ costCentreId: r.costCentreId, allocationPct: Number(r.allocationPct) })),
        changeReason: reason.trim(),
      });
      toast.success(`Split saved for ${selected.full_name}.`);
      setSelected(null); setRows([]); setReason("");
      onSaved();
    } catch (error: any) {
      toast.error(error?.response?.data?.message ?? "Could not save the split.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Support staff</CardTitle>
          <p className="text-sm text-muted-foreground">
            People the P&amp;L cannot tie to a single client-facing cost centre. Anyone left without
            a split stays 100% on their own cost centre, or pools to the branch driver if they have none.
          </p>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8 h-9"
              placeholder="Search by name, code or cost centre…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="max-h-[520px] overflow-y-auto p-0">
          {loading ? <Skeleton className="m-4 h-40" /> : filteredCandidates.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No one matches that search.</p>
          ) : (
            <ul className="divide-y">
              {filteredCandidates.map((c) => (
                <li key={c.employee_id}>
                  <button
                    type="button"
                    onClick={() => pick(c)}
                    className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-muted/60 ${
                      selected?.employee_id === c.employee_id ? "bg-muted" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.full_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[c.designation_name, c.dept_name, c.branch_name].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {c.allocation_rows > 0 && (
                      <Badge variant={Math.abs(Number(c.allocation_total) - 100) <= 0.01 ? "secondary" : "destructive"}>
                        {Number(c.allocation_total ?? 0)}%
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {selected ? `Split — ${selected.full_name}` : "Select someone to split"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!selected ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Choose a person on the left to divide their cost across the cost centres they serve.
            </p>
          ) : (
            <>
              {rows.map((row, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label className="text-xs">Cost centre</Label>
                    <select
                      className={selectClass}
                      value={row.costCentreId}
                      onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, costCentreId: e.target.value } : r))}
                    >
                      <option value="">Select…</option>
                      {costCentres.map((cc) => (
                        <option key={cc.id} value={cc.id}>{cc.cost_centre_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <Label className="text-xs">Share %</Label>
                    <Input
                      className="text-right"
                      inputMode="decimal"
                      value={row.allocationPct}
                      onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, allocationPct: e.target.value } : r))}
                    />
                  </div>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    disabled={rows.length === 1}
                  >Remove</Button>
                </div>
              ))}

              <Button variant="outline" size="sm"
                onClick={() => setRows([...rows, { costCentreId: "", allocationPct: "" }])}>
                Add a cost centre
              </Button>

              <div className={`rounded-md border px-3 py-2 text-sm ${
                balanced
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                  : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"}`}>
                Total {total.toFixed(2)}%{balanced ? " — balanced." : " — must be exactly 100% before this can be saved."}
              </div>

              <div>
                <Label className="text-xs">Reason</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Which cost centres this person serves, and why this share" />
              </div>

              <Button onClick={() => void save()} disabled={saving || !balanced}>
                <Save className="mr-2 h-4 w-4" />Save split
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Employee lookup — find any one employee, anywhere, and see the FULL billability answer for
 * them: whether they're billable and why (which rule, or the default), what seat rate applies,
 * and any cost-centre split on file. Answers the question none of the other tabs can: "is THIS
 * specific person resolved, and if not, what exactly is missing" — including employees who show
 * up nowhere else on this page because they have no process/designation/cost centre at all.
 */
function EmployeeLookupTab() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EmployeeLookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      hrmsApi.get<{ data: EmployeeLookupResult[] }>(`/api/finance/billability/employee-lookup?q=${encodeURIComponent(q)}`)
        .then((res) => setResults(res.data ?? []))
        .catch(() => toast.error("Could not search employees."))
        .finally(() => { setSearching(false); setSearched(true); });
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Look up an employee</CardTitle>
        <p className="text-sm text-muted-foreground">
          Search by name or employee code to see exactly how this page's rules resolve for one
          person — the same answer the P&amp;L engines use, not a re-derived guess.
        </p>
        <div className="relative mt-2 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Employee name or code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        {searching ? <Skeleton className="h-24 w-full" /> : query.trim().length < 2 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Type at least 2 characters to search.</p>
        ) : searched && results.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No employee matches "{query.trim()}".</p>
        ) : (
          <div className="space-y-3">
            {results.map((r) => (
              <div key={r.employeeId} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-sm">{r.fullName ?? "(no name)"}</span>{" "}
                    <span className="text-xs text-muted-foreground">{r.employeeCode}</span>
                    {!r.activeStatus && <Badge variant="outline" className="ml-2">Inactive</Badge>}
                  </div>
                  <Badge className={r.billability.isBillable ? "bg-emerald-600 hover:bg-emerald-600" : "bg-slate-500 hover:bg-slate-500"}>
                    {r.billability.isBillable ? "Billable" : "Not billable"}
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div><span className="text-muted-foreground">Process</span><br />{r.processName ?? <span className="text-amber-700">missing</span>}</div>
                  <div><span className="text-muted-foreground">Role</span><br />{r.designationName ?? <span className="text-amber-700">missing</span>}</div>
                  <div><span className="text-muted-foreground">Cost centre</span><br />{r.costCentreName ?? <span className="text-amber-700">missing</span>}</div>
                  <div><span className="text-muted-foreground">Client</span><br />{r.clientName ?? "—"}</div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {BILLABILITY_SOURCE_LABEL[r.billability.source] ?? r.billability.source}
                  {r.billability.isBillable && (
                    r.seatRate && r.seatRate.seatRateMonthly > 0
                      ? <> — seat rate ₹{inr(r.seatRate.seatRateMonthly)}/mo ({r.seatRate.source === "not_seat_billed" ? "not seat-billed" : r.seatRate.source.replace(/_/g, " ")})</>
                      : <> — <span className="text-amber-700">no seat rate resolves for this employee yet, so they earn no seat revenue</span></>
                  )}
                </p>
                {r.allocation && (
                  <div className="mt-2 text-xs">
                    <span className="text-muted-foreground">Cost split on file:</span>{" "}
                    {r.allocation.rows.map((a) => `${a.costCentreName ?? a.costCentreId} ${a.allocationPct}%`).join(", ")}
                    {!r.allocation.balanced && <span className="ml-1 text-amber-700">(does not total 100%)</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
