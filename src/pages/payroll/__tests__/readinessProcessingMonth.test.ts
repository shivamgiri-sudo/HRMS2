/**
 * The readiness page must open on the month being PREPARED, not today's.
 *
 * Payroll is closed monthly and always in arrears — August's payroll is prepared during
 * September — so the readiness of the current calendar month is not what anyone opens this page
 * to see. It defaulted to today's month anyway. On 2026-09-05, with August being processed,
 * Head Office read "22%, blocked, 2/10 checks"; August's actual score was 42, and three of its
 * checks had just been satisfied that day.
 *
 * The failure is quiet, which is what makes it expensive: the page renders a full, plausible
 * dashboard for a month nobody is working on, and disagrees with the Payroll page beside it —
 * which correctly says "Currently processing: August 2026" — with nothing to indicate the two
 * are answering different questions.
 *
 * The month picker still allows any month. This pins where it STARTS.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * Mirrors processingMonth() in PayrollReadinessDashboard.tsx. Kept here rather than exported
 * because the page's default export drags the whole dashboard — and every hook it uses — into
 * the test; the rule is four lines and what matters is that the rule is right.
 */
function processingMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function at(iso: string): string {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
  return processingMonth();
}

afterEach(() => vi.useRealTimers());

describe("the month the page opens on", () => {
  it("is the previous month, not today's — the incident date", () => {
    // The exact case: on 5 Sep the page showed September's readiness while August was the month
    // being processed.
    expect(at("2026-09-05T12:00:00+05:30")).toBe("2026-08");
  });

  it("rolls back across a year boundary", () => {
    expect(at("2026-01-09T10:00:00+05:30")).toBe("2025-12");
  });

  it("does not skip a month when today is the 31st", () => {
    /*
     * The trap this guards. `new Date(2026,6,31); setMonth(5)` asks for 31 June, which does not
     * exist, so JS rolls it to 1 July and the answer comes back as July — the month you started
     * in. Setting the date to the 1st first is what makes it safe, and every 31st would
     * otherwise show the WRONG month on a page that gates payroll.
     */
    expect(at("2026-07-31T23:00:00+05:30")).toBe("2026-06");
    expect(at("2026-03-31T09:00:00+05:30")).toBe("2026-02");
    expect(at("2026-05-31T09:00:00+05:30")).toBe("2026-04");
  });

  it("handles the 29th, 30th and 31st of a month preceding a short one", () => {
    // 31 Dec -> November, not December; 30 Mar -> February even though February is short.
    expect(at("2026-12-31T18:00:00+05:30")).toBe("2026-11");
    expect(at("2026-03-30T18:00:00+05:30")).toBe("2026-02");
  });

  it("pads single-digit months so the API filter matches", () => {
    // The value goes straight into ?month=YYYY-MM. '2026-9' matches no readiness row.
    expect(at("2026-10-02T09:00:00+05:30")).toBe("2026-09");
    expect(at("2026-02-14T09:00:00+05:30")).toBe("2026-01");
  });

  it("returns the same shape on the first of the month", () => {
    // A run on the 1st is the most likely moment for someone to open this page.
    expect(at("2026-09-01T00:05:00+05:30")).toBe("2026-08");
  });
});
