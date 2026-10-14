import { describe, expect, it } from "vitest";
import { callOutcome } from "../he-signals.js";
import { classifyQueueError, dispositionAnswers, mapSuperbotFeedback, parseSuperbotRejected, sbDate, sbPhone, sbTime } from "../he-superbot.js";

const fb = (feedback: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  reference_id: "m-1", phone: "+919876543210", time: "2026-10-08T10:15:00", status: "answered", outcome: "disposed", call_duration: 75,
  feedback: Object.fromEntries(Object.entries(feedback).map(([k, v]) => [k, { value: v }])), ...extra,
});

describe("superbot formats", () => {
  it("formats date, time and phone like the integration sample", () => {
    expect(sbDate("2026-10-12")).toBe("12/10/2026");
    expect(sbTime("10:00")).toBe("10 AM");
    expect(sbTime("14:30")).toBe("2:30 PM");
    expect(sbTime("00:00")).toBe("12 AM");
    expect(sbPhone("9876543210")).toBe("+919876543210");
  });
});

describe("mapSuperbotFeedback", () => {
  it("confirmed attendance", () => {
    const m = mapSuperbotFeedback(fb({ name_confirmation: "yes", walkin_interview_attendance: "yes", email_received: "yes" }));
    expect(callOutcome(m.result)).toBe("WALKIN_CONFIRMED_YES");
    expect(m.humanFollowUp).toBeNull();
    expect(m.providerCallId).toBe("m-1:2026-10-08T10:15:00");
  });
  it("wrong person", () => {
    const m = mapSuperbotFeedback(fb({ name_confirmation: "no" }));
    expect(callOutcome(m.result)).toBe("WRONG_PERSON_REACHED");
  });
  it("declines and found a job elsewhere", () => {
    const m = mapSuperbotFeedback(fb({ name_confirmation: "yes", walkin_interview_attendance: "no", already_done: "already_done_elsewhere" }));
    expect(m.result.declineReason).toBe("found_job");
    expect(callOutcome(m.result)).toBe("WALKIN_DECLINED_NEEDS_FOLLOWUP");
  });
  it("maybe and HR request need a person", () => {
    const m = mapSuperbotFeedback(fb({ name_confirmation: "yes", walkin_interview_attendance: "maybe", talk_to_hr: "yes", callback_request: "yes" }));
    expect(m.humanFollowUp).toMatch(/unsure.*HR.*callback/);
  });
  it("voicemail and abandoned are not answered", () => {
    expect(callOutcome(mapSuperbotFeedback(fb({}, { outcome: "voicemail" })).result)).toBe("NO_ANSWER");
    expect(callOutcome(mapSuperbotFeedback(fb({}, { outcome: "abandoned" })).result)).toBe("NO_ANSWER");
  });
  it("failed call carries the reason", () => {
    const m = mapSuperbotFeedback(fb({}, { status: "failed", call_status: "NUMBER_BUSY" }));
    expect(callOutcome(m.result)).toBe("CALL_FAILED");
    expect(m.result.failedReason).toBe("NUMBER_BUSY");
  });
});

describe("classifyQueueError", () => {
  it("matches the documented replies", () => {
    expect(classifyQueueError(400, { message: "Number already queued" })).toBe("already_queued");
    expect(classifyQueueError(400, { message: "Phone Number is incorrect" })).toBe("bad_number");
    expect(classifyQueueError(400, { message: "Parameter empty" })).toBe("params_missing");
    expect(classifyQueueError(400, { message: "Validation Failed" })).toBe("validation");
    expect(classifyQueueError(401, null)).toBe("auth");
    expect(classifyQueueError(500, null)).toBe("provider_error");
  });
});

describe("parseSuperbotRejected", () => {
  it("reads the documented errors[] body", () => {
    const r = parseSuperbotRejected({ status: true, message: "", total_calls: 5, total_unaccepted_calls: 2, id: [1, 2, 3],
      errors: [{ phone: "+91708175851", message: "Phone Number is incorrect", reference_id: "HRMS-001" }, { phone: "+91628349896", message: "Number already queued", reference_id: "HRMS-002" }] });
    expect(r).toEqual([
      { referenceId: "HRMS-001", phone: "+91708175851", reason: "Phone Number is incorrect", badNumber: true },
      { referenceId: "HRMS-002", phone: "+91628349896", reason: "Number already queued", badNumber: false },
    ]);
  });
  it("still reads numbers[] and a bare entry, and drops entries without a reference", () => {
    expect(parseSuperbotRejected({ numbers: [{ reference_id: "HRMS-003", reason: "invalid" }, { phone: "+91999" }] }).map((x) => x.referenceId)).toEqual(["HRMS-003"]);
    expect(parseSuperbotRejected({ reference_id: "HRMS-004", reason: "x" })[0].referenceId).toBe("HRMS-004");
    expect(parseSuperbotRejected({ status: true, errors: [] })).toEqual([]);
    expect(parseSuperbotRejected(null)).toEqual([]);
  });
});

describe("disposition fallback (Mascall integration sheet list)", () => {
  const only = (disposition: string, extra: Record<string, unknown> = {}) => ({ reference_id: "HRMS-009", phone: "+919876543210", time: "2026-10-12 10:05:42", status: "answered", outcome: "disposed", call_duration: "62.40", disposition, ...extra });

  it("reads every attendance / identity / email / details / hr / callback disposition", () => {
    expect(dispositionAnswers("WILL ATTEND WALK IN INTERVIEW")).toEqual({ walkin_interview_attendance: "yes" });
    expect(dispositionAnswers("will attend walk-in interview")).toEqual({ walkin_interview_attendance: "yes" });
    expect(dispositionAnswers("WILL NOT ATTEND WALK IN INTERVIEW")).toEqual({ walkin_interview_attendance: "no" });
    expect(dispositionAnswers("UNCERTAIN ABOUT ATTENDING WALK-IN INTERVIEW")).toEqual({ walkin_interview_attendance: "maybe" });
    expect(dispositionAnswers("ALREADY DONE ELSEWHERE")).toEqual({ already_done: "already_done_elsewhere" });
    expect(dispositionAnswers("INTERVIEW ALREADY DONE")).toEqual({ already_done: "already_done" });
    expect(dispositionAnswers("NOT APPLIED")).toEqual({ not_applied: "yes" });
    expect(dispositionAnswers("DETAILS NOT FILLED")).toEqual({ details_filled: "no" });
    expect(dispositionAnswers("DETAILS FILLED")).toEqual({ details_filled: "yes" });
    expect(dispositionAnswers("EMAIL RECEIVED")).toEqual({ email_received: "yes" });
    expect(dispositionAnswers("NOT A GOOD TIME TO TALK")).toEqual({ good_time_to_talk: "no" });
    expect(dispositionAnswers("GOOD TIME TO TALK")).toEqual({ good_time_to_talk: "yes" });
    expect(dispositionAnswers("CALL PICKED BY SOMEONE ELSE")).toEqual({ name_confirmation: "no" });
    expect(dispositionAnswers("NAME NOT VERIFIED")).toEqual({ name_confirmation: "no" });
    expect(dispositionAnswers("ONLY NAME VERIFIED")).toEqual({ name_confirmation: "yes" });
    expect(dispositionAnswers("NOT INTERESTED TO TALK TO AN EXPERT")).toEqual({ talk_to_hr: "no" });
    expect(dispositionAnswers("INTERESTED TO TALK TO AN EXPERT")).toEqual({ talk_to_hr: "yes" });
    expect(dispositionAnswers("CALLBACK NOT REQUESTED")).toEqual({ callback_request: "no" });
    expect(dispositionAnswers("INTERESTED AND CALLBACK REQUESTED")).toEqual({ callback_request: "yes" });
    expect(dispositionAnswers("CALLBACK DETAILS SHARED")).toEqual({ callback_request: "yes" });
    expect(dispositionAnswers(null)).toEqual({});
  });

  it("a disposition posted WITHOUT its field block still confirms the candidate", () => {
    const m = mapSuperbotFeedback(only("WILL ATTEND WALK IN INTERVIEW"));
    expect(m.result.originalSlotAnswer).toBe("yes");
    expect(callOutcome(m.result)).toBe("WALKIN_CONFIRMED_YES");
    expect(m.incomplete).toBe(false);
    expect(m.humanFollowUp).toBeNull();
  });
  it("a declining disposition without fields declines, not 'ended early'", () => {
    const m = mapSuperbotFeedback(only("WILL NOT ATTEND WALK IN INTERVIEW"));
    expect(m.result.originalSlotAnswer).toBe("no");
    expect(callOutcome(m.result)).toBe("WALKIN_DECLINED_NEEDS_FOLLOWUP");
    const e = mapSuperbotFeedback(only("ALREADY DONE ELSEWHERE", { feedback: { walkin_interview_attendance: { value: "no" } } }));
    expect(e.result.declineReason).toBe("found_job");
  });
  it("uncertain asks for a person and is never marked declined", () => {
    const m = mapSuperbotFeedback(only("UNCERTAIN ABOUT ATTENDING WALK-IN INTERVIEW"));
    expect(m.humanFollowUp).toMatch(/unsure about attending/);
    expect(m.result.originalSlotAnswer).toBeUndefined();
  });
  it("a field value always wins over the disposition", () => {
    const m = mapSuperbotFeedback(only("WILL NOT ATTEND WALK IN INTERVIEW", { feedback: { name_confirmation: { value: "yes" }, walkin_interview_attendance: { value: "yes" } } }));
    expect(m.result.originalSlotAnswer).toBe("yes");
  });
  it("wrong person by disposition alone", () => {
    expect(callOutcome(mapSuperbotFeedback(only("CALL PICKED BY SOMEONE ELSE")).result)).toBe("WRONG_PERSON_REACHED");
  });
});

describe("call id and time", () => {
  it("reads the time from the sheet's 'SB Interaction Date' label", () => {
    const m = mapSuperbotFeedback({ reference_id: "HRMS-010", status: "answered", "SB Interaction Date": "2026-10-12 10:05:42" });
    expect(m.startedAt).toBe("2026-10-12 10:05:42");
    expect(m.providerCallId).toBe("HRMS-010:2026-10-12 10:05:42");
  });
  it("without a time, two attempts of one booking get different ids; a redelivery gets the same id", () => {
    const a = mapSuperbotFeedback({ reference_id: "HRMS-011", status: "failed", call_status: "Number Busy", call_duration: "0" });
    const b = mapSuperbotFeedback({ reference_id: "HRMS-011", status: "answered", call_duration: "58.2", outcome: "disposed" });
    const a2 = mapSuperbotFeedback({ reference_id: "HRMS-011", status: "failed", call_status: "Number Busy", call_duration: "0" });
    expect(a.providerCallId).not.toBe(b.providerCallId);
    expect(a.providerCallId).toBe(a2.providerCallId);
    expect(a.startedAt).toBeNull();
  });
  it("keeps the id format when a time is present (redeliveries of earlier posts still dedupe)", () => {
    expect(mapSuperbotFeedback({ reference_id: "m-1", time: "2026-10-08T10:15:00", status: "answered" }).providerCallId).toBe("m-1:2026-10-08T10:15:00");
  });
});
