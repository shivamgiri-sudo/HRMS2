import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Pencil,
  Check,
  X,
  AlertCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CalendarRecord {
  calendar_month: string;
  attendance_cutoff_date: string | null;
  incentive_upload_deadline: string | null;
  deductions_upload_deadline: string | null;
  branch_readiness_deadline: string | null;
  payroll_run_date: string | null;
  validation_date: string | null;
  disbursement_date: string | null;
  notes: string | null;
  updated_at: string | null;
}

type MilestoneKey =
  | "attendance_cutoff_date"
  | "incentive_upload_deadline"
  | "deductions_upload_deadline"
  | "branch_readiness_deadline"
  | "payroll_run_date"
  | "validation_date"
  | "disbursement_date";

const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  attendance_cutoff_date: "Attendance Cutoff",
  incentive_upload_deadline: "Incentive Upload Deadline",
  deductions_upload_deadline: "Deductions Upload Deadline",
  branch_readiness_deadline: "Branch Readiness Sign-Off",
  payroll_run_date: "Payroll Run Date",
  validation_date: "Validation Date",
  disbursement_date: "Disbursement Date",
};

const MILESTONE_KEYS = Object.keys(MILESTONE_LABELS) as MilestoneKey[];

const EDITOR_ROLES = ["payroll_head", "super_admin", "admin"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMonthDisplay(yyyyMM: string): string {
  const [y, m] = yyyyMM.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function offsetMonth(yyyyMM: string, delta: number): string {
  const [y, m] = yyyyMM.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function todayYYYYMM(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
}

interface DaysRemaining {
  days: number;
  label: string;
  color: string; // tailwind bg+text classes for chip
}

function daysRemaining(dateStr: string): DaysRemaining {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff > 3) return { days: diff, label: `${diff} days left`, color: "bg-green-100 text-green-800" };
  if (diff > 0) return { days: diff, label: `${diff} day${diff === 1 ? "" : "s"} left`, color: "bg-amber-100 text-amber-800" };
  if (diff === 0) return { days: 0, label: "Today", color: "bg-orange-100 text-orange-800" };
  return { days: diff, label: `Overdue (${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"})`, color: "bg-red-100 text-red-800" };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface MilestoneCardProps {
  label: string;
  dateStr: string | null;
  editing: boolean;
  editValue: string;
  onEditChange: (v: string) => void;
  onEditStart: () => void;
  onEditCancel: () => void;
  canEdit: boolean;
}

function MilestoneCard({
  label,
  dateStr,
  editing,
  editValue,
  onEditChange,
  onEditStart,
  onEditCancel,
  canEdit,
}: MilestoneCardProps) {
  const chip = dateStr ? daysRemaining(dateStr) : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-2 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        {canEdit && !editing && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onEditStart}
            title="Edit date"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>

      {editing ? (
        <div className="flex items-center gap-2 mt-1">
          <Input
            type="date"
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            className="h-7 text-sm"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" type="button" onClick={() => {/* handled by parent save */}}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" type="button" onClick={onEditCancel}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : dateStr ? (
        <div className="flex items-center justify-between gap-2 mt-1">
          <span className="text-sm font-medium text-foreground">{formatDate(dateStr)}</span>
          {chip && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${chip.color}`}>
              {chip.label}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-1">
          <span className="text-sm text-muted-foreground italic">Not configured</span>
        </div>
      )}
    </div>
  );
}

// ─── Month Column ─────────────────────────────────────────────────────────────

interface MonthColumnProps {
  month: string;
  data: CalendarRecord | null;
  canEdit: boolean;
  pendingEdits: Partial<Record<MilestoneKey, string>>;
  onEditChange: (key: MilestoneKey, value: string) => void;
  editingKey: string | null;
  setEditingKey: (k: string | null) => void;
}

function MonthColumn({
  month,
  data,
  canEdit,
  pendingEdits,
  onEditChange,
  editingKey,
  setEditingKey,
}: MonthColumnProps) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-slate-700 border-b pb-2">{formatMonthDisplay(month)}</h3>
      {MILESTONE_KEYS.map((key) => {
        const edKey = `${month}__${key}`;
        const isEditing = editingKey === edKey;
        const rawDate = data?.[key] ?? null;
        const editVal = pendingEdits[key] ?? (rawDate ? rawDate.substring(0, 10) : "");

        return (
          <MilestoneCard
            key={key}
            label={MILESTONE_LABELS[key]}
            dateStr={isEditing ? null : rawDate}
            editing={isEditing}
            editValue={editVal}
            onEditChange={(v) => onEditChange(key, v)}
            onEditStart={() => setEditingKey(edKey)}
            onEditCancel={() => setEditingKey(null)}
            canEdit={canEdit}
          />
        );
      })}
    </div>
  );
}

// ─── API helpers ──────────────────────────────────────────────────────────────

interface UpcomingItem {
  month: string;
  data: CalendarRecord | null;
}

async function fetchUpcoming(): Promise<UpcomingItem[]> {
  const res = await hrmsApi.get<{ success: boolean; data: UpcomingItem[] }>(
    "/api/payroll/calendar/upcoming",
  );
  return res.data ?? [];
}

async function fetchMonth(month: string): Promise<CalendarRecord | null> {
  const res = await hrmsApi.get<{ success: boolean; data: CalendarRecord | null }>(
    `/api/payroll/calendar?month=${month}`,
  );
  return res.data;
}

async function patchMonth(
  month: string,
  updates: Partial<Record<MilestoneKey, string | null>>,
): Promise<CalendarRecord> {
  const res = await hrmsApi.patch<{ success: boolean; data: CalendarRecord }>(
    `/api/payroll/calendar/${month}`,
    updates,
  );
  return res.data;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PayrollCalendar() {
  const qc = useQueryClient();
  const { roleKeys } = useWorkforceAccess();
  const canEdit = EDITOR_ROLES.some((r) => roleKeys.includes(r));

  const [viewMonth, setViewMonth] = useState<string>(todayYYYYMM());
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // pendingEdits: month -> key -> value
  const [pendingEdits, setPendingEdits] = useState<
    Record<string, Partial<Record<MilestoneKey, string>>>
  >({});

  // Upcoming query (always fetches 3 months from today)
  const upcomingQuery = useQuery({
    queryKey: ["payroll-calendar-upcoming"],
    queryFn: fetchUpcoming,
    staleTime: 60_000,
  });

  // Single month query (for navigation into past/future months)
  const singleQuery = useQuery({
    queryKey: ["payroll-calendar", viewMonth],
    queryFn: () => fetchMonth(viewMonth),
    staleTime: 60_000,
  });

  // Build display months: viewMonth + next 2
  const displayMonths = useMemo(() => {
    return [viewMonth, offsetMonth(viewMonth, 1), offsetMonth(viewMonth, 2)];
  }, [viewMonth]);

  // Resolve data for each display month — prefer upcoming cache
  const upcomingItems = upcomingQuery.data ?? [];
  const upcomingByMonth: Record<string, CalendarRecord | null> = {};
  for (const item of upcomingItems) upcomingByMonth[item.month] = item.data;

  // For the primary viewMonth we also have singleQuery data
  const dataByMonth: Record<string, CalendarRecord | null> = { ...upcomingByMonth };
  if (singleQuery.data !== undefined) dataByMonth[viewMonth] = singleQuery.data;

  const saveMutation = useMutation({
    mutationFn: async ({ month, updates }: { month: string; updates: Partial<Record<MilestoneKey, string | null>> }) => {
      return patchMonth(month, updates);
    },
    onSuccess: (_, { month }) => {
      void qc.invalidateQueries({ queryKey: ["payroll-calendar-upcoming"] });
      void qc.invalidateQueries({ queryKey: ["payroll-calendar", month] });
      setPendingEdits((prev) => {
        const next = { ...prev };
        delete next[month];
        return next;
      });
      setEditingKey(null);
    },
  });

  function handleEditChange(month: string, key: MilestoneKey, value: string) {
    setPendingEdits((prev) => ({
      ...prev,
      [month]: { ...prev[month], [key]: value },
    }));
  }

  function handleSave(month: string) {
    const edits = pendingEdits[month] ?? {};
    if (Object.keys(edits).length === 0) return;
    saveMutation.mutate({ month, updates: edits });
  }

  function hasPendingEdits(month: string): boolean {
    return Object.keys(pendingEdits[month] ?? {}).length > 0;
  }

  const isLoading = upcomingQuery.isLoading || singleQuery.isLoading;
  const error = upcomingQuery.error ?? singleQuery.error;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Payroll Processing Calendar</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Milestone dates and deadlines for each payroll cycle
          </p>
        </div>

        {/* Month navigation */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setViewMonth((m) => offsetMonth(m, -1))}
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[9rem] text-center">
            {formatMonthDisplay(viewMonth)}
          </span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setViewMonth((m) => offsetMonth(m, 1))}
            title="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {viewMonth !== todayYYYYMM() && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setViewMonth(todayYYYYMM())}
            >
              Back to current month
            </Button>
          )}
        </div>

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>Failed to load calendar data. Please refresh.</span>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-3">
                <div className="h-5 w-32 rounded bg-slate-200 animate-pulse" />
                {MILESTONE_KEYS.map((k) => (
                  <div key={k} className="h-20 rounded-lg bg-slate-100 animate-pulse" />
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Calendar grid */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {displayMonths.map((month) => (
              <div key={month} className="flex flex-col gap-4">
                <MonthColumn
                  month={month}
                  data={dataByMonth[month] ?? null}
                  canEdit={canEdit}
                  pendingEdits={pendingEdits[month] ?? {}}
                  onEditChange={(key, val) => handleEditChange(month, key, val)}
                  editingKey={editingKey}
                  setEditingKey={setEditingKey}
                />
                {canEdit && hasPendingEdits(month) && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleSave(month)}
                      disabled={saveMutation.isPending}
                    >
                      {saveMutation.isPending ? "Saving…" : "Save Changes"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setPendingEdits((prev) => {
                          const next = { ...prev };
                          delete next[month];
                          return next;
                        });
                        setEditingKey(null);
                      }}
                    >
                      Discard
                    </Button>
                  </div>
                )}
                {saveMutation.isError && saveMutation.variables?.month === month && (
                  <p className="text-xs text-red-600">Failed to save. Please try again.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
