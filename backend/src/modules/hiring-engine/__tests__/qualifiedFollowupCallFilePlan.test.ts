import { describe, expect, it } from "vitest";
import {
  callFileConfig, callFileDriveType, parseCallFileSlots, planCallFile, slotsFromHours, type CallFileCandidate,
} from "../qualified-followup.callfile-plan.js";
import { CALL_FILE_SLOTS } from "../qualified-followup.rules.js";
import type { OfferRow } from "../he-best-offer.js";

const now = new Date("2026-10-07T12:00:00+05:30");
const cand = (over: Partial<CallFileCandidate> = {}): CallFileCandidate => ({
  id: "r1", sourceType: "meta_live", mobile10: "9876543210", fullName: "asha rao", roleName: "Support", requisitionId: "req-1", requisitionCode: "REQ-1",
  branchName: "Noida", branchAddress: "Sector 62", campaign: "Oct Noida", qualifiedAt: "2026-10-07 09:00:00",
  emailStatus: "sent", emailSentAt: "2026-10-07 09:00:05", waStatus: "sent", waSentAt: "2026-10-07 10:00:00", slotDate: null, slotTime: null,
  leadStatus: null, consentRevoked: false, matchStates: [], rowDeclined: false,
  callsN: 0, callsAnswered: 0, callsRetryable: 0, lastCallAt: null, metaOutcome: null, filesN: 0, lastFileAt: null, ...over,
});
const offer = (rowId: string, code: string, over: Partial<OfferRow> = {}): OfferRow => ({
  rowId, requisitionId: `id-${code}`, requisitionCode: code, qualifiedAt: "2026-10-07 09:00:00", started: true, declined: false,
  distanceKm: null, score: null, headcountRemaining: null, ...over,
});

describe("slot configuration", () => {
  it("default is every 2 hours from 10:00 to 18:00 (20:00 is after the window)", () => {
    expect([...CALL_FILE_SLOTS]).toEqual(["10:00", "12:00", "14:00", "16:00", "18:00"]);
  });
  it("parses an env list, drops anything outside 09:00 to before 20:00, sorts and de-duplicates", () => {
    expect(parseCallFileSlots("18:00, 9:30,12:00,12:00,20:00,08:00,bad,23:99")).toEqual(["09:30", "12:00", "18:00"]);
    expect(parseCallFileSlots("20:00,21:00")).toBeNull();
    expect(parseCallFileSlots(undefined)).toBeNull();
  });
  it("he_model_param hours become slots (12.5 = 12:30), same window", () => {
    expect(slotsFromHours([11, 12.5, 20, 8.75, 15])).toEqual(["11:00", "12:30", "15:00"]);
    expect(slotsFromHours([])).toBeNull();
  });
  it("precedence: he_model_param, then env, then default; cool days and the empty note", () => {
    const env = { QUAL_FOLLOWUP_CALL_FILE_SLOTS: "11:00,13:00", QUAL_FOLLOWUP_CALL_FILE_COOL_DAYS: "7", QUAL_FOLLOWUP_CALL_FILE_EMPTY_NOTE: "true" } as NodeJS.ProcessEnv;
    expect(callFileConfig({} as NodeJS.ProcessEnv, new Map())).toEqual({ slots: [...CALL_FILE_SLOTS], coolDays: 0, emptyNote: false });
    expect(callFileConfig(env, new Map())).toEqual({ slots: ["11:00", "13:00"], coolDays: 7, emptyNote: true });
    const p = new Map([["policy.callfile_slot_1", 10], ["policy.callfile_slot_2", 16], ["policy.callfile_cool_days", 30]]);
    expect(callFileConfig(env, p)).toMatchObject({ slots: ["10:00", "16:00"], coolDays: 30 });
    expect(callFileConfig({ QUAL_FOLLOWUP_CALL_FILE_COOL_DAYS: "-3" } as NodeJS.ProcessEnv, new Map()).coolDays).toBe(0);
  });
});

describe("drive type (single swap point for the attribution rule)", () => {
  it("labels", () => {
    expect(callFileDriveType({ sourceType: "meta_live" })).toBe("Live Meta");
    expect(callFileDriveType({ sourceType: "meta_old" })).toBe("Old Meta data");
    expect(callFileDriveType({ sourceType: "he" })).toBe("Hiring Engine");
  });
});

describe("planCallFile", () => {
  it("one line per person: several requisitions and drive types collapse to the best requisition, the rest are listed", () => {
    const rows = [
      cand({ id: "a", requisitionCode: "REQ-A", requisitionId: "id-REQ-A", sourceType: "meta_live" }),
      cand({ id: "b", requisitionCode: "REQ-B", requisitionId: "id-REQ-B", sourceType: "he", qualifiedAt: "2026-10-07 08:00:00" }),
      cand({ id: "c", mobile10: "9123456789", requisitionCode: "REQ-C" }),
    ];
    const offers = new Map([["9876543210", [offer("a", "REQ-A", { distanceKm: 2 }), offer("b", "REQ-B", { distanceKm: 14 }), offer("z", "REQ-Z")]]]);
    const p = planCallFile(rows, { now, coolDays: 0, offerRows: offers });
    expect(p.rows.map((r) => r.best.id)).toEqual(["a", "c"]);
    expect(p.rows[0].siblings.map((s) => s.id)).toEqual(["b"]);
    expect(p.rows[0].otherRequisitionCodes).toEqual(["REQ-B", "REQ-Z"]);
    expect(p.merged).toBe(1);
    expect(new Set(p.rows.map((r) => r.best.mobile10)).size).toBe(p.rows.length);
  });

  it("without offer data the earliest qualified requisition wins", () => {
    const p = planCallFile([cand({ id: "a", qualifiedAt: "2026-10-07 09:00:00" }), cand({ id: "b", requisitionCode: "REQ-B", qualifiedAt: "2026-10-07 08:00:00" })], { now, coolDays: 0 });
    expect(p.rows[0].best.id).toBe("b");
  });

  it("skips STOP, confirmed, arrived and the declined requisition, with reasons", () => {
    const p = planCallFile([
      cand({ id: "o", mobile10: "9000000001", leadStatus: "opted_out" }),
      cand({ id: "k", mobile10: "9000000002", consentRevoked: true }),
      cand({ id: "f", mobile10: "9000000003", matchStates: ["confirmed"] }),
      cand({ id: "v", mobile10: "9000000004", leadStatus: "arrived" }),
      cand({ id: "d1", mobile10: "9000000005", rowDeclined: true }),
      cand({ id: "d2", mobile10: "9000000005", requisitionCode: "REQ-2" }),
    ], { now, coolDays: 0 });
    expect(p.rows.map((r) => r.best.id)).toEqual(["d2"]);
    expect(Object.fromEntries(p.skipped.map((s) => [s.id, s.reason]))).toEqual({ o: "opted_out", k: "opted_out", f: "confirmed", v: "arrived", d1: "declined" });
    expect(p.skippedByReason).toMatchObject({ opted_out: 2, confirmed: 1, arrived: 1, declined: 1 });
  });

  it("a person already placed in a file or reached by the voice bot is never placed again by default", () => {
    const p = planCallFile([
      cand({ id: "f", mobile10: "9000000001", filesN: 1, lastFileAt: "2026-09-01 10:00:00" }),
      cand({ id: "r", mobile10: "9000000002", callsN: 1, callsAnswered: 1, lastCallAt: "2026-10-06 11:00:00" }),
      cand({ id: "m", mobile10: "9000000003", metaOutcome: "WALKIN_CONFIRMED_YES" }),
      cand({ id: "u", mobile10: "9000000004", callsN: 1, lastCallAt: "2026-10-07 09:00:00" }),
    ], { now, coolDays: 0 });
    expect(p.rows).toHaveLength(0);
    expect(Object.fromEntries(p.skipped.map((s) => [s.id, s.reason]))).toEqual({ f: "already_in_file", r: "already_reached", m: "already_reached", u: "already_called" });
  });

  it("a no-answer outcome allows one retry at least 2 hours later (BRD retry rule); too soon waits, not skipped", () => {
    const na = { callsN: 1, callsRetryable: 1 };
    const ok = planCallFile([cand({ ...na, lastCallAt: "2026-10-07 09:30:00" })], { now, coolDays: 0 });
    expect(ok.rows[0].attempt).toBe(2);
    const meta = planCallFile([cand({ metaOutcome: "NO_ANSWER", lastCallAt: "2026-10-07 09:30:00" })], { now, coolDays: 0 });
    expect(meta.rows[0].attempt).toBe(2);
    const soon = planCallFile([cand({ ...na, lastCallAt: "2026-10-07 11:00:00" })], { now, coolDays: 0 });
    expect(soon.rows).toHaveLength(0);
    expect(soon.deferred).toEqual([{ id: "r1", reason: "retry_too_soon" }]);
    expect(soon.skipped).toHaveLength(0);
    // the file placement and the result imported for it are one attempt; two attempts is the BRD maximum
    const one = planCallFile([cand({ ...na, filesN: 1, lastCallAt: "2026-10-06 09:00:00", lastFileAt: "2026-10-06 08:00:00" })], { now, coolDays: 0 });
    expect(one.rows[0].attempt).toBe(2);
    const twice = planCallFile([cand({ callsN: 2, callsRetryable: 2, filesN: 1, lastCallAt: "2026-10-06 09:00:00", lastFileAt: "2026-10-06 08:00:00" })], { now, coolDays: 0 });
    expect(twice.skipped[0].reason).toBe("already_in_file");
  });

  it("a configured cool period lets a person back once it has passed", () => {
    const r = cand({ filesN: 1, lastFileAt: "2026-09-20 10:00:00" });
    expect(planCallFile([r], { now, coolDays: 30 }).skipped[0].reason).toBe("already_in_file");
    const back = planCallFile([r], { now, coolDays: 10 });
    expect(back.rows[0].attempt).toBe(2);
  });

  it("priority: slot today or tomorrow P1, later slot P2, none P3; past slot blanked; sorted by priority then qualified time", () => {
    const p = planCallFile([
      cand({ id: "none", mobile10: "9000000001", qualifiedAt: "2026-10-07 07:00:00" }),
      cand({ id: "later", mobile10: "9000000002", slotDate: "2026-10-12", slotTime: "11:00:00" }),
      cand({ id: "tom", mobile10: "9000000003", slotDate: "2026-10-08", slotTime: "10:30:00" }),
      cand({ id: "past", mobile10: "9000000004", slotDate: "2026-10-06", slotTime: "10:30:00", qualifiedAt: "2026-10-07 06:00:00" }),
    ], { now, coolDays: 0 });
    expect(p.rows.map((r) => [r.best.id, r.priority])).toEqual([["tom", "P1"], ["later", "P2"], ["past", "P3"], ["none", "P3"]]);
    expect(p.rows.find((r) => r.best.id === "past")!.interviewDate).toBeNull();
    expect(p.rows.find((r) => r.best.id === "tom")).toMatchObject({ interviewDate: "2026-10-08", interviewTime: "10:30" });
  });
});
