import { beforeEach, describe, expect, it, vi } from "vitest";

/** Pin of the public invitation API for match tokens (context SQL + result, answer calls), taken before invite tokens were added. */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  row: { id: "M1", lead_id: "L1", state: "invited", slot_at: "2026-10-09 11:00:00", full_name: "Asha Rao", branch_name: "NOIDA-2", designation_name: "CSE",
    rsvp_open: 1, address: "C-27 Sector 62", latitude: 28.6, longitude: 77.3, is_open: 0, optin_open: 1, lead_status: "new" } as Record<string, unknown>,
  recordInviteAnswer: vi.fn(async (..._a: unknown[]) => ({ state: "confirmed" })),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string, p: unknown[] = []) => { h.sqls.push({ sql, p }); return sql.includes("WHERE m.token = ?") ? [[h.row]] : [[]]; }) },
}));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(), grantConsent: vi.fn(), hasConsent: vi.fn(async () => false), revokeConsent: vi.fn() }));
vi.mock("../he-ingest.service.js", () => ({ recordInviteAnswer: h.recordInviteAnswer }));

import { answerInvite, getContextByToken } from "../he-location.service.js";

const TOKEN = "a".repeat(32);
beforeEach(() => { h.sqls = []; h.recordInviteAnswer.mockClear(); });

describe("public invitation API pin (match tokens)", () => {
  it("context SQL and result", async () => {
    const c = await getContextByToken(TOKEN);
    expect({ c, sqls: h.sqls }).toMatchSnapshot();
  });
  for (const a of ["yes", "no", "later"] as const) {
    it(`answer ${a}`, async () => {
      const r = await answerInvite(TOKEN, a);
      expect({ r, calls: h.recordInviteAnswer.mock.calls }).toMatchSnapshot();
    });
  }
  it("bad answer and closed rsvp", async () => {
    expect(await answerInvite(TOKEN, "maybe")).toEqual({ ok: false, reason: "bad_answer" });
    h.row.rsvp_open = 0;
    expect(await answerInvite(TOKEN, "yes")).toEqual({ ok: false, reason: "closed" });
    h.row.rsvp_open = 1;
    expect(h.recordInviteAnswer).not.toHaveBeenCalled();
  });
});
