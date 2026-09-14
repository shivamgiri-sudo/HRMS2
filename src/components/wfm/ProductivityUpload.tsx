/**
 * WFM manual dialler-productivity upload (requirements.md Requirement 17), rendered as the third
 * tab of the existing Bulk Upload Hub (`/bulk-upload`). No route of its own — the grant it is
 * gated on, WFM_PRODUCTIVITY_UPLOAD, is a section-level permission inside that page (see
 * backend/sql/1639_wfm_productivity_upload_page_access.sql).
 *
 * Drives three already-tested endpoints, unchanged by this file:
 *   GET  /api/wfm/productivity-upload/sources
 *   POST /api/wfm/productivity-upload/preview
 *   POST /api/wfm/productivity-upload/commit
 *
 * SHAPE OF THIS FILE
 * The presentational panels and every decision the flow makes are exported as small pure units,
 * and the container is a thin shell over them. That is not decoration: vitest.config.ts runs
 * frontend tests under `environment: "node"` and neither jsdom nor @testing-library/react is
 * installed in this repo, so there is no click to simulate. Logic that lives inside a closure in
 * a component here is logic that cannot be tested at all. Splitting it out is what makes
 * "Commit stays disabled until the previewed set is the set being written" an assertion rather
 * than a claim.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileWarning,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { apiUrl } from "@/lib/apiBase";
import { getAuthToken } from "@/lib/hrmsApi";
import { useBranches, useProcesses } from "@/hooks/useOrgMasters";
import { filterByScope, useWfmScopeFilter } from "@/hooks/useWfmScopeFilter";

/** The role_page_access grant this tab is gated on. Registered by migration 1639. */
export const PRODUCTIVITY_UPLOAD_PAGE_CODE = "WFM_PRODUCTIVITY_UPLOAD";

const API_ROOT = "/api/wfm/productivity-upload";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Contracts, copied from the route (backend/src/modules/wfm/productivity-upload.routes.ts)
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface DiallerSourceOption {
  diallerSourceId: string;
  sourceCode: string;
  displayName: string;
  sourceType: string;
  /** null when this source has no usable Column_Mapping row yet. Uploads are impossible until it has one. */
  columnMappings: Record<string, string> | null;
  mappingVersion: number | null;
}

export interface PreviewAcceptedRow {
  rowNumber: number;
  employeeId: string;
  employeeCode: string;
  reportDate: string;
  loginMinutes: number;
  callsHandled?: number | null;
  ahtSeconds?: number | null;
  bioMinutes?: number | null;
  lunchMinutes?: number | null;
  qaMinutes?: number | null;
  trainingMinutes?: number | null;
}

export interface PreviewRejectedRow {
  rowNumber: number;
  employeeCode: string;
  reason: string;
}

export interface UploadFields {
  diallerSourceId: string;
  branchId: string;
  processId: string;
  /** YYYY-MM-DD */
  dateFrom: string;
  /** YYYY-MM-DD */
  dateTo: string;
}

export const EMPTY_UPLOAD_FIELDS: UploadFields = {
  diallerSourceId: "",
  branchId: "",
  processId: "",
  dateFrom: "",
  dateTo: "",
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Preview-approval identity
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Identifies the exact submission a human approved on the preview screen.
 *
 * /preview and /commit are stateless — /commit re-parses the file and re-runs every check rather
 * than reading a stored pending batch. So nothing on the server can tell that the file or the
 * declared window changed between the two calls: swap the file after previewing and /commit will
 * happily write rows nobody ever looked at. This fingerprint is what closes that: Commit is
 * enabled only while the current form + file still hash to the fingerprint that produced the
 * displayed preview.
 *
 * The file contributes name, size and lastModified rather than its bytes. Reading the whole file
 * to hash it would be the stronger check, but it is async and would have to run on every
 * keystroke; name+size+lastModified changes for any re-export or re-save from a spreadsheet,
 * which is how a file actually changes here. A file swapped for a different one of byte-identical
 * length, name and timestamp is the residual gap, and the server's own duplicate-submission guard
 * (409, on a sha256 of the bytes) is what catches that case.
 */
export function submissionFingerprint(fields: UploadFields, file: File | null): string {
  const filePart = file ? `${file.name}\u0000${file.size}\u0000${file.lastModified}` : "\u0000no-file";
  return [
    fields.diallerSourceId,
    fields.branchId,
    fields.processId,
    fields.dateFrom,
    fields.dateTo,
    filePart,
  ].join("\u001f");
}

export interface GateInput {
  source: DiallerSourceOption | null;
  fields: UploadFields;
  file: File | null;
  /** Fingerprint of the submission whose preview is currently on screen, or null if none is. */
  approvedFingerprint: string | null;
  busy: boolean;
}

export interface GateState {
  canPreview: boolean;
  canCommit: boolean;
  /** Plain-language reason Commit is unavailable, for display next to the button. null when it is available. */
  blockedReason: string | null;
}

/**
 * The single source of truth for whether Preview and Commit may run.
 *
 * Both buttons read this, so they cannot disagree, and the reason is returned as text rather than
 * left implicit in a `disabled` attribute — a greyed-out button that does not say why is the
 * usual way this kind of screen wastes someone's afternoon (and conveying the state by colour
 * alone would not be readable to everyone in any case).
 */
export function commitGateState(input: GateInput): GateState {
  const { source, fields, file, approvedFingerprint, busy } = input;

  if (busy) {
    return { canPreview: false, canCommit: false, blockedReason: "A request is in flight." };
  }
  if (!source) {
    return { canPreview: false, canCommit: false, blockedReason: "Choose a dialler source." };
  }
  if (source.columnMappings === null) {
    return {
      canPreview: false,
      canCommit: false,
      blockedReason: `${source.displayName} has no column mapping configured, so no file can be read for it yet.`,
    };
  }
  const missing: string[] = [];
  if (!fields.branchId) missing.push("branch");
  if (!fields.processId) missing.push("process");
  if (!fields.dateFrom) missing.push("date from");
  if (!fields.dateTo) missing.push("date to");
  if (!file) missing.push("CSV file");
  if (missing.length > 0) {
    return {
      canPreview: false,
      canCommit: false,
      blockedReason: `Still needed: ${missing.join(", ")}.`,
    };
  }
  if (fields.dateFrom > fields.dateTo) {
    return {
      canPreview: false,
      canCommit: false,
      blockedReason: "Date from must not be after date to.",
    };
  }

  const current = submissionFingerprint(fields, file);
  if (approvedFingerprint === null) {
    return {
      canPreview: true,
      canCommit: false,
      blockedReason: "Run Preview first — commit writes only a set that has been previewed.",
    };
  }
  if (approvedFingerprint !== current) {
    return {
      canPreview: true,
      canCommit: false,
      blockedReason:
        "The file or a field changed after the last preview. Preview again so the set you approve is the set that gets written.",
    };
  }
  return { canPreview: true, canCommit: true, blockedReason: null };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Request building and response classification
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface SubmitArgs {
  file: File;
  fields: UploadFields;
  columnMappings: Record<string, string>;
  /** Sent on /commit only. The selected source's mappingVersion, so the batch's audit trail names the mapping actually used. */
  mappingVersionUsed?: number | null;
  /** Sent on /commit only, and only to force a declared re-upload past the duplicate guard. */
  supersedesBatchId?: string | null;
}

export function buildUploadFormData(args: SubmitArgs): FormData {
  const fd = new FormData();
  fd.append("file", args.file, args.file.name);
  fd.append("diallerSourceId", args.fields.diallerSourceId);
  fd.append("branchId", args.fields.branchId);
  fd.append("processId", args.fields.processId);
  fd.append("dateFrom", args.fields.dateFrom);
  fd.append("dateTo", args.fields.dateTo);
  fd.append("columnMappings", JSON.stringify(args.columnMappings));
  if (typeof args.mappingVersionUsed === "number" && Number.isFinite(args.mappingVersionUsed)) {
    fd.append("mappingVersionUsed", String(args.mappingVersionUsed));
  }
  if (args.supersedesBatchId) {
    fd.append("supersedesBatchId", args.supersedesBatchId);
  }
  return fd;
}

export type PreviewOutcome =
  | { kind: "previewed"; accepted: PreviewAcceptedRow[]; rejected: PreviewRejectedRow[] }
  | { kind: "refused"; message: string };

export function classifyPreviewResponse(status: number, body: unknown): PreviewOutcome {
  const b = (body ?? {}) as Record<string, unknown>;
  if (status === 200 && b.success === true) {
    return {
      kind: "previewed",
      accepted: Array.isArray(b.accepted) ? (b.accepted as PreviewAcceptedRow[]) : [],
      rejected: Array.isArray(b.rejected) ? (b.rejected as PreviewRejectedRow[]) : [],
    };
  }
  return { kind: "refused", message: serverMessage(b, "The preview could not be produced.") };
}

export type CommitOutcome =
  | {
      kind: "committed";
      batchId: string;
      batchReference: string;
      acceptedCount: number;
      rejectedCount: number;
    }
  | {
      /** HTTP 207. Some rows did not land. Never reported as a success. */
      kind: "partial";
      batchId: string;
      batchReference: string;
      acceptedCount: number;
      rejectedCount: number;
      writeErrors: string[];
    }
  | {
      /** 200 with success:false — every row was rejected, so nothing was contributed. */
      kind: "nothing_written";
      rejectedCount: number;
    }
  | { kind: "duplicate"; message: string; priorBatchId: string | null }
  | { kind: "refused"; message: string };

function serverMessage(body: Record<string, unknown>, fallback: string): string {
  const message = body.message ?? body.error;
  return typeof message === "string" && message.trim() !== "" ? message : fallback;
}

/**
 * commitUploadBatch returns `writeErrors: string[]` — each entry already written for a human and
 * already naming the affected row range. They are shown verbatim rather than summarised. Anything
 * that is not a string is stringified rather than dropped: losing a partial-write warning is a
 * far worse outcome than showing an ugly one.
 */
function writeErrorLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)));
}

/**
 * Turns a /commit response into exactly one outcome.
 *
 * 207 is the case worth spelling out: the body carries a batchId and an acceptedCount, so it
 * reads like a success at a glance, and treating it as one would tell an uploader their rows are
 * in when some of them are not. It is classified as `partial` before anything reads the counts,
 * and the panel below renders it in the failure register with the writeErrors listed.
 *
 * A 200 whose `success` is false is the "everything was rejected" case the route documents:
 * nothing was written, so it is not reported as a commit either.
 */
export function classifyCommitResponse(status: number, body: unknown): CommitOutcome {
  const b = (body ?? {}) as Record<string, unknown>;

  if (status === 409) {
    return {
      kind: "duplicate",
      message: serverMessage(b, "An identical file was already committed for this source, branch and process."),
      priorBatchId: typeof b.priorBatchId === "string" && b.priorBatchId !== "" ? b.priorBatchId : null,
    };
  }

  const writeErrors = writeErrorLines(b.writeErrors);
  const acceptedCount = Number(b.acceptedCount) || 0;
  const rejectedCount = Number(b.rejectedCount) || 0;

  if (status === 207 || writeErrors.length > 0) {
    return {
      kind: "partial",
      batchId: String(b.batchId ?? ""),
      batchReference: String(b.batchReference ?? ""),
      acceptedCount,
      rejectedCount,
      writeErrors:
        writeErrors.length > 0
          ? writeErrors
          : ["The server reported a partial write but listed no specific errors."],
    };
  }

  if (status === 200 && b.success === true) {
    return {
      kind: "committed",
      batchId: String(b.batchId ?? ""),
      batchReference: String(b.batchReference ?? ""),
      acceptedCount,
      rejectedCount,
    };
  }

  if (status === 200) {
    // The route answers 200/success:false when acceptedCount is 0 — the file parsed, but every
    // row was rejected, so no productivity row exists as a result of this commit.
    return { kind: "nothing_written", rejectedCount };
  }

  return { kind: "refused", message: serverMessage(b, "The commit was refused.") };
}

async function postMultipart(path: string, body: FormData): Promise<{ status: number; body: unknown }> {
  const response = await fetch(apiUrl(`${API_ROOT}${path}`), {
    method: "POST",
    // Content-Type is deliberately not set: the browser must add the multipart boundary itself.
    headers: { Authorization: `Bearer ${getAuthToken() ?? ""}` },
    body,
  });
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

export async function submitPreview(args: SubmitArgs): Promise<PreviewOutcome> {
  const { status, body } = await postMultipart(
    "/preview",
    buildUploadFormData({ ...args, mappingVersionUsed: null, supersedesBatchId: null }),
  );
  return classifyPreviewResponse(status, body);
}

export async function submitCommit(args: SubmitArgs): Promise<CommitOutcome> {
  const { status, body } = await postMultipart("/commit", buildUploadFormData(args));
  return classifyCommitResponse(status, body);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Tab visibility
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Whether the Bulk Upload Hub may show this tab, and whether it may ever be the active tab.
 *
 * `isResolved` is not redundant with `canViewPage`. useWorkforceAccess().canViewPage returns
 * false for every page code until /api/access/me has answered (its own doc comment says so), so
 * a caller that only asked canViewPage would hide the tab on the first render for users who do
 * hold the grant, then pop it in — and, worse, would be indistinguishable from a real denial.
 * Both flags are required so the caller can hold off rather than guess.
 */
export function canUseProductivityTab(access: {
  isResolved: boolean;
  canViewPage: (pageCode: string) => boolean;
}): boolean {
  return access.isResolved && access.canViewPage(PRODUCTIVITY_UPLOAD_PAGE_CODE);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Presentational panels — exported so they can be rendered and asserted on directly
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function SourceMappingBlockedNotice({ source }: { source: DiallerSourceOption }) {
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
      <div className="space-y-1 text-sm text-amber-900">
        <p className="font-semibold">
          No column mapping is configured for {source.displayName} ({source.sourceCode}).
        </p>
        <p>
          Uploads for this source cannot be accepted until a column mapping is configured for it,
          because nothing tells the system which CSV column holds the employee code, the date or
          the login minutes. This screen cannot configure it. Ask whoever administers dialler
          sources to add a mapping, then come back.
        </p>
      </div>
    </div>
  );
}

export function PreviewResultPanel({
  accepted,
  rejected,
}: {
  accepted: PreviewAcceptedRow[];
  rejected: PreviewRejectedRow[];
}) {
  const nothingAccepted = accepted.length === 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Badge className="gap-1 bg-emerald-100 text-emerald-800">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {accepted.length} row(s) would be
          written
        </Badge>
        <Badge className="gap-1 bg-rose-100 text-rose-800">
          <XCircle className="h-3 w-3" aria-hidden="true" /> {rejected.length} row(s) rejected
        </Badge>
      </div>

      {nothingAccepted && (
        <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Every row was rejected, so committing this file would write nothing. Fix the rows
            listed below and preview again.
          </span>
        </div>
      )}

      {accepted.length > 0 && (
        <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <caption className="sr-only">Rows that would be written by a commit</caption>
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">Row</th>
                <th scope="col" className="px-3 py-2 text-left">Employee code</th>
                <th scope="col" className="px-3 py-2 text-left">Report date</th>
                <th scope="col" className="px-3 py-2 text-left">Login minutes</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {accepted.map((row) => (
                <tr key={`accepted-${row.rowNumber}`} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{row.rowNumber}</td>
                  <td className="px-3 py-1.5">{row.employeeCode}</td>
                  <td className="px-3 py-1.5">{row.reportDate}</td>
                  <td className="px-3 py-1.5">{row.loginMinutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="max-h-64 overflow-auto rounded-lg border border-rose-200 bg-rose-50">
          <table className="w-full text-xs">
            <caption className="px-3 py-2 text-left text-xs font-semibold text-rose-800">
              Rejected rows — these will not be written
            </caption>
            <thead className="text-rose-700">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">Row</th>
                <th scope="col" className="px-3 py-2 text-left">Employee code</th>
                <th scope="col" className="px-3 py-2 text-left">Reason</th>
              </tr>
            </thead>
            <tbody className="text-rose-800">
              {rejected.map((row) => (
                <tr key={`rejected-${row.rowNumber}-${row.employeeCode}`} className="border-t border-rose-100">
                  <td className="px-3 py-1.5">{row.rowNumber}</td>
                  <td className="px-3 py-1.5">{row.employeeCode || "-"}</td>
                  <td className="px-3 py-1.5">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CommitResultPanel({
  outcome,
  onSupersede,
  superseding,
}: {
  outcome: CommitOutcome;
  onSupersede?: () => void;
  superseding?: boolean;
}) {
  if (outcome.kind === "committed") {
    return (
      <div role="status" className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">Committed as batch {outcome.batchReference || outcome.batchId}.</p>
          <p>
            {outcome.acceptedCount} row(s) written, {outcome.rejectedCount} row(s) rejected and
            recorded against the batch.
          </p>
        </div>
      </div>
    );
  }

  if (outcome.kind === "partial") {
    return (
      <div role="alert" className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-semibold">
            Partial write — batch {outcome.batchReference || outcome.batchId} did not complete.
          </p>
          <p>
            Some rows were written and some were not. Do not treat this as a successful upload.
            Reported counts: {outcome.acceptedCount} accepted, {outcome.rejectedCount} rejected.
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {outcome.writeErrors.map((error, index) => (
              <li key={`write-error-${index}`}>{error}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (outcome.kind === "nothing_written") {
    return (
      <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">Nothing was written.</p>
          <p>
            All {outcome.rejectedCount} row(s) were rejected, so this commit contributed no
            productivity data.
          </p>
        </div>
      </div>
    );
  }

  if (outcome.kind === "duplicate") {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <div className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold">Duplicate submission — nothing was written.</p>
            <p>{outcome.message}</p>
            <p>
              If this re-upload is intentional, resubmit it declaring that it supersedes the
              earlier batch. The earlier batch stays on record and is marked as superseded.
            </p>
          </div>
        </div>
        {onSupersede && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onSupersede}
            disabled={superseding}
            className="border-amber-400 text-amber-900"
          >
            {superseding ? "Resubmitting..." : "Resubmit superseding the previous batch"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{outcome.message}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Container
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface SourcesResponse {
  success: boolean;
  sources: DiallerSourceOption[];
}

function labelOf(record: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return fallback;
}

export function ProductivityUpload() {
  const [fields, setFields] = useState<UploadFields>(EMPTY_UPLOAD_FIELDS);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ accepted: PreviewAcceptedRow[]; rejected: PreviewRejectedRow[] } | null>(null);
  const [approvedFingerprint, setApprovedFingerprint] = useState<string | null>(null);
  const [commitOutcome, setCommitOutcome] = useState<CommitOutcome | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "commit" | "supersede">(null);

  const scope = useWfmScopeFilter();

  const sourcesQuery = useQuery({
    queryKey: ["productivity-upload", "sources"],
    queryFn: async (): Promise<DiallerSourceOption[]> => {
      const response = await fetch(apiUrl(`${API_ROOT}/sources`), {
        headers: { Authorization: `Bearer ${getAuthToken() ?? ""}` },
      });
      const body = (await response.json().catch(() => null)) as SourcesResponse | null;
      if (!response.ok || !body?.success) {
        throw new Error(
          (body as unknown as { message?: string })?.message ??
            "The list of dialler sources could not be loaded.",
        );
      }
      return body.sources ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const sources = sourcesQuery.data ?? [];

  const branchesQuery = useBranches();
  const processesQuery = useProcesses(fields.branchId || undefined);

  const branches = useMemo(
    () =>
      filterByScope(
        (branchesQuery.data ?? []) as Array<Record<string, unknown> & { id: string }>,
        scope.branchIds,
        scope.hasAllAccess,
      ),
    [branchesQuery.data, scope.branchIds, scope.hasAllAccess],
  );

  const processes = useMemo(
    () =>
      filterByScope(
        (processesQuery.data ?? []) as Array<Record<string, unknown> & { id: string }>,
        scope.processIds,
        scope.hasAllAccess,
      ),
    [processesQuery.data, scope.processIds, scope.hasAllAccess],
  );

  /**
   * With exactly one manual-upload source there is no choice to make, so it is treated as
   * selected. Derived rather than written into state by an effect: an effect would leave the
   * mapping state of the only source that exists invisible until after the first paint, and the
   * derived form is the same value on the server, on the first render and on every render after.
   */
  const effectiveFields = useMemo<UploadFields>(() => {
    if (fields.diallerSourceId || sources.length !== 1) return fields;
    return { ...fields, diallerSourceId: sources[0]!.diallerSourceId };
  }, [fields, sources]);

  const source = useMemo(
    () => sources.find((s) => s.diallerSourceId === effectiveFields.diallerSourceId) ?? null,
    [sources, effectiveFields.diallerSourceId],
  );

  const gate = commitGateState({
    source,
    fields: effectiveFields,
    file,
    approvedFingerprint,
    busy: busy !== null,
  });

  /**
   * Any change to a field or the file drops the approved preview. This is the whole point of the
   * fingerprint: /commit re-reads the file and re-derives the rows, so a preview approved against
   * different inputs is approval for a different set of writes.
   */
  function invalidatePreview() {
    setPreview(null);
    setApprovedFingerprint(null);
    setCommitOutcome(null);
    setFormError(null);
  }

  function updateField<K extends keyof UploadFields>(key: K, value: UploadFields[K]) {
    setFields((prev) => {
      const next = { ...prev, [key]: value };
      // A process belongs to a branch, so a branch change can leave a process from the old branch
      // selected — which the server would answer with a 403 the uploader could do nothing about.
      if (key === "branchId") next.processId = "";
      return next;
    });
    invalidatePreview();
  }

  function pickFile(candidate: File | null) {
    if (candidate && !candidate.name.toLowerCase().endsWith(".csv")) {
      setFile(null);
      invalidatePreview();
      setFormError(
        "This upload reads CSV files only. In Excel choose File > Save As > CSV (Comma delimited) (*.csv) and upload that file.",
      );
      return;
    }
    setFile(candidate);
    invalidatePreview();
  }

  async function runPreview() {
    if (!source?.columnMappings || !file) return;
    const fingerprint = submissionFingerprint(effectiveFields, file);
    setBusy("preview");
    setFormError(null);
    setCommitOutcome(null);
    try {
      const outcome = await submitPreview({
        file,
        fields: effectiveFields,
        columnMappings: source.columnMappings,
      });
      if (outcome.kind === "previewed") {
        setPreview({ accepted: outcome.accepted, rejected: outcome.rejected });
        setApprovedFingerprint(fingerprint);
      } else {
        setPreview(null);
        setApprovedFingerprint(null);
        setFormError(outcome.message);
      }
    } catch (err) {
      setPreview(null);
      setApprovedFingerprint(null);
      setFormError(err instanceof Error ? err.message : "The preview request failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runCommit(supersedesBatchId: string | null) {
    if (!source?.columnMappings || !file) return;
    setBusy(supersedesBatchId ? "supersede" : "commit");
    setFormError(null);
    try {
      const outcome = await submitCommit({
        file,
        fields: effectiveFields,
        columnMappings: source.columnMappings,
        mappingVersionUsed: source.mappingVersion,
        supersedesBatchId,
      });
      setCommitOutcome(outcome);
      if (outcome.kind === "committed" || outcome.kind === "partial") {
        // The previewed set has now been written (wholly or partly). Re-arm the gate so the same
        // file cannot be committed twice with one further click.
        setApprovedFingerprint(null);
      }
    } catch (err) {
      setCommitOutcome({
        kind: "refused",
        message: err instanceof Error ? err.message : "The commit request failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  const duplicatePriorBatchId =
    commitOutcome?.kind === "duplicate" ? commitOutcome.priorBatchId : null;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-slate-900">WFM Productivity Upload</h3>
        <p className="mt-1 text-sm text-slate-500">
          Upload a dialler productivity report as CSV for one branch, one process and one date
          range. Preview is mandatory: nothing is written until the previewed rows are approved
          and committed.
        </p>
      </div>

      {sourcesQuery.isError && (
        <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {sourcesQuery.error instanceof Error
              ? sourcesQuery.error.message
              : "The list of dialler sources could not be loaded."}
          </span>
        </div>
      )}

      {sourcesQuery.isSuccess && sources.length === 0 && (
        <div role="alert" className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            No dialler source is registered for manual upload, so there is nothing to upload
            against yet. Sources that pull automatically are deliberately excluded from this
            screen.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="pu-source" className="mb-1.5 block text-xs font-semibold text-slate-600">
            Dialler source
          </label>
          <select
            id="pu-source"
            value={effectiveFields.diallerSourceId}
            onChange={(event) => updateField("diallerSourceId", event.target.value)}
            disabled={sourcesQuery.isLoading}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">
              {sourcesQuery.isLoading ? "Loading sources..." : "Select a dialler source"}
            </option>
            {sources.map((option) => (
              <option key={option.diallerSourceId} value={option.diallerSourceId}>
                {option.displayName} ({option.sourceCode})
                {option.columnMappings === null ? " - no column mapping" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pu-branch" className="mb-1.5 block text-xs font-semibold text-slate-600">
            Branch
          </label>
          <select
            id="pu-branch"
            value={fields.branchId}
            onChange={(event) => updateField("branchId", event.target.value)}
            disabled={branchesQuery.isLoading}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">{branchesQuery.isLoading ? "Loading branches..." : "Select a branch"}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {labelOf(branch, ["branch_name", "name", "branch_code"], branch.id)}
              </option>
            ))}
          </select>
          {/*
            An empty picker with no explanation reads as "there are no branches", which is never
            true. Both failure shapes are named: the request failed, or it succeeded and the
            caller's own scope leaves nothing to choose.
          */}
          {branchesQuery.isError && (
            <p className="mt-1 text-xs text-rose-700">
              The branch list could not be loaded, so no branch can be chosen. Reload the page; if
              it keeps failing, your account may not be permitted to read the branch master.
            </p>
          )}
          {branchesQuery.isSuccess && branches.length === 0 && (
            <p className="mt-1 text-xs text-amber-800">
              No branch is available to you here, so no batch can be submitted.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="pu-process" className="mb-1.5 block text-xs font-semibold text-slate-600">
            Process
          </label>
          <select
            id="pu-process"
            value={fields.processId}
            onChange={(event) => updateField("processId", event.target.value)}
            disabled={!fields.branchId || processesQuery.isLoading}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">
              {!fields.branchId
                ? "Select a branch first"
                : processesQuery.isLoading
                  ? "Loading processes..."
                  : "Select a process"}
            </option>
            {processes.map((process) => (
              <option key={process.id} value={process.id}>
                {labelOf(process, ["process_name", "name", "process_code"], process.id)}
              </option>
            ))}
          </select>
          {fields.branchId && processesQuery.isError && (
            <p className="mt-1 text-xs text-rose-700">
              The process list could not be loaded, so no process can be chosen.
            </p>
          )}
          {fields.branchId && processesQuery.isSuccess && processes.length === 0 && (
            <p className="mt-1 text-xs text-amber-800">
              No process is listed for this branch. A batch cannot be submitted without one.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pu-date-from" className="mb-1.5 block text-xs font-semibold text-slate-600">
              Date from
            </label>
            <input
              id="pu-date-from"
              type="date"
              value={fields.dateFrom}
              onChange={(event) => updateField("dateFrom", event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="pu-date-to" className="mb-1.5 block text-xs font-semibold text-slate-600">
              Date to
            </label>
            <input
              id="pu-date-to"
              type="date"
              value={fields.dateTo}
              onChange={(event) => updateField("dateTo", event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {source && source.columnMappings === null && <SourceMappingBlockedNotice source={source} />}

      {source && source.columnMappings && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-700">
            Column mapping in use (version {source.mappingVersion ?? "unversioned"})
          </p>
          <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
            {Object.entries(source.columnMappings).map(([header, target]) => (
              <li key={header}>
                <span className="font-mono">{header}</span> to <span className="font-mono">{target}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label htmlFor="pu-file" className="mb-1.5 block text-xs font-semibold text-slate-600">
          CSV file
        </label>
        <input
          id="pu-file"
          type="file"
          accept=".csv,text/csv"
          disabled={!source || source.columnMappings === null}
          onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
          className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        />
        {file && <p className="mt-1 text-xs text-slate-500">Selected: {file.name}</p>}
      </div>

      {formError && (
        <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{formError}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={runPreview}
          disabled={!gate.canPreview}
        >
          {busy === "preview" ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Previewing...
            </>
          ) : (
            <>
              <Upload className="h-3 w-3" aria-hidden="true" /> Preview
            </>
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void runCommit(null)}
          disabled={!gate.canCommit}
          aria-describedby={gate.blockedReason ? "pu-gate-reason" : undefined}
        >
          {busy === "commit" ? "Committing..." : "Commit previewed rows"}
        </Button>
        {gate.blockedReason && (
          <p id="pu-gate-reason" className="text-xs text-slate-600">
            {gate.blockedReason}
          </p>
        )}
      </div>

      {preview && <PreviewResultPanel accepted={preview.accepted} rejected={preview.rejected} />}

      {commitOutcome && (
        <CommitResultPanel
          outcome={commitOutcome}
          superseding={busy === "supersede"}
          onSupersede={
            duplicatePriorBatchId
              ? () => void runCommit(duplicatePriorBatchId)
              : undefined
          }
        />
      )}

      {commitOutcome?.kind === "duplicate" && !duplicatePriorBatchId && (
        <p className="text-xs text-slate-600">
          The server did not name the earlier batch id, so this screen cannot build the
          superseding resubmission for you. Quote the message above to whoever administers WFM
          uploads.
        </p>
      )}
    </div>
  );
}

export default ProductivityUpload;
