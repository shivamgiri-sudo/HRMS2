/**
 * Who may be issued an appointment letter.
 *
 * The letter is the last step of joining formalities, so the gate has to be
 * right in both directions: it must not issue to someone whose BGV or documents
 * are outstanding, and it must not block someone who has genuinely finished.
 *
 * The BGV rule is the codebase's existing canonical one —
 * overall_status = 'clear' AND is_auto_approved = 0 — which appears three times
 * in reconciliation.service.ts. An auto-approved report is explicitly not a
 * pass: it is a report nobody looked at.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Rows = Record<string, unknown>[];
const state: {
  employee?: Rows; issued?: Rows; bgv?: Rows; docs?: Rows; esign?: Rows; salary?: Rows;
} = {};

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes("FROM employees e")) return [state.employee ?? []];
      if (s.includes("FROM appointment_letter_issue")) return [state.issued ?? []];
      if (s.includes("FROM candidate_bgv_report")) return [state.bgv ?? []];
      if (s.includes("signed_count")) return [state.esign ?? []];
      if (s.includes("employee_joining_document_checklist")) return [state.docs ?? []];
      if (s.includes("salary_component_assignments")) return [state.salary ?? []];
      return [[]];
    }),
  },
}));

const { evaluateAppointmentLetterEligibility, TERMINAL_DOCUMENT_STATUSES } =
  await import("../appointmentLetterEligibility.service.js");

const READY = {
  id: "emp-1", employee_code: "MAS62917", full_name: "HARSH TALWAR",
  branch_id: "b1", branch_name: "NOIDA-2", branch_address: "A-45, Sector 63",
  designation_name: "EXECUTIVE", date_of_joining: new Date("2025-09-25T18:30:00Z"),
  candidate_id: "cand-1",
};

function setup(over: Partial<typeof state> = {}) {
  state.employee = [{ ...READY }];
  state.issued = [];
  state.bgv = [{ overall_status: "clear", is_auto_approved: 0 }];
  state.docs = [{ mandatory_total: 6, mandatory_done: 6, pending_names: null }];
  state.esign = [{ signed_count: 1 }];
  state.salary = [{ sca: 1, legacy: 0 }];
  Object.assign(state, over);
}

const codes = (r: { blockers: { code: string }[] }) => r.blockers.map((b) => b.code);

beforeEach(() => setup());

describe("the happy path", () => {
  it("is eligible when BGV is clear and every document is done", async () => {
    const r = await evaluateAppointmentLetterEligibility("emp-1");
    expect(r.eligible).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.employeeCode).toBe("MAS62917");
  });
});

describe("BGV", () => {
  it("blocks when no BGV report exists", async () => {
    setup({ bgv: [] });
    expect(codes(await evaluateAppointmentLetterEligibility("emp-1"))).toContain("bgv_not_started");
  });

  it.each(["pending", "in_progress", "refer", "negative"])("blocks when overall_status is %s", async (status) => {
    setup({ bgv: [{ overall_status: status, is_auto_approved: 0 }] });
    expect(codes(await evaluateAppointmentLetterEligibility("emp-1"))).toContain("bgv_not_clear");
  });

  it("blocks a clear-but-auto-approved report", async () => {
    // Clear on paper, but nobody reviewed it.
    setup({ bgv: [{ overall_status: "clear", is_auto_approved: 1 }] });
    const r = await evaluateAppointmentLetterEligibility("emp-1");
    expect(r.eligible).toBe(false);
    expect(codes(r)).toContain("bgv_auto_approved");
  });
});

describe("joining documents", () => {
  it("blocks when any mandatory document is outstanding, and names it", async () => {
    setup({ docs: [{ mandatory_total: 6, mandatory_done: 4, pending_names: "NDA & Confidentiality Agreement, IT Compliance Agreement" }] });
    const r = await evaluateAppointmentLetterEligibility("emp-1");
    expect(codes(r)).toContain("joining_documents_incomplete");
    // HR needs to know WHICH, not merely that something is missing.
    expect(r.blockers.find((b) => b.code === "joining_documents_incomplete")!.reason).toContain("NDA");
    expect(r.blockers.find((b) => b.code === "joining_documents_incomplete")!.reason).toContain("2 of 6");
  });

  it("blocks when no checklist exists at all", async () => {
    setup({ docs: [{ mandatory_total: 0, mandatory_done: 0, pending_names: null }] });
    expect(codes(await evaluateAppointmentLetterEligibility("emp-1"))).toContain("no_joining_documents");
  });

  it("counts a wet-signed upload as complete", () => {
    // HR-gated and not self-assertable, so it is a real completion. This keeps
    // one definition of "done" rather than a second competing one.
    expect(TERMINAL_DOCUMENT_STATUSES).toContain("wet_signed_uploaded");
    expect(TERMINAL_DOCUMENT_STATUSES).toContain("esign_completed");
  });
});

describe("joining kit e-sign", () => {
  it("blocks issuance when no mandatory document has ever been e-signed or wet-signed", async () => {
    setup({ esign: [{ signed_count: 0 }] });
    const r = await evaluateAppointmentLetterEligibility("emp-1");
    expect(r.eligible).toBe(false);
    expect(codes(r)).toContain("joining_kit_not_esigned");
  });

  it("is satisfied by a single e-signed mandatory document, distinct from joining_documents_incomplete", async () => {
    setup({ esign: [{ signed_count: 1 }] });
    const r = await evaluateAppointmentLetterEligibility("emp-1");
    expect(codes(r)).not.toContain("joining_kit_not_esigned");
  });

  it("is not checked at all when there is no checklist (no_joining_documents covers that case)", async () => {
    setup({ docs: [{ mandatory_total: 0, mandatory_done: 0, pending_names: null }], esign: [{ signed_count: 0 }] });
    const r = await evaluateAppointmentLetterEligibility("emp-1");
    expect(codes(r)).not.toContain("joining_kit_not_esigned");
    expect(codes(r)).toContain("no_joining_documents");
  });
});

describe("what the letter needs in order to be printable", () => {
  it("blocks when the branch has no address", async () => {
    setup({ employee: [{ ...READY, branch_address: "" }] });
    expect(codes(await evaluateAppointmentLetterEligibility("emp-1"))).toContain("branch_address_missing");
  });

  it("blocks when no branch is assigned", async () => {
    setup({ employee: [{ ...READY, branch_id: null, branch_address: "" }] });
    expect(codes(await evaluateAppointmentLetterEligibility("emp-1"))).toContain("branch_not_assigned");
  });

  it("blocks when no salary can be resolved", async () => {
    setup({ salary: [{ sca: 0, legacy: 0 }] });
    expect(codes(await evaluateAppointmentLetterEligibility("emp-1"))).toContain("salary_not_assigned");
  });

  it("accepts a legacy-only salary", async () => {
    setup({ salary: [{ sca: 0, legacy: 12 }] });
    expect((await evaluateAppointmentLetterEligibility("emp-1")).eligible).toBe(true);
  });

  it("blocks when there is no date of joining", async () => {
    setup({ employee: [{ ...READY, date_of_joining: null }] });
    expect(codes(await evaluateAppointmentLetterEligibility("emp-1"))).toContain("no_date_of_joining");
  });
});

describe("names: warn, do not block", () => {
  it("blocks a name too short to print", async () => {
    setup({ employee: [{ ...READY, full_name: "A" }] });
    expect(codes(await evaluateAppointmentLetterEligibility("emp-1"))).toContain("employee_name_incomplete");
  });

  it("only warns on a single-word name", async () => {
    // A mononymous employee is normal in India; blocking would stop a real hire.
    setup({ employee: [{ ...READY, full_name: "HARSH" }] });
    const r = await evaluateAppointmentLetterEligibility("emp-1");
    expect(r.eligible).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain("name_possibly_incomplete");
  });
});

describe("idempotency", () => {
  it("reports an existing letter rather than allowing a second", async () => {
    setup({ issued: [{ letter_number: "MCN-AL-2026-000123" }] });
    const r = await evaluateAppointmentLetterEligibility("emp-1");
    expect(r.alreadyIssued).toBe(true);
    expect(r.existingLetterNumber).toBe("MCN-AL-2026-000123");
  });
});

describe("every failing reason is reported, not just the first", () => {
  it("returns all blockers together", async () => {
    setup({
      bgv: [{ overall_status: "refer", is_auto_approved: 0 }],
      docs: [{ mandatory_total: 6, mandatory_done: 2, pending_names: "NDA" }],
      salary: [{ sca: 0, legacy: 0 }],
      employee: [{ ...READY, branch_address: "" }],
    });
    const r = await evaluateAppointmentLetterEligibility("emp-1");
    expect(r.eligible).toBe(false);
    expect(codes(r)).toEqual(expect.arrayContaining([
      "bgv_not_clear", "joining_documents_incomplete", "branch_address_missing", "salary_not_assigned",
    ]));
    expect(r.blockers.length).toBeGreaterThanOrEqual(4);
  });
});
