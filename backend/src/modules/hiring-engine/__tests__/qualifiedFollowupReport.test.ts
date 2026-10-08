import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send } }));

import { readSwitches } from "../qualified-followup.policy.js";
import { buildDailyReport, collectDailyReport, groupWaFailures, runDailyReport, type DailyReportData } from "../qualified-followup.report.js";

const now = new Date("2026-10-07T08:30:00+05:30");
const liveEnv = { QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv;
const testEnv = { QUAL_FOLLOWUP_MODE: "live", QUAL_FOLLOWUP_TEST_MODE: "true", QUAL_FOLLOWUP_TEST_TO_PHONE: "9111122222", QUAL_FOLLOWUP_TEST_TO_EMAIL: "qa@x.in" } as NodeJS.ProcessEnv;
const zero = { enqueued: 0, emailed: 0, emailFailed: 0, whatsapped: 0, waFailed: 0, callInFile: 0, callQueued: 0, called: 0, stopped: {} };

const data = (over: Partial<DailyReportData> = {}): DailyReportData => ({
  date: "2026-10-07", mode: "live",
  perSource: [{ sourceType: "meta_live", ...zero, enqueued: 5, emailed: 4 }, { sourceType: "meta_old", ...zero }, { sourceType: "he", ...zero, enqueued: 2, stopped: { opted_out: 1 } }],
  skipped: [{ reason: "no_phone", count: 1, examples: [{ name: "Asha", mobileMasked: "xxxxxx3210", requisition: "REQ-1" }] }],
  waFailuresByCode: [{ code: "132018", count: 2, sample: "(#132018) a <b>" }],
  blockedByReason: [{ channel: "whatsapp", reason: "whatsapp_not_configured", count: 4 }],
  callFiles: [],
  ...over,
});

beforeEach(() => { execute.mockReset(); send.mockReset(); send.mockResolvedValue({}); Object.values(logger).forEach((f) => f.mockReset()); });

describe("buildDailyReport", () => {
  it("shows phones masked only", () => {
    const r = buildDailyReport(data());
    expect(r.html).toContain("xxxxxx3210");
    expect(r.text).toContain("xxxxxx3210");
    expect(r.html).not.toMatch(/\d{10}/);
    expect(r.text).not.toMatch(/\d{10}/);
  });
  it("renders one row per source in order, zero-count included", () => {
    const r = buildDailyReport(data());
    const order = ["meta_live", "meta_old", "he"].map((s) => r.html.indexOf(`<td>${s}</td>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(r.text).toMatch(/meta_old\b.*0/);
  });
  it("subject and html escaping", () => {
    expect(buildDailyReport(data()).subject).toBe("[HRMS] Qualified follow-up daily report 2026-10-07 (live)");
    expect(buildDailyReport(data()).html).toContain("&lt;b&gt;");
  });
});

describe("calling-file batches in the daily report", () => {
  it("collects each batch of the window for this tag with its counts; empty batches included", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("FROM qualified_followup_call_batch")) return [[
        { slot_key: "2026-10-06 10:00", status: "sent", row_count: 12, summary: JSON.stringify({ rows: 12, skipped: { already_in_file: 3, opted_out: 1 }, merged: 2, deferred: 0 }) },
        { slot_key: "2026-10-06 12:00", status: "empty", row_count: 0, summary: null },
      ]];
      if (q.includes("COUNT(*)")) return [[{ n: 0 }]];
      return [[]];
    });
    const d = await collectDailyReport(new Date("2026-10-06T08:30:00+05:30"), now, "live");
    const sql = execute.mock.calls.map(([q]) => String(q)).find((q) => q.includes("FROM qualified_followup_call_batch"))!;
    expect(sql).toContain("mode_tag = ?");
    expect(d.callFiles).toEqual([
      { slot: "2026-10-06 10:00", status: "sent", rows: 12, notFiled: 4, merged: 2 },
      { slot: "2026-10-06 12:00", status: "empty", rows: 0, notFiled: 0, merged: 0 },
    ]);
  });
  it("a failed batch read leaves the report going, marked unavailable", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM qualified_followup_call_batch")) throw new Error("Unknown column 'mode_tag'");
      return String(sql).includes("COUNT(*)") ? [[{ n: 0 }]] : [[]];
    });
    expect((await collectDailyReport(new Date("2026-10-06T08:30:00+05:30"), now, "live")).callFiles).toBeNull();
  });
  it("renders a Calling files section with totals", () => {
    const r = buildDailyReport(data({ callFiles: [
      { slot: "2026-10-06 10:00", status: "sent", rows: 12, notFiled: 4, merged: 2 }, { slot: "2026-10-06 12:00", status: "empty", rows: 0, notFiled: 0, merged: 0 }] }));
    expect(r.html).toContain("<h3>Calling files</h3>");
    expect(r.html).toMatch(/2 batches, 12 people filed, 4 not filed/);
    expect(r.text).toMatch(/2026-10-06 10:00 sent: 12 people, 4 not filed \(duplicates or stops\), 2 merged/);
    expect(buildDailyReport(data({ callFiles: null })).text).toMatch(/Calling files\nunavailable/);
  });
});

describe("groupWaFailures", () => {
  it("groups by Meta code, most frequent first", () => {
    expect(groupWaFailures(["(#132018) a", "(#132018) b", "HTTP 401"]).map(({ code, count }) => ({ code, count })))
      .toEqual([{ code: "132018", count: 2 }, { code: "HTTP 401", count: 1 }]);
  });
  it("cuts the sample to 120 chars and strips phones and e-mails", () => {
    const [g] = groupWaFailures([`(#132018) to 919876543210 a@b.com ${"x".repeat(200)}`]);
    expect(g!.sample.length).toBeLessThanOrEqual(120);
    expect(g!.sample).not.toMatch(/\d{10}|@/);
  });
});

describe("collectDailyReport", () => {
  it("builds all three sources, zero-filled, and groups failures", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("GROUP BY qf.source_type, qf.stopped_reason")) return [[{ source_type: "he", stopped_reason: "opted_out", n: "3" }]];
      if (q.includes("GROUP BY qf.source_type")) return [[{ source_type: "he", enqueued: "2", emailed: "1", email_failed: "0", whatsapped: "1", wa_failed: "1", call_in_file: "0", call_queued: "0", called: "0" }]];
      if (q.includes("wa_error FROM")) return [[{ wa_error: "(#132018) a" }, { wa_error: "(#132018) b" }]];
      if (q.includes("COUNT(*)")) return [[{ n: 0 }]];
      return [[]];
    });
    const d = await collectDailyReport(new Date("2026-10-06T08:30:00+05:30"), now, "live");
    expect(d.perSource.map((p) => p.sourceType)).toEqual(["meta_live", "meta_old", "he"]);
    expect(d.perSource[2]).toMatchObject({ enqueued: 2, stopped: { opted_out: 3 } });
    expect(d.perSource[0]!.enqueued).toBe(0);
    expect(d.waFailuresByCode[0]).toMatchObject({ code: "132018", count: 2 });
    expect(d.date).toBe("2026-10-07");
  });
  it("reports blocked and skipped steps by scrubbed reason, per channel", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("qf.wa_error AS reason")) return [[{ reason: "whatsapp_not_configured", n: "7" }, { reason: "bad for a@b.in", n: "1" }]];
      if (q.includes("qf.email_error AS reason")) return [[{ reason: "no_email", n: "2" }]];
      if (q.includes("COUNT(*)")) return [[{ n: 0 }]];
      return [[]];
    });
    const d = await collectDailyReport(new Date("2026-10-06T08:30:00+05:30"), now, "live");
    expect(d.blockedByReason).toEqual([
      { channel: "email", reason: "no_email", count: 2 },
      { channel: "whatsapp", reason: "whatsapp_not_configured", count: 7 },
      { channel: "whatsapp", reason: "bad for [email]", count: 1 },
    ]);
    const sql = execute.mock.calls.map(([q]) => String(q)).find((q) => q.includes("qf.wa_error AS reason"))!;
    expect(sql).toContain("IN ('blocked','skipped')");
    expect(buildDailyReport(d).text).toContain("whatsapp: whatsapp_not_configured x7");
  });
  it("caps skip examples at 10 per reason while keeping the full count", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("SELECT COUNT(*) AS n FROM") && q.includes("opted_out")) return [[{ n: 25 }]];
      if (q.includes("AS name") && q.includes("opted_out")) {
        const m = q.match(/LIMIT (\d+)/);
        return [Array.from({ length: Math.min(25, Number(m?.[1] ?? 25)) }, (_, i) => ({ name: `N${i}`, phone: "9876543210", req: "R1" }))];
      }
      return [[]];
    });
    const d = await collectDailyReport(new Date("2026-10-06T08:30:00+05:30"), now, "live");
    const s = d.skipped.find((x) => x.reason === "opted_out")!;
    expect(s.count).toBe(25);
    expect(s.examples).toHaveLength(10);
    expect(execute.mock.calls.some(([q]) => String(q).includes("AS name") && /LIMIT 10\b/.test(String(q)))).toBe(true);
  });
  it("uses explicit collation on string joins", async () => {
    execute.mockResolvedValue([[]]);
    await collectDailyReport(new Date("2026-10-06T08:30:00+05:30"), now, "live");
    const joins = execute.mock.calls.map(([q]) => String(q)).filter((q) => /JOIN job_requisition/.test(q));
    expect(joins.length).toBeGreaterThan(0);
    for (const q of joins) expect(q).toMatch(/COLLATE utf8mb4_unicode_ci/);
  });
});

describe("runDailyReport", () => {
  it("sends to the call-file recipient and resolves true", async () => {
    execute.mockResolvedValue([[]]);
    expect(await runDailyReport(readSwitches(liveEnv), "live", now)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ to: "shivam.giri@teammas.in", subject: expect.stringContaining("(live)") });
  });
  it("test mode goes only to the test email", async () => {
    execute.mockResolvedValue([[]]);
    await runDailyReport(readSwitches(testEnv), "test", now);
    expect(send.mock.calls[0]![0].to).toBe("qa@x.in");
  });
  it("dry run sends nothing and reports handled", async () => {
    execute.mockResolvedValue([[]]);
    expect(await runDailyReport(readSwitches({ QUAL_FOLLOWUP_MODE: "dry_run" } as NodeJS.ProcessEnv), "dry_run", now)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
  it("email failure resolves false without throwing", async () => {
    execute.mockResolvedValue([[]]);
    send.mockRejectedValue(new Error("smtp down for a@b.com 9876543210"));
    expect(await runDailyReport(readSwitches(liveEnv), "live", now)).toBe(false);
    const logged = JSON.stringify(logger.warn.mock.calls) + JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toMatch(/a@b\.com|9876543210/);
  });
  it("selection error resolves false, sends nothing, logs without contact data", async () => {
    execute.mockRejectedValue(new Error("boom 9876543210 x@y.in"));
    expect(await runDailyReport(readSwitches(liveEnv), "live", now)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/9876543210|x@y\.in/);
  });
  it("test mode without a test email fails closed", async () => {
    execute.mockResolvedValue([[]]);
    expect(await runDailyReport({ ...readSwitches(testEnv), testEmail: null }, "test", now)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
