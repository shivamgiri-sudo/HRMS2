import { describe, expect, it } from "vitest";
import { buildFollowUpEmail, type FollowEmailInput } from "../he-followup-email.service.js";
import { engineMode } from "../he-policy.service.js";

const base: FollowEmailInput = { kind: "reminder_1d", name: "Rahul", role: "Customer Success Executive", company: "MAS Callnet", branch: "Noida Sector 62", address: "Trapezoid IT Park, Noida - 201309", date: "Thu 8 Oct 2026", time: "11:00 AM", maps: "https://maps.google.com/?q=1,2", docs: "Aadhaar, PAN", reference: "HE-AB12CD", contact: "Neha HR 98100", answerUrl: "https://x.test/w/abc" };

describe("follow-up emails", () => {
  it("day-before reminder: slot, three answer buttons, documents and reference", () => {
    const m = buildFollowUpEmail(base);
    expect(m.subject).toBe("Reminder: your interview on Thu 8 Oct 2026, 11:00 AM - Customer Success Executive");
    for (const a of ["yes", "later", "no"]) expect(m.html).toContain(`?a=${a}`);
    expect(m.html).toContain("Aadhaar"); expect(m.html).toContain("HE-AB12CD"); expect(m.text).toContain("Yes, I will come");
  });
  it("confirmation has no answer buttons, only a way to ask for another time", () => {
    const m = buildFollowUpEmail({ ...base, kind: "confirmed" });
    expect(m.subject.startsWith("Confirmed: your interview")).toBe(true);
    expect(m.html).not.toContain("?a=yes"); expect(m.html).not.toContain("?a=no"); expect(m.html).toContain("?a=later");
  });
  it("new slot offer asks yes / does not work; no-show offers a new slot or not interested and leaves out the documents", () => {
    const o = buildFollowUpEmail({ ...base, kind: "reschedule_offer" });
    expect(o.html).toContain("Yes, this works"); expect(o.html).toContain("?a=no"); expect(o.html).not.toContain("?a=later");
    const n = buildFollowUpEmail({ ...base, kind: "no_show" });
    expect(n.subject).toContain("We missed you"); expect(n.html).toContain("I need a new slot"); expect(n.html).toContain("Not interested"); expect(n.html).not.toContain("Please carry");
  });
  it("escapes anything that could be markup", () => {
    const m = buildFollowUpEmail({ ...base, name: "<img src=x onerror=1>", role: "<b>Role</b>", branch: "A&B" });
    expect(m.html).not.toContain("<img src=x"); expect(m.html).toContain("&lt;img"); expect(m.html).toContain("A&amp;B");
  });
});

describe("engine mode (screen switch + environment)", () => {
  it("off unless the screen switch or the environment turns it on", () => {
    expect(engineMode({} as NodeJS.ProcessEnv, false)).toBe("off");
    expect(engineMode({} as NodeJS.ProcessEnv, true)).toBe("live");
  });
  it("environment: enabled alone is a dry run, enabled + live is live; the screen switch makes it live either way", () => {
    expect(engineMode({ HE_ENGINE_ENABLED: "true" } as never, false)).toBe("dry");
    expect(engineMode({ HE_ENGINE_ENABLED: "true" } as never, true)).toBe("live");
    expect(engineMode({ HE_ENGINE_ENABLED: "true", HE_ENGINE_LIVE: "true" } as never, false)).toBe("live");
  });
});
