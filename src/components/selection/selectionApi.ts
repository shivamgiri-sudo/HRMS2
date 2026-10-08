// The selection API as the screens call it. Every read carries the caller's permissions; the server enforces them too.
import { hrmsApi } from "@/lib/hrmsApi";
import type { RunPerson } from "./approvalModel";
import type {
  ApprovalState, BulkRow, CriteriaPatch, CriteriaResponse, Permissions, PreviewResult, RequisitionItem, SaveResult, SourceKind, SubSource, WhyNotPerson,
} from "./selectionTypes";

type Env<T> = { success: boolean; data: T };
const R = "/api/job-requisition";
const enc = encodeURIComponent;

export const selectionApi = {
  list: (onlyIncomplete = false) => hrmsApi.get<Env<{ items: RequisitionItem[]; permissions: Permissions }>>(`${R}/selection/requisitions${onlyIncomplete ? "?onlyIncomplete=1" : ""}`).then((r) => r.data),
  campaign: (campaignId: string) => hrmsApi.get<Env<{ items: RequisitionItem[]; permissions: Permissions }>>(`${R}/selection/campaign/${enc(campaignId)}/requisitions`).then((r) => r.data),
  criteria: (id: string) => hrmsApi.get<Env<CriteriaResponse>>(`${R}/${enc(id)}/criteria`).then((r) => r.data),
  save: (id: string, patch: CriteriaPatch, reason: string | null, dryRun = false) => hrmsApi.put<Env<SaveResult>>(`${R}/${enc(id)}/criteria`, { patch, reason, dryRun }).then((r) => r.data),
  templates: () => hrmsApi.get<Env<Array<{ id: string; version: number; label: string }>>>(`${R}/criteria/templates`).then((r) => r.data),
  applyTemplate: (id: string, templateId: string, replaceFilled: boolean, reason: string | null, dryRun: boolean) =>
    hrmsApi.post<Env<SaveResult & { skipped: string[] }>>(`${R}/${enc(id)}/criteria/template`, { templateId, replaceFilled, reason, dryRun }).then((r) => r.data),
  bulk: (requisitionIds: string[], patch: CriteriaPatch, replaceFilled: boolean, reason: string | null, dryRun: boolean) =>
    hrmsApi.post<Env<BulkRow[]>>(`${R}/criteria/bulk`, { requisitionIds, patch, replaceFilled, reason, dryRun }).then((r) => r.data),
  copy: (fromRequisitionId: string, toRequisitionIds: string[], keys: string[] | "all", replaceFilled: boolean, reason: string | null, dryRun: boolean) =>
    hrmsApi.post<Env<BulkRow[]>>(`${R}/criteria/copy`, { fromRequisitionId, toRequisitionIds, keys, replaceFilled, reason, dryRun }).then((r) => r.data),
  preview: (id: string, source: SourceKind, sub: SubSource | "all", draft?: CriteriaPatch | null) => (draft
    ? hrmsApi.post<Env<PreviewResult>>(`${R}/${enc(id)}/selection/preview`, { source, sub, draft }) : hrmsApi.get<Env<PreviewResult>>(`${R}/${enc(id)}/selection/preview?source=${source}&sub=${sub}`)).then((r) => r.data),
  csvPath: (id: string, source: SourceKind, sub: SubSource | "all") => `${R}/${enc(id)}/selection/preview.csv?source=${source}&sub=${sub}`,
  why: (q: string, requisitionId?: string) => hrmsApi.get<Env<WhyNotPerson[]>>(`${R}/selection/why?q=${enc(q)}${requisitionId ? `&requisitionId=${enc(requisitionId)}` : ""}`).then((r) => r.data),
  setOverride: (mobile: string, requisitionScope: string, kind: "include" | "exclude", reason: string) =>
    hrmsApi.put<Env<{ warning: string | null }>>("/api/he/shortlist/override", { mobile, requisitionScope, kind, reason }).then((r) => r.data),
  removeOverride: (mobile: string, requisitionScope: string, reason: string) => hrmsApi.delete("/api/he/shortlist/override", { data: { mobile, requisitionScope, reason } }),
  approvalState: (requisitionId: string, sourceKind: SourceKind) =>
    hrmsApi.get<Env<ApprovalState>>(`/api/he/shortlist/approval-state?requisitionId=${enc(requisitionId)}&sourceKind=${sourceKind}`).then((r) => r.data),
  run: (requisitionId: string, sourceKind: SourceKind) => hrmsApi.post<Env<{ runId: string }>>("/api/he/shortlist/run", { requisitionId, sourceKind }).then((r) => r.data),
  runPeople: (runId: string) => hrmsApi.get<Env<{ requisitionId: string; items: RunPerson[] }>>(`/api/he/shortlist/run/${enc(runId)}/candidates`).then((r) => r.data),
  /** Unticks and review approvals travel as row ids of the run; the screen never holds full mobiles. */
  approve: (requisitionId: string, sourceKind: SourceKind, runId: string, untickIds: string[], approveReviewIds: string[], note: string | null) =>
    hrmsApi.post<Env<{ approved: number }>>("/api/he/shortlist/approve", { requisitionId, sourceKind, runId, untickIds, approveReviewIds, note }).then((r) => r.data),
  approveStanding: (requisitionId: string, versionId: string, days: number) => hrmsApi.post<Env<{ validUntil: string }>>("/api/he/shortlist/approve-standing", { requisitionId, versionId, days }).then((r) => r.data),
  revokeStanding: (id: string) => hrmsApi.delete(`/api/he/shortlist/approve-standing/${enc(id)}`),
  bookedMismatch: (requisitionId: string) => hrmsApi.get<Env<Array<{ followupId: string; maskedMobile: string; firstName: string; verdict: string; slotAt: string; matchState: string }>>>(`/api/he/shortlist/booked-mismatch?requisitionId=${enc(requisitionId)}`).then((r) => r.data),
  releaseHeld: (followupId: string, reason: string) => hrmsApi.post("/api/he/shortlist/release-held", { followupId, reason }),
};
