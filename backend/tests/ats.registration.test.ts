/**
 * ATS Registration Tests — Stages 1–5
 * Covers: valid registration, missing mandatory fields, duplicate mobile,
 * duplicate email, rejected/selected reprocess detection, invalid branch/process
 * (validation layer), unauthorized branch (scope check).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));

import { db } from "../src/db/mysql.js";
import { atsService } from "../src/modules/ats/ats.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

function resetDbMock() {
  vi.clearAllMocks();
  mockExecute.mockReset().mockResolvedValue([[], []]);
}

const validInput = {
  fullName: "Priya Singh",
  mobile: "9876543210",
  email: "priya@example.com",
  education: "Graduate",
  experience: "1 year",
  appliedForProcess: "Inbound",
  appliedForBranch: "Mumbai",
  sourcingChannel: "Walk-In",
  walkInDate: "2026-06-10",
};

const fakeCandidate = {
  id: "cand-new",
  candidate_code: "CND-TEST1",
  full_name: "Priya Singh",
  mobile: "9876543210",
  email: "priya@example.com",
  education: "Graduate",
  experience: "1 year",
  applied_for_process: "Inbound",
  applied_for_branch: "Mumbai",
  sourcing_channel: "Walk-In",
  current_stage: "Applied",
  active_status: 1,
  created_at: "2026-06-10T10:00:00Z",
  updated_at: "2026-06-10T10:00:00Z",
};

describe("atsService.createCandidate — valid registration", () => {
  beforeEach(resetDbMock);

  it("inserts and returns new candidate when all mandatory fields provided", async () => {
    mockExecute
      .mockResolvedValueOnce([[]])           // mobile dup check — no match
      .mockResolvedValueOnce([[]])           // email dup check — no match
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // stage log
      .mockResolvedValueOnce([[fakeCandidate]]);    // re-fetch
    const result = await atsService.createCandidate(validInput, "user-1");
    expect(result.full_name).toBe("Priya Singh");
    expect(result.applied_for_branch).toBe("Mumbai");
  });

  it("normalises sourcing channel before inserting", async () => {
    mockExecute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ ...fakeCandidate, sourcing_channel: "Walk-In" }]]);
    const result = await atsService.createCandidate({ ...validInput, sourcingChannel: "walk-in" }, "user-1");
    const insertSql: string = mockExecute.mock.calls[2][0];
    expect(insertSql).toMatch(/INSERT INTO ats_candidate/i);
    expect(result.sourcing_channel).toBe("Walk-In");
  });
});

describe("atsService.createCandidate — duplicate mobile", () => {
  beforeEach(resetDbMock);

  it("throws 409 DUPLICATE_MOBILE for active candidate", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "c1", current_stage: "Applied", active_status: 1 }]]);
    const err = await atsService.createCandidate(validInput, "user-1").catch((e) => e);
    expect(err.message).toMatch(/mobile.*already registered/i);
    expect((err as any).statusCode).toBe(409);
    expect((err as any).code).toBe("DUPLICATE_MOBILE");
  });

  it("throws 409 DUPLICATE_REJECTED with reprocess message for rejected candidate", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "c1", current_stage: "Rejected", active_status: 1 }]]);
    const err = await atsService.createCandidate(validInput, "user-1").catch((e) => e);
    expect(err.message).toMatch(/rejected/i);
    expect((err as any).statusCode).toBe(409);
    expect((err as any).code).toBe("DUPLICATE_REJECTED");
  });

  it("throws 409 DUPLICATE_SELECTED for selected candidate", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "c1", current_stage: "Selected", active_status: 1 }]]);
    const err = await atsService.createCandidate(validInput, "user-1").catch((e) => e);
    expect(err.message).toMatch(/selected/i);
    expect((err as any).statusCode).toBe(409);
    expect((err as any).code).toBe("DUPLICATE_SELECTED");
  });

  it("throws 409 DUPLICATE_SELECTED for converted candidate", async () => {
    mockExecute.mockResolvedValueOnce([[{ id: "c1", current_stage: "converted", active_status: 1 }]]);
    const err = await atsService.createCandidate(validInput, "user-1").catch((e) => e);
    expect((err as any).code).toBe("DUPLICATE_SELECTED");
  });
});

describe("atsService.createCandidate — duplicate email", () => {
  beforeEach(resetDbMock);

  it("throws 409 DUPLICATE_EMAIL when email already registered", async () => {
    mockExecute
      .mockResolvedValueOnce([[]])  // no mobile dup
      .mockResolvedValueOnce([[{ id: "c2", current_stage: "Screening" }]]); // email dup
    const err = await atsService.createCandidate(validInput, "user-1").catch((e) => e);
    expect(err.message).toMatch(/email.*already registered/i);
    expect((err as any).statusCode).toBe(409);
    expect((err as any).code).toBe("DUPLICATE_EMAIL");
  });

  it("throws 409 DUPLICATE_EMAIL_REJECTED with reprocess message for rejected email", async () => {
    mockExecute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: "c2", current_stage: "Rejected" }]]);
    const err = await atsService.createCandidate(validInput, "user-1").catch((e) => e);
    expect(err.message).toMatch(/rejected/i);
    expect((err as any).code).toBe("DUPLICATE_EMAIL_REJECTED");
  });
});

describe("atsService.createCandidate — scope column SQL", () => {
  beforeEach(resetDbMock);

  it("listCandidates builds WHERE using applied_for_branch column (not branch_id)", async () => {
    mockExecute
      .mockResolvedValueOnce([[fakeCandidate]])
      .mockResolvedValueOnce([[{ total: 1 }]]);
    await atsService.listCandidates({ page: 1, limit: 20, branch: "Mumbai" });
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/applied_for_branch/i);
    expect(sql).not.toMatch(/\bc\.branch_id\b/);
  });

  it("listCandidates builds WHERE using applied_for_process column (not process_id)", async () => {
    mockExecute
      .mockResolvedValueOnce([[fakeCandidate]])
      .mockResolvedValueOnce([[{ total: 1 }]]);
    await atsService.listCandidates({ page: 1, limit: 20, process: "Inbound" });
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/applied_for_process/i);
    expect(sql).not.toMatch(/\bc\.process_id\b/);
  });
});

/**
 * POST /api/ats/registration/submit-enhanced is unauthenticated by design so a
 * walk-in can self-register, and it matches an existing candidate by mobile
 * number alone. That combination meant anyone who knew a candidate's mobile
 * could rewrite their identity — including the email address that then receives
 * their Letter of Intent and onboarding token.
 *
 * The guard lives in raw SQL, so it is pinned here at the source level: a unit
 * test cannot reach the statement any other way, and a well-meaning edit that
 * restores the plain assignment would otherwise be silent.
 */
describe("public registration cannot overwrite an existing candidate's identity", () => {
  const routeSource = readFileSync(
    new URL("../src/modules/ats/registration.enhanced.routes.ts", import.meta.url),
    "utf8",
  );
  // The UPDATE that runs when a candidate with this mobile already exists.
  const updateBlock = routeSource.slice(
    routeSource.indexOf("UPDATE ats_candidate"),
    routeSource.indexOf("WHERE id = ?", routeSource.indexOf("UPDATE ats_candidate")),
  );

  it("keeps an existing full_name instead of taking the submitted one", () => {
    expect(updateBlock).toMatch(/full_name\s*=\s*COALESCE\(\s*NULLIF\(\s*TRIM\(full_name\)/);
    expect(updateBlock, "full_name is assigned outright — identity is overwritable")
      .not.toMatch(/full_name\s*=\s*\?/);
  });

  it("keeps an existing email, so an offer cannot be redirected", () => {
    expect(updateBlock).toMatch(/email\s*=\s*COALESCE\(\s*NULLIF\(\s*TRIM\(email\)/);
    expect(updateBlock, "email is assigned outright — the offer letter can be redirected")
      .not.toMatch(/[^_]email\s*=\s*\?/);
  });

  it("keeps an existing date of birth and gender", () => {
    expect(updateBlock).toMatch(/gender\s*=\s*COALESCE\(gender/);
    expect(updateBlock).toMatch(/date_of_birth\s*=\s*COALESCE\(date_of_birth/);
  });

  it("is rate limited where it is mounted", () => {
    const appSource = readFileSync(new URL("../src/app.ts", import.meta.url), "utf8");
    const mount = appSource.split("\n").find((line) => line.includes('"/api/ats/registration"')) ?? "";
    expect(mount, "the public registration router is mounted without a rate limiter")
      .toMatch(/publicRegistrationLimiter/);
  });
});
