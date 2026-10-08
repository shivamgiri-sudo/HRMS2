import { describe, expect, it } from "vitest";
import { answerFromButtonId, answerFromCallOutcome, answerFromIntent, answerFromInviteTap, statusFor } from "../response-normalise.js";

describe("response normaliser", () => {
  it.each([
    ["confirm", "confirm"], ["decline", "decline"], ["reschedule", "reschedule"], ["opt_out", "unsubscribe"],
    ["on_my_way", "on_my_way"], ["skip", "other"], ["unknown", "question"],
  ] as const)("intent %s → %s", (i, a) => expect(answerFromIntent(i)).toBe(a));

  it.each([["yes", "confirm"], ["no", "decline"], ["later", "reschedule"], ["stop", "unsubscribe"]] as const)("tap %s → %s", (t, a) => expect(answerFromInviteTap(t)).toBe(a));

  it.each([
    ["WALKIN_CONFIRMED_YES", "confirm"], ["WALKIN_RESCHEDULED", "reschedule"], ["WALKIN_DECLINED_NEEDS_FOLLOWUP", "decline"],
    ["NO_ANSWER", "no_answer"], ["CALL_FAILED", "no_answer"], ["CALL_FAILED:busy", "no_answer"], ["CALL_INCOMPLETE", "no_answer"],
    ["WRONG_PERSON_REACHED", "wrong_person"], ["SOMETHING_NEW", "other"], ["", "other"],
  ])("call outcome %s → %s", (o, a) => expect(answerFromCallOutcome(o)).toBe(a));

  it.each([
    ["1", "confirm"], ["yes", "confirm"], ["YES", "confirm"], ["confirm", "confirm"], [" Yes ", "confirm"],
    ["2", "reschedule"], ["later", "reschedule"], ["3", "decline"], ["no", "decline"], ["STOP", "unsubscribe"], ["unsubscribe", "unsubscribe"],
  ])("button id %s → %s", (id, a) => expect(answerFromButtonId(id)).toBe(a));

  it("unknown or empty button ids → null (fall back to the text)", () => {
    expect(answerFromButtonId(null)).toBeNull();
    expect(answerFromButtonId("")).toBeNull();
    expect(answerFromButtonId("Haan ji")).toBeNull();
    expect(answerFromButtonId("location")).toBeNull();
  });

  it("status: free-text questions go to review; applied plans are applied; the rest are recorded", () => {
    expect(statusFor({ answer: "question", mode: "text", applied: false })).toBe("needs_review");
    expect(statusFor({ answer: "other", mode: "text", applied: false })).toBe("needs_review");
    expect(statusFor({ answer: "confirm", mode: "button", applied: true })).toBe("applied");
    expect(statusFor({ answer: "confirm", mode: "text", applied: true })).toBe("applied");
    expect(statusFor({ answer: "no_answer", mode: "call", applied: true })).toBe("recorded");
    expect(statusFor({ answer: "on_my_way", mode: "text", applied: true })).toBe("recorded");
    expect(statusFor({ answer: "confirm", mode: "text", applied: false })).toBe("recorded");
    expect(statusFor({ answer: "other", mode: "call", applied: false })).toBe("recorded");
  });
});
