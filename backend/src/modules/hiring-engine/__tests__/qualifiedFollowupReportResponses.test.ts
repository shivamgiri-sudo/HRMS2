import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send: vi.fn() } }));

import { collectResponsesSection, responsesLines, type ResponsesSection } from "../qualified-followup.report-responses.js";
import { buildDailyReport, collectDailyReport, type DailyReportData } from "../qualified-followup.report.js";

const NOW = new Date("2026-10-08T03:00:00Z"); // 08:30 IST
const F = "2026-10-07 08:30:00", T = "2026-10-08 08:30:00";
const section = (o: Partial<ResponsesSection> = {}): ResponsesSection => ({
  byChannel: [{ channel: "whatsapp", responses: 5, confirms: 3 }, { channel: "web", responses: 2, confirms: 2 }], conflicts: 1,
  queue: { size: 4, oldestHours: 30 }, whatsappInbound: { lastAt: "2026-10-08 07:10:00", count7d: 40 }, emailInbound: { lastAt: null, count7d: 0, pollerAt: null }, ...o,
});
const base = (o: Partial<DailyReportData> = {}): DailyReportData => ({ date: "2026-10-08", mode: "live", perSource: [], skipped: [], waFailuresByCode: [], blockedByReason: [], callFiles: [], ...o });

beforeEach(() => { execute.mockReset(); });

describe("collectResponsesSection", () => {
  it("reads the window per channel, the review queue, 7-day inbound health and the IMAP cursor", async () => {
    execute.mockImplementation(async (sql: string) => {
      const q = String(sql);
      if (q.includes("GROUP BY cr.channel") && q.includes("SUM(cr.conflict = 1)")) return [[{ channel: "whatsapp", responses: 5, confirms: 3, conflicts: 1 }, { channel: "email", responses: 1, confirms: 0, conflicts: 0 }]];
      if (q.includes("status = 'needs_review'")) return [[{ n: 4, oldest: "2026-10-07 02:30:00" }]];
      if (q.includes("source_kind IN")) return [[{ channel: "whatsapp", last_at: "2026-10-08 07:10:00", n: 40 }]];
      if (q.includes("FROM inbound_email_cursor")) return [[{ at: "2026-10-08 08:25:00" }]];
      return [[]];
    });
    const s = (await collectResponsesSection(F, T, NOW))!;
    expect(s.byChannel).toEqual([{ channel: "whatsapp", responses: 5, confirms: 3 }, { channel: "email", responses: 1, confirms: 0 }]);
    expect(s.conflicts).toBe(1);
    expect(s.queue).toEqual({ size: 4, oldestHours: 30 });
    expect(s.whatsappInbound).toEqual({ lastAt: "2026-10-08 07:10:00", count7d: 40 });
    expect(s.emailInbound).toEqual({ lastAt: null, count7d: 0, pollerAt: "2026-10-08 08:25:00" });
    const win = execute.mock.calls.find(([q]) => String(q).includes("SUM(cr.conflict = 1)"))!;
    expect(win[1]).toEqual([F, T]);
    const inbound = execute.mock.calls.find(([q]) => String(q).includes("source_kind IN"))!;
    expect(inbound[1]).toEqual(["2026-10-01 08:30:00"]);
  });
  it("ledger not deployed yet: null (the report says unavailable), never throws", async () => {
    execute.mockRejectedValue(Object.assign(new Error("x"), { code: "ER_NO_SUCH_TABLE" }));
    expect(await collectResponsesSection(F, T, NOW)).toBeNull();
  });
  it("collectDailyReport includes the section", async () => {
    execute.mockImplementation(async (sql: string) => (String(sql).includes("COUNT(*) AS n") ? [[{ n: 0 }]] : [[]]));
    const d = await collectDailyReport(new Date("2026-10-07T03:00:00Z"), NOW, "live");
    expect(d.responses).toMatchObject({ byChannel: [], conflicts: 0, queue: { size: 0, oldestHours: null } });
  });
});

describe("Responses section in the daily report", () => {
  it("per channel responses and confirms, queue size and oldest age, inbound health, conflicts; no phone numbers", () => {
    const r = buildDailyReport(base({ responses: section() }));
    expect(r.html).toContain("<h3>Responses</h3>");
    expect(r.text).toContain("whatsapp: 5 responses, 3 confirmed");
    expect(r.text).toContain("Waiting for HR review: 4 (oldest 30 h)");
    expect(r.text).toContain("WhatsApp inbound: 40 in 7 days, last 2026-10-08 07:10:00");
    expect(r.text).toContain("Conflicts (a later answer against a confirm): 1");
    expect(r.html).not.toMatch(/\d{10}/);
  });
  it("warns when no WhatsApp reply came in for 7 days, and when the mailbox poller has not run", () => {
    const t = responsesLines(section({ whatsappInbound: { lastAt: null, count7d: 0 } })).text.join("\n");
    expect(t).toContain("WARNING WhatsApp inbound: none in 7 days");
    expect(t).toContain("Email inbound: none in 7 days (mailbox poller not running)");
  });
  it("unavailable section says so; a report without the field is unchanged", () => {
    expect(buildDailyReport(base({ responses: null })).text).toContain("Responses\nunavailable");
    expect(buildDailyReport(base()).html).not.toContain("Responses");
  });
});
