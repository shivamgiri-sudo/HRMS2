// Shapes returned by /api/wfm/roster-upload-tracker (backend: roster-upload-tracker.service.ts).

export type UploadStatus = "uploaded" | "delayed" | "partial" | "missing" | "due";

export const STATUS_ORDER: readonly UploadStatus[] = ["uploaded", "delayed", "partial", "missing", "due"];

export interface PersonRef {
  userId: string | null;
  employeeId: string | null;
  name: string;
}

export interface TrackerCell {
  weekStart: string;
  status: UploadStatus;
  expected: number;
  covered: number;
  uploadedAtMs: number | null;
  hoursLate: number | null;
  hoursToDeadline: number | null;
}

export interface TrackerProcessRow {
  branchId: string;
  branchName: string;
  processId: string;
  processName: string;
  managers: PersonRef[];
  cells: TrackerCell[];
}

export interface TrackerBranch {
  branchId: string;
  branchName: string;
  wfm: PersonRef[];
  processes: TrackerProcessRow[];
}

export interface TrackerWeek {
  weekStart: string;
  deadlineAtMs: number;
  isCurrent: boolean;
  counts: Record<UploadStatus, number>;
}

export interface TrackerResponse {
  nowMs: number;
  weeks: TrackerWeek[];
  branches: TrackerBranch[];
  filters: {
    branches: { id: string; name: string }[];
    processes: { id: string; name: string; branchId: string }[];
    managers: { id: string; name: string }[];
  };
  summary: { currentWeek: Record<UploadStatus, number>; nextWeek: Record<UploadStatus, number> };
}

export interface AlertTrailEntry {
  stage: string;
  recipientName: string | null;
  recipientRole: string;
  sentAtMs: number;
}

export interface CellDetail {
  branchId: string;
  branchName: string;
  processId: string;
  processName: string;
  weekStart: string;
  deadlineAtMs: number;
  cell: TrackerCell;
  managers: PersonRef[];
  wfm: PersonRef[];
  skipLevel: PersonRef[];
  batches: {
    id: number;
    status: string;
    fileName: string | null;
    scope: "branch" | "process";
    uploadedBy: string | null;
    createdAtMs: number;
    committedAtMs: number | null;
    totalRows: number;
  }[];
  uncoveredEmployees: { id: string; code: string; name: string }[];
  uncoveredTotal: number;
  trail: AlertTrailEntry[];
}

export interface TrackerFilters {
  branchId: string;
  processId: string;
  managerId: string;
  status: UploadStatus | "all";
  offset: number;
}
