/**
 * The legacy "short form" onboarding path (/onboard → submit-profile) used to
 * mark a profile submitted with zero document validation — its "photo" field
 * was a free-text URL box, not a capture. A live DB check on 2026-08-29 found
 * 51 of 91 submitted profiles (56%) had no Live Selfie document as a result,
 * 9 of them already real employees with no photo.
 *
 * submitProfile() must now require the same real Live Selfie document the
 * canonical full-onboarding flow requires (see hasLiveSelfieDocument in
 * onboarding-full.service.ts) before it will mark a profile submitted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Rows = Record<string, unknown>[];
const state: { docs?: Rows } = {};

const CANDIDATE = "11111111-2222-3333-4444-555555555555";

const dbExecute = vi.fn(async (sql: string) => {
  const s = String(sql);
  if (s.includes("ats_onboarding_bridge")) {
    return [[{
      candidate_id: CANDIDATE,
      onboarding_token_expires_at: "2099-01-01T00:00:00.000Z",
      full_name: "TEST CANDIDATE",
      profile_status: "in_progress",
    }]];
  }
  if (s.includes("candidate_onboarding_document")) return [state.docs ?? []];
  return [[]];
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { submitProfile } = await import("../ats.onboarding.service.js");

beforeEach(() => {
  state.docs = [];
  dbExecute.mockClear();
});

describe("submitProfile — mandatory Live Selfie gate", () => {
  it("rejects submission when no Live Selfie document exists", async () => {
    state.docs = [];
    await expect(submitProfile("tok", { father_name: "X" })).rejects.toMatchObject({
      statusCode: 400,
      code: "MISSING_REQUIRED_DOCUMENTS",
    });
  });

  it("rejects when only non-selfie documents exist", async () => {
    state.docs = [{ doc_type: "Aadhaar", doc_name: "Aadhaar Card" }];
    await expect(submitProfile("tok", {})).rejects.toMatchObject({
      code: "MISSING_REQUIRED_DOCUMENTS",
    });
  });

  it("succeeds once a Live Selfie document exists", async () => {
    state.docs = [{ doc_type: "Live Selfie", doc_name: "Live Selfie (Identity Verification)" }];
    await expect(submitProfile("tok", { father_name: "X" })).resolves.toMatchObject({
      candidateId: CANDIDATE,
    });
  });

  it("does not write any profile data before the gate is checked", async () => {
    // Regression guard: the old code updated ats_candidate/ats_onboarding_request
    // /candidate_onboarding_profile unconditionally. Confirm a rejected
    // submission makes no such write.
    state.docs = [];
    await expect(submitProfile("tok", { father_name: "X" })).rejects.toBeTruthy();
    const wroteProfile = dbExecute.mock.calls.some(([sql]) =>
      String(sql).includes("UPDATE ats_candidate SET") || String(sql).includes("INSERT INTO candidate_onboarding_profile"),
    );
    expect(wroteProfile).toBe(false);
  });
});
