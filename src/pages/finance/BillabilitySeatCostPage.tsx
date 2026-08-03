import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  IndianRupee,
  RefreshCw,
  Save,
  Search,
  SplitSquareHorizontal,
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
      setMatrix(m.data.data ?? []);
      setSeatRates(r.data.data ?? []);
      setCostCentres(cc.data.data ?? []);
      setCandidates(sc.data.data ?? []);
      setExceptions(ex.data.data ?? null);
    } catch {
      toast.error("Could not load billability configuration.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

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
                <div className="relative mt-2 max-w-sm">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Filter by process, client or role…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
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
function ExceptionBanner({ exceptions, loading }: { exceptions: Exceptions | null; loading: boolean }) {
  if (loading || !exceptions) return null;
  const { unresolvableByMatrix, activeEmployees, noCostCentre,
          costCentresWithStaff, costCentresWithRate, unbalancedAllocations } = exceptions;
  const pct = activeEmployees ? Math.round((unresolvableByMatrix / activeEmployees) * 100) : 0;
  const clean = unresolvableByMatrix === 0 && unbalancedAllocations.length === 0
    && costCentresWithRate >= costCentresWithStaff;

  if (clean) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
        <CheckCircle2 className="h-4 w-4" />
        Every active employee can be resolved, every staffed cost centre has a rate, and all splits balance.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" />
        What this configuration cannot answer yet
      </div>
      <ul className="mt-1.5 space-y-1 pl-6 text-[13px]">
        {unresolvableByMatrix > 0 && (
          <li>
            <strong>{unresolvableByMatrix} of {activeEmployees} active employees ({pct}%)</strong> have
            no process or no designation, so no rule can reach them. They are treated as not
            billable and excluded from seat revenue — never guessed.
          </li>
        )}
        {noCostCentre > 0 && (
          <li>{noCostCentre} active employees have no cost centre, so their cost cannot be attributed.</li>
        )}
        {costCentresWithRate < costCentresWithStaff && (
          <li>
            {costCentresWithStaff - costCentresWithRate} of {costCentresWithStaff} cost centres
            with staff have no seat rate. Their billable employees earn no revenue until one is set.
          </li>
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

  const total = rows.reduce((sum, r) => sum + (Number(r.allocationPct) || 0), 0);
  const balanced = Math.abs(total - 100) <= 0.01;

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
        </CardHeader>
        <CardContent className="max-h-[520px] overflow-y-auto p-0">
          {loading ? <Skeleton className="m-4 h-40" /> : (
            <ul className="divide-y">
              {candidates.map((c) => (
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
