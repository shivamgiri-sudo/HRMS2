/**
 * autoGenerateJoiningDocuments runs detached after employee creation. These tests
 * pin the three robustness rules added after MAS63558: kit documents first, a
 * per-document timeout that lets the loop continue, and a summary of rows that
 * still have no file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const execute = vi.fn();
const generateChecklistDraft = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));
vi.mock("../universalDigitalFormFill.service.js", () => ({ generateChecklistDraft }));
vi.mock("../employeeJoiningDocumentAnalysis.service.js", () => ({ analyzeEmployeeJoiningDocument: vi.fn() }));
vi.mock("../../integrations/luckpay/luckpay.client.js", () => ({
  esignWithUrl: vi.fn(), generateClientTransactionId: vi.fn(), sanitizeProviderPayload: vi.fn(), luckpayClient: {},
}));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: {} }));
vi.mock("../../communication/email.service.js", () => ({ emailService: {} }));
vi.mock("../../ats/ats.email.service.js", () => ({
  buildJoiningDocEsignEmailHtml: vi.fn(), buildEpfComplianceReviewEmailHtml: vi.fn(),
}));

const { autoGenerateJoiningDocuments } = await import("../employeeJoiningDocuments.service.js");
const { DRAFT_GENERATION_TIMEOUT_MS } = await import("../joiningKitDraftRepair.service.js");

// Order as the SQL returns it: mandatory first, then by document_name — so the
// EPF acroform documents sort ahead of the kit documents.
const CHECKLIST = [
  { checklist_id: "c-epf", document_code: "EPF_DECLARATION" },
  { checklist_id: "c-bams", document_code: "BAMS_DECLARATION" },
  { checklist_id: "c-contract", document_code: "EMPLOYMENT_CONTRACT" },
  { checklist_id: "c-it", document_code: "IT_COMPLIANCE" },
  { checklist_id: "c-nda", document_code: "NDA_CONFIDENTIALITY" },
];
let missingCodes: string[] = [];
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  missingCodes = [];
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  generateChecklistDraft.mockResolvedValue({});
  execute.mockImplementation(async (sql: string) => {
    if (/FROM employees e/.test(sql)) return [[{ id: "emp-1", employee_code: "MAS1" }]];
    if (/FROM employee_joining_document_template\s+WHERE active_status/.test(sql)) return [[]];
    if (/SELECT document_code FROM employee_joining_document_checklist WHERE employee_id/.test(sql)) return [[]];
    if (/JOIN employee_joining_document_template t ON t.id = c.template_id/.test(sql)) return [CHECKLIST];
    if (/NOT EXISTS/.test(sql) && /document_code <> 'EMPLOYMENT_CONTRACT'/.test(sql)) {
      return [missingCodes.map((document_code) => ({ document_code }))];
    }
    return [[{ total_count: 0, mandatory_count: 0, mandatory_completed: 0, completed_count: 0 }]];
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("autoGenerateJoiningDocuments", () => {
  it("generates kit documents before the EPF acroform documents and still skips the contract", async () => {
    await autoGenerateJoiningDocuments("emp-1", null, "actor");
    expect(generateChecklistDraft.mock.calls.map((c) => c[0])).toEqual(["c-bams", "c-it", "c-nda", "c-epf"]);
  });

  it("a hung document times out and the loop continues with the next", async () => {
    vi.useFakeTimers();
    generateChecklistDraft.mockImplementation((id: string) =>
      id === "c-bams" ? new Promise(() => undefined) : Promise.resolve({}));
    const p = autoGenerateJoiningDocuments("emp-1", null, "actor");
    await vi.advanceTimersByTimeAsync(DRAFT_GENERATION_TIMEOUT_MS + 1);
    await p;
    expect(generateChecklistDraft.mock.calls.map((c) => c[0])).toEqual(["c-bams", "c-it", "c-nda", "c-epf"]);
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => String(c[0]).includes("Failed to generate draft for checklist item"));
    expect(logged?.[1]).toMatchObject({ documentCode: "BAMS_DECLARATION" });
    expect(String(logged?.[1].error)).toMatch(/timed out/);
  });

  it("logs one summary line naming rows that still have no file", async () => {
    missingCodes = ["IT_COMPLIANCE", "EPF_DECLARATION"];
    await autoGenerateJoiningDocuments("emp-1", null, "actor");
    const summaries = warn.mock.calls.filter((c) => String(c[0]).includes("still without a file"));
    expect(summaries).toHaveLength(1);
    expect(summaries[0][1]).toMatchObject({
      employeeId: "emp-1", missingCount: 2, documentCodes: ["IT_COMPLIANCE", "EPF_DECLARATION"],
    });
  });

  it("logs no summary when every row has a file", async () => {
    await autoGenerateJoiningDocuments("emp-1", null, "actor");
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("still without a file"))).toHaveLength(0);
  });

  it("keeps the existing Completed log line", async () => {
    await autoGenerateJoiningDocuments("emp-1", null, "actor");
    const completed = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls
      .find((c) => String(c[0]).includes("[autoGenerateJoiningDocuments] Completed:"));
    expect(completed?.[1]).toMatchObject({ employeeId: "emp-1", draftsGenerated: 4, skippedForPayrollApproval: 1 });
  });
});
