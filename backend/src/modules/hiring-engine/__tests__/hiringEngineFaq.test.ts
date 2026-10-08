import { describe, expect, it } from "vitest";
import { detectFaq, faqAnswer, salaryText, type FaqContext } from "../he-faq.js";

const ctx: FaqContext = { firstName: "Riya", role: "Telesales Executive", company: "MAS Callnet", branch: "Noida Sector 62", address: "Plot 1, Sector 62", maps: "https://maps.google.com/?q=1,2", dateLabel: "Tue 6 Oct 2026", timeLabel: "11:00 AM", docs: "Aadhaar, PAN", salaryText: salaryText(14000, 18000), contact: "Neha 98xxxx", lang: "hi" };
describe("WhatsApp bot answers", () => {
  it("detects common questions in Hinglish and English", () => {
    expect(detectFaq("office kahan hai?")).toBe("address");
    expect(detectFaq("kya laana hai")).toBe("documents");
    expect(detectFaq("kitne baje aana hai")).toBe("timing");
    expect(detectFaq("salary kitni hai")).toBe("salary");
    expect(detectFaq("what is the job role")).toBe("job");
    expect(detectFaq("ok")).toBeNull();
  });
  it("answers only from facts we hold", () => {
    expect(faqAnswer("address", ctx)).toMatch(/Sector 62.*maps/);
    expect(faqAnswer("salary", ctx)).toMatch(/14,000 - Rs 18,000/);
    expect(faqAnswer("salary", { ...ctx, salaryText: null })).toBeNull();
    expect(faqAnswer("timing", { ...ctx, lang: "en" })).toMatch(/Tue 6 Oct 2026, 11:00 AM/);
    expect(faqAnswer("address", { ...ctx, address: null, maps: null })).toBeNull();
  });
});
