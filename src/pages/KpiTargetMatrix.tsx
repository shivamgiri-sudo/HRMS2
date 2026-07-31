import { useEffect, useMemo, useState } from "react";
import { Loader, RefreshCcw, Save, Search, Undo2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * One grid for every KPI target in the organisation.
 *
 * Replaces having to visit /kpi-config once per process (97 visits to see 97 processes) and
 * reading /kpi-master's flat list of 372 undifferentiated rows. Rows here are the
 * process × designation pairs that actually have employees — 133 of the 2,310 the full cross
 * product would produce — and each cell shows both the effective target and where it came
 * from, so an inherited value is never mistaken for one somebody chose.
 */

type CellSource = "explicit" | "process" | "cost_centre" | "designation" | "department" | "none";

interface MatrixPair {
  process_id: string | null;
  process_name: string | null;
  designation_id: string | null;
  designation_name: string | null;
  headcount: number;
  inherit_varies: boolean;
}

interface MatrixMetric {
  id: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: string;
  category: string;
  actual_rows: number;
  has_data: boolean;
}

interface MatrixCell {
  target_value: number | null;
  min_threshold: number | null;
  weightage: number | null;
  source: CellSource;
  /** False when the process has never produced this metric and none is configured. */
  applicable: boolean;
}

/**
 * A bare "240" and a bare "95" look identical but mean opposite things — 240 seconds of talk
 * time is a ceiling to stay under, 95 percent attendance is a floor to reach. The unit and
 * direction have to be on the column or the grid is ambiguous.
 */
const UNIT_SYMBOL: Record<string, string> = {
  percent: "%",
  seconds: "s",
  currency: "₹",
  count: "#",
};

const directionHint = (direction: string) =>
  direction === "lower_is_better" ? "↓ lower is better" : "↑ higher is better";

interface MatrixResponse {
  pairs: MatrixPair[];
  metrics: MatrixMetric[];
  cells: Record<string, MatrixCell>;
}

/** Where an effective value came from, in the words a configurer would use. */
const SOURCE_LABEL: Record<CellSource, string> = {
  explicit: "Set for this process and designation",
  process: "Inherited from the process",
  cost_centre: "Inherited from the cost centre",
  designation: "Inherited from the designation",
  department: "Inherited from the department",
  none: "No target anywhere — this metric is not scored for these employees",
};

const pairKey = (pair: MatrixPair) => `${pair.process_id ?? "~"}|${pair.designation_id ?? "~"}`;
const cellKey = (pair: MatrixPair, metricId: string) => `${pairKey(pair)}|${metricId}`;

export default function KpiTargetMatrix() {
  const [data, setData] = useState<MatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [search, setSearch] = useState("");
  const [unconfiguredOnly, setUnconfiguredOnly] = useState(false);
  const [showAllMetrics, setShowAllMetrics] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /** Pending cell edits, keyed like `cells`. Cleared once saved. */
  const [edits, setEdits] = useState<Record<string, string>>({});

  const [bulkMetricId, setBulkMetricId] = useState("");
  const [bulkValue, setBulkValue] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: MatrixResponse }>("/api/kpi-master/matrix");
      setData(res.data);
      setEdits({});
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the target matrix");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visiblePairs = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    return data.pairs.filter((pair) => {
      if (term) {
        const haystack = `${pair.process_name ?? ""} ${pair.designation_name ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (unconfiguredOnly) {
        // "Unconfigured" means nothing was chosen for this exact pair — an inherited value
        // still leaves the pair unreviewed, which is the whole point of the filter.
        const anyExplicit = data.metrics.some(
          (metric) => data.cells[cellKey(pair, metric.id)]?.source === "explicit",
        );
        if (anyExplicit) return false;
      }
      return true;
    });
  }, [data, search, unconfiguredOnly]);

  function setEdit(pair: MatrixPair, metricId: string, value: string) {
    setEdits((prev) => ({ ...prev, [cellKey(pair, metricId)]: value }));
  }

  function toggleRow(pair: MatrixPair) {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = pairKey(pair);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applyBulk() {
    if (!data || !bulkMetricId || bulkValue.trim() === "") return;
    const next = { ...edits };
    let skipped = 0;
    for (const pair of visiblePairs) {
      if (!selected.has(pairKey(pair))) continue;
      // Bulk is where a wrong target spreads fastest. Selecting 40 rows and applying a
      // sales target would otherwise hit voice and back-office processes too.
      if (!showAllMetrics && data.cells[cellKey(pair, bulkMetricId)]?.applicable === false) {
        skipped += 1;
        continue;
      }
      next[cellKey(pair, bulkMetricId)] = bulkValue.trim();
    }
    setEdits(next);
    setMessage(
      skipped
        ? { ok: true, text: `Applied to ${selected.size - skipped}. Skipped ${skipped} that do not report this metric.` }
        : null,
    );
  }

  const pendingCount = Object.keys(edits).length;

  async function save() {
    if (!data || !pendingCount) return;
    setSaving(true);
    setMessage(null);

    const byKey = new Map(data.pairs.map((pair) => [pairKey(pair), pair]));
    const cells: unknown[] = [];
    for (const [key, raw] of Object.entries(edits)) {
      const lastSeparator = key.lastIndexOf("|");
      const pair = byKey.get(key.slice(0, lastSeparator));
      const metricId = key.slice(lastSeparator + 1);
      // A target is meaningless without a process to attach it to; pairs with no process
      // are shown for visibility but cannot be configured here.
      if (!pair?.process_id || raw.trim() === "") continue;
      cells.push({
        metric_id: metricId,
        process_id: pair.process_id,
        designation_id: pair.designation_id,
        target_value: Number(raw),
      });
    }

    if (!cells.length) {
      setSaving(false);
      setMessage({ ok: false, text: "Nothing to save — blank values are ignored." });
      return;
    }

    try {
      const res = await hrmsApi.post<{ success: boolean; applied: number; failed: number }>(
        "/api/kpi-master/matrix/bulk",
        { cells },
      );
      setMessage(
        res.failed
          ? { ok: false, text: `Saved ${res.applied}. ${res.failed} could not be saved.` }
          : { ok: true, text: `Saved ${res.applied} target${res.applied === 1 ? "" : "s"}.` },
      );
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">KPI Targets</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every process and designation that has employees, with the target each one is
              measured against.
            </p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {message && (
          <div
            role="status"
            className={`rounded-md border p-3 text-sm ${
              message.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                : "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"
            }`}
          >
            {message.text}
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <p className="font-medium">Could not load the target matrix.</p>
            <p className="mt-1">{error}</p>
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        )}

        {!error && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Filter by process or designation"
                  className="w-72 pl-8"
                  aria-label="Filter by process or designation"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={unconfiguredOnly}
                  onCheckedChange={(value) => setUnconfiguredOnly(value === true)}
                />
                Only pairs with nothing set
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={showAllMetrics}
                  onCheckedChange={(value) => setShowAllMetrics(value === true)}
                />
                Show metrics a process does not report
              </label>

              <div className="ml-auto flex items-center gap-2">
                {pendingCount > 0 && (
                  <>
                    <span className="text-sm text-muted-foreground">
                      {pendingCount} unsaved change{pendingCount === 1 ? "" : "s"}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => setEdits({})}>
                      <Undo2 className="mr-2 h-4 w-4" />
                      Discard
                    </Button>
                  </>
                )}
                <Button onClick={() => void save()} disabled={saving || !pendingCount}>
                  {saving ? <Loader className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save
                </Button>
              </div>
            </div>

            {selected.size > 0 && data && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3 text-sm">
                <span className="font-medium">
                  {selected.size} row{selected.size === 1 ? "" : "s"} selected
                </span>
                <span>Set</span>
                <select
                  value={bulkMetricId}
                  onChange={(event) => setBulkMetricId(event.target.value)}
                  className="h-9 cursor-pointer rounded-md border bg-background px-2"
                  aria-label="Metric to apply in bulk"
                >
                  <option value="">Choose a metric</option>
                  {data.metrics.map((metric) => (
                    <option key={metric.id} value={metric.id}>
                      {metric.metric_name}
                    </option>
                  ))}
                </select>
                <span>to</span>
                <Input
                  value={bulkValue}
                  onChange={(event) => setBulkValue(event.target.value)}
                  className="w-28"
                  inputMode="decimal"
                  aria-label="Target value to apply in bulk"
                />
                <Button size="sm" variant="secondary" onClick={applyBulk} disabled={!bulkMetricId || bulkValue.trim() === ""}>
                  Apply to selected
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear selection
                </Button>
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader className="h-4 w-4 animate-spin" />
                Loading targets…
              </div>
            ) : !data || !visiblePairs.length ? (
              <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
                {data && data.pairs.length
                  ? "No process or designation matches that filter."
                  : "No process and designation pairs have active employees yet."}
              </div>
            ) : (
              // Wide grids scroll inside their own container so the page body never scrolls
              // sideways.
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" aria-label="Select row" />
                      <TableHead className="min-w-[180px]">Process</TableHead>
                      <TableHead className="min-w-[150px]">Designation</TableHead>
                      <TableHead className="text-right">People</TableHead>
                      {data.metrics.map((metric) => (
                        <TableHead key={metric.id} className="min-w-[130px] text-right align-bottom">
                          <div
                            className="flex flex-col items-end leading-tight"
                            title={`${metric.metric_name} — ${metric.unit}, ${directionHint(metric.direction)}`}
                          >
                            <span>
                              {metric.metric_code}
                              <span className="ml-1 font-normal text-muted-foreground">
                                {UNIT_SYMBOL[metric.unit] ?? metric.unit}
                              </span>
                            </span>
                            <span className="text-xs font-normal text-muted-foreground">
                              {metric.direction === "lower_is_better" ? "↓ lower better" : "↑ higher better"}
                            </span>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visiblePairs.map((pair) => {
                      const key = pairKey(pair);
                      return (
                        <TableRow key={key} data-state={selected.has(key) ? "selected" : undefined}>
                          <TableCell>
                            <Checkbox
                              checked={selected.has(key)}
                              onCheckedChange={() => toggleRow(pair)}
                              aria-label={`Select ${pair.process_name ?? "unassigned"} ${pair.designation_name ?? ""}`}
                              disabled={!pair.process_id}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {pair.process_name ?? <span className="text-muted-foreground">Not assigned</span>}
                          </TableCell>
                          <TableCell>
                            {pair.designation_name ?? <span className="text-muted-foreground">Not assigned</span>}
                            {pair.inherit_varies && (
                              <span
                                className="ml-1 cursor-help text-xs text-amber-600"
                                title="These employees sit in more than one department or cost centre, so an inherited value here does not apply identically to all of them."
                              >
                                mixed
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{pair.headcount}</TableCell>
                          {data.metrics.map((metric) => {
                            const cell = data.cells[cellKey(pair, metric.id)];
                            const edited = edits[cellKey(pair, metric.id)];
                            const isInherited = cell && cell.source !== "explicit" && cell.source !== "none";

                            // This process does not report this metric. Rendering an empty
                            // editable box here invites a target that nothing will ever
                            // score — a revenue goal on a process with no sales feed.
                            if (cell && !cell.applicable && !showAllMetrics) {
                              return (
                                <TableCell
                                  key={metric.id}
                                  className="text-right text-muted-foreground/40"
                                  title={`${pair.process_name ?? "This process"} does not report ${metric.metric_name}. Tick "Show metrics a process does not report" to set one anyway.`}
                                >
                                  n/a
                                </TableCell>
                              );
                            }

                            return (
                              <TableCell key={metric.id} className="text-right">
                                <Input
                                  value={edited ?? (cell?.target_value ?? "").toString()}
                                  onChange={(event) => setEdit(pair, metric.id, event.target.value)}
                                  disabled={!pair.process_id}
                                  inputMode="decimal"
                                  placeholder="—"
                                  title={`${cell ? SOURCE_LABEL[cell.source] : SOURCE_LABEL.none}${
                                    cell && !cell.applicable ? " · this process does not report this metric" : ""
                                  }`}
                                  aria-label={`${metric.metric_name} target for ${pair.process_name ?? "unassigned"} ${pair.designation_name ?? ""}`}
                                  className={`h-8 w-24 text-right tabular-nums transition-colors ${
                                    edited !== undefined
                                      ? "border-blue-400 bg-blue-50 dark:bg-blue-950"
                                      : cell && !cell.applicable
                                        ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/30"
                                        : isInherited
                                          ? "border-transparent bg-transparent text-muted-foreground"
                                          : ""
                                  }`}
                                />
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>Grey — inherited, nothing set for this exact pair</span>
              <span>Black — set for this process and designation</span>
              <span>Blue — edited, not yet saved</span>
              <span>n/a — this process does not report that metric</span>
              <span>Amber — a target on a metric the process does not report</span>
              <span>Hover any cell to see where its value comes from</span>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
