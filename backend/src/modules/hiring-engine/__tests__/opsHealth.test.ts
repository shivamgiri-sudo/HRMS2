import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<{ match: RegExp; rows: unknown[]; throws?: boolean }>, sqls: [] as string[] }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string) => { h.sqls.push(sql); const hit = h.rows.find((r) => r.match.test(sql)); if (hit?.throws) throw new Error("db"); return [hit ? hit.rows : [], []]; }) },
}));
vi.mock("../../../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send: vi.fn(), bind: vi.fn() } }));

import { collectHealth, healthEmail, istHour, runMorningHealth } from "../ops-health.service.js";

beforeEach(() => { h.rows = []; h.sqls = []; });

describe("collectHealth", () => {
  it("flags the reader, the WhatsApp backlog and past-deadline requisitions", async () => {
    h.rows = [
      { match: /FROM meta_lead_raw/, rows: [{ h: 2 }] },
      { match: /inbound_email_cursor/, rows: [] },
      { match: /wa_due_at < DATE_SUB/, rows: [{ n: 40, oldest: "2026-10-09 10:00:00" }] },
      { match: /job_requisition WHERE active_status = 1 AND approval_status = 'approved' AND fulfilled_headcount < requested_headcount AND requisition_validity IS NOT NULL/, rows: [{ c: "NOIDA-Onfido-17", v: "2026-09-25" }] },
    ];
    const c = await collectHealth(new Date("2026-10-11T03:00:00Z"));
    const by = Object.fromEntries(c.map((x) => [x.key, x]));
    expect(by.reply_reader.level).toBe("crit");
    expect(by.wa_backlog.level).toBe("crit");
    expect(by.past_deadline.detail).toContain("NOIDA-Onfido-17");
    expect(by.meta_sync.level).toBe("ok");
  });
  it("a failing query is never reported as healthy", async () => {
    h.rows = [{ match: /FROM meta_lead_raw/, rows: [], throws: true }];
    const c = await collectHealth(new Date());
    expect(c.find((x) => x.key === "meta_sync")?.level).toBe("warn");
  });
});

describe("healthEmail", () => {
  it("is an all-clear when nothing is wrong and leads with the worst item otherwise", () => {
    expect(healthEmail([{ key: "a", level: "ok", title: "Fine", detail: "ok" }], "2026-10-11").subject).toContain("all healthy");
    const m = healthEmail([{ key: "a", level: "ok", title: "Fine", detail: "ok" }, { key: "b", level: "crit", title: "Stuck", detail: "bad" }, { key: "c", level: "warn", title: "Watch", detail: "hmm" }], "2026-10-11");
    expect(m.level).toBe("crit");
    expect(m.subject).toContain("2 need attention");
    expect(m.text.split("\n")[0]).toContain("Stuck");
  });
});

describe("runMorningHealth", () => {
  it("only runs between 08:15 and noon IST", async () => {
    expect(istHour(new Date("2026-10-11T02:30:00Z"))).toBeCloseTo(8, 1);
    expect(await runMorningHealth(new Date("2026-10-11T02:30:00Z"))).toBe(false);   // 08:00 IST
    expect(await runMorningHealth(new Date("2026-10-11T07:30:00Z"))).toBe(false);   // 13:00 IST
  });
  it("sends once a day and not again the same day", async () => {
    const send = vi.fn(async () => ({}));
    h.rows = [{ match: /FROM he_model_param WHERE param_key = \?/, rows: [] }];
    expect(await runMorningHealth(new Date("2026-10-11T03:30:00Z"), { send: send as never, to: "x@example.test" })).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    h.rows = [{ match: /FROM he_model_param WHERE param_key = \?/, rows: [{ sample: 20261011 }] }];
    expect(await runMorningHealth(new Date("2026-10-11T04:30:00Z"), { send: send as never, to: "x@example.test" })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
