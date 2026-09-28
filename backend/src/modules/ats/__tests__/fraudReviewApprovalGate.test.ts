/**
 * HR cannot approve an onboarding profile while the fraud check has a serious alert
 * still waiting for a decision. The Approve button is disabled on screen, but a screen
 * is not a control — reviewFullOnboarding() refuses on the server too.
 *
 * Push Back and Reject are never gated: sending a suspicious profile back must always
 * be possible.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { reviewFullOnboarding } = await import("../onboarding-full.service.js");

const CANDIDATE_ID = "a7edfea8-fcfd-4744-9223-f109eefcadaf";
const REACHED_SYNC = "REACHED_STATUS_SYNC";

let alertRows: Array<{ alert_type: string }> = [];
const seen: string[] = [];

beforeEach(() => {
  execute.mockReset();
  seen.length = 0;
  alertRows = [];
  execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    seen.push(s);
    if (s.includes("branch_master br_scope")) return [[{ id: CANDIDATE_ID }], []];
    if (s.includes("FROM candidate_fraud_alert")) return [alertRows, []];
    // The first write after the gate is the status sync: reaching it means the gate let the call through.
    if (s.includes("UPDATE ats_candidate SET profile_status")) throw new Error(REACHED_SYNC);
    return [[], []];
  });
});

describe("reviewFullOnboarding — fraud review gate", () => {
  it("refuses to approve while a critical or high alert is unresolved", async () => {
    alertRows = [{ alert_type: "DUPLICATE_AADHAAR" }];
    await expect(reviewFullOnboarding(CANDIDATE_ID, { status: "approved" }, "hr-1")).rejects.toMatchObject({
      statusCode: 409,
      code: "FRAUD_REVIEW_REQUIRED",
      message: expect.stringContaining("duplicate aadhaar"),
    });
    expect(seen.some((s) => s.includes("UPDATE ats_candidate"))).toBe(false);
  });

  it("names every kind of alert that is holding approval", async () => {
    alertRows = [{ alert_type: "DUPLICATE_PAN" }, { alert_type: "FACE_MISMATCH" }, { alert_type: "DUPLICATE_PAN" }];
    await expect(reviewFullOnboarding(CANDIDATE_ID, { status: "approved" }, "hr-1")).rejects.toThrow(/duplicate pan, face mismatch/);
  });

  it("counts alerts still 'under review' as unresolved, and only critical or high ones", async () => {
    alertRows = [];
    await expect(reviewFullOnboarding(CANDIDATE_ID, { status: "approved" }, "hr-1")).rejects.toThrow(REACHED_SYNC);
    const gateSql = seen.find((s) => s.includes("FROM candidate_fraud_alert")) ?? "";
    expect(gateSql).toContain("'open', 'under_review'");
    expect(gateSql).toContain("'critical', 'high'");
  });

  it("lets approval through when nothing serious is waiting", async () => {
    alertRows = [];
    await expect(reviewFullOnboarding(CANDIDATE_ID, { status: "approved" }, "hr-1")).rejects.toThrow(REACHED_SYNC);
  });

  it("never gates Push Back, even with a serious alert open", async () => {
    alertRows = [{ alert_type: "DUPLICATE_AADHAAR" }];
    await expect(
      reviewFullOnboarding(CANDIDATE_ID, { status: "hr_review", remarks: "please correct the Aadhaar" }, "hr-1"),
    ).rejects.toThrow(REACHED_SYNC);
    expect(seen.some((s) => s.includes("FROM candidate_fraud_alert"))).toBe(false);
  });

  it("never gates Reject", async () => {
    alertRows = [{ alert_type: "DUPLICATE_AADHAAR" }];
    await expect(reviewFullOnboarding(CANDIDATE_ID, { status: "rejected", remarks: "fraud" }, "hr-1")).rejects.toThrow(REACHED_SYNC);
  });
});
