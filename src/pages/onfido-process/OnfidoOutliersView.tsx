import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DASH, EmptyNote, SectionCard, fmtDate } from "./onfidoReportShared";

interface DateRange {
  from: string;
  to: string;
}

interface TargetTile {
  key: string;
  label: string;
  target: number | null;
  achievement: number | null;
  variance: number | null;
  unit: "percent" | "seconds";
  lowerIsBetter: boolean;
  onTarget: boolean | null;
}

type ActionStatus = "open" | "in_progress" | "closed";

interface ActionSummary {
  id: string;
  status: ActionStatus;
  dueDate: string | null;
  ownerName: string | null;
}

interface OutlierRow {
  analystEmail: string;
  tlName: string | null;
  amName: string | null;
  metric: "Overall Error %" | "POA Error %";
  value: number;
  target: number;
  variance: number;
  severity: "high" | "medium";
  flaggedWeeks: number;
  pattern: "repeat" | "intermittent" | "new" | "recovering";
  streak: number;
  repeat: boolean;
  action: ActionSummary | null;
  tenureBucket: string | null;
}

interface OutlierReport {
  from: string;
  to: string;
  dataAsOf: string | null;
  targets: TargetTile[];
  outliers: OutlierRow[];
}

interface OutlierAction {
  id: string;
  analystEmail: string;
  analystName: string | null;
  tlName: string | null;
  amName: string | null;
  metric: string;
  periodFrom: string;
  periodTo: string;
  observedValue: number | null;
  targetValue: number | null;
  actionTaken: string | null;
  rca: string | null;
  ownerName: string | null;
  dueDate: string | null;
  status: ActionStatus;
  closureRemarks: string | null;
  closedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  overdue: boolean;
}

interface Props {
  range: DateRange;
  tlFilter: string;
  amFilter: string;
  analystFilter: string;
}

const STATUS_LABEL: Record<ActionStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  closed: "Closed",
};
const STATUS_FILTERS: Array<{ key: "" | ActionStatus; label: string }> = [
  { key: "", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "closed", label: "Closed" },
];

const pct = (value: number | null): string =>
  value === null ? DASH : `${value.toFixed(2)}%`;

function scopeQuery(tl: string, am: string, analyst: string): string {
  return (
    (tl ? `&tlName=${encodeURIComponent(tl)}` : "") +
    (am ? `&amName=${encodeURIComponent(am)}` : "") +
    (analyst ? `&analystEmail=${encodeURIComponent(analyst)}` : "")
  );
}

function TargetTiles({ tiles }: { tiles: TargetTile[] }) {
  return (
    <div
      className="kr"
      style={{
        gridTemplateColumns: `repeat(${Math.max(tiles.length, 1)}, 1fr)`,
      }}
    >
      {tiles.map((t) => {
        const colour =
          t.onTarget === null
            ? "var(--muted)"
            : t.onTarget
              ? "var(--green)"
              : "var(--red)";
        const sign = t.variance !== null && t.variance > 0 ? "+" : "";
        return (
          <div
            key={t.key}
            className="kpi"
            style={{ "--kc": colour } as React.CSSProperties}
          >
            <label>{t.label}</label>
            <div className="kv">{pct(t.achievement)}</div>
            {t.achievement === null && <div className="ks">No audit data in this range</div>}
            <div className="ks">
              Target{" "}
              {t.target === null
                ? "not set"
                : `${t.lowerIsBetter ? "at most " : "at least "}${t.target}%`}
              {t.variance !== null && (
                <>
                  {" · "}
                  <strong style={{ color: colour }}>
                    Variance {sign}
                    {t.variance.toFixed(2)} pts
                  </strong>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({
  status,
  overdue,
}: {
  status: ActionStatus;
  overdue?: boolean;
}) {
  const cls =
    status === "closed"
      ? "oc-severity-medium"
      : overdue
        ? "oc-severity-high"
        : "oc-severity-medium";
  return (
    <span className={`oc-badge-pill ${cls}`}>
      {STATUS_LABEL[status]}
      {overdue ? " · overdue" : ""}
    </span>
  );
}

const PATTERN_LABEL: Record<OutlierRow["pattern"], string> = {
  repeat: "Repeat",
  intermittent: "On and off",
  new: "New",
  recovering: "Recovering",
};

function PatternBadge({ row }: { row: OutlierRow }) {
  const cls = row.pattern === "repeat" ? "oc-severity-high" : "oc-severity-medium";
  const detail = `Outside target in ${row.flaggedWeeks} of the last 4 weeks; ${row.streak} in a row up to the end date`;
  return (
    <span className={`oc-badge-pill ${cls}`} title={detail}>
      {PATTERN_LABEL[row.pattern]}
      {row.pattern === "repeat" ? ` x${row.streak}` : ""}
    </span>
  );
}

interface LogTarget {
  row: OutlierRow;
}

function LogActionDialog({
  target,
  range,
  onClose,
}: {
  target: LogTarget | null;
  range: DateRange;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [actionTaken, setActionTaken] = useState("");
  const [rca, setRca] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [dueDate, setDueDate] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const row = target!.row;
      return hrmsApi.post("/api/onfido-process/outlier-actions", {
        analystEmail: row.analystEmail,
        tlName: row.tlName,
        amName: row.amName,
        metric: row.metric,
        periodFrom: range.from,
        periodTo: range.to,
        observedValue: row.value,
        targetValue: row.target,
        actionTaken: actionTaken || null,
        rca: rca || null,
        ownerName: ownerName || null,
        dueDate: dueDate || null,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["onfido-process", "outliers"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["onfido-process", "outlier-actions"],
      });
      setActionTaken("");
      setRca("");
      setOwnerName("");
      setDueDate("");
      onClose();
    },
  });

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log action</DialogTitle>
          <DialogDescription>
            {target?.row.analystEmail} · {target?.row.metric}{" "}
            {target?.row.value}% (target {target?.row.target}%)
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="oa-action">Action taken</Label>
            <Textarea
              id="oa-action"
              rows={2}
              maxLength={2000}
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="oa-rca">Remarks / RCA</Label>
            <Textarea
              id="oa-rca"
              rows={2}
              maxLength={2000}
              value={rca}
              onChange={(e) => setRca(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="oa-owner">Owner</Label>
              <Input
                id="oa-owner"
                maxLength={255}
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="oa-due">Due date</Label>
              <Input
                id="oa-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          {create.error instanceof Error && (
            <p role="alert" className="text-sm text-red-600">
              Could not save: {create.error.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            Save action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionsTable({
  scope,
}: {
  scope: { tl: string; am: string; analyst: string };
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"" | ActionStatus>("");
  const query = useQuery({
    queryKey: ["onfido-process", "outlier-actions", status, scope],
    queryFn: () =>
      hrmsApi.get<{ data: OutlierAction[] }>(
        `/api/onfido-process/outlier-actions?${status ? `status=${status}` : "status="}${scopeQuery(scope.tl, scope.am, scope.analyst)}`,
      ),
  });
  const actions = query.data?.data ?? [];

  const update = useMutation({
    mutationFn: (input: {
      id: string;
      status: ActionStatus;
      closureRemarks?: string | null;
    }) =>
      hrmsApi.patch(`/api/onfido-process/outlier-actions/${input.id}`, {
        status: input.status,
        ...(input.closureRemarks !== undefined
          ? { closureRemarks: input.closureRemarks }
          : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["onfido-process", "outlier-actions"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["onfido-process", "outliers"],
      });
    },
  });

  const change = (a: OutlierAction, next: ActionStatus) => {
    if (next === "closed") {
      const remarks = window.prompt(
        "Closure remarks (what resolved it)?",
        a.closureRemarks ?? "",
      );
      if (remarks === null) return;
      update.mutate({
        id: a.id,
        status: next,
        closureRemarks: remarks.trim() || null,
      });
      return;
    }
    update.mutate({ id: a.id, status: next });
  };

  return (
    <SectionCard
      title="Actions and closure"
      accent="var(--purple)"
      subtitle="Every action logged against an outlier: owner, due date and whether it is closed."
    >
      <div className="oc-pillbar" style={{ marginBottom: 10 }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key || "all"}
            className={f.key === status ? "oc-pill-btn active" : "oc-pill-btn"}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {query.isLoading && <EmptyNote>Loading...</EmptyNote>}
      {query.error instanceof Error && (
        <EmptyNote>Could not load actions: {query.error.message}</EmptyNote>
      )}
      {update.error instanceof Error && (
        <EmptyNote>Could not update: {update.error.message}</EmptyNote>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="oc-table">
          <thead>
            <tr>
              <th>Analyst</th>
              <th>Metric</th>
              <th>Action taken</th>
              <th>RCA</th>
              <th>Owner</th>
              <th>Due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {actions.length === 0 && !query.isLoading && (
              <tr className="oc-empty-row">
                <td colSpan={7}>No actions logged yet</td>
              </tr>
            )}
            {actions.map((a) => (
              <tr key={a.id}>
                <td title={`TL ${a.tlName ?? DASH} · AM ${a.amName ?? DASH}`}>
                  {a.analystName ?? a.analystEmail}
                </td>
                <td>{a.metric}</td>
                <td>{a.actionTaken ?? DASH}</td>
                <td>{a.rca ?? DASH}</td>
                <td>{a.ownerName ?? DASH}</td>
                <td>{a.dueDate ? fmtDate(a.dueDate) : DASH}</td>
                <td>
                  <StatusPill status={a.status} overdue={a.overdue} />
                  <select
                    aria-label={`Change status for ${a.analystEmail}`}
                    className="oc-select"
                    style={{ marginLeft: 8, width: 120 }}
                    value={a.status}
                    disabled={update.isPending}
                    onChange={(e) => change(a, e.target.value as ActionStatus)}
                  >
                    {(Object.keys(STATUS_LABEL) as ActionStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  {a.status === "closed" && a.closureRemarks && (
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      Closed: {a.closureRemarks}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

/**
 * Outliers and actions: who is outside target, by how much, whether it is a repeat, what action is
 * being taken and whether it is closed - so the dashboard says not just what the number is but who
 * is driving it and what is being done.
 */
export default function OnfidoOutliersView({
  range,
  tlFilter,
  amFilter,
  analystFilter,
}: Props) {
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);
  const query = useQuery({
    queryKey: [
      "onfido-process",
      "outliers",
      range,
      tlFilter,
      amFilter,
      analystFilter,
    ],
    queryFn: () =>
      hrmsApi.get<{ data: OutlierReport }>(
        `/api/onfido-process/outliers?from=${range.from}&to=${range.to}${scopeQuery(tlFilter, amFilter, analystFilter)}`,
      ),
  });
  const report = query.data?.data;
  const outliers = report?.outliers ?? [];
  const repeats = outliers.filter((o) => o.repeat).length;

  return (
    <div className="space-y-4">
      <div
        style={{ fontSize: 12, color: "var(--muted)" }}
        data-testid="outliers-data-as-of"
      >
        Data up to:{" "}
        {report?.dataAsOf
          ? fmtDate(report.dataAsOf)
          : query.isLoading
            ? "loading..."
            : "no audit data in this range"}
      </div>
      {report && <TargetTiles tiles={report.targets} />}

      <SectionCard
        title="Outliers"
        accent="var(--red)"
        subtitle={`Analysts outside target in the selected period. Pattern looks at the last 4 weeks up to the end date: Repeat = outside target in the latest 2+ weeks running (${repeats} of ${outliers.length} here).`}
      >
        {query.isLoading && <EmptyNote>Loading...</EmptyNote>}
        {query.error instanceof Error && (
          <EmptyNote>Could not load outliers: {query.error.message}</EmptyNote>
        )}
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead>
              <tr>
                <th>Analyst</th>
                <th>TL</th>
                <th>AM</th>
                <th>Tenure</th>
                <th>Metric</th>
                <th className="oc-right">Value</th>
                <th className="oc-right">Target</th>
                <th className="oc-right">Variance</th>
                <th>Pattern</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {!query.isLoading && outliers.length === 0 && (
                <tr className="oc-empty-row">
                  <td colSpan={10}>Nobody is outside target in this period</td>
                </tr>
              )}
              {outliers.slice(0, 300).map((o) => (
                <tr key={`${o.analystEmail}-${o.metric}`}>
                  <td>{o.analystEmail}</td>
                  <td>{o.tlName ?? DASH}</td>
                  <td>{o.amName ?? DASH}</td>
                  <td title="Tenure (AON) bucket from the latest roster row">{o.tenureBucket ?? DASH}</td>
                  <td>{o.metric}</td>
                  <td className="oc-right">{o.value}%</td>
                  <td className="oc-right" style={{ color: "var(--muted)" }}>
                    {o.target}%
                  </td>
                  <td className="oc-right" style={{ color: "var(--red)" }}>
                    +{o.variance} pts
                  </td>
                  <td>
                    <PatternBadge row={o} />
                  </td>
                  <td>
                    {o.action ? (
                      <StatusPill status={o.action.status} />
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] cursor-pointer sm:min-h-0"
                        onClick={() => setLogTarget({ row: o })}
                      >
                        Log action
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {outliers.length > 300 && (
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
            Showing first 300 of {outliers.length}
          </div>
        )}
      </SectionCard>

      <ActionsTable
        scope={{ tl: tlFilter, am: amFilter, analyst: analystFilter }}
      />
      <LogActionDialog
        target={logTarget}
        range={range}
        onClose={() => setLogTarget(null)}
      />
    </div>
  );
}
