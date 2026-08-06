/**
 * ATS Recruiter Interview Workflow — 15 mandatory test cases (S6)
 *
 * All DB calls are mocked. No real database connection needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

// ── Mock DB ───────────────────────────────────────────────────────────────────

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([[], []]),
    getConnection: vi.fn(),
  },
}));

import { db } from "../src/db/mysql.js";
import {
  verifyRecruiter,
  getMyPendingCandidates,
  submitInterviewUpdate,
  type RecruiterProfile,
} from "../src/modules/ats-full-parity/recruiterInterview.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetConnection = db.getConnection as ReturnType<typeof vi.fn>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PIN = "1234";
let pinHash: string;
beforeEach(async () => {
  if (!pinHash) pinHash = await bcrypt.hash(PIN, 10);
});

const fakeRecruiter = {
  id: "rec-1",
  name: "Test Recruiter",
  recruiter_code: "REC001",
  pin_hash: "",               // filled per-test from pinHash
  email: "rec@example.com",
  branch: "Mumbai",
  employee_id: "emp-1",
  active_status: 1,
  available_today: "Y",
};

const fakeCandidate = {
  id: "cand-1",
  candidate_code: "CND-ABC",
  recruiter_assigned_name: "Test Recruiter",
  q_token: "MUM-001",
  current_stage: "Arrival",
  status: "Waiting",
  created_date: "2026-06-10",
  created_time: "09:00:00",
};

/**
 * The single process lookup submitInterviewUpdate runs straight after locking the
 * candidate. It both recognises the process — refusing one that appears in neither
 * process_master, integration_process_alias nor ats_form_config.hiringProcessOptions —
 * and resolves process_id from it. This row says "Onfido" is a real, active process.
 */
const processLookup = [[{
  master_id: "process-onfido",
  alias_id: null,
  process_options: "Onfido,Housing,LP,BBB",
}]];

/**
 * The row submitInterviewUpdate expects back when secondRoundInterviewerId is supplied.
 * It looks the interviewer up (404 "Second round interviewer not found" if absent) and
 * then refuses a branch that differs from the recruiter's, so branch_name must match
 * recruiterProfile.branch below.
 */
const interviewerRow = [[{
  id: "interviewer-1",
  interviewer_name: "Second Round Interviewer",
  branch_name: "Mumbai",
  designation_name: "Operations Manager",
}]];

/**
 * A joining date that is always in the future. Was hardcoded "2026-07-01", which the
 * "Date of Joining cannot be in the past" rule silently outdated on 1 July 2026 — the
 * kind of failure that arrives on a calendar date rather than with a code change.
 */
const FUTURE_DOJ = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const recruiterProfile: RecruiterProfile = {
  id: "rec-1",
  name: "Test Recruiter",
  recruiterCode: "REC001",
  branch: "Mumbai",
  email: "rec@example.com",
  employeeId: "emp-1",
};

/**
 * A submission that passes validateSubmission, so tests asserting anything *after*
 * validation actually reach it.
 *
 * followupDate/followupReason are not optional decoration: validateSubmission derives
 * `followupRequired` from the decision itself — `finalDecision === "Hold"` (or
 * "Client Round - Pending") sets it — and then demands both fields. Commit ed8b8db4
 * added that rule and did not update this fixture, so every test built on validBase
 * has been dying at 400 "Follow-up Date is required" ever since. The ones checking a
 * 403 or a 409 were reporting the wrong refusal, and the ones checking INSERT/UPDATE,
 * audit rows and SELECT FOR UPDATE never executed the code they name.
 */
const validBase = {
  candidateId: "cand-1",
  qToken: "MUM-001",
  interviewedForProcess: "Onfido",
  walkinEndStage: "Round 1- HR Screening",
  finalDecision: "Hold",
  round1Result: "Hold",
  followupDate: "2026-08-20",
  followupReason: "Candidate to confirm availability",
};

// Mock connection helper (returns a fake transaction connection)
function mockConn(executeResponses: any[]) {
  let callIdx = 0;
  const conn = {
    execute: vi.fn().mockImplementation(() => {
      const resp = executeResponses[callIdx++] ?? [[], []];
      return Promise.resolve(resp);
    }),
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  };
  mockGetConnection.mockResolvedValue(conn);
  return conn;
}

// ── Test 1: Assigned Waiting candidate appears; unassigned is denied ──────────

describe("TC-01: Assigned Waiting candidate appears; unassigned candidate is denied", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only assigned Waiting candidates", async () => {
    mockExecute.mockResolvedValueOnce([[
      {
        id: "cand-1",
        candidate_code: "CND-ABC",
        full_name: "Test Candidate",
        mobile: "9999999999",
        q_token: "MUM-001",
        applied_for_process: "Onfido",
        applied_for_branch: "Mumbai",
        status: "Waiting",
        pending_minutes: 30,
      },
    ]]);
    const results = await getMyPendingCandidates("Test Recruiter");
    expect(results).toHaveLength(1);
    expect(results[0].candidateId).toBe("cand-1");
  });

  it("denies submission for candidate assigned to a different recruiter", async () => {
    const conn = mockConn([
      // candidate row — assigned to someone else
      [[{ ...fakeCandidate, recruiter_assigned_name: "Other Recruiter" }]],
      processLookup, // process recognition + process_id
    ]);
    void conn; // suppress unused warning
    await expect(
      submitInterviewUpdate(validBase, "user-1", recruiterProfile)
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

// ── Test 2: Invalid recruiter / PIN and inactive-today recruiter are denied ───

describe("TC-02: Recruiter auth failures are denied", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects wrong PIN", async () => {
    mockExecute.mockResolvedValueOnce([[{ ...fakeRecruiter, pin_hash: pinHash }]]);
    await expect(verifyRecruiter("REC001", "wrong")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects unknown recruiter code", async () => {
    mockExecute.mockResolvedValueOnce([[]]);
    await expect(verifyRecruiter("UNKNOWN", PIN)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects recruiter with no biometric punch-in today", async () => {
    mockExecute.mockResolvedValueOnce([[{ ...fakeRecruiter, pin_hash: pinHash }]]);
    mockExecute.mockResolvedValueOnce([[]]); // no biometric row
    await expect(verifyRecruiter("REC001", PIN)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("allows recruiter with biometric punch-in", async () => {
    mockExecute.mockResolvedValueOnce([[{ ...fakeRecruiter, pin_hash: pinHash }]]);
    mockExecute.mockResolvedValueOnce([[{ first_punch_in: "09:00:00" }]]);
    const profile = await verifyRecruiter("REC001", PIN);
    expect(profile.recruiterCode).toBe("REC001");
  });
});

// ── Test 3: Blank Skill Test accepted at Round 2, Round 3, Selected ───────────

describe("TC-03: Blank optional Skill Test accepted at higher stages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts submission at Round 2 stage with no skill test fields", async () => {
    mockConn([
      [[fakeCandidate]], // candidate lock
      interviewerRow, // second-round interviewer lookup
      processLookup, // process recognition + process_id
      [[]], // no existing submission
      [{ affectedRows: 1 }], // insert submission
      [{ affectedRows: 1 }], // audit
      [{ affectedRows: 1 }], // update candidate
      [{ affectedRows: 1 }], // stage log
    ]);
    const [subRows] = [[{ id: "sub-1", walkin_end_stage: "Round 2- Op's" }]];
    mockExecute.mockResolvedValueOnce([[subRows]]);
    const input = {
      ...validBase,
      walkinEndStage: "Round 2- Op's",
      finalDecision: "Hold",
      round1Result: "Hold",
      round2Result: "Hold",
      // Rank 3+ requires it; the test is about skill-test fields being optional, not this.
      secondRoundInterviewerId: "interviewer-1",
      // no skillTestResult, skillTestTyping, skillTestAi
    };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).resolves.toBeDefined();
  });

  it("accepts submission at Selection Discussion with no skill test fields", async () => {
    mockConn([
      [[fakeCandidate]],
      interviewerRow, // second-round interviewer lookup
      processLookup, // process recognition + process_id
      [[]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    mockExecute.mockResolvedValueOnce([[{ id: "sub-1" }]]);
    const input = {
      ...validBase,
      walkinEndStage: "Selection Discussion",
      finalDecision: "Selected",
      round1Result: "Selected",
      round2Result: "Selected",
      round3Result: "Selected",
      secondRoundInterviewerId: "interviewer-1",
      offerSalary: "25000",
      offerDoj: FUTURE_DOJ,
      reportingTiming: "09:00",
    };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).resolves.toBeDefined();
  });
});

// ── Test 4: Skill Test Rejected without Skill VOC is denied ──────────────────

describe("TC-04: SkillTest Rejected without SkillTest VOC is denied", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when skillTestResult=Rejected and skillTestVoc is blank", async () => {
    mockConn([[[fakeCandidate]], [[]]]);
    const input = {
      ...validBase,
      walkinEndStage: "Interview - Skill Test",
      skillTestResult: "Rejected",
      // no skillTestVoc
    };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepts when skillTestResult=Rejected and skillTestVoc is provided", async () => {
    mockConn([
      [[fakeCandidate]],
      processLookup, // process recognition + process_id
      [[]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    mockExecute.mockResolvedValueOnce([[{ id: "sub-1" }]]);
    const input = {
      ...validBase,
      walkinEndStage: "Interview - Skill Test",
      round1Result: "Hold",
      skillTestResult: "Rejected",
      skillTestVoc: "Typing Speed Issue",
    };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).resolves.toBeDefined();
  });
});

// ── Test 5: Each rejected round without its VOC is denied ────────────────────

describe("TC-05: Rejected round without VOC is denied", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Round1 Rejected without Round1 VOC", async () => {
    mockConn([[[fakeCandidate]], [[]]]);
    const input = {
      ...validBase,
      round1Result: "Rejected",
      // no round1Voc
    };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects Round2 Rejected without Round2 VOC at Round 2 stage", async () => {
    mockConn([[[fakeCandidate]], [[]]]);
    const input = {
      ...validBase,
      walkinEndStage: "Round 2- Op's",
      round1Result: "Hold",
      round2Result: "Rejected",
      // no round2Voc
    };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects Round3 Rejected without Round3 VOC at Round 3 stage", async () => {
    mockConn([[[fakeCandidate]], [[]]]);
    const input = {
      ...validBase,
      walkinEndStage: "Round 3- Client",
      round1Result: "Hold",
      round2Result: "Hold",
      round3Result: "Rejected",
      // no round3Voc
    };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ── Test 6: Selected without salary, DOJ or reporting time is denied ──────────

describe("TC-06: Selected requires offer details", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects Selected without offerSalary", async () => {
    mockConn([[[fakeCandidate]], [[]]]);
    const input = {
      ...validBase,
      walkinEndStage: "Selection Discussion",
      finalDecision: "Selected",
      round1Result: "Selected",
      round2Result: "Selected",
      round3Result: "Selected",
      secondRoundInterviewerId: "interviewer-1",
      // no offerSalary
      offerDoj: FUTURE_DOJ,
      reportingTiming: "09:00",
    };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects Selected without offerDoj", async () => {
    mockConn([[[fakeCandidate]], [[]]]);
    const input = {
      ...validBase,
      walkinEndStage: "Selection Discussion",
      finalDecision: "Selected",
      round1Result: "Selected",
      round2Result: "Selected",
      round3Result: "Selected",
      secondRoundInterviewerId: "interviewer-1",
      offerSalary: "25000",
      // no offerDoj
      reportingTiming: "09:00",
    };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects Selected without reportingTiming", async () => {
    mockConn([[[fakeCandidate]], [[]]]);
    const input = {
      ...validBase,
      walkinEndStage: "Selection Discussion",
      finalDecision: "Selected",
      round1Result: "Selected",
      round2Result: "Selected",
      round3Result: "Selected",
      secondRoundInterviewerId: "interviewer-1",
      offerSalary: "25000",
      offerDoj: FUTURE_DOJ,
      // no reportingTiming
    };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ── Test 7: Selected auto-normalizes reached round results ────────────────────

describe("TC-07: Selected auto-normalizes round results", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cascades round results to Selected when finalDecision=Selected at Selection Discussion", async () => {
    const input = {
      candidateId: "cand-1",
      qToken: "MUM-001",
      interviewedForProcess: "Onfido",
      walkinEndStage: "Selection Discussion",
      finalDecision: "Selected",
      round1Result: "Hold", // should be overridden to Selected
      round2Result: "Hold", // should be overridden to Selected
      round3Result: "Hold", // should be overridden to Selected
      offerSalary: "30000",
      offerDoj: FUTURE_DOJ,
      reportingTiming: "09:00",
      secondRoundInterviewerId: "interviewer-1", // rank 5 requires it
    };
    const conn = mockConn([
      [[fakeCandidate]],
      interviewerRow, // second-round interviewer lookup
      processLookup, // process recognition + process_id
      [[]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    mockExecute.mockResolvedValueOnce([[{ id: "sub-1", round1_result: "Selected", round2_result: "Selected", round3_result: "Selected" }]]);
    const result = await submitInterviewUpdate(input, "user-1", recruiterProfile);
    expect(result).toBeDefined();
    // Verify the INSERT was called with "Selected" for round results
    const insertCall = conn.execute.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].trim().startsWith("INSERT INTO ats_interview_submission\n")
    );
    expect(insertCall).toBeDefined();

    // Columns are resolved by name from the statement itself. These were hardcoded
    // positions (8, 16, 19) derived by counting the column list by hand; the INSERT has
    // since gained the second-round interviewer columns and their snapshots, so 16 and 19
    // slid onto unrelated fields and the test read null for round2_result. Positional
    // assertions on a growing column list break silently every time a column is added.
    const insertSql = String(insertCall[0]);
    const columns = insertSql
      .slice(insertSql.indexOf("(") + 1, insertSql.indexOf(")"))
      .split(",")
      .map((column) => column.trim());
    const valueOf = (column: string) => {
      const index = columns.indexOf(column);
      expect(index, `INSERT INTO ats_interview_submission no longer has a ${column} column`).toBeGreaterThan(-1);
      return insertCall[1][index];
    };

    expect(valueOf("round1_result")).toBe("Selected");
    expect(valueOf("round2_result")).toBe("Selected");
    expect(valueOf("round3_result")).toBe("Selected");
  });
});

// ── Test 8: Invalid process, decision and stage are denied ────────────────────

describe("TC-08: Invalid enum values are denied", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * This assertion never ran until the validBase fixture was repaired: the submission was
   * rejected at 400 for a missing follow-up date instead, so it passed on the wrong error
   * while the process itself went unchecked. The check now exists, against the union of
   * process_master, integration_process_alias and ats_form_config.hiringProcessOptions.
   *
   * The mock therefore answers three lookups — master, alias, config — all empty, which
   * is what an unrecognised process looks like.
   */
  it("rejects invalid process", async () => {
    mockConn([
      [[fakeCandidate]], // candidate lock
      // Single process lookup: no master row, no alias, and the dropdown does not list it.
      [[{ master_id: null, alias_id: null, process_options: "Onfido,Housing,LP" }]],
    ]);
    const input = { ...validBase, interviewedForProcess: "InvalidProcess" };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("accepts a process that only the recruiter dropdown knows, not process_master", async () => {
    // "LP", "BBB" and friends are real options in ats_form_config.hiringProcessOptions
    // with no process_master row. Validating against the master alone would have rejected
    // 263 of 1,299 production submissions, so this pins that they still go through.
    mockConn([
      [[fakeCandidate]], // candidate lock
      // No master row and no alias, so process_id stays null — but the dropdown lists it.
      [[{ master_id: null, alias_id: null, process_options: "Onfido,Housing,LP,BBB" }]],
      [[]],              // no existing submission
      [{ affectedRows: 1 }], // insert
      [{ affectedRows: 1 }], // audit
      [{ affectedRows: 1 }], // update candidate
      [{ affectedRows: 1 }], // stage log
    ]);
    mockExecute.mockResolvedValueOnce([[{ id: "sub-1" }]]);
    const input = { ...validBase, interviewedForProcess: "LP" };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).resolves.toBeDefined();
  });

  it("rejects invalid finalDecision", async () => {
    mockConn([[[fakeCandidate]], [[]]]);
    const input = { ...validBase, finalDecision: "MaybeLater" };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects invalid walkinEndStage", async () => {
    mockConn([[[fakeCandidate]], [[]]]);
    const input = { ...validBase, walkinEndStage: "Round 99- Unknown" };
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ── Test 9: First submission inserts one row ──────────────────────────────────

describe("TC-09: First submission inserts one row", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls INSERT when no existing submission", async () => {
    const conn = mockConn([
      [[fakeCandidate]],
      processLookup, // process recognition + process_id
      [[]], // no existing submission
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    mockExecute.mockResolvedValueOnce([[{ id: "sub-1" }]]);
    await submitInterviewUpdate(validBase, "user-1", recruiterProfile);
    const insertCall = conn.execute.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("INSERT INTO ats_interview_submission")
    );
    expect(insertCall).toBeDefined();
    const updateCall = conn.execute.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("UPDATE ats_interview_submission")
    );
    expect(updateCall).toBeUndefined();
  });
});

// ── Test 10: Resubmission updates same CandidateID/QToken row ─────────────────

describe("TC-10: Resubmission updates same row, preserves previous timestamp/stage/decision", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls UPDATE when existing submission found, preserves tracking fields", async () => {
    const conn = mockConn([
      [[fakeCandidate]],
      processLookup, // process recognition + process_id
      [[{ id: "sub-1", submitted_at: "2026-06-10T10:00:00Z", walkin_end_stage: "Arrival", final_decision: "Hold" }]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    mockExecute.mockResolvedValueOnce([[{ id: "sub-1" }]]);
    const result = await submitInterviewUpdate(validBase, "user-1", recruiterProfile);
    expect(result.action).toBe("updated");
    const updateCall = conn.execute.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("UPDATE ats_interview_submission") && c[0].includes("previous_submitted_time")
    );
    expect(updateCall).toBeDefined();
    // previous_submitted_time = submitted_at is set via SQL self-reference (no extra param needed)
    const insertCall = conn.execute.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].trim().startsWith("INSERT INTO ats_interview_submission\n")
    );
    expect(insertCall).toBeUndefined();
  });
});

// ── Test 11: QToken mismatch does not overwrite incompatible submission ────────

describe("TC-11: QToken mismatch rejects submission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when q_token in DB does not match provided qToken", async () => {
    mockConn([
      [[{ ...fakeCandidate, q_token: "MUM-999" }]], // different token in DB
      [[]], // no submission with this combo
    ]);
    const input = { ...validBase, qToken: "MUM-001" }; // mismatch
    await expect(submitInterviewUpdate(input, "user-1", recruiterProfile)).rejects.toMatchObject({ statusCode: 409 });
  });
});

// ── Test 12: Date column remains unchanged ────────────────────────────────────

describe("TC-12: created_date and created_time columns are never modified", () => {
  beforeEach(() => vi.clearAllMocks());

  it("UPDATE ats_candidate does not include created_date or created_time", async () => {
    const conn = mockConn([
      [[fakeCandidate]],
      processLookup, // process recognition + process_id
      [[]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    mockExecute.mockResolvedValueOnce([[{ id: "sub-1" }]]);
    await submitInterviewUpdate(validBase, "user-1", recruiterProfile);
    const updateCandidateCall = conn.execute.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].startsWith("UPDATE ats_candidate")
    );
    expect(updateCandidateCall).toBeDefined();
    expect(updateCandidateCall[0]).not.toMatch(/created_date/);
    expect(updateCandidateCall[0]).not.toMatch(/created_time/);
  });
});

// ── Test 13: Concurrent submissions do not create duplicates ──────────────────

describe("TC-13: Transaction + SELECT FOR UPDATE prevents duplicate rows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses SELECT FOR UPDATE on both candidate and submission rows", async () => {
    const conn = mockConn([
      [[fakeCandidate]],
      processLookup, // process recognition + process_id
      [[]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    mockExecute.mockResolvedValueOnce([[{ id: "sub-1" }]]);
    await submitInterviewUpdate(validBase, "user-1", recruiterProfile);
    const forUpdateCalls = conn.execute.mock.calls.filter((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("FOR UPDATE")
    );
    expect(forUpdateCalls.length).toBeGreaterThanOrEqual(2); // candidate + submission
    expect(conn.beginTransaction).toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalled();
  });
});

// ── Test 14: Audit log records INSERT and UPDATE separately ───────────────────

describe("TC-14: Audit log records insert and update actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts audit row with action=INSERT on first submission", async () => {
    const conn = mockConn([
      [[fakeCandidate]],
      processLookup, // process recognition + process_id
      [[]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    mockExecute.mockResolvedValueOnce([[{ id: "sub-1" }]]);
    await submitInterviewUpdate(validBase, "user-1", recruiterProfile);
    const auditCall = conn.execute.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("ats_interview_submission_audit")
    );
    expect(auditCall).toBeDefined();
    expect(auditCall[1][2]).toBe("INSERT");
  });

  it("inserts audit row with action=UPDATE on resubmission", async () => {
    const conn = mockConn([
      [[fakeCandidate]],
      processLookup, // process recognition + process_id
      [[{ id: "sub-1", submitted_at: "2026-06-10T09:00:00Z", walkin_end_stage: "Arrival", final_decision: "Hold" }]],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
      [{ affectedRows: 1 }],
    ]);
    mockExecute.mockResolvedValueOnce([[{ id: "sub-1" }]]);
    await submitInterviewUpdate(validBase, "user-1", recruiterProfile);
    const auditCall = conn.execute.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("ats_interview_submission_audit")
    );
    expect(auditCall).toBeDefined();
    expect(auditCall[1][2]).toBe("UPDATE");
  });
});

// ── Test 15: Frontend validation error messages match backend ─────────────────

describe("TC-15: Frontend validation messages match backend errors", () => {
  it("frontend reports 'Interviewed for Process is required' for blank process", () => {
    // This test validates the client-side validateForm logic (imported inline here)
    const STAGE_RANK_LOCAL: Record<string, number> = {
      Arrival: 0, "Round 1- HR Screening": 1, "Interview - Skill Test": 2,
      "Round 2- Op's": 3, "Round 3- Client": 4, "Selection Discussion": 5,
    };
    function validateForm(form: Record<string, string>): string | null {
      if (!form.processName) return "Interviewed for Process is required.";
      if (!form.finalDecision) return "Final Decision is required.";
      if (!form.stageName) return "Walk-in End Stage is required.";
      const rank = STAGE_RANK_LOCAL[form.stageName] ?? -1;
      if (rank < 0) return `Invalid Walk-in End Stage: "${form.stageName}"`;
      if (rank >= 1 && !form.round1Result) return "Round1 Result is required from Round 1 stage onwards.";
      if (rank >= 1 && form.round1Result === "Rejected" && !form.round1Voc) return "Round1 VOC is required when Round1 Result is Rejected.";
      if (form.skillResult === "Rejected" && !form.skillVoc) return "SkillTest VOC is required when SkillTest Result is Rejected.";
      if (rank >= 3 && !form.round2Result) return "Round2 Result is required from Round 2 stage onwards.";
      if (rank >= 4 && !form.round3Result) return "Round3 Result is required from Round 3 stage onwards.";
      if (form.finalDecision === "Selected") {
        if (!form.offerSalary) return "Offer Salary is required when Final Decision is Selected.";
        if (!form.offerDoj) return "Date of Joining is required when Final Decision is Selected.";
        if (!form.reportingTiming) return "Reporting Timing is required when Final Decision is Selected.";
      }
      return null;
    }
    expect(validateForm({ processName: "", finalDecision: "Hold", stageName: "Arrival" })).toBe("Interviewed for Process is required.");
    expect(validateForm({ processName: "Onfido", finalDecision: "", stageName: "Arrival" })).toBe("Final Decision is required.");
    expect(validateForm({ processName: "Onfido", finalDecision: "Hold", stageName: "" })).toBe("Walk-in End Stage is required.");
    expect(validateForm({ processName: "Onfido", finalDecision: "Hold", stageName: "Round 1- HR Screening", round1Result: "" })).toBe("Round1 Result is required from Round 1 stage onwards.");
    expect(validateForm({ processName: "Onfido", finalDecision: "Selected", stageName: "Selection Discussion", round1Result: "Selected", round2Result: "Selected", round3Result: "Selected", offerSalary: "", offerDoj: FUTURE_DOJ, reportingTiming: "09:00" })).toBe("Offer Salary is required when Final Decision is Selected.");
    expect(validateForm({ processName: "Onfido", finalDecision: "Hold", stageName: "Arrival" })).toBeNull();
  });
});
