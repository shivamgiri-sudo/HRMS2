import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const sendTpl = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
const warn = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));
vi.mock("../../communication/email.service.js", () => ({ emailService: { send, isConfigured: () => true } }));
vi.mock("../he-meta-bridge.service.js", () => ({ bridgeOneMetaLead: vi.fn() }));
vi.mock("../../meta-campaign/interview-slot.service.js", () => ({ assignInterviewSlot: vi.fn() }));
vi.mock("../he-send.service.js", async (orig) => ({ ...(await orig<typeof import("../he-send.service.js")>()), sendTemplateToLead: sendTpl }));
vi.mock("../he-secrets.service.js", () => ({ superbotConfig: vi.fn(async () => null) }));

import { bestOfferSkipSql, DISTANCE_BAND_KM, heldOffers, rankOffers, type OfferRow } from "../he-best-offer.js";
import { offerHolds } from "../he-best-offer.service.js";
import { readSwitches } from "../qualified-followup.policy.js";
import { runEmailStep } from "../qualified-followup.email.js";
import { runWhatsappStep } from "../qualified-followup.whatsapp.js";
import { runCallStep } from "../qualified-followup.call.js";
import { runStopChecks } from "../qualified-followup.stops.js";

const offer = (rowId: string, o: Partial<OfferRow> = {}): OfferRow => ({
  rowId, requisitionId: `req-${rowId}`, requisitionCode: `RQ-${rowId}`, qualifiedAt: "2026-10-14 09:00:00", started: false, declined: false,
  distanceKm: null, score: null, headcountRemaining: null, ...o,
});
const byId = (rows: OfferRow[]) => Object.fromEntries(rankOffers(rows).map((d) => [d.rowId, d]));

describe("rankOffers", () => {
  it("uses 5 km bands", () => expect(DISTANCE_BAND_KM).toBe(5));

  it("three fresh requisitions: the nearer band wins, unknown distance is last", () => {
    const d = byId([offer("A", { distanceKm: 8, score: 60, headcountRemaining: 5 }), offer("B", { distanceKm: 3, score: 50, headcountRemaining: 2 }), offer("C", { distanceKm: null, score: 90, headcountRemaining: 1 })]);
    expect(d.B).toEqual({ rowId: "B", held: false, bestRowId: "B", why: null });
    expect(d.A).toEqual({ rowId: "A", held: true, bestRowId: "B", why: "nearer" });
    expect(d.C).toEqual({ rowId: "C", held: true, bestRowId: "B", why: "nearer" });
  });

  it("same band: higher score wins", () => {
    const d = byId([offer("A", { distanceKm: 1, score: 80 }), offer("B", { distanceKm: 4.9, score: 70 })]);
    expect(d.A.held).toBe(false);
    expect(d.B).toMatchObject({ held: true, bestRowId: "A", why: "higher_score" });
  });

  it("same band and score: fewest seats left wins", () => {
    const d = byId([offer("A", { distanceKm: 2, score: 70, headcountRemaining: 4 }), offer("B", { distanceKm: 2, score: 70, headcountRemaining: 1 })]);
    expect(d.B.held).toBe(false);
    expect(d.A).toMatchObject({ held: true, bestRowId: "B", why: "more_urgent" });
  });

  it("all else equal: earliest qualified, then id", () => {
    const d = byId([offer("A", { qualifiedAt: "2026-10-14 10:00:00" }), offer("B", { qualifiedAt: "2026-10-14 09:00:00" })]);
    expect(d.A).toMatchObject({ held: true, bestRowId: "B", why: "earlier" });
    const t = byId([offer("Z"), offer("Y")]);
    expect(t.Y.held).toBe(false);
    expect(t.Z).toMatchObject({ held: true, bestRowId: "Y", why: "earlier" });
  });

  it("an in-progress row keeps the offer whatever the ranking says", () => {
    const d = byId([offer("A", { distanceKm: 1, score: 99 }), offer("B", { distanceKm: 2 }), offer("C", { distanceKm: 40, started: true })]);
    expect(d.C).toEqual({ rowId: "C", held: false, bestRowId: "C", why: null });
    expect(d.A).toMatchObject({ held: true, bestRowId: "C", why: "already_offered" });
    expect(d.B).toMatchObject({ held: true, bestRowId: "C", why: "already_offered" });
  });

  it("two rows that both started: the earlier qualified keeps it, so they never block each other", () => {
    const d = byId([offer("A", { started: true, qualifiedAt: "2026-10-14 11:00:00" }), offer("B", { started: true, qualifiedAt: "2026-10-14 09:00:00" })]);
    expect(d.B.held).toBe(false);
    expect(d.A).toMatchObject({ held: true, bestRowId: "B", why: "already_offered" });
  });

  it("a decline releases: the declined row is neither best nor held, the next best is chosen among the rest", () => {
    const d = byId([offer("A", { distanceKm: 8 }), offer("B", { distanceKm: 1, declined: true, started: true }), offer("C", { distanceKm: 3 })]);
    expect(d.B).toEqual({ rowId: "B", held: false, bestRowId: null, why: null });
    expect(d.C.held).toBe(false);
    expect(d.A).toMatchObject({ held: true, bestRowId: "C", why: "nearer" });
  });

  it("a stopped best row releases (stopped rows are never loaded, so the rest rank alone)", () => {
    const d = byId([offer("A", { distanceKm: 8 }), offer("C", { distanceKm: 3 })]);
    expect(d.C.held).toBe(false);
    expect(d.A.held).toBe(true);
  });

  it("a single row is never held; all declined holds nothing", () => {
    expect(rankOffers([offer("A", { distanceKm: 99 })])).toEqual([{ rowId: "A", held: false, bestRowId: "A", why: null }]);
    expect(rankOffers([offer("A", { declined: true }), offer("B", { declined: true })]).every((d) => !d.held && d.bestRowId === null)).toBe(true);
    expect(rankOffers([])).toEqual([]);
  });

  it("heldOffers lists the held rows with the requisition holding them", () => {
    const m = new Map([["9876543210", [offer("A", { distanceKm: 8 }), offer("B", { distanceKm: 1 })]], ["9123456789", [offer("X")]]]);
    expect(heldOffers(m)).toEqual([{ mobile10: "9876543210", rowId: "A", requisitionId: "req-A", requisitionCode: "RQ-A", bestRowId: "B", bestRequisitionCode: "RQ-B", why: "nearer" }]);
  });
});

describe("bestOfferSkipSql", () => {
  it("is empty when off and the incumbent check when on", () => {
    expect(bestOfferSkipSql(false)).toBe("");
    const s = bestOfferSkipSql(true);
    expect(s.startsWith(" AND NOT EXISTS (SELECT 1 FROM qualified_followup o WHERE o.mobile10 = qf.mobile10")).toBe(true);
    expect(s).toContain("o.owner = 'pipeline' AND o.stopped_reason IS NULL");
    expect(s).toContain("hm.state = 'declined'");
    expect(s).toBe(" AND NOT EXISTS (SELECT 1 FROM qualified_followup o WHERE o.mobile10 = qf.mobile10 AND o.id <> qf.id AND o.mode_at_enqueue = qf.mode_at_enqueue AND o.owner = 'pipeline' AND o.stopped_reason IS NULL AND (o.email_status IS NOT NULL OR o.wa_status IS NOT NULL OR o.call_state <> 'pending') AND (NOT (qf.email_status IS NOT NULL OR qf.wa_status IS NOT NULL OR qf.call_state <> 'pending') OR o.qualified_at < qf.qualified_at OR (o.qualified_at = qf.qualified_at AND o.id < qf.id)) AND NOT EXISTS (SELECT 1 FROM he_lead hl JOIN he_match hm ON hm.lead_id = hl.id AND hm.requisition_id = o.requisition_id WHERE hl.mobile10 = o.mobile10 AND hm.state = 'declined'))");
  });
});

// ---- step integration (switch on) ----
const now = new Date("2026-10-14T05:00:00Z");
const liveEnv = { QUAL_FOLLOWUP_MODE: "live" } as NodeJS.ProcessEnv;
const MOB = "9876543210";
const qfRow = (id: string, requisitionId: string, o: Record<string, unknown> = {}) => ({
  id, source_type: "meta_live", meta_lead_id: `m-${id}`, he_lead_id: "lead-1", ats_candidate_id: null, requisition_id: requisitionId, drive_id: null, mobile10: MOB,
  email: "c@x.com", full_name: "asha rao", branch_name: "Noida", role_name: "Customer Support", qualified_at: "2026-10-14 09:00:00",
  email_due_at: null, email_status: null, email_attempts: 0, wa_due_at: "2026-10-14 10:00:00", wa_status: null, wa_attempts: 0,
  call_due_at: null, call_state: "pending", call_attempts: 0, ...o,
});
const offerDb = (id: string, requisitionId: string, o: Record<string, unknown> = {}) => ({
  id, mobile10: MOB, requisition_id: requisitionId, requisition_code: `RQ-${requisitionId}`, qualified_at: "2026-10-14 09:00:00", started: 0, declined: 0,
  distance_km: null, score: null, remaining: null, ...o,
});

interface World { rows: Array<Record<string, unknown>>; offers?: Array<Record<string, unknown>>; offersFail?: boolean }
function world(w: World) {
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM qualified_followup qf") && q.includes("hm.state = 'declined' AS declined")) {
      if (w.offersFail) throw Object.assign(new Error(`read failed for ${MOB}`), { code: "ER_LOCK_WAIT_TIMEOUT" });
      return [w.offers ?? []];
    }
    if (q.includes("FROM qualified_followup qf") && q.includes("qf.id NOT IN")) return [[]]; // the backfill: nothing more is due
    if (q.includes("FROM qualified_followup qf")) return [w.rows];
    if (q.startsWith("UPDATE")) return [{ affectedRows: 1 }];
    if (q.startsWith("INSERT")) return [{ affectedRows: 1 }];
    if (q.includes("SELECT status FROM he_lead")) return [[{ status: "new" }]];
    if (q.includes("FROM branch_master")) return [[{ address: "Sector 62, Noida", latitude: null, longitude: null }]];
    if (q.includes("FROM job_requisition")) return [[{ bmi_assessment_url: "https://bmi.example/x" }]];
    if (q.includes("FROM meta_lead_raw")) return [[{ interview_date: "2026-10-15", interview_time: "10:30:00" }]];
    return [[]];
  });
}
const offerReads = () => execute.mock.calls.filter(([sql]) => String(sql).includes("hm.state = 'declined' AS declined"));
const stepSelect = (marker: string) => String(execute.mock.calls.find(([sql]) => String(sql).includes("FROM qualified_followup qf") && String(sql).includes(marker))![0]);

describe("steps with HE_BEST_OFFER on", () => {
  beforeEach(() => {
    execute.mockReset(); sendTpl.mockReset(); send.mockReset(); warn.mockReset();
    sendTpl.mockResolvedValue({ status: "sent", messageId: "msg-1", providerMessageId: "p1" });
    send.mockResolvedValue({ messageId: "mail-1" });
    process.env.HE_BEST_OFFER = " TRUE ";
  });
  afterEach(() => { delete process.env.HE_BEST_OFFER; });

  it("each step's SELECT carries the incumbent fragment right after the owner filter", async () => {
    world({ rows: [] });
    await runEmailStep(readSwitches(liveEnv), "live", now);
    await runWhatsappStep(readSwitches(liveEnv), "live", now, 10);
    await runCallStep(readSwitches(liveEnv), "live", now);
    for (const m of ["qf.email_status IS NULL AND qf.stopped_reason", "qf.wa_status IS NULL AND qf.wa_sent_at", "qf.call_state = 'pending' AND"]) {
      expect(stepSelect(m)).toContain(`qf.owner = 'pipeline'${bestOfferSkipSql(true)}`);
    }
    expect(offerReads()).toHaveLength(0); // nothing selected: no sibling read
  });

  it("two fresh rows of one mobile: one is processed, the other held; one sibling read for the whole step", async () => {
    world({
      rows: [qfRow("r1", "q1"), qfRow("r2", "q2")],
      offers: [offerDb("r1", "q1", { distance_km: "12.0" }), offerDb("r2", "q2", { distance_km: "2.5" })],
    });
    const c = await runWhatsappStep(readSwitches(liveEnv), "live", now, 10);
    expect(c).toMatchObject({ processed: 1, sent: 1, held: 1 });
    expect(sendTpl).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls.some(([sql, p]) => String(sql).includes("SET wa_status = 'sending'") && (p as unknown[])[0] === "r2")).toBe(true);
    expect(execute.mock.calls.some(([sql, p]) => String(sql).includes("SET wa_status = 'sending'") && (p as unknown[])[0] === "r1")).toBe(false);
    expect(offerReads()).toHaveLength(1); // the single backfill finds nothing, so no second sibling read
    const [sql, params] = offerReads()[0];
    expect(String(sql)).toContain("JOIN job_requisition jr ON jr.id = qf.requisition_id COLLATE utf8mb4_unicode_ci");
    expect(String(sql)).toContain("qf.mobile10 IN (?)");
    expect(params).toEqual([MOB, "live"]);
  });

  it("a sibling read failure processes nothing: every selected row is held and retried next run, logged by code only", async () => {
    world({ rows: [qfRow("r1", "q1"), qfRow("r2", "q2"), { ...qfRow("r3", "q3"), mobile10: "9123456789" }], offersFail: true });
    const c = await runWhatsappStep(readSwitches(liveEnv), "live", now, 10);
    expect(c).toMatchObject({ processed: 0, sent: 0, held: 3 });
    expect(sendTpl).not.toHaveBeenCalled();
    expect(execute.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE"))).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/\d{10}/);
    expect(JSON.stringify(warn.mock.calls)).toContain("ER_LOCK_WAIT_TIMEOUT");
  });

  it("a mobile with one open row is never held", async () => {
    world({ rows: [qfRow("r1", "q1")], offers: [offerDb("r1", "q1", { distance_km: "90" })] });
    const c = await runWhatsappStep(readSwitches(liveEnv), "live", now, 10);
    expect(c).toMatchObject({ processed: 1, sent: 1, held: 0 });
  });

  it("the email step holds the same way and never claims a held row", async () => {
    world({
      rows: [qfRow("r1", "q1", { email_due_at: "2026-10-14 09:10:00", wa_due_at: null }), qfRow("r2", "q2", { email_due_at: "2026-10-14 09:10:00", wa_due_at: null })],
      offers: [offerDb("r1", "q1", { score: 90 }), offerDb("r2", "q2", { score: 40 })],
    });
    const c = await runEmailStep(readSwitches(liveEnv), "live", now);
    expect(c).toMatchObject({ processed: 1, held: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls.some(([sql, p]) => String(sql).includes("SET email_status = 'sending'") && (p as unknown[])[0] === "r2")).toBe(false);
  });

  it("the call step holds a row whose sibling keeps the offer", async () => {
    const callRow = (id: string, q: string, at: string) => qfRow(id, q, { email_status: "sent", wa_status: "sent", call_due_at: "2026-10-14 10:00:00", qualified_at: at });
    world({
      rows: [callRow("r1", "q1", "2026-10-14 09:00:00"), callRow("r2", "q2", "2026-10-14 08:00:00")],
      offers: [offerDb("r1", "q1", { started: 1, qualified_at: "2026-10-14 09:00:00" }), offerDb("r2", "q2", { started: 1, qualified_at: "2026-10-14 08:00:00" })],
    });
    const c = await runCallStep(readSwitches(liveEnv), "live", now);
    expect(c).toMatchObject({ processed: 1, held: 1 });
    expect(execute.mock.calls.some(([sql, p]) => String(sql).includes("call_state = 'in_file'") && (p as unknown[])[1] === "r1")).toBe(false);
  });

  it("a row whose requisition the candidate declined is skipped (held, not stopped) and releases the next row", async () => {
    world({
      rows: [qfRow("r1", "q1"), qfRow("r2", "q2")],
      offers: [offerDb("r1", "q1", { declined: 1, started: 1, distance_km: "1" }), offerDb("r2", "q2", { distance_km: "30" })],
    });
    const c = await runWhatsappStep(readSwitches(liveEnv), "live", now, 10);
    expect(c).toMatchObject({ processed: 1, sent: 1, held: 1 });
    expect(execute.mock.calls.some(([sql, p]) => String(sql).includes("SET wa_status = 'sending'") && (p as unknown[])[0] === "r1")).toBe(false);
    expect(execute.mock.calls.some(([sql, p]) => String(sql).includes("SET wa_status = 'sending'") && (p as unknown[])[0] === "r2")).toBe(true);
    expect(execute.mock.calls.some(([sql]) => /stopped_reason = /.test(String(sql)) && String(sql).startsWith("UPDATE"))).toBe(false);
  });

  it("a lone declined row is skipped too", async () => {
    world({ rows: [qfRow("r1", "q1")], offers: [offerDb("r1", "q1", { declined: 1 })] });
    const c = await runWhatsappStep(readSwitches(liveEnv), "live", now, 10);
    expect(c).toMatchObject({ processed: 0, sent: 0, held: 1 });
  });

  it("offerHolds ignores siblings of a paused source: a better paused sibling holds nobody", async () => {
    world({ rows: [], offers: [offerDb("r1", "q1", { distance_km: "1", source_type: "walkin" }), offerDb("r2", "q2", { distance_km: "30" })] });
    const rows = [{ id: "r2", mobile10: MOB }] as never;
    expect((await offerHolds(rows, "live", [])).held.has("r2")).toBe(true);
    expect((await offerHolds(rows, "live", ["walkin"])).held.has("r2")).toBe(false);
  });

  it("held rows ahead of their best sibling do not starve the step: one backfill select brings the best row in", async () => {
    // LIMIT 2 window holds h1,h2 (their best sibling b is outside it); the backfill returns b, which is processed.
    const mob = (id: string, m: string, q: string, o: Record<string, unknown> = {}) => qfRow(id, q, { mobile10: m, ...o });
    const window = [mob("h1", "9000000001", "q1"), mob("h2", "9000000002", "q2")];
    const best = [mob("b1", "9000000001", "q9"), mob("b2", "9000000002", "q8")];
    const offers = [
      offerDb("h1", "q1", { mobile10: "9000000001", distance_km: "20" }), offerDb("b1", "q9", { mobile10: "9000000001", distance_km: "1" }),
      offerDb("h2", "q2", { mobile10: "9000000002", distance_km: "20" }), offerDb("b2", "q8", { mobile10: "9000000002", distance_km: "1" }),
    ];
    execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const q = String(sql);
      if (q.includes("hm.state = 'declined' AS declined")) return [offers.filter((o) => (params as string[]).includes(o.mobile10 as string))];
      if (q.includes("FROM qualified_followup qf") && q.includes("qf.id NOT IN")) return [best];
      if (q.includes("FROM qualified_followup qf")) return [window];
      if (q.startsWith("UPDATE") || q.startsWith("INSERT")) return [{ affectedRows: 1 }];
      if (q.includes("SELECT status FROM he_lead")) return [[{ status: "new" }]];
      if (q.includes("FROM branch_master")) return [[{ address: "x", latitude: null, longitude: null }]];
      if (q.includes("FROM job_requisition")) return [[{ bmi_assessment_url: "https://bmi.example/x" }]];
      if (q.includes("FROM meta_lead_raw")) return [[{ interview_date: "2026-10-15", interview_time: "10:30:00" }]];
      return [[]];
    });
    const c = await runWhatsappStep(readSwitches(liveEnv), "live", now, 2);
    expect(c).toMatchObject({ processed: 2, sent: 2, held: 2 });
    const backfills = execute.mock.calls.filter(([sql]) => String(sql).includes("qf.id NOT IN"));
    expect(backfills).toHaveLength(1);
    expect(String(backfills[0][0])).toContain("qf.id NOT IN (?,?)");
    expect(String(backfills[0][0])).toMatch(/LIMIT 2$/);
    expect(backfills[0][1]).toEqual(["live", now, "h1", "h2"]);
    const claimed = execute.mock.calls.filter(([sql]) => String(sql).includes("SET wa_status = 'sending'")).map(([, p]) => (p as unknown[])[0]);
    expect(claimed.sort()).toEqual(["b1", "b2"]);
  });

  it("nothing held: no backfill statement", async () => {
    world({ rows: [qfRow("r1", "q1")], offers: [offerDb("r1", "q1")] });
    await runWhatsappStep(readSwitches(liveEnv), "live", now, 10);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes("qf.id NOT IN"))).toBe(false);
  });

  it("stop checks are untouched by the switch: no sibling read, held rows are never stopped for being held", async () => {
    world({ rows: [] });
    await runStopChecks("live");
    const on = execute.mock.calls.map(([s, p]) => [String(s), p]);
    execute.mockClear();
    delete process.env.HE_BEST_OFFER;
    await runStopChecks("live");
    expect(execute.mock.calls.map(([s, p]) => [String(s), p])).toEqual(on);
    expect(offerReads()).toHaveLength(0);
  });
});

describe("steps with HE_BEST_OFFER off", () => {
  beforeEach(() => { execute.mockReset(); sendTpl.mockResolvedValue({ status: "sent", messageId: "msg-1" }); send.mockResolvedValue({ messageId: "m" }); });

  it.each([undefined, "", "1", "yes", "false"])("value %j: no fragment, no holds call, both rows processed", async (v) => {
    if (v === undefined) delete process.env.HE_BEST_OFFER; else process.env.HE_BEST_OFFER = v;
    try {
      world({ rows: [qfRow("r1", "q1"), qfRow("r2", "q2")] });
      const c = await runWhatsappStep(readSwitches(liveEnv), "live", now, 10);
      expect(c).toMatchObject({ processed: 2, held: 0 });
      expect(offerReads()).toHaveLength(0);
      expect(execute.mock.calls.some(([sql]) => String(sql).includes("FROM qualified_followup o"))).toBe(false);
    } finally { delete process.env.HE_BEST_OFFER; }
  });
});
