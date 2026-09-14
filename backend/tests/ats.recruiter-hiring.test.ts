import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([[], []]),
  },
}));

vi.mock("../src/modules/ats/ats.service.js", () => ({
  atsService: {
    createCandidate: vi.fn(),
  },
}));

vi.mock("../src/modules/ats/ats.queue.service.js", () => ({
  atsQueueService: {
    createToken: vi.fn(),
  },
}));

vi.mock("../src/modules/ats/ats.onboarding.service.js", () => ({
  sendOnboardingToken: vi.fn(),
}));

import { db } from "../src/db/mysql.js";
import { atsService } from "../src/modules/ats/ats.service.js";
import { atsQueueService } from "../src/modules/ats/ats.queue.service.js";
import { mapSheetRow, importHiringActivityRows, createCandidateFromActivity, createTokenFromActivity, __test__ } from "../src/modules/ats/recruiter-hiring.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

function resetDb() {
  vi.clearAllMocks();
  mockExecute.mockReset().mockResolvedValue([[], []]);
}

describe("hiring activity sheet mapping", () => {
  beforeEach(resetDb);

  it("accepts the exact sheet headers and normalizes booleans, dates, month, salary, and mobile", () => {
    const { normalized, errors } = mapSheetRow({
      Date: "28-Apr-25",
      "HR Recruiter": "  Shivam  ",
      "Hiring Source": "Employee Referral",
      "WP Groups": "Group A",
      Position: "Sales Executive",
      Location: "Delhi",
      "Process Name": "Inbound",
      "Candidate Name": "  Priya Singh ",
      Gender: "Female",
      "Mobile No.": "+91 98765 43210",
      "Candidate Education Qualification": "Graduate",
      "HR Recruiter Remarks": "Shortlisted",
      "HR Recruiter_Rejection Reasons": "",
      "Candidate Email Address": "priya@example.com",
      "Experience Level": "1-2 years",
      "Candidate Location": "Delhi",
      "PI_HR Interviewer_ Date": "Apr'25",
      "PI_HR Interviewer": "Rahul",
      "HR Interview Status": "Selected",
      "HR Rejection Reason": "",
      "AI Assessment Score": "87.5",
      "AI Interview Result": "Pass",
      "Ops Interviewer Name": "Ops One",
      "Ops Interview Status": "Selected",
      "Ops Rejection Reason": "",
      "Salary Package in INR": "₹ 25,000.50",
      "Offer Letter": "Sent",
      "Joining Status": "Joined",
      Month: "April 2025",
      "Batch No.": "B-1",
      "Current Status": "Selected",
      "Joined Candidate's Emp Code": "MAS1001",
      "Emp Referral Details": "Employee referral from branch",
      Walkin: "yes",
      "FInal Selection": "yes",
      Joined: "yes",
      Contacted: "",
    });

    expect(errors).toHaveLength(0);
    expect(normalized?.activity_date).toBe("2025-04-28");
    expect(normalized?.recruiter_name_snapshot).toBe("Shivam");
    expect(normalized?.mobile).toBe("9876543210");
    expect(normalized?.activity_month).toContain("Apr");
    expect(normalized?.salary_package_inr).toBe(25000.5);
    expect(normalized?.walkin_flag).toBe(1);
    expect(normalized?.final_selection_flag).toBe(1);
    expect(normalized?.joined_flag).toBe(1);
    expect(normalized?.contacted_flag).toBe(0);
  });

  it("aliases Final Selection and Joined Candidate Emp Code", () => {
    const { normalized } = mapSheetRow({
      Date: "2025-04-28",
      "HR Recruiter": "Shivam",
      "Hiring Source": "Walk-In",
      Position: "Executive",
      Location: "Delhi",
      "Process Name": "Inbound",
      "Candidate Name": "Asha",
      "Mobile No.": "9999999999",
      "Final Selection": "1",
      "Joined Candidate Emp Code": "MAS2001",
    });
    expect(normalized?.final_selection_flag).toBe(1);
    expect(normalized?.joined_candidate_emp_code).toBe("MAS2001");
  });
});

describe("import flow", () => {
  beforeEach(resetDb);

  it("imports valid rows and logs invalid rows without rejecting the whole file", async () => {
    mockExecute
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // batch insert
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // row 1 insert
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // error insert
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // batch update

    const result = await importHiringActivityRows(
      [
        {
          Date: "2025-04-28",
          "HR Recruiter": "Shivam",
          "Hiring Source": "Walk-In",
          Position: "Agent",
          Location: "Delhi",
          "Process Name": "Inbound",
          "Candidate Name": "Asha",
          "Mobile No.": "9999999999",
        },
        {
          Date: "",
          "HR Recruiter": "Shivam",
        },
      ],
      "user-1",
      "sample.xlsx"
    );

    expect(result.totalRows).toBe(2);
    expect(result.insertedRows).toBe(1);
    expect(result.failedRows).toBe(1);
    expect(result.errors[0].error_message).toMatch(/Date is required/);
  });
});

describe("tracker actions", () => {
  beforeEach(resetDb);

  it("creates a candidate from a linked activity row when no match exists", async () => {
    mockExecute
      .mockResolvedValueOnce([[{
        id: "activity-1",
        activity_date: "2025-04-28",
        recruiter_name_snapshot: "Shivam",
        hiring_source: "Walk-In",
        position_name: "Agent",
        location_name: "Delhi",
        process_name: "Inbound",
        candidate_name: "Asha",
        mobile: "9999999999",
        raw_sheet_payload: {},
      }]]) // load activity
      .mockResolvedValueOnce([[]]) // mobile lookup
      .mockResolvedValueOnce([[]]) // name+mobile
      .mockResolvedValueOnce([[]]) // email
      .mockResolvedValueOnce([[]]) // employee code
      .mockResolvedValueOnce([[]]) // candidate code
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // link update
      .mockResolvedValueOnce([[{
        id: "cand-1",
        full_name: "Asha",
        mobile: "9999999999",
      }]]); // fetch candidate from createCandidate mock path
    (atsService.createCandidate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "cand-1",
      full_name: "Asha",
      mobile: "9999999999",
    });

    const result = await createCandidateFromActivity("activity-1", "user-1");
    expect(result.created).toBe(true);
    expect((atsService.createCandidate as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      fullName: "Asha",
      mobile: "9999999999",
      appliedForProcess: "Inbound",
    });
  });

  it("creates a walk-in token and updates the human-readable token number", async () => {
    mockExecute
      .mockResolvedValueOnce([[{
        id: "activity-1",
        activity_date: "2025-04-28",
        recruiter_name_snapshot: "Shivam",
        hiring_source: "Walk-In",
        position_name: "Agent",
        location_name: "Delhi",
        branch_name: "Delhi",
        process_name: "Inbound",
        candidate_name: "Asha",
        mobile: "9999999999",
        raw_sheet_payload: {},
      }]]) // load activity
      .mockResolvedValueOnce([[{ id: "cand-1", full_name: "Asha", mobile: "9999999999" }]]) // mobile lookup resolves candidate
      .mockResolvedValueOnce([[{ total: 0 }]]) // token count for human token number
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // token number update
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // candidate snapshot update
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // activity link update
    (atsQueueService.createToken as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "tok-1",
      candidate_id: "cand-1",
      token: "uuid",
      status: "active",
    });

    const result = await createTokenFromActivity("activity-1", "user-1");
    expect(result.token.token_number).toContain("DEL-20250428");
  });
});

describe("__test__ helpers", () => {
  it("generates a deterministic token prefix", () => {
    expect(__test__.tokenNumberFor("Delhi", "2025-04-28", 7)).toBe("DEL-20250428-007");
  });
});
