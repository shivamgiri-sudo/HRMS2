import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: h.execute } }));
vi.mock("../../../logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../he-email.service.js", () => ({ sendInviteEmail: vi.fn() }));
vi.mock("../he-send.service.js", () => ({ sendTemplateToLead: vi.fn() }));

import { DUE_SQL, inCorrectionWindow, runSlotCorrections } from "../slot-corrections.js";

const at = (hhmm: string) => new Date(`2026-10-11T${hhmm}:00+05:30`);
beforeEach(() => h.execute.mockReset());

describe("slot corrections", () => {
  it("only runs between 09:00 and 20:00 IST, on any day", () => {
    expect(inCorrectionWindow(at("08:59"))).toBe(false);
    expect(inCorrectionWindow(at("09:00"))).toBe(true);
    expect(inCorrectionWindow(at("19:59"))).toBe(true);
    expect(inCorrectionWindow(at("20:00"))).toBe(false);
  });
  it("selects only matches emailed for another drive and not for the one they hold", () => {
    expect(DUE_SQL).toContain("NOT (x.drive_id <=> m.drive_id)");
    expect(DUE_SQL).toContain("NOT EXISTS");
    expect(DUE_SQL).toContain("y.drive_id <=> m.drive_id");
    expect(DUE_SQL).toContain("l.status <> 'opted_out'");
  });
  it("outside the window it reads nothing", async () => {
    const r = await runSlotCorrections(at("07:00"));
    expect(r).toEqual({ due: 0, emailed: 0, whatsapp: 0 });
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("sends the email and one WhatsApp per due match, and skips the WhatsApp already sent for that drive", async () => {
    const email = vi.fn(async () => ({ status: "sent" as const, messageId: "m", providerMessageId: "p" }));
    const wa = vi.fn(async () => ({ status: "sent" as const, messageId: "m", providerMessageId: "p" }));
    h.execute
      .mockResolvedValueOnce([[{ match_id: "a", lead_id: "l1", requisition_id: "r", drive_id: "d" }, { match_id: "b", lead_id: "l2", requisition_id: "r", drive_id: "d" }], []])
      .mockResolvedValueOnce([[], []])            // l1: no earlier reschedule offer for that drive
      .mockResolvedValueOnce([[{ 1: 1 }], []]);   // l2: already offered
    const r = await runSlotCorrections(at("10:00"), { email, wa });
    expect(r).toEqual({ due: 2, emailed: 2, whatsapp: 1 });
    expect(wa).toHaveBeenCalledWith({ leadId: "l1", key: "he_reschedule_offer", matchId: "a", transactional: true });
  });
  it("a database error is swallowed", async () => {
    h.execute.mockRejectedValueOnce(new Error("db down"));
    await expect(runSlotCorrections(at("10:00"))).resolves.toEqual({ due: 0, emailed: 0, whatsapp: 0 });
  });
});
