import { describe, expect, it } from "vitest";
import { callOutcome } from "../he-signals.js";
import { classifyQueueError, mapSuperbotFeedback, parseSuperbotRejected, sbDate, sbPhone, sbTime } from "../he-superbot.js";

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
