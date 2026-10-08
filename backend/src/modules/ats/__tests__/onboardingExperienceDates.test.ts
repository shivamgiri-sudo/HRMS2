import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The candidate onboarding journey asks for previous employment "From Date",
 * "To Date" and reason for leaving, posts them (`{ token, ...experience }`),
 * and reads them straight back out of the saved row. The INSERT in
 * saveExperienceDetails named neither date column, so MySQL accepted the row
 * and dropped the values: `candidate_onboarding_experience` holds 74 rows, 12
 * of them naming an employer, and 0 with a from_date or a to_date.
 *
 * Date of exit from the previous establishment is a required field on EPF
 * Form 11, so this silently pushed a question the candidate had already
 * answered back onto HR.
 *
 * These assertions are about the write, not the response: the old code
 * returned success either way, which is exactly why nobody noticed.
 */

const calls: Array<{ sql: string; params: unknown[] }> = [];

const CANDIDATE = "11111111-2222-3333-4444-555555555555";

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql);
      calls.push({ sql: s, params });
      // validateOnboardingToken reads the token off ats_onboarding_bridge and
      // rejects an expired one, so the row has to carry a future expiry.
      if (s.includes("ats_onboarding_bridge")) {
        return [[{
          candidate_id: CANDIDATE,
          id: CANDIDATE,
          onboarding_token_expires_at: "2099-01-01T00:00:00.000Z",
          full_name: "TEST CANDIDATE",
          profile_status: "in_progress",
        }]];
      }
      return [[]];
    }),
  },
}));

const { saveExperienceDetails } = await import("../onboarding-full.service.js");

const INPUT = {
  workingExperience: "experienced",
  experienceYear: 3,
  employerName: "PREVIOUS EMPLOYER PVT LTD",
  lastDesignation: "SENIOR EXECUTIVE",
  lastCtc: "480000",
  fromDate: "2022-04-01",
  toDate: "2025-11-30",
  reasonForLeaving: "Better opportunity",
};

function experienceInsert() {
  return calls.find(
    (c) => c.sql.includes("candidate_onboarding_experience") && /INSERT/i.test(c.sql),
  );
}

beforeEach(() => {
  calls.length = 0;
});

describe("saveExperienceDetails persists previous-employment dates", () => {
  it("names from_date, to_date and reason_for_leaving in the INSERT", async () => {
    await saveExperienceDetails("any-token", INPUT).catch(() => undefined);

    const insert = experienceInsert();
    expect(insert, "no INSERT into candidate_onboarding_experience was issued").toBeDefined();

    expect(insert!.sql).toContain("from_date");
    expect(insert!.sql).toContain("to_date");
    expect(insert!.sql).toContain("reason_for_leaving");
  });

  it("passes the submitted dates as parameters, not just column names", async () => {
    await saveExperienceDetails("any-token", INPUT).catch(() => undefined);

    const insert = experienceInsert()!;
    expect(insert.params).toContain("2022-04-01");
    expect(insert.params).toContain("2025-11-30");
    expect(insert.params).toContain("Better opportunity");
  });

  it("updates the dates on re-save instead of keeping the first value", async () => {
    // The row is written once per candidate and revised as they edit the step,
    // so an ON DUPLICATE KEY UPDATE that omits the dates would strand whatever
    // was stored first.
    await saveExperienceDetails("any-token", INPUT).catch(() => undefined);

    const insert = experienceInsert()!;
    const onDuplicate = insert.sql.slice(insert.sql.search(/ON DUPLICATE KEY UPDATE/i));
    expect(onDuplicate).toContain("from_date = VALUES(from_date)");
    expect(onDuplicate).toContain("to_date = VALUES(to_date)");
    expect(onDuplicate).toContain("reason_for_leaving = VALUES(reason_for_leaving)");
  });

  it("stores an empty date as NULL rather than the empty string", async () => {
    // The inputs are type=date and post "" when cleared. '' is not a valid DATE
    // and MySQL would coerce it to 0000-00-00 under a lax sql_mode.
    await saveExperienceDetails("any-token", { ...INPUT, fromDate: "", toDate: "" })
      .catch(() => undefined);

    const insert = experienceInsert()!;
    expect(insert.params).not.toContain("");
  });
});
