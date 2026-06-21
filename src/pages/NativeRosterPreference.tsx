import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CalendarClock, CheckCircle2, XCircle, RefreshCw, Plus } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RosterPreference {
  id: string;
  employee_id?: string;
  employee_code?: string;
  first_name?: string;
  last_name?: string;
  preferred_shift_id?: string;
  shift_name?: string;
  preferred_week_off?: string;
  flexibility?: string;
  notes?: string;
  effective_from?: string;
  status?: string;
  rejection_reason?: string;
  created_at?: string;
}

interface SubmitForm {
  preferredShiftId: string;
  preferredWeekOff: string;
  flexibility: string;
  notes: string;
  effectiveFrom: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WEEK_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const FLEXIBILITY_OPTIONS: { value: string; label: string; description: string }[] = [
  { value: "fixed", label: "Fixed", description: "Same shift every week, no flexibility" },
  { value: "semi_flexible", label: "Semi-Flexible", description: "Occasional shift adjustments acceptable" },
  { value: "fully_flexible", label: "Fully Flexible", description: "Any shift assignment is acceptable" },
];

const EMPTY_FORM: SubmitForm = {
  preferredShiftId: "",
  preferredWeekOff: "",
  flexibility: "fixed",
  notes: "",
  effectiveFrom: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fullName(row: { first_name?: string; last_name?: string }): string {
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || "—";
}

function formatDate(str?: string): string {
  if (!str) return "—";
  try {
    return new Date(str).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return str;
  }
}

function StatusBadge({ status }: { status?: string }) {
  if (status === "approved") {
    return (
      <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
        Approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">
        Rejected
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
      Pending
    </Badge>
  );
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = "my-preferences" | "pending-approvals";

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NativeRosterPreference() {
  const [activeTab, setActiveTab] = useState<Tab>("my-preferences");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SubmitForm>(EMPTY_FORM);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdminOrHR, roleKeys } = useIsAdminOrHR();

  const isApprover =
    isAdminOrHR ||
    roleKeys.includes("manager") ||
    roleKeys.includes("wfm");

  // -- Queries -----------------------------------------------------------------

  const myPrefsQuery = useQuery({
    queryKey: ["roster-prefs-my"],
    queryFn: () =>
      hrmsApi
        .get<{ data: RosterPreference[] }>("/wfm/roster-preferences/my")
        .then((r) => r.data.data ?? []),
    enabled: activeTab === "my-preferences",
  });

  const pendingQuery = useQuery({
    queryKey: ["roster-prefs-pending"],
    queryFn: () =>
      hrmsApi
        .get<{ data: RosterPreference[] }>("/wfm/roster-preferences/pending")
        .then((r) => r.data.data ?? []),
    enabled: activeTab === "pending-approvals" && isApprover,
  });

  // -- Mutations ----------------------------------------------------------------

  const submitMutation = useMutation({
    mutationFn: (data: SubmitForm) =>
      hrmsApi.post("/api/wfm/roster-preferences", {
        preferredShiftId: data.preferredShiftId || undefined,
        preferredWeekOff: data.preferredWeekOff || undefined,
        flexibility: data.flexibility,
        notes: data.notes || undefined,
        effectiveFrom: data.effectiveFrom,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roster-prefs-my"] });
      setForm(EMPTY_FORM);
      setShowForm(false);
      toast({ title: "Roster preference submitted for approval." });
    },
    onError: (err: any) => {
      toast({
        title: "Submission failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      hrmsApi.patch(`/api/wfm/roster-preferences/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roster-prefs-pending"] });
      toast({ title: "Preference approved." });
    },
    onError: (err: any) => {
      toast({
        title: "Approval failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      hrmsApi.patch(`/api/wfm/roster-preferences/${id}/reject`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roster-prefs-pending"] });
      setRejectId(null);
      setRejectReason("");
      toast({ title: "Preference rejected." });
    },
    onError: (err: any) => {
      toast({
        title: "Rejection failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    },
  });

  // -- Render ------------------------------------------------------------------

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "my-preferences", label: "My Preferences", icon: <CalendarClock className="h-4 w-4" /> },
    ...(isApprover
      ? [{ key: "pending-approvals" as Tab, label: "Pending Approvals", icon: <CheckCircle2 className="h-4 w-4" /> }]
      : []),
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page header */}
        <div className="rounded-3xl bg-slate-950 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-blue-300">
            WFM
          </p>
          <h1 className="mt-2 text-3xl font-black">Roster Preferences</h1>
          <p className="mt-2 text-sm text-slate-300">
            Submit your shift and week-off preferences. Managers can review and
            approve submissions here.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 border-b border-slate-200 pb-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={[
                "flex items-center gap-2 rounded-t-xl border border-b-0 px-5 py-2.5 text-sm font-semibold transition",
                activeTab === t.key
                  ? "border-slate-200 bg-white text-slate-900 shadow-sm"
                  : "border-transparent text-slate-500 hover:text-slate-700",
              ].join(" ")}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: My Preferences */}
        {activeTab === "my-preferences" && (
          <div className="space-y-4">
            {/* Submit form toggle */}
            <div className="flex justify-end">
              <Button
                onClick={() => setShowForm((v) => !v)}
                className="bg-slate-950 hover:bg-slate-800 text-white"
              >
                <Plus className="h-4 w-4 mr-2" />
                {showForm ? "Cancel" : "New Preference Request"}
              </Button>
            </div>

            {/* Submit form */}
            {showForm && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-semibold">
                    Submit Roster Preference
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {/* Preferred Shift */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">
                        Preferred Shift ID{" "}
                        <span className="text-slate-400 font-normal">(optional)</span>
                      </label>
                      <Input
                        placeholder="Leave blank for no preference"
                        value={form.preferredShiftId}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, preferredShiftId: e.target.value }))
                        }
                        className="font-mono text-sm"
                      />
                      <p className="text-xs text-slate-400">
                        Enter a shift template UUID from the shift master.
                      </p>
                    </div>

                    {/* Preferred Week Off */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">
                        Preferred Week Off{" "}
                        <span className="text-slate-400 font-normal">(optional)</span>
                      </label>
                      <Select
                        value={form.preferredWeekOff}
                        onValueChange={(v) =>
                          setForm((f) => ({
                            ...f,
                            preferredWeekOff: v === "none" ? "" : v,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="No preference" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No preference</SelectItem>
                          {WEEK_DAYS.map((d) => (
                            <SelectItem key={d} value={d}>
                              {d}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Effective From */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">
                        Effective From <span className="text-red-500">*</span>
                      </label>
                      <Input
                        type="date"
                        value={form.effectiveFrom}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, effectiveFrom: e.target.value }))
                        }
                      />
                    </div>

                    {/* Flexibility */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">
                        Flexibility <span className="text-red-500">*</span>
                      </label>
                      <div className="flex flex-col gap-2 pt-1">
                        {FLEXIBILITY_OPTIONS.map((opt) => (
                          <label
                            key={opt.value}
                            className={[
                              "flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition",
                              form.flexibility === opt.value
                                ? "border-blue-500 bg-blue-50"
                                : "border-slate-200 hover:border-slate-300",
                            ].join(" ")}
                          >
                            <input
                              type="radio"
                              name="flexibility"
                              value={opt.value}
                              checked={form.flexibility === opt.value}
                              onChange={() =>
                                setForm((f) => ({ ...f, flexibility: opt.value }))
                              }
                              className="mt-0.5 accent-blue-600"
                            />
                            <div>
                              <p className="text-sm font-semibold text-slate-800">
                                {opt.label}
                              </p>
                              <p className="text-xs text-slate-500">
                                {opt.description}
                              </p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Notes */}
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-sm font-medium text-slate-700">
                        Notes{" "}
                        <span className="text-slate-400 font-normal">(optional)</span>
                      </label>
                      <textarea
                        rows={3}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        placeholder="Any additional context for your preference…"
                        value={form.notes}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, notes: e.target.value }))
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-5 flex justify-end gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowForm(false);
                        setForm(EMPTY_FORM);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => submitMutation.mutate(form)}
                      disabled={
                        submitMutation.isPending ||
                        !form.flexibility ||
                        !form.effectiveFrom
                      }
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {submitMutation.isPending ? "Submitting…" : "Submit Preference"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* History list */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  My Preference History
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    queryClient.invalidateQueries({ queryKey: ["roster-prefs-my"] })
                  }
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {myPrefsQuery.isLoading && (
                  <p className="text-sm text-slate-400 py-4 text-center">
                    Loading…
                  </p>
                )}
                {myPrefsQuery.isError && (
                  <p className="text-sm text-red-500 py-4 text-center">
                    Failed to load preferences.
                  </p>
                )}
                {myPrefsQuery.data && (
                  <Table className="smarthr-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Shift</TableHead>
                        <TableHead>Week Off</TableHead>
                        <TableHead>Flexibility</TableHead>
                        <TableHead>Effective From</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {myPrefsQuery.data.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="text-center text-slate-400 py-8"
                          >
                            No preferences submitted yet.
                          </TableCell>
                        </TableRow>
                      )}
                      {myPrefsQuery.data.map((pref) => (
                        <TableRow key={pref.id} className="hover:bg-gray-50 transition-colors">
                          <TableCell className="text-sm">
                            {pref.shift_name ?? (pref.preferred_shift_id ? (
                              <span className="font-mono text-xs text-slate-400">
                                {pref.preferred_shift_id.slice(0, 8)}…
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs">No preference</span>
                            ))}
                          </TableCell>
                          <TableCell className="text-sm">
                            {pref.preferred_week_off ?? (
                              <span className="text-slate-400 text-xs">No preference</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">
                              {(pref.flexibility ?? "—").replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">
                            {formatDate(pref.effective_from)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={pref.status} />
                          </TableCell>
                          <TableCell className="text-xs text-slate-500 max-w-[200px] truncate">
                            {pref.notes || (pref.rejection_reason ? (
                              <span className="text-red-500">
                                {pref.rejection_reason}
                              </span>
                            ) : "—")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tab: Pending Approvals */}
        {activeTab === "pending-approvals" && isApprover && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Pending Approval Requests
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  queryClient.invalidateQueries({ queryKey: ["roster-prefs-pending"] })
                }
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {pendingQuery.isLoading && (
                <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
              )}
              {pendingQuery.isError && (
                <p className="text-sm text-red-500 py-4 text-center">
                  Failed to load pending preferences.
                </p>
              )}

              {/* Inline reject reason input */}
              {rejectId && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex flex-col gap-3">
                  <p className="text-sm font-semibold text-red-700">
                    Rejection Reason
                  </p>
                  <Input
                    placeholder="Enter reason for rejection…"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    className="bg-white"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-red-600 hover:bg-red-700 text-white"
                      disabled={rejectMutation.isPending || !rejectReason.trim()}
                      onClick={() =>
                        rejectMutation.mutate({
                          id: rejectId,
                          reason: rejectReason.trim(),
                        })
                      }
                    >
                      Confirm Rejection
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRejectId(null);
                        setRejectReason("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {pendingQuery.data && (
                <Table className="smarthr-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Shift Preference</TableHead>
                      <TableHead>Week Off</TableHead>
                      <TableHead>Flexibility</TableHead>
                      <TableHead>Effective From</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingQuery.data.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="text-center text-slate-400 py-8"
                        >
                          No pending preference requests.
                        </TableCell>
                      </TableRow>
                    )}
                    {pendingQuery.data.map((pref) => (
                      <TableRow key={pref.id} className="hover:bg-gray-50 transition-colors">
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">
                              {fullName(pref)}
                            </span>
                            {pref.employee_code && (
                              <span className="font-mono text-xs text-slate-400">
                                {pref.employee_code}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {pref.shift_name ?? (pref.preferred_shift_id ? (
                            <span className="font-mono text-xs text-slate-400">
                              {pref.preferred_shift_id.slice(0, 8)}…
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">Any</span>
                          ))}
                        </TableCell>
                        <TableCell className="text-sm">
                          {pref.preferred_week_off ?? (
                            <span className="text-slate-400 text-xs">Any</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">
                            {(pref.flexibility ?? "—").replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {formatDate(pref.effective_from)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500 max-w-[160px] truncate">
                          {pref.notes || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={approveMutation.isPending}
                              onClick={() => approveMutation.mutate(pref.id)}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-300 text-red-600 hover:bg-red-50"
                              onClick={() => {
                                setRejectId(pref.id);
                                setRejectReason("");
                              }}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              Reject
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
