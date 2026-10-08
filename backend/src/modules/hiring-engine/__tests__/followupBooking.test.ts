import { beforeEach, describe, expect, it, vi } from "vitest";

/** bookJourney maps a follow-up row onto the shared booking core (drive selection is tested in walkinBooking.test.ts). */
const h = vi.hoisted(() => ({
  sqls: [] as Array<{ sql: string; p: unknown[] }>,
  req: { approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0, requisition_validity: null } as Record<string, unknown> | null,
  address: "Sector 62, Noida" as string | null,
  match: null as Record<string, unknown> | null,
  driveDate: "2026-10-12",
  book: vi.fn(),
  ensure: vi.fn(async () => "L1" as string | null),
  leadByMobile: null as string | null,
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      h.sqls.push({ sql: sql.replace(/\s+/g, " ").trim(), p });
      if (sql.includes("FROM job_requisition")) return [h.req ? [h.req] : []];
      if (sql.includes("FROM branch_master")) return [h.address === null ? [] : [{ address: h.address }]];
      if (sql.includes("FROM he_match WHERE lead_id = ? AND requisition_id = ?")) return [h.match ? [h.match] : []];
      if (sql.includes("SELECT drive_date FROM he_drive")) return [[{ drive_date: h.driveDate }]];
      if (sql.includes("SELECT id FROM he_lead WHERE mobile10")) return [h.leadByMobile ? [{ id: h.leadByMobile }] : []];
      if (sql.includes("FROM he_match WHERE id = ?")) return [[{ id: "M1", slot_at: "2026-10-10 10:00:00", token: "tok1" }]];
      return [{ affectedRows: 1 }];
    }),
  },
}));
vi.mock("../walkin-booking.service.js", async () => {
  const actual = await vi.importActual<typeof import("../walkin-booking.service.js")>("../walkin-booking.service.js");
  return { ...actual, bookLeadOnDrive: h.book };
});
vi.mock("../qualified-followup.context.js", async () => {
  const actual = await vi.importActual<typeof import("../qualified-followup.context.js")>("../qualified-followup.context.js");
  return { ...actual, ensureHeLead: h.ensure };
});

import { bookJourney, markInvitedAfterSend, mirrorSlotToMeta } from "../followup-booking.service.js";
import { loadSendContext, type FollowupRow } from "../qualified-followup.context.js";

const NOW = new Date("2026-10-09T05:30:00Z"); // Fri 11:00 IST
const row = (o: Partial<FollowupRow> = {}): FollowupRow => ({
  id: "F1", sourceType: "meta_live", metaLeadId: "ML1", heLeadId: null, atsCandidateId: null, requisitionId: "R1", driveId: null,
  mobile10: "9876543210", email: "a@x.in", fullName: "Asha Rao", branchName: "NOIDA-2", roleName: "CSE", qualifiedAt: NOW,
  emailDueAt: null, emailStatus: null, emailAttempts: 0, waDueAt: null, waStatus: null, waAttempts: 0, callDueAt: null, callState: "pending", callAttempts: 0,
  matchId: null, journeyState: "enrolled", reinviteNo: 0, heldReason: null, modeAtEnqueue: "live", ...o,
});
const writes = () => h.sqls.filter((s) => /^(INSERT|UPDATE|DELETE)/.test(s.sql));

beforeEach(() => {
  h.sqls = []; h.address = "Sector 62, Noida"; h.match = null; h.driveDate = "2026-10-12"; h.leadByMobile = null;
  h.req = { approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 5, fulfilled_headcount: 0, requisition_validity: null };
  h.book.mockReset(); h.ensure.mockReset(); h.ensure.mockResolvedValue("L1");
  h.book.mockResolvedValue({ status: "booked", matchId: "M1", driveId: "D1", slotAt: "2026-10-10 10:00:00", token: "t", created: true });
});

describe("bookJourney", () => {
  it("books through the shared core, writes match_id/drive_id back and mirrors the slot for a Live Meta row", async () => {
    const r = await bookJourney(row(), { now: NOW, simulate: false });
    expect(r).toEqual({ status: "booked", matchId: "M1", driveId: "D1", slotAt: "2026-10-10 10:00:00" });
    expect(h.book).toHaveBeenCalledWith(expect.objectContaining({ leadId: "L1", requisitionId: "R1", branchName: "NOIDA-2", preferredSlotAt: null, now: NOW, state: "invited" }));
    expect(writes().map((w) => [w.sql, w.p])).toEqual([
      ["UPDATE qualified_followup SET match_id = ?, drive_id = ? WHERE id = ?", ["M1", "D1", "F1"]],
      ["UPDATE meta_lead_raw SET interview_date = ?, interview_time = ? WHERE id = ?", ["2026-10-10", "10:00:00", "ML1"]],
    ]);
  });

  it("an HE row prefers its line-up drive's day and is not mirrored", async () => {
    await bookJourney(row({ sourceType: "he", metaLeadId: null, heLeadId: "L9", driveId: "D7" }), { now: NOW, simulate: false });
    expect(h.book).toHaveBeenCalledWith(expect.objectContaining({ leadId: "L1", preferredSlotAt: "2026-10-12 00:00:00" }));
    expect(writes().some((w) => w.sql.includes("meta_lead_raw"))).toBe(false);
  });

  it("reuses an invited match with a future slot (never moved to another day)", async () => {
    h.match = { id: "M5", state: "invited", drive_id: "D5", slot_at: "2026-10-09 15:00:00" };
    const r = await bookJourney(row(), { now: NOW, simulate: false });
    expect(r).toEqual({ status: "booked", matchId: "M5", driveId: "D5", slotAt: "2026-10-09 15:00:00" });
    expect(h.book).not.toHaveBeenCalled();
    expect(writes()[0].p).toEqual(["M5", "D5", "F1"]);
  });

  it("a past invited slot is re-booked through the core", async () => {
    h.match = { id: "M5", state: "invited", drive_id: "D5", slot_at: "2026-10-08 15:00:00" };
    await bookJourney(row(), { now: NOW, simulate: false });
    expect(h.book).toHaveBeenCalled();
  });

  it("no branch address -> slotless no_branch_address, no writes", async () => {
    h.address = null;
    expect(await bookJourney(row(), { now: NOW, simulate: false })).toEqual({ status: "slotless", reason: "no_branch_address" });
    expect(await bookJourney(row({ branchName: null }), { now: NOW, simulate: false })).toEqual({ status: "slotless", reason: "no_branch_address" });
    expect(writes()).toHaveLength(0);
    expect(h.book).not.toHaveBeenCalled();
  });

  it("requisition closed since enrolment -> slotless requisition_closed", async () => {
    h.req = { ...h.req, fulfilled_headcount: 5 };
    expect(await bookJourney(row(), { now: NOW, simulate: false })).toEqual({ status: "slotless", reason: "requisition_closed" });
    h.req = { ...h.req, fulfilled_headcount: 0, approval_status: "pending_approval" };
    expect(await bookJourney(row(), { now: NOW, simulate: false })).toEqual({ status: "slotless", reason: "requisition_closed" });
    expect(writes()).toHaveLength(0);
  });

  it("simulate makes no writes and returns would_book with the date", async () => {
    const r = await bookJourney(row(), { now: NOW, simulate: true });
    expect(r).toEqual({ status: "would_book", driveDate: "2026-10-10" });
    expect(writes()).toHaveLength(0);
    expect(h.book).not.toHaveBeenCalled();
    expect(h.ensure).not.toHaveBeenCalled();
  });

  it("no lead -> slotless no_lead", async () => {
    h.ensure.mockResolvedValue(null);
    expect(await bookJourney(row(), { now: NOW, simulate: false })).toEqual({ status: "slotless", reason: "no_lead" });
  });

  it("core unavailable maps to slotless reasons", async () => {
    h.book.mockResolvedValue({ status: "unavailable", reason: "no_capacity" });
    expect(await bookJourney(row(), { now: NOW, simulate: false })).toEqual({ status: "slotless", reason: "no_capacity" });
    h.book.mockResolvedValue({ status: "unavailable", reason: "drive_closed" });
    expect(await bookJourney(row(), { now: NOW, simulate: false })).toEqual({ status: "slotless", reason: "drive_closed" });
    h.book.mockResolvedValue({ status: "unavailable", reason: "no_branch" });
    expect(await bookJourney(row(), { now: NOW, simulate: false })).toEqual({ status: "slotless", reason: "no_branch_address" });
  });
});

describe("booking helpers", () => {
  it("markInvitedAfterSend moves suggested -> invited only", async () => {
    await markInvitedAfterSend("M1");
    expect(h.sqls[0]).toEqual({ sql: "UPDATE he_match SET state = 'invited' WHERE id = ? AND state = 'suggested' AND slot_at IS NOT NULL", p: ["M1"] });
  });
  it("mirrorSlotToMeta writes interview_date / interview_time", async () => {
    await mirrorSlotToMeta("ML1", "2026-10-10 14:30:00");
    expect(h.sqls[0].p).toEqual(["2026-10-10", "14:30:00", "ML1"]);
  });
});

describe("loadSendContext reads the booking", () => {
  it("a booked row of any source takes its slot and token from he_match, never the Meta rolling slot", async () => {
    const ctx = await loadSendContext(row({ matchId: "M1" }), { assignSlot: true, now: NOW });
    expect(ctx).toMatchObject({ matchId: "M1", matchToken: "tok1", slot: { date: "2026-10-10", time: "10:00:00" } });
    expect(h.sqls.some((s) => s.sql.includes("meta_lead_raw"))).toBe(false);
  });
});
