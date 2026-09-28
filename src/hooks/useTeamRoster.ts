import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { CellType, TemplateProcess } from "@/components/wfm/team-roster/teamRosterFormat";

const BASE = "/api/wfm/team-roster";
export const TEAM_ROSTER_KEY = ["wfm", "team-roster"] as const;

const unwrap = <T,>(res: unknown): T => (res && typeof res === "object" && "data" in res ? (res as { data: T }).data : (res as T));

function qs(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ── types ────────────────────────────────────────────────────────────────────

export interface TeamRosterMe {
  employee: { id: string; code: string | null; name: string } | null;
  isManager: boolean;
  teamSize: number;
  teamTruncated: boolean;
  hasReportingManager: boolean;
  canApproveManagerStep: boolean;
  canApproveWfmStep: boolean;
  today: string;
  maxRangeDays: number;
}

export interface GridCell {
  assignment?: {
    id: string; type: string | null; isWeekOff: boolean; shiftTemplateId: string | null; shiftCode: string | null;
    shiftName: string | null; start: string | null; end: string | null; finalStatus: string | null;
  };
  leave?: "FULL" | "HALF";
  lockedBy?: { submissionId: number; submissionNo: string | null; status: string; submitter: string };
  draft?: { kind: "FILL_BLANK" | "CHANGE"; type: CellType; shiftTemplateId: string | null; shiftStart: string | null; shiftEnd: string | null; reason: string | null };
}

export interface GridRow {
  employeeId: string; code: string | null; name: string; processId: string | null; processName: string | null; lobId?: string | null; lobName?: string | null;
  cells: Record<string, GridCell>;
}

export interface GridResponse {
  from: string; to: string; today: string; dates: string[]; total: number; offset: number; limit: number;
  teamTruncated: boolean; rows: GridRow[];
}

export interface DraftLine { employeeId: string; date: string; kind: string; type: CellType; shiftTemplateId: string | null; shiftStart: string | null; shiftEnd: string | null; reason: string | null }
export interface DraftResponse { draft: { id: number; note: string | null; createdAt: string; lines: DraftLine[] } | null }

export interface LineUpsert {
  employeeId: string; date: string; type: CellType; shiftStart?: string | null; shiftEnd?: string | null;
  shiftTemplateId?: string | null; shiftMasterId?: string | null; reason?: string | null;
}
export interface CellRef { employeeId: string; date: string }

export interface SubmissionListItem {
  id: number; submissionNo: string | null; status: string; from: string | null; to: string | null;
  submittedAt: string | null; appliedAt: string | null; submitter: { code: string | null; name: string };
  managerApprover: string | null; lineCount: number; appliedCount: number; warningCount: number;
}
export interface SubmissionList { items: SubmissionListItem[]; total: number; offset: number; limit: number }

export interface SubmissionDetail {
  submission: {
    id: number; submissionNo: string | null; status: string; from: string | null; to: string | null; note: string | null;
    submitter: { id: string; code: string | null; name: string };
    managerApprover: { id: string; name: string } | null; managerStepSkipped: boolean;
    managerDecision: { decision: string; at: string | null; remarks: string | null } | null;
    wfmDecision: { decision: string; at: string | null; remarks: string | null } | null;
    createdAt: string | null; submittedAt: string | null; appliedAt: string | null;
  };
  lines: Array<{
    id: number; employeeId: string; employeeCode: string | null; employeeName: string; lobName?: string | null; date: string; kind: "FILL_BLANK" | "CHANGE";
    old: { type: string | null; label: string | null } | null; new: { type: string; label: string | null };
    reason: string | null; warnings: string[]; status: string; skipReason: string | null; appliedAssignmentId: string | null;
  }>;
  summary: { total: number; applied: number; skipped: number; failed: number; pending: number; withWarnings: number };
  timeline: Array<{ action: string; actorName: string | null; actorRole: string | null; remarks: string | null; at: string; meta: unknown }>;
  permissions: { canCancel: boolean; canManagerDecide: boolean; canWfmDecide: boolean; canCopyToDraft: boolean };
}

export interface AttendanceTotals {
  present: number; absent: number; onDuty: number; halfDay: number; leave: number; holiday: number; weekOff: number; totalWorkingDays: number;
}
export interface AttendanceLegendItem { code: string; label: string }
export interface TeamAttendanceRow {
  employeeId: string | null; code: string | null; name: string; designation: string | null; processName: string | null; lobName?: string | null;
  days: string[]; regularizedDays: number[]; totals: AttendanceTotals;
}
export interface TeamAttendanceResponse {
  month: string; daysInMonth: number; dates: string[]; legend: AttendanceLegendItem[]; notes: string[];
  total: number; offset: number; limit: number; teamTruncated: boolean; rows: TeamAttendanceRow[];
}
export interface TeamAttendanceDetail {
  month: string; daysInMonth: number; legend: AttendanceLegendItem[]; notes: string[];
  employee: { employeeId: string; code: string | null; name: string; designation: string | null; processName: string | null };
  totals: AttendanceTotals;
  days: Array<{ date: string; day: number; weekday: string; code: string; regularized: boolean }>;
}

// ── queries ──────────────────────────────────────────────────────────────────

export const meKey = [...TEAM_ROSTER_KEY, "me"] as const;
export const templatesKey = [...TEAM_ROSTER_KEY, "templates"] as const;
export const draftKey = [...TEAM_ROSTER_KEY, "draft"] as const;
export const gridKey = (f: { from: string; to: string; search: string; offset: number; limit: number; lobId?: string; processId?: string }) => [...TEAM_ROSTER_KEY, "grid", f] as const;
export const submissionsKey = (status: string, offset: number) => [...TEAM_ROSTER_KEY, "submissions", status, offset] as const;
export const approvalsKey = (step: string, offset: number) => [...TEAM_ROSTER_KEY, "approvals", step, offset] as const;
export const detailKey = (id: number | null) => [...TEAM_ROSTER_KEY, "detail", id] as const;
export const attendanceKey = (f: { month: string; search: string; offset: number; limit: number; lobId?: string; processId?: string }) => [...TEAM_ROSTER_KEY, "attendance", f] as const;
export const attendanceDetailKey = (employeeId: string | null, month: string) => [...TEAM_ROSTER_KEY, "attendance-detail", employeeId, month] as const;

export const useTeamRosterMe = () =>
  useQuery({ queryKey: meKey, queryFn: async () => unwrap<TeamRosterMe>(await hrmsApi.get(`${BASE}/me`)), staleTime: 60_000 });

export const useTeamRosterTemplates = (enabled: boolean) =>
  useQuery({ queryKey: templatesKey, enabled, staleTime: 5 * 60_000, queryFn: async () => unwrap<{ processes: TemplateProcess[] }>(await hrmsApi.get(`${BASE}/templates`)) });

export const useTeamRosterGrid = (f: { from: string; to: string; search: string; offset: number; limit: number; lobId?: string; processId?: string }, enabled: boolean) =>
  useQuery({
    queryKey: gridKey(f), enabled, placeholderData: keepPreviousData,
    queryFn: async () => unwrap<GridResponse>(await hrmsApi.get(`${BASE}/grid${qs(f)}`)),
  });

export const useTeamRosterDraft = (enabled: boolean) =>
  useQuery({ queryKey: draftKey, enabled, queryFn: async () => unwrap<DraftResponse>(await hrmsApi.get(`${BASE}/draft`)) });

export const useMySubmissions = (status: string, offset: number, enabled = true) =>
  useQuery({
    queryKey: submissionsKey(status, offset), enabled, placeholderData: keepPreviousData,
    queryFn: async () => unwrap<SubmissionList>(await hrmsApi.get(`${BASE}/submissions${qs({ status: status === "all" ? undefined : status, offset, limit: 25 })}`)),
  });

export const useApprovals = (step: "manager" | "wfm", offset: number, enabled: boolean) =>
  useQuery({
    queryKey: approvalsKey(step, offset), enabled, placeholderData: keepPreviousData,
    queryFn: async () => unwrap<SubmissionList>(await hrmsApi.get(`${BASE}/approvals${qs({ step, offset, limit: 25 })}`)),
  });

export const useSubmissionDetail = (id: number | null) =>
  useQuery({ queryKey: detailKey(id), enabled: id !== null, queryFn: async () => unwrap<SubmissionDetail>(await hrmsApi.get(`${BASE}/submissions/${id}`)) });

export const useTeamAttendance = (f: { month: string; search: string; offset: number; limit: number; lobId?: string; processId?: string }, enabled: boolean) =>
  useQuery({
    queryKey: attendanceKey(f), enabled, placeholderData: keepPreviousData, staleTime: 60_000,
    queryFn: async () => unwrap<TeamAttendanceResponse>(await hrmsApi.get(`${BASE}/attendance${qs(f)}`)),
  });

export const useTeamAttendanceDetail = (employeeId: string | null, month: string) =>
  useQuery({
    queryKey: attendanceDetailKey(employeeId, month), enabled: employeeId !== null, staleTime: 60_000,
    queryFn: async () => unwrap<TeamAttendanceDetail>(await hrmsApi.get(`${BASE}/attendance/${employeeId}${qs({ month })}`)),
  });

// ── mutations ────────────────────────────────────────────────────────────────

export function useSaveDraftLines() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { upserts: LineUpsert[]; deletes: CellRef[] }) =>
      unwrap<{ draftId: number; lineCount: number; from: string | null; to: string | null }>(await hrmsApi.put(`${BASE}/draft/lines`, body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM_ROSTER_KEY }),
  });
}

export function useAutofillSuggestions() {
  return useMutation({
    mutationFn: async (body: { from: string; to: string; mode: "usual" | "copy_last_week"; employeeIds: string[] }) =>
      unwrap<{ suggestions: Array<{ employeeId: string; date: string; type: CellType; shiftStart: string | null; shiftEnd: string | null }>; employeesWithoutHistory: number }>(await hrmsApi.post(`${BASE}/autofill`, body)),
  });
}

export function useDiscardDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap<{ discarded: boolean }>(await hrmsApi.delete(`${BASE}/draft`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM_ROSTER_KEY }),
  });
}

export function useSubmitDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (note: string | null) =>
      unwrap<{ submissionId: number; submissionNo: string; status: string; managerStepSkipped: boolean; lineCount: number }>(await hrmsApi.post(`${BASE}/draft/submit`, { note })),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM_ROSTER_KEY }),
  });
}

export type SubmissionAction = "cancel" | "copy-to-draft" | "manager-approve" | "manager-reject" | "wfm-approve" | "wfm-reject";

export function useSubmissionAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: number; action: SubmissionAction; remarks?: string }) =>
      unwrap<Record<string, unknown>>(await hrmsApi.post(`${BASE}/submissions/${v.id}/${v.action}`, v.remarks ? { remarks: v.remarks } : {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM_ROSTER_KEY }),
  });
}
