import { describe, expect, it } from "vitest";
import { classifyReply, stripQuoted } from "../response-classifier.js";

type Case = [string, string, number?];
const cases: Case[] = [
  // English: clear answers
  ["Yes I will come", "confirm", 0.9],
  ["yes", "confirm", 0.9],
  ["Ok sir", "confirm", 0.9],
  ["Sure, I will be there", "confirm", 0.9],
  ["I will come tomorrow at 11", "reschedule"],
  ["no problem I will come", "confirm", 0.9],
  ["No issue, coming", "confirm", 0.9],
  ["no problem", "confirm", 0.6],
  ["No", "decline", 0.9],
  ["I cannot come", "decline", 0.9],
  ["Not interested", "decline", 0.9],
  ["I already joined another company", "decline", 0.9],
  ["unable to attend", "decline", 0.9],
  ["cannot come tomorrow, can I come Monday", "reschedule", 0.9],
  ["Can I come next week instead", "reschedule", 0.9],
  ["I need another time", "reschedule", 0.9],
  ["yes but I need another time", "reschedule", 0.6],
  ["what is the salary?", "question", 0.8],
  ["Where is the office", "question", 0.8],
  ["Which documents should I bring?", "question", 0.8],
  ["STOP", "unsubscribe", 0.9],
  ["Please do not message me", "unsubscribe", 0.9],
  ["unsubscribe", "unsubscribe", 0.9],
  ["wrong number", "wrong_person", 0.9],
  ["I am on my way", "on_my_way", 0.9],
  ["thank you", "other", 0.3],
  ["", "other", 0],
  ["   ", "other", 0],
  // Hinglish
  ["haan aaunga", "confirm", 0.9],
  ["ji haan main aa jaunga", "confirm", 0.9],
  ["theek hai sir", "confirm", 0.9],
  ["koi dikkat nahi, aa jaunga", "confirm", 0.9],
  ["nahi aa paunga", "decline", 0.9],
  ["kal aa sakta hu kya", "reschedule", 0.9],
  ["salary kitna hai", "question", 0.8],
  ["office kahan hai", "question", 0.8],
  ["band karo", "unsubscribe", 0.9],
  ["galat number hai", "wrong_person", 0.9],
  ["main nikal gaya hu", "on_my_way", 0.9],
];

describe("classifyReply", () => {
  it.each(cases)("%j → %s", (text, answer, conf) => {
    const r = classifyReply(text);
    expect(r.answer).toBe(answer);
    if (conf != null) expect(r.confidence).toBe(conf);
    expect(Array.isArray(r.reasons)).toBe(true);
  });

  it("a quoted reply is classified on the top part only", () => {
    const body = "Yes I will come\n\nOn Thu, 8 Oct 2026 at 10:00, MAS Callnet <hr@x.in> wrote:\n> Will you come?\n> Cannot come: https://x/w/abc?a=no\n> Need another time";
    expect(classifyReply(body, { channel: "email" })).toMatchObject({ answer: "confirm", confidence: 0.9 });
  });

  it("Outlook style original message and signatures are removed", () => {
    expect(stripQuoted("Cannot come sorry\n-----Original Message-----\nFrom: hr\nYes, I will come")).toBe("Cannot come sorry");
    expect(stripQuoted("ok\n--\nRahul\nNot interested in spam")).toBe("ok");
    expect(stripQuoted("ok\nSent from my iPhone")).toBe("ok");
    expect(stripQuoted("Will come\nRegards,\nNo name")).toBe("Will come");
  });

  it("questions alongside a clear answer keep the answer and say so", () => {
    const r = classifyReply("Yes I will come. What is the address?");
    expect(r.answer).toBe("confirm");
    expect(r.reasons.join(" ")).toMatch(/question/);
  });
});

describe("stripQuoted: header on the same line as the reply", () => {
  it("cuts a Gmail inline header", () => {
    expect(stripQuoted("I will attend the interview. On Thu, 8 Oct, 2026, 11:37 pm Mas Callnet HR Team, [email] wrote:")).toBe("I will attend the interview.");
    expect(stripQuoted("Ok sir On Thu, Oct 8, 2026 at 7:22 PM Mas Callnet HR Team <hr@x.com> wrote: hello")).toBe("Ok sir");
  });
  it("cuts a header that was cut short by a preview limit, only with weekday + year + time", () => {
    expect(stripQuoted("I will come. On Thu, 8 Oct, 2026, 11:3")).toBe("I will come.");
  });
  it("keeps a reply that merely says on a day", () => {
    expect(stripQuoted("I can come on Monday 12 Oct")).toBe("I can come on Monday 12 Oct");
    expect(stripQuoted("On Monday I will come")).toBe("On Monday I will come");
  });
});

describe("classifyReply: another chance / coming now (the replies that sat in the review queue)", () => {
  it.each([
    ["Sir I have late seen this massege please give me again 1 chance", "reschedule"],
    ["Hi, I am interested. Can u schedule my interview to Monday", "reschedule"],
    ["Please give me another chance", "reschedule"],
    ["You can come now.", "confirm"],
    ["I can come now sir", "confirm"],
  ])("%s -> %s", (text, answer) => {
    const c = classifyReply(text);
    expect(c.answer).toBe(answer);
    expect(c.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it("still leaves a contact-number question and a work-from-home ask to a person", () => {
    expect(classifyReply("Koi contect number available h .sir .").confidence).toBeLessThan(0.9);
    expect(classifyReply("I want work from home Thankyou Neha").confidence).toBeLessThan(0.9);
  });
});
