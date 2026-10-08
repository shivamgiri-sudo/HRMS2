import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), executeRun: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({
  emailService: { isConfigured: () => true, send: vi.fn() },
}));
vi.mock("../dashboard-export.service.js", () => ({
  isKnownDashboard: (k: string) => ["satya_retail", "gnc_sale"].includes(k),
  buildDashboardExcel: vi.fn(),
}));
vi.mock("../mis-export.service.js", () => ({
  buildMisExcel: vi.fn(),
  getMisCompanies: vi.fn(async () => ({ bellavita: [{ title: "Overall Dashboard" }], dalmia: [] })),
}));

import { buildMisExcel } from "../mis-export.service.js";
import { buildDashboardExcel } from "../dashboard-export.service.js";
import { emailService } from "../../communication/email.service.js";
import fs from "fs";
import {
  advanceRun, bodyToHtml, computeFirstRun, createSchedule, misCompanyOf, sendSchedule, type ScheduleRow, parseRecipients, parseScheduleInput, resolvePeriod,
} from "../mis-schedule.service";

const at = (y: number, mo: number, d: number, h = 0, m = 0) => new Date(y, mo - 1, d, h, m, 0, 0);

const validBody = {
  dashboardKey: "satya_retail",
  to: "Boss@Example.com; ops@example.com",
  cc: "boss@example.com, qa@example.com",
  subject: "Daily MIS",
  bodyText: "Please find the MIS attached.",
  frequency: "daily",
  sendTime: "09:30",
  rangeMode: "yesterday",
};

describe("recipient parsing", () => {
  it("splits on commas, semicolons and spaces, lower-cases and dedupes", () => {
    const r = parseRecipients("A@x.com; b@x.com,  a@X.com", "To", true);
    expect(r).toEqual({ ok: true, value: ["a@x.com", "b@x.com"] });
  });

  it("requires To, but allows an empty CC", () => {
    expect(parseRecipients("", "To", true).ok).toBe(false);
    expect(parseRecipients("", "CC", false)).toEqual({ ok: true, value: [] });
  });

  it("rejects a malformed address and names the field", () => {
    const r = parseRecipients("good@x.com, not-an-email", "CC", false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("CC");
  });
});

describe("schedule input validation", () => {
  it("accepts a valid daily schedule and dedupes CC against To", () => {
    const r = parseScheduleInput(validBody);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.to).toEqual(["boss@example.com", "ops@example.com"]);
      expect(r.value.cc).toEqual(["boss@example.com", "qa@example.com"]);
      expect(r.value.weekday).toBeNull();
    }
  });

  it("rejects an unknown dashboard key", () => {
    expect(parseScheduleInput({ ...validBody, dashboardKey: "made_up" }).ok).toBe(false);
  });

  it("accepts an MIS report key and reads its company", () => {
    const r = parseScheduleInput({ ...validBody, dashboardKey: "mis:bellavita" });
    expect(r.ok).toBe(true);
    expect(misCompanyOf("mis:bellavita")).toBe("bellavita");
    expect(misCompanyOf("satya_retail")).toBeNull();
    expect(parseScheduleInput({ ...validBody, dashboardKey: "mis:Bad-Key" }).ok).toBe(false);
  });

  it("refuses to create an MIS schedule for a company with no MIS sections", async () => {
    const r = parseScheduleInput({ ...validBody, dashboardKey: "mis:dalmia" });
    if (!r.ok) throw new Error(r.error);
    await expect(createSchedule(r.value, "u1")).rejects.toThrow(/No MIS report/);
  });

  it("requires a weekday for weekly and a date for once", () => {
    expect(parseScheduleInput({ ...validBody, frequency: "weekly" }).ok).toBe(false);
    expect(parseScheduleInput({ ...validBody, frequency: "weekly", weekday: 1 }).ok).toBe(true);
    expect(parseScheduleInput({ ...validBody, frequency: "once" }).ok).toBe(false);
    expect(parseScheduleInput({ ...validBody, frequency: "once", sendOnDate: "2026-10-05" }).ok).toBe(true);
  });

  it("rejects a bad time and a fixed period without dates", () => {
    expect(parseScheduleInput({ ...validBody, sendTime: "9am" }).ok).toBe(false);
    expect(parseScheduleInput({ ...validBody, rangeMode: "fixed" }).ok).toBe(false);
  });

  it("swaps a fixed period given backwards", () => {
    const r = parseScheduleInput({ ...validBody, rangeMode: "fixed", rangeFrom: "2026-10-09", rangeTo: "2026-10-01" });
    expect(r.ok && r.value.rangeFrom).toBe("2026-10-01");
  });

  it("caps recipients at 25", () => {
    const many = Array.from({ length: 26 }, (_, i) => `u${i}@x.com`).join(",");
    expect(parseScheduleInput({ ...validBody, to: many }).ok).toBe(false);
  });
});

describe("next run times", () => {
  it("daily: later today if the time has not passed, otherwise tomorrow", () => {
    expect(computeFirstRun(at(2026, 10, 3, 8), "daily", "09:30", null, null)).toBe("2026-10-03 09:30:00");
    expect(computeFirstRun(at(2026, 10, 3, 10), "daily", "09:30", null, null)).toBe("2026-10-04 09:30:00");
  });

  it("weekly: the next matching weekday strictly after now", () => {
    // 3 Oct 2026 is a Saturday (getDay 6). Monday = 1.
    expect(computeFirstRun(at(2026, 10, 3, 10), "weekly", "09:00", null, 1)).toBe("2026-10-05 09:00:00");
    // Same weekday, time not yet passed -> today
    expect(computeFirstRun(at(2026, 10, 5, 8), "weekly", "09:00", null, 1)).toBe("2026-10-05 09:00:00");
    // Same weekday, time passed -> next week
    expect(computeFirstRun(at(2026, 10, 5, 10), "weekly", "09:00", null, 1)).toBe("2026-10-12 09:00:00");
  });

  it("once: null when the date and time are already in the past", () => {
    expect(computeFirstRun(at(2026, 10, 3, 10), "once", "09:00", "2026-10-03", null)).toBeNull();
    expect(computeFirstRun(at(2026, 10, 3, 8), "once", "09:00", "2026-10-03", null)).toBe("2026-10-03 09:00:00");
  });

  it("advance: daily and weekly move forward, once completes", () => {
    expect(advanceRun("2026-10-03 09:30:00", "daily", "09:30")).toBe("2026-10-04 09:30:00");
    expect(advanceRun("2026-10-03 09:30:00", "weekly", "09:30")).toBe("2026-10-10 09:30:00");
    expect(advanceRun("2026-10-03 09:30:00", "once", "09:30")).toBeNull();
  });
});

describe("period resolution", () => {
  const now = at(2026, 10, 3, 9);
  it("yesterday is a single day ending before today", () => {
    expect(resolvePeriod("yesterday", now, null, null)).toEqual({ from: "2026-10-02", to: "2026-10-02" });
  });
  it("month-to-date runs from the 1st to today", () => {
    expect(resolvePeriod("mtd", now, null, null)).toEqual({ from: "2026-10-01", to: "2026-10-03" });
  });
  it("last 7 days ends yesterday", () => {
    expect(resolvePeriod("last_7_days", now, null, null)).toEqual({ from: "2026-09-26", to: "2026-10-02" });
  });
  it("fixed uses the stored dates", () => {
    expect(resolvePeriod("fixed", now, "2026-09-01", "2026-09-30")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("body rendering", () => {
  it("escapes HTML in the typed body and keeps line breaks", () => {
    const html = bodyToHtml("<b>hi</b>\nline2 & more", "sched-1");
    expect(html).not.toContain("<b>hi</b>");
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;<br>line2 &amp; more");
    expect(html).toContain("sched-1");
  });
});

describe("MIS report send", () => {
  it("attaches the exact workbook the MIS tab download builds (same builder, label and MTD period)", async () => {
    vi.mocked(buildMisExcel).mockImplementation(async (_c, _l, _f, _t, filePath) => {
      fs.writeFileSync(filePath, "xlsx-bytes");
      return { raw: [], sections: ["Overall Dashboard"], skipped: [] };
    });
    vi.mocked(emailService.send).mockResolvedValue({ messageId: "m1" } as never);
    const row = {
      id: "s1", dashboard_key: "mis:bellavita", report_title: "Bellavita", lob: null,
      to_addresses: "a@x.com", cc_addresses: null, subject: "MIS", body_text: "Hi",
      range_mode: "mtd", range_from: null, range_to: null, frequency: "daily", send_time: "10:00",
    } as unknown as ScheduleRow;
    const r = await sendSchedule(row, "manual", at(2026, 10, 6, 10, 0));
    expect(r.status).toBe("sent");
    // Same call the MIS tab's GET /mis/:company/excel makes for This Month.
    expect(buildMisExcel).toHaveBeenCalledWith("bellavita", "Bellavita", "2026-10-01", "2026-10-06", expect.any(String));
    expect(buildDashboardExcel).not.toHaveBeenCalled();
    const mail = vi.mocked(emailService.send).mock.calls[0][0];
    expect(mail.attachments?.[0].filename).toBe("bellavita_MIS_2026-10-06.xlsx");
    expect(String(mail.attachments?.[0].content)).toBe("xlsx-bytes");
  });
});
