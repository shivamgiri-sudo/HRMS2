import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const warn = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));

import {
  ACTION_PRIORITY, ageText, contactHref, parseRef, pickRecruiter, rankActions, type ActionFact,
} from "../he-action-queue.js";
import { clearActionQueueCache, getActionQueue } from "../he-action-queue.service.js";

const NOW = "2026-10-14 11:30:00";
const fact = (o: Partial<ActionFact> = {}): ActionFact => ({
  kind: "high_score_not_reached", ref: { type: "match", id: "m1" }, leadId: "l1", mobile10: "9876543210", name: "Asha", requisitionId: "r1",
  requisitionCode: "RQ-1", branch: "Pune", driveDate: "2026-10-14", eventAt: "2026-10-14 08:30:00", score: 80, assignedRecruiter: null, ...o,
});

describe("pickRecruiter", () => {
  it("present first, then lightest queue, then name", () => {
    expect(pickRecruiter([{ name: "B", presentToday: false, activeQueue: 0 }, { name: "A", presentToday: true, activeQueue: 3 }, { name: "C", presentToday: true, activeQueue: 1 }])).toBe("C");
    expect(pickRecruiter([])).toBeNull();
  });
});

describe("rankActions", () => {
  it("keeps one item per mobile: the lowest priority number", () => {
    const { items } = rankActions([fact({ kind: "wa_failed", ref: { type: "followup", id: "f1" } }), fact({ kind: "replied_not_confirmed" })], NOW, () => null);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "replied_not_confirmed", suggested: "whatsapp", ref: "match:m1", id: "replied_not_confirmed:match:m1" });
  });
  it("same kind: the oldest event wins", () => {
    const { items } = rankActions([fact({ ref: { type: "match", id: "new" }, eventAt: "2026-10-14 10:00:00" }), fact({ ref: { type: "match", id: "old" }, eventAt: "2026-10-14 06:00:00" })], NOW, () => null);
    expect(items.map((i) => i.ref)).toEqual(["match:old"]);
  });
  it("sorts by priority, then sooner drive (null last), then older", () => {
    const kinds = Object.keys(ACTION_PRIORITY) as ActionFact["kind"][];
    const facts = [...kinds].reverse().map((kind, i) => fact({ kind, mobile10: `98765432${10 + i}`, ref: { type: "match", id: `m${i}` } }));
    expect(rankActions(facts, NOW, () => null).items.map((i) => i.kind)).toEqual(kinds);
    const two = rankActions([
      fact({ mobile10: "9000000001", driveDate: "2026-10-16", ref: { type: "match", id: "a" } }),
      fact({ mobile10: "9000000002", driveDate: "2026-10-15", ref: { type: "match", id: "b" } }),
      fact({ mobile10: "9000000003", driveDate: null, ref: { type: "match", id: "c" } }),
    ], NOW, () => null).items.map((i) => i.ref);
    expect(two).toEqual(["match:b", "match:a", "match:c"]);
  });
  it("caps at 100 and says truncated", () => {
    const facts = Array.from({ length: 120 }, (_, i) => fact({ mobile10: `9${String(100000000 + i)}`, ref: { type: "match", id: `m${i}` } }));
    const r = rankActions(facts, NOW, () => null);
    expect([r.items.length, r.truncated]).toEqual([100, true]);
  });
  it("ageText", () => {
    expect([ageText(59), ageText(61), ageText(1440), ageText(2900)]).toEqual(["59 min", "1 h", "1 day", "2 days"]);
  });
  it("masks the mobile and never carries a 10-digit run", () => {
    const { items } = rankActions([fact()], NOW, () => null);
    expect(items[0].mobileMasked).toBe("xxxxxx3210");
    expect(JSON.stringify(items)).not.toMatch(/\d{10}/);
  });
  it("recruiter basis: assigned, suggested, none", () => {
    expect(rankActions([fact({ assignedRecruiter: "Ravi" })], NOW, () => "Zed").items[0].recruiter).toEqual({ name: "Ravi", basis: "assigned" });
    expect(rankActions([fact()], NOW, () => "Zed").items[0].recruiter).toEqual({ name: "Zed", basis: "suggested" });
    expect(rankActions([fact()], NOW, () => null).items[0].recruiter).toEqual({ name: null, basis: "none" });
  });
  it("reasons use the exact wording", () => {
    const r = (f: Partial<ActionFact>) => rankActions([fact(f)], NOW, () => null).items[0].reason;
    expect(r({ kind: "confirmed_no_reminder", driveDate: "2026-10-14" })).toBe("Confirmed for Wed 14 Oct but no reminder went out");
    expect(r({ kind: "no_show_recovery", driveDate: "2026-10-13" })).toBe("Did not come on Tue 13 Oct: call to offer a new slot");
    expect(r({ kind: "wa_failed" })).toBe("WhatsApp failed: call instead");
    expect(r({ score: 82 })).toBe("Strong match (score 82) not reached yet");
  });
});

describe("contactHref and parseRef", () => {
  it("builds links only for valid Indian mobiles", () => {
    expect(contactHref("tel", "9876543210")).toBe("tel:+919876543210");
    expect(contactHref("whatsapp", "9876543210")).toBe("https://wa.me/919876543210");
    expect(contactHref("whatsapp", "5876543210")).toBeNull();
  });
  it("facts without a ten-digit mobile are not collapsed into one person", () => {
    const facts = [
      fact({ mobile10: "", ref: { type: "match", id: "a" } }),
      fact({ mobile10: "", ref: { type: "match", id: "b" } }),
      fact({ mobile10: "12345", ref: { type: "match", id: "c" } }),
      fact({ mobile10: "9000000001", ref: { type: "match", id: "d" } }),
      fact({ mobile10: "9000000001", kind: "wa_failed", ref: { type: "match", id: "e" } }),
    ];
    const { items } = rankActions(facts, NOW, () => null);
    expect(items).toHaveLength(4);
    expect(items.filter((i) => i.kind === "high_score_not_reached" && i.ref !== "match:d")).toHaveLength(3);
  });
  it("parses match and followup refs only", () => {
    const id = "0f1e2d3c-aaaa-bbbb-cccc-0000000abcde";
    expect(parseRef(`match:${id}`)).toEqual({ type: "match", id });
    expect(parseRef("match:not-a-uuid")).toBeNull();
    expect(parseRef(`lead:${id}`)).toBeNull();
    expect(parseRef(undefined)).toBeNull();
  });
});

// ---- service (mocked statements) -----------------------------------------------------------------------------------------------------
const NOW_DATE = new Date("2026-10-14T06:00:00Z");
const row = (o: Record<string, unknown> = {}) => ({
  ref_id: "m1", lead_id: "l1", mobile10: "9876543210", full_name: "Asha", requisition_id: "r1", requisition_code: "RQ-1", branch_name: "Pune",
  drive_date: "2026-10-14", score: 80, recruiter: null, event_at: "2026-10-14 08:30:00", ...o,
});
let byKind: Record<string, unknown[]> = {};
let failKind: string | null = null;
const sqls = () => execute.mock.calls.map((c) => String(c[0]));
const kindOf = (q: string): string | null =>
  q.includes("m.state = 'no_show'") ? "no_show_recovery"
  : q.includes("h.direction = 'in'") ? "replied_not_confirmed"
  : q.includes("he_reminder_1d") ? "confirmed_no_reminder"
  : q.includes("FROM qualified_followup qf") ? "wa_failed"
  : q.includes("w.delivery_status = 'failed'") ? "wa_failed_b"
  : q.includes("m.score >=") ? "high_score_not_reached" : null;
beforeEach(() => {
  vi.clearAllMocks(); clearActionQueueCache(); byKind = {}; failKind = null;
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM employees e")) return [[{ employee_id: "e1", first_name: "Kiran", last_name: "S", present_today: 1 }]];
    if (q.includes("FROM ats_queue_token")) return [[]];
    const k = kindOf(q);
    if (k && k === failKind) throw Object.assign(new Error("boom"), { code: "ER_X" });
    return [byKind[k ?? ""] ?? []];
  });
});

describe("getActionQueue", () => {
  it("every kind statement starts from he_drive or qualified_followup and never reads he_message / he_lead as a root", async () => {
    await getActionQueue({}, { all: true }, NOW_DATE);
    const kinds = sqls().filter((q) => kindOf(q));
    expect(kinds).toHaveLength(6);
    for (const q of kinds) {
      expect(q).toMatch(/FROM (he_drive|qualified_followup)\b/);
      expect(q.indexOf("FROM")).toBe(q.search(/FROM (he_drive|qualified_followup)\b/));
      expect(q).not.toContain("FROM he_message");
      expect(q).not.toContain("FROM he_lead ");
      // the drive window leads the join (measured: left alone the optimizer sometimes scans all of he_match first)
      if (/FROM he_drive d/.test(q)) { expect(q).toMatch(/^SELECT STRAIGHT_JOIN /); expect(q).toContain("JOIN he_match m FORCE INDEX (idx_he_match_drive) ON"); }
    }
  });
  it("Pune scope carries COLLATE on the branch compare", async () => {
    await getActionQueue({}, { all: false, branchName: "Pune" }, NOW_DATE);
    for (const q of sqls().filter((s) => kindOf(s))) expect(q).toMatch(/branch_name = \? COLLATE utf8mb4_unicode_ci/);
  });
  it("no-show recovery binds today-2 and today in IST", async () => {
    await getActionQueue({}, { all: true }, NOW_DATE);
    const c = execute.mock.calls.find((x) => kindOf(String(x[0])) === "no_show_recovery")!;
    expect(c[1]).toEqual(["2026-10-12", "2026-10-14"]);
  });
  it("one rejecting section gives partial and keeps the rest; a partial result is not cached", async () => {
    byKind.high_score_not_reached = [row()];
    failKind = "replied_not_confirmed";
    const r = await getActionQueue({}, { all: true }, NOW_DATE);
    expect(r).toMatchObject({ enabled: true, partial: true, failedSections: ["replied_not_confirmed"] });
    expect(r!.items).toHaveLength(1);
    const before = execute.mock.calls.length;
    await getActionQueue({}, { all: true }, NOW_DATE);
    expect(execute.mock.calls.length).toBeGreaterThan(before);
  });
  it("a clean result is cached per scope", async () => {
    byKind.high_score_not_reached = [row()];
    const a = await getActionQueue({}, { all: true }, NOW_DATE);
    const n = execute.mock.calls.length;
    const b = await getActionQueue({}, { all: true }, NOW_DATE);
    expect(execute.mock.calls.length).toBe(n);
    expect(b).toEqual(a);
    await getActionQueue({}, { all: false, branchName: "Pune" }, NOW_DATE);
    expect(execute.mock.calls.length).toBeGreaterThan(n);
  });
  it("suggests a recruiter read-only and counts by kind with masked mobiles", async () => {
    byKind.high_score_not_reached = [row()];
    byKind.replied_not_confirmed = [row({ mobile10: "9000000001", ref_id: "m2" })];
    const r = (await getActionQueue({}, { all: true }, NOW_DATE))!;
    expect(r.counts).toMatchObject({ replied_not_confirmed: 1, high_score_not_reached: 1, wa_failed: 0 });
    expect(r.items[0].recruiter).toEqual({ name: "Kiran S", basis: "suggested" });
    expect(JSON.stringify(r)).not.toMatch(/\d{10}/);
    for (const q of sqls()) expect(q.trimStart()).not.toMatch(/^(INSERT|UPDATE|DELETE)/i);
    expect(sqls().find((q) => q.includes("FROM employees e"))!.trimStart()).toMatch(/^SELECT/);
  });
  it("selects the requisition's branch for display and the recruiter lookup", async () => {
    byKind.high_score_not_reached = [row({ branch_name: "Thane" })];
    const r = (await getActionQueue({}, { all: true }, NOW_DATE))!;
    expect(r.items[0].branch).toBe("Thane");
    for (const q of sqls().filter((x) => kindOf(x) && !x.includes("FROM qualified_followup"))) {
      expect(q).toMatch(/jr\.branch_name,\s*d\.drive_date/);
      expect(q).not.toMatch(/\bd\.branch_name\b/);
    }
    expect(execute.mock.calls.find((c) => String(c[0]).includes("FROM employees e"))![1]).toEqual(["2026-10-14", "Thane", "Thane"]);
  });
  it("more than 20 branches needing a suggestion is partial with a reason and is not cached", async () => {
    byKind.high_score_not_reached = Array.from({ length: 21 }, (_, i) => row({ ref_id: `m${i}`, mobile10: `90000000${String(10 + i)}`, branch_name: `B${i}` }));
    const r = (await getActionQueue({}, { all: true }, NOW_DATE))!;
    expect(r.partial).toBe(true);
    expect(r.failedSections).toEqual(["recruiters"]);
    expect(r.partialReason).toMatch(/first 20 of 21 branches/);
    expect(execute.mock.calls.filter((c) => String(c[0]).includes("FROM employees e"))).toHaveLength(20);
    const n = execute.mock.calls.length;
    await getActionQueue({}, { all: true }, NOW_DATE);
    expect(execute.mock.calls.length).toBeGreaterThan(n);
  });
  it("out-of-scope requisition or branch is null without reading the lists", async () => {
    expect(await getActionQueue({ branch: "Noida" }, { all: false, branchName: "Pune" }, NOW_DATE)).toBeNull();
    expect(await getActionQueue({}, { all: false, branchName: null }, NOW_DATE)).toBeNull();
    expect(sqls().filter((q) => kindOf(q))).toHaveLength(0);
  });
});
