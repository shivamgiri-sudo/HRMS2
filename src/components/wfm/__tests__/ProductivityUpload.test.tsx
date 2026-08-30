/**
 * ProductivityUpload tests.
 *
 * Same deviation and same sectioned shape as the sibling RosterPivotGrid.test.tsx:
 * @testing-library/react and jsdom are not installed in this repo and vitest.config.ts runs
 * frontend tests under `environment: "node"`, so there is no `render()` and no
 * `userEvent.click()`.
 *   - Section A renders the REAL component through `renderToStaticMarkup` with the react-query
 *     cache pre-seeded and the api helper mocked at the module boundary.
 *   - Section B exercises the real decision functions and the real request/response handling
 *     directly, including a mocked-fetch round trip that inspects the multipart body actually
 *     sent.
 *   - Section C asserts the tab wiring against the live BulkUploadHub source, which is where the
 *     gate has to hold and which cannot be rendered here (it pulls in DashboardLayout, the auth
 *     context and the whole master-data tab).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.fn();
vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: { get: (...args: unknown[]) => apiGet(...args) },
  getAuthToken: () => "test-token",
}));

// useWfmScopeFilter reaches useWorkforceAccess -> useUserRole -> useAuth, i.e. a react context
// this component does not own. Mocked to the "sees everything" answer so these tests are about
// the upload flow rather than about scope resolution, which has its own tests.
vi.mock("@/hooks/useWfmScopeFilter", () => ({
  useWfmScopeFilter: () => ({
    branchIds: [],
    processIds: [],
    hasAllAccess: true,
    isScoped: false,
    scopeDescription: "All branches and processes",
    isLoading: false,
  }),
  filterByScope: <T,>(items: T[]) => items,
}));

import {
  CommitResultPanel,
  EMPTY_UPLOAD_FIELDS,
  PRODUCTIVITY_UPLOAD_PAGE_CODE,
  PreviewResultPanel,
  ProductivityUpload,
  buildUploadFormData,
  canUseProductivityTab,
  classifyCommitResponse,
  classifyPreviewResponse,
  commitGateState,
  submissionFingerprint,
  submitCommit,
  submitPreview,
  type DiallerSourceOption,
  type UploadFields,
} from "@/components/wfm/ProductivityUpload";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────────────────────

const MAPPED_SOURCE: DiallerSourceOption = {
  diallerSourceId: "src-1",
  sourceCode: "AMEYO_MUM",
  displayName: "Ameyo Mumbai",
  sourceType: "manual_upload",
  columnMappings: { "Emp Code": "employee_code", Date: "report_date", Login: "login_minutes" },
  mappingVersion: 3,
};

const UNMAPPED_SOURCE: DiallerSourceOption = {
  diallerSourceId: "src-2",
  sourceCode: "OZONETEL_PUN",
  displayName: "Ozonetel Pune",
  sourceType: "manual_upload",
  columnMappings: null,
  mappingVersion: null,
};

const COMPLETE_FIELDS: UploadFields = {
  diallerSourceId: "src-1",
  branchId: "branch-1",
  processId: "process-1",
  dateFrom: "2026-07-01",
  dateTo: "2026-07-31",
};

function csvFile(name = "july.csv", body = "Emp Code,Date,Login\nMAS001,2026-07-01,480\n"): File {
  return new File([body], name, { type: "text/csv", lastModified: 1_760_000_000_000 });
}

/**
 * The opening tag of the <button> whose visible label ENDS with `label`, so `disabled` and the
 * aria wiring can be asserted on the element rather than on the page as a whole. Anchored on
 * `${label}</button>` rather than on the bare label: prose elsewhere on the page legitimately
 * contains the same words ("Preview is mandatory..."), and matching that would test nothing.
 */
function buttonTagFor(html: string, label: string): string {
  const labelAt = html.indexOf(`${label}</button>`);
  expect(labelAt, `no button labelled "${label}" was rendered`).toBeGreaterThan(-1);
  const tagStart = html.lastIndexOf("<button", labelAt);
  expect(tagStart, `"${label}" is not inside a <button>`).toBeGreaterThan(-1);
  return html.slice(tagStart, html.indexOf(">", tagStart) + 1);
}

/** Whether the element carrying `id` was rendered with a real `disabled` attribute. */
function isDisabled(html: string, id: string): boolean {
  const at = html.indexOf(`id="${id}"`);
  expect(at, `#${id} was not rendered`).toBeGreaterThan(-1);
  // Scoped to the element's own opening tag: `disabled:cursor-not-allowed` lives in the class
  // list of the same element, so a substring search on the whole document says "disabled" for a
  // control that is perfectly usable.
  const tag = html.slice(at, html.indexOf(">", at) + 1);
  return / disabled=""/.test(tag);
}

function renderUpload(
  sources: DiallerSourceOption[],
  branches: Array<Record<string, unknown>> = [
    { id: "branch-1", branch_name: "Mumbai HO", active_status: 1 },
  ],
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(["productivity-upload", "sources"], sources);
  client.setQueryData(["org", "branches"], branches);
  client.setQueryData(["org", "processes", undefined], []);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProductivityUpload />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Section A — real render
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe("ProductivityUpload — a source with no column mapping", () => {
  it("says plainly that the source has no mapping and cannot be uploaded to", () => {
    const html = renderUpload([UNMAPPED_SOURCE]);
    expect(html).toContain("No column mapping is configured for Ozonetel Pune");
    expect(html).toContain("cannot be accepted until a column mapping is configured");
  });

  it("blocks the file input, Preview and Commit rather than letting a doomed upload be attempted", () => {
    const html = renderUpload([UNMAPPED_SOURCE]);
    // The file input is the one control that would otherwise invite the work.
    expect(isDisabled(html, "pu-file")).toBe(true);
    expect(buttonTagFor(html, "Preview")).toContain('disabled=""');
    expect(buttonTagFor(html, "Commit previewed rows")).toContain('disabled=""');
    expect(html).toContain("has no column mapping configured, so no file can be read for it yet");
  });

  it("marks the unmapped source in the picker, so the reason is visible before selecting it", () => {
    const html = renderUpload([MAPPED_SOURCE, UNMAPPED_SOURCE]);
    expect(html).toContain("no column mapping");
  });
});

describe("ProductivityUpload — a source with a usable mapping", () => {
  it("does not show the blocked notice and lists the mapping actually in use", () => {
    const html = renderUpload([MAPPED_SOURCE]);
    expect(html).not.toContain("No column mapping is configured");
    expect(html).toContain("Column mapping in use (version 3)");
    expect(html).toContain("employee_code");
    expect(html).toContain("login_minutes");
  });

  it("offers the file input, since this source can actually be uploaded to", () => {
    const html = renderUpload([MAPPED_SOURCE]);
    expect(isDisabled(html, "pu-file")).toBe(false);
  });

  it("keeps Commit disabled before any preview has been run, and says why in words", () => {
    const html = renderUpload([MAPPED_SOURCE]);
    expect(buttonTagFor(html, "Commit previewed rows")).toContain('disabled=""');
    // The reason is rendered as text and tied to the button, rather than conveyed by the
    // greyed-out styling alone.
    expect(html).toContain("Still needed:");
    expect(html).toContain('id="pu-gate-reason"');
    expect(buttonTagFor(html, "Commit previewed rows")).toContain('aria-describedby="pu-gate-reason"');
  });

  it("labels every input", () => {
    const html = renderUpload([MAPPED_SOURCE]);
    for (const id of ["pu-source", "pu-branch", "pu-process", "pu-date-from", "pu-date-to", "pu-file"]) {
      expect(html, `missing label for #${id}`).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe("ProductivityUpload — nothing to choose from", () => {
  it("says so rather than showing an empty source picker with no explanation", () => {
    const html = renderUpload([]);
    expect(html).toContain("No dialler source is registered for manual upload");
  });

  it("says so rather than showing an empty branch picker with no explanation", () => {
    const html = renderUpload([MAPPED_SOURCE], []);
    expect(html).toContain("No branch is available to you here");
  });
});

describe("PreviewResultPanel", () => {
  it("renders every rejected row with its row number, employee code and reason", () => {
    const html = renderToStaticMarkup(
      <PreviewResultPanel
        accepted={[
          {
            rowNumber: 2,
            employeeId: "emp-1",
            employeeCode: "MAS001",
            reportDate: "2026-07-01",
            loginMinutes: 480,
          },
        ]}
        rejected={[
          { rowNumber: 3, employeeCode: "MAS999", reason: "No active employee for this code" },
          { rowNumber: 7, employeeCode: "MAS002", reason: "login_minutes must be a whole number" },
        ]}
      />,
    );
    expect(html).toContain("Rejected rows");
    expect(html).toContain("MAS999");
    expect(html).toContain("No active employee for this code");
    expect(html).toContain("MAS002");
    expect(html).toContain("login_minutes must be a whole number");
    expect(html).toContain("2 row(s) rejected");
    expect(html).toContain("1 row(s) would be written");
  });

  it("makes clear that committing would write nothing when every row was rejected", () => {
    const html = renderToStaticMarkup(
      <PreviewResultPanel
        accepted={[]}
        rejected={[{ rowNumber: 2, employeeCode: "MAS001", reason: "report_date outside the window" }]}
      />,
    );
    expect(html).toContain("Every row was rejected, so committing this file would write nothing");
  });
});

describe("CommitResultPanel", () => {
  it("reports a 207 as a partial write, never as a success, and lists the write errors", () => {
    const outcome = classifyCommitResponse(207, {
      success: false,
      batchId: "batch-9",
      batchReference: "PUB-2026-07-0009",
      acceptedCount: 300,
      rejectedCount: 4,
      // Verbatim shape of commitUploadBatch's writeErrors: plain strings, already naming the
      // affected row range.
      writeErrors: [
        "300 accepted row(s) (rows 302-601) could not be saved. Re-upload this range once the problem is resolved.",
      ],
    });
    const html = renderToStaticMarkup(<CommitResultPanel outcome={outcome} />);

    expect(outcome.kind).toBe("partial");
    expect(html).toContain("Partial write");
    expect(html).toContain("did not complete");
    expect(html).toContain("Do not treat this as a successful upload");
    expect(html).toContain("(rows 302-601) could not be saved");
    expect(html).not.toContain("Committed as batch");
  });

  it("surfaces a duplicate submission with the server's message and a labelled supersede action", () => {
    const outcome = classifyCommitResponse(409, {
      success: false,
      message:
        "An identical file was already committed as batch PUB-2026-07-0007 for this source, branch and process.",
      priorBatchId: "batch-7",
    });
    const html = renderToStaticMarkup(
      <CommitResultPanel outcome={outcome} onSupersede={() => undefined} />,
    );

    expect(html).toContain("Duplicate submission");
    expect(html).toContain("already committed as batch PUB-2026-07-0007");
    expect(html).toContain("Resubmit superseding the previous batch");
  });

  it("does not offer a supersede action when the caller has no prior batch id to declare", () => {
    const outcome = classifyCommitResponse(409, { success: false, message: "Already committed." });
    const html = renderToStaticMarkup(<CommitResultPanel outcome={outcome} />);
    expect(html).toContain("Already committed.");
    expect(html).not.toContain("Resubmit superseding the previous batch");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Section B — the real decisions and the real request/response handling
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe("commitGateState — preview must precede commit", () => {
  const file = csvFile();

  it("refuses Commit until a preview has succeeded for the current submission", () => {
    const gate = commitGateState({
      source: MAPPED_SOURCE,
      fields: COMPLETE_FIELDS,
      file,
      approvedFingerprint: null,
      busy: false,
    });
    expect(gate.canPreview).toBe(true);
    expect(gate.canCommit).toBe(false);
    expect(gate.blockedReason).toContain("Run Preview first");
  });

  it("allows Commit once the approved preview matches the current submission", () => {
    const gate = commitGateState({
      source: MAPPED_SOURCE,
      fields: COMPLETE_FIELDS,
      file,
      approvedFingerprint: submissionFingerprint(COMPLETE_FIELDS, file),
      busy: false,
    });
    expect(gate.canCommit).toBe(true);
    expect(gate.blockedReason).toBeNull();
  });

  it("re-disables Commit when the file changes after a preview", () => {
    const approved = submissionFingerprint(COMPLETE_FIELDS, file);
    const gate = commitGateState({
      source: MAPPED_SOURCE,
      fields: COMPLETE_FIELDS,
      file: csvFile("august.csv"),
      approvedFingerprint: approved,
      busy: false,
    });
    expect(gate.canCommit).toBe(false);
    expect(gate.blockedReason).toContain("changed after the last preview");
  });

  it("re-disables Commit when any declared field changes after a preview", () => {
    const approved = submissionFingerprint(COMPLETE_FIELDS, file);
    for (const changed of [
      { ...COMPLETE_FIELDS, branchId: "branch-2" },
      { ...COMPLETE_FIELDS, processId: "process-2" },
      { ...COMPLETE_FIELDS, dateFrom: "2026-07-02" },
      { ...COMPLETE_FIELDS, dateTo: "2026-08-01" },
      { ...COMPLETE_FIELDS, diallerSourceId: "src-3" },
    ]) {
      const gate = commitGateState({
        source: MAPPED_SOURCE,
        fields: changed,
        file,
        approvedFingerprint: approved,
        busy: false,
      });
      expect(gate.canCommit, `${JSON.stringify(changed)} should invalidate the preview`).toBe(false);
    }
  });

  it("refuses both actions for a source with no column mapping, whatever else is filled in", () => {
    const gate = commitGateState({
      source: UNMAPPED_SOURCE,
      fields: { ...COMPLETE_FIELDS, diallerSourceId: UNMAPPED_SOURCE.diallerSourceId },
      file,
      approvedFingerprint: submissionFingerprint(COMPLETE_FIELDS, file),
      busy: false,
    });
    expect(gate.canPreview).toBe(false);
    expect(gate.canCommit).toBe(false);
    expect(gate.blockedReason).toContain("no column mapping configured");
  });

  it("names what is still missing rather than silently staying disabled", () => {
    const gate = commitGateState({
      source: MAPPED_SOURCE,
      fields: EMPTY_UPLOAD_FIELDS,
      file: null,
      approvedFingerprint: null,
      busy: false,
    });
    expect(gate.blockedReason).toBe("Still needed: branch, process, date from, date to, CSV file.");
  });
});

describe("classifyCommitResponse", () => {
  it("classifies a clean 200 as committed", () => {
    const outcome = classifyCommitResponse(200, {
      success: true,
      batchId: "b1",
      batchReference: "PUB-1",
      acceptedCount: 10,
      rejectedCount: 0,
      writeErrors: [],
    });
    expect(outcome.kind).toBe("committed");
  });

  it("classifies a 200 whose success is false as nothing written", () => {
    const outcome = classifyCommitResponse(200, {
      success: false,
      batchId: "b1",
      acceptedCount: 0,
      rejectedCount: 12,
      writeErrors: [],
    });
    expect(outcome).toMatchObject({ kind: "nothing_written", rejectedCount: 12 });
  });

  it("passes a 403 scope refusal through with the server's own message", () => {
    const outcome = classifyCommitResponse(403, {
      success: false,
      message: "This process is outside your resolved scope",
    });
    expect(outcome).toEqual({
      kind: "refused",
      message: "This process is outside your resolved scope",
    });
  });

  it("passes a 400 validation refusal through with the server's own message", () => {
    const outcome = classifyCommitResponse(400, {
      success: false,
      message: "The CSV has a header row but no data rows.",
    });
    expect(outcome).toEqual({
      kind: "refused",
      message: "The CSV has a header row but no data rows.",
    });
  });
});

describe("classifyPreviewResponse", () => {
  it("returns the accepted and rejected lists on success", () => {
    const outcome = classifyPreviewResponse(200, {
      success: true,
      accepted: [{ rowNumber: 2, employeeCode: "MAS001" }],
      rejected: [{ rowNumber: 3, employeeCode: "MAS002", reason: "nope" }],
    });
    expect(outcome).toMatchObject({ kind: "previewed" });
    if (outcome.kind !== "previewed") throw new Error("unreachable");
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.rejected[0]!.reason).toBe("nope");
  });

  it("surfaces the server's message on a refusal", () => {
    const outcome = classifyPreviewResponse(400, {
      success: false,
      message: 'columnMappings maps "Foo" to an unknown target field',
    });
    expect(outcome).toEqual({
      kind: "refused",
      message: 'columnMappings maps "Foo" to an unknown target field',
    });
  });
});

describe("the multipart body actually sent", () => {
  function stubFetch(responses: Array<{ status: number; body: unknown }>) {
    const calls: Array<{ url: string; form: FormData }> = [];
    let index = 0;
    const fetchMock = vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), form: (init as { body: FormData }).body });
      const next = responses[Math.min(index++, responses.length - 1)]!;
      return {
        status: next.status,
        ok: next.status < 400,
        json: async () => next.body,
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  it("sends every field the route requires, with columnMappings as a JSON string", () => {
    const form = buildUploadFormData({
      file: csvFile(),
      fields: COMPLETE_FIELDS,
      columnMappings: MAPPED_SOURCE.columnMappings!,
      mappingVersionUsed: 3,
    });
    expect(form.get("diallerSourceId")).toBe("src-1");
    expect(form.get("branchId")).toBe("branch-1");
    expect(form.get("processId")).toBe("process-1");
    expect(form.get("dateFrom")).toBe("2026-07-01");
    expect(form.get("dateTo")).toBe("2026-07-31");
    expect(JSON.parse(String(form.get("columnMappings")))).toEqual(MAPPED_SOURCE.columnMappings);
    expect(form.get("mappingVersionUsed")).toBe("3");
    expect(form.get("file")).toBeInstanceOf(File);
  });

  it("never sends mappingVersionUsed or supersedesBatchId on a preview", async () => {
    const calls = stubFetch([{ status: 200, body: { success: true, accepted: [], rejected: [] } }]);
    await submitPreview({
      file: csvFile(),
      fields: COMPLETE_FIELDS,
      columnMappings: MAPPED_SOURCE.columnMappings!,
      mappingVersionUsed: 3,
      supersedesBatchId: "batch-7",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/wfm/productivity-upload/preview");
    expect(calls[0]!.form.get("mappingVersionUsed")).toBeNull();
    expect(calls[0]!.form.get("supersedesBatchId")).toBeNull();
  });

  it("omits supersedesBatchId on a first commit and sends it on the declared resubmission", async () => {
    const calls = stubFetch([
      {
        status: 409,
        body: {
          success: false,
          message: "An identical file was already committed as batch PUB-2026-07-0007.",
          priorBatchId: "batch-7",
        },
      },
      {
        status: 200,
        body: {
          success: true,
          batchId: "batch-8",
          batchReference: "PUB-2026-07-0008",
          acceptedCount: 300,
          rejectedCount: 0,
          writeErrors: [],
        },
      },
    ]);

    const base = {
      file: csvFile(),
      fields: COMPLETE_FIELDS,
      columnMappings: MAPPED_SOURCE.columnMappings!,
      mappingVersionUsed: MAPPED_SOURCE.mappingVersion,
    };

    const first = await submitCommit(base);
    expect(first).toMatchObject({ kind: "duplicate", priorBatchId: "batch-7" });
    expect(calls[0]!.url).toContain("/api/wfm/productivity-upload/commit");
    expect(calls[0]!.form.get("supersedesBatchId")).toBeNull();

    if (first.kind !== "duplicate") throw new Error("unreachable");
    const retry = await submitCommit({ ...base, supersedesBatchId: first.priorBatchId });

    expect(calls).toHaveLength(2);
    expect(calls[1]!.form.get("supersedesBatchId")).toBe("batch-7");
    expect(calls[1]!.form.get("mappingVersionUsed")).toBe("3");
    expect(retry).toMatchObject({ kind: "committed", batchId: "batch-8" });
  });
});

describe("canUseProductivityTab", () => {
  it("is false while page access has not resolved, even though canViewPage would say true", () => {
    expect(canUseProductivityTab({ isResolved: false, canViewPage: () => true })).toBe(false);
  });

  it("is false when the grant is absent", () => {
    expect(canUseProductivityTab({ isResolved: true, canViewPage: () => false })).toBe(false);
  });

  it("is true only for the WFM_PRODUCTIVITY_UPLOAD code", () => {
    const asked: string[] = [];
    const result = canUseProductivityTab({
      isResolved: true,
      canViewPage: (code) => {
        asked.push(code);
        return code === PRODUCTIVITY_UPLOAD_PAGE_CODE;
      },
    });
    expect(result).toBe(true);
    expect(asked).toEqual(["WFM_PRODUCTIVITY_UPLOAD"]);
    expect(canUseProductivityTab({ isResolved: true, canViewPage: (c) => c === "BULK_UPLOAD" })).toBe(
      false,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// Section C — the tab wiring in BulkUploadHub, asserted against the live source
// ═════════════════════════════════════════════════════════════════════════════════════════════

describe("BulkUploadHub — productivity tab gating", () => {
  const HUB = readFileSync(resolve(__dirname, "../../../pages/BulkUploadHub.tsx"), "utf8");

  it("derives the gate from canUseProductivityTab and nothing else", () => {
    expect(HUB).toMatch(/const canUploadProductivity = canUseProductivityTab\(workforceAccess\)/);
  });

  it("renders neither the tab button nor its panel without the grant", () => {
    expect(HUB).toMatch(/\{canUploadProductivity && \(\s*<button/);
    expect(HUB).toMatch(/\{canUploadProductivity && effectiveTab === "productivity" && \(/);
  });

  it("can never leave the productivity tab active for someone without the grant", () => {
    expect(HUB).toMatch(
      /activeTab === "productivity" && !canUploadProductivity \? "master" : activeTab/,
    );
    // Every tab-conditional render reads the collapsed tab, not the raw state, or the fallback
    // above would be decorative.
    const rawReads = HUB.match(/activeTab === "(master|apr)"/g) ?? [];
    expect(rawReads, "a panel still keys off the un-collapsed activeTab").toEqual([]);
  });

  it("leaves the existing master and apr tabs in place", () => {
    expect(HUB).toContain('setActiveTab("master")');
    expect(HUB).toContain('setActiveTab("apr")');
    expect(HUB).toContain("Master Data Upload");
    expect(HUB).toContain("APR / Dialler Attendance");
    expect(HUB).toContain("<AprBulkUpload />");
  });
});
