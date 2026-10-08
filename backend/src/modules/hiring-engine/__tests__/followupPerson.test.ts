import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One owner per person (followup_person). The db mock is a tiny in-memory followup_person that applies the module's own statements
 * (the claim IF, the holder-only release, the 30-day re-invite window), so the tests check behaviour, not SQL text.
 */
type P = { active_followup_id: string | null; last_first_contact_at: Date | null; reinvites_30d: number; reinvite_window_start: Date | null; opted_out_at: Date | null };
const h = vi.hoisted(() => ({ people: new Map<string, P>(), sqls: [] as Array<{ sql: string; p: unknown[] }> }));
const blank = (): P => ({ active_followup_id: null, last_first_contact_at: null, reinvites_30d: 0, reinvite_window_start: null, opted_out_at: null });
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push({ sql: q, p });
      const m = String(p[0]);
      if (q.startsWith("SELECT active_followup_id, last_first_contact_at")) { const r = h.people.get(m); return [r ? [r] : []]; }
      if (q.startsWith("SELECT active_followup_id FROM followup_person")) { const r = h.people.get(m); return [r ? [{ active_followup_id: r.active_followup_id }] : []]; }
      if (q.startsWith("INSERT INTO followup_person (mobile10, active_followup_id)")) {
        const r = h.people.get(m);
        if (!r) h.people.set(m, { ...blank(), active_followup_id: String(p[1]) });
        else if (q.includes("IF(active_followup_id IS NULL OR active_followup_id = VALUES(active_followup_id)") && (r.active_followup_id === null || r.active_followup_id === p[1])) r.active_followup_id = String(p[1]);
        return [{ affectedRows: 1 }];
      }
      if (q.startsWith("UPDATE followup_person SET active_followup_id = NULL WHERE mobile10 = ? AND active_followup_id = ?")) {
        const r = h.people.get(m);
        if (r && r.active_followup_id === p[1]) { r.active_followup_id = null; return [{ affectedRows: 1 }]; }
        return [{ affectedRows: 0 }];
      }
      if (q.startsWith("INSERT INTO followup_person (mobile10, last_first_contact_at")) {
        const at = p[1] as Date; const reinvite = Number(p[2]) === 1;
        const r = h.people.get(m) ?? blank();
        r.last_first_contact_at = at;
        if (reinvite) {
          const fresh = !r.reinvite_window_start || r.reinvite_window_start.getTime() < at.getTime() - 30 * 86_400_000;
          r.reinvites_30d = fresh ? 1 : r.reinvites_30d + 1;
          if (fresh) r.reinvite_window_start = at;
        }
        h.people.set(m, r);
        return [{ affectedRows: 1 }];
      }
      if (q.startsWith("UPDATE qualified_followup SET journey_state = 'held_best_offer'")) return [{ affectedRows: p.length }];
      return [[]];
    }),
  },
}));

import { claimPerson, notePersonFirstContact, personFacts, releasePerson } from "../followup-person.service.js";
import { markHeldBestOffer } from "../he-best-offer.service.js";
import { normaliseMobile10 } from "../qualified-followup.schedule.js";

beforeEach(() => { h.people.clear(); h.sqls = []; });

describe("one owner per person", () => {
  it("two requisitions for one mobile -> one claim wins; after release the other can claim", async () => {
    expect(await claimPerson("9876543210", "A")).toBe(true);
    expect(await claimPerson("9876543210", "B")).toBe(false);
    await releasePerson("9876543210", "A");
    expect(await claimPerson("9876543210", "B")).toBe(true);
  });

  it("claim is idempotent for the holder", async () => {
    expect(await claimPerson("9876543210", "A")).toBe(true);
    expect(await claimPerson("9876543210", "A")).toBe(true);
    expect((await personFacts("9876543210")).activeFollowupId).toBe("A");
  });

  it("release by a non-holder does nothing", async () => {
    await claimPerson("9876543210", "A");
    await releasePerson("9876543210", "B");
    expect((await personFacts("9876543210")).activeFollowupId).toBe("A");
    expect(h.sqls.find((s) => s.sql.startsWith("UPDATE followup_person"))!.sql).toContain("AND active_followup_id = ?");
  });

  it("mobiles written +91 98765 43210 and 098765 43210 claim the same person", async () => {
    expect(normaliseMobile10("+91 98765 43210")).toBe("9876543210");
    expect(normaliseMobile10("098765 43210")).toBe("9876543210");
    expect(await claimPerson("+91 98765 43210", "A")).toBe(true);
    expect(await claimPerson("098765 43210", "B")).toBe(false);
    expect([...h.people.keys()]).toEqual(["9876543210"]);
  });

  it("an invalid mobile never claims", async () => {
    expect(await claimPerson("12345", "A")).toBe(false);
    expect(h.sqls).toHaveLength(0);
  });

  it("personFacts defaults for someone never seen", async () => {
    expect(await personFacts("9876543210")).toEqual({ activeFollowupId: null, lastFirstContactAt: null, reinvites30d: 0, optedOutAt: null });
  });
});

describe("first contact and re-invites", () => {
  const day = (d: number) => new Date(Date.UTC(2026, 9, d, 5, 30));
  it("first contact sets last_first_contact_at; reinvite counts within 30 days and resets after", async () => {
    await notePersonFirstContact("9876543210", day(1), { reinvite: false });
    let f = await personFacts("9876543210");
    expect(f.lastFirstContactAt).toEqual(day(1));
    expect(f.reinvites30d).toBe(0);
    await notePersonFirstContact("9876543210", day(9), { reinvite: true });
    await notePersonFirstContact("9876543210", day(17), { reinvite: true });
    f = await personFacts("9876543210");
    expect(f.reinvites30d).toBe(2);
    expect(f.lastFirstContactAt).toEqual(day(17));
    await notePersonFirstContact("9876543210", new Date(day(9).getTime() + 31 * 86_400_000), { reinvite: true });
    expect((await personFacts("9876543210")).reinvites30d).toBe(1);
  });
  it("the re-invite counter is assigned before its window (MySQL applies ON DUPLICATE assignments left to right)", async () => {
    await notePersonFirstContact("9876543210", day(1), { reinvite: true });
    const q = h.sqls.find((s) => s.sql.startsWith("INSERT INTO followup_person (mobile10, last_first_contact_at"))!.sql;
    expect(q.indexOf("reinvites_30d = IF(")).toBeLessThan(q.indexOf("reinvite_window_start = IF("));
  });
});

describe("best-offer holds are recorded on the journey", () => {
  it("held rows are marked held_best_offer, only those ids and only from enrolled", async () => {
    await markHeldBestOffer(new Set(["Q2", "Q3"]));
    const u = h.sqls.find((s) => s.sql.startsWith("UPDATE qualified_followup SET journey_state = 'held_best_offer'"))!;
    expect(u.sql).toBe("UPDATE qualified_followup SET journey_state = 'held_best_offer' WHERE id IN (?,?) AND journey_state = 'enrolled'");
    expect(u.p).toEqual(["Q2", "Q3"]);
  });
  it("nothing held -> no write", async () => {
    await markHeldBestOffer(new Set());
    expect(h.sqls).toHaveLength(0);
  });
});
