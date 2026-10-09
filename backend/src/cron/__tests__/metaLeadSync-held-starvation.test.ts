import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake meta_lead_raw: 150 held leads (auto_notify off or a backfill) created BEFORE 5 fresh ones. The fake honours the
// query's held / eligible filter the way MySQL's HAVING on the select aliases does, then ORDER BY created_at ASC LIMIT 100.
type Row = { id: string; created_at: number; auto_notify_off: number; meta_created: string; held: boolean };
const rows: Row[] = [];
const execute = vi.fn(async (sql: string) => {
  if (!/FROM meta_lead_raw/.test(sql)) return [[]];
  let pick = rows.slice();
  if (sql.includes("HAVING COALESCE(auto_notify_off, 0) = 0 AND COALESCE(is_backfill, 0) = 0")) pick = pick.filter((r) => !r.held);
  else if (sql.includes("HAVING (auto_notify_off = 1 OR is_backfill = 1)")) pick = pick.filter((r) => r.held);
  pick.sort((a, b) => a.created_at - b.created_at);
  return [pick.slice(0, 100).map((r) => ({ id: r.id, auto_notify_off: r.auto_notify_off, meta_created: r.meta_created, is_backfill: r.held && !r.auto_notify_off ? 1 : 0 }))];
});

vi.mock("../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...(a as [string])) } }));
vi.mock("../../modules/meta-campaign/meta-campaign.service.js", () => ({ metaCampaignService: {} }));
vi.mock("../../modules/meta-campaign/meta-api.client.js", () => ({ isMetaConfigured: () => false }));
const notifyQualifiedLead = vi.fn(async () => ({ succeeded: ["whatsapp"], skipped: [], failed: [] }));
vi.mock("../../modules/meta-campaign/lead-outreach.service.js", () => ({ notifyQualifiedLead: (...a: unknown[]) => notifyQualifiedLead(...(a as [])) }));
vi.mock("../../modules/meta-campaign/meta-messages.service.js", () => ({ reconcileDeliveryStatuses: vi.fn() }));
const enrolMetaArrival = vi.fn(async () => ({ path: "unified", status: "held_manual" }));
vi.mock("../../modules/selection/meta-arrival.service.js", () => ({ enrolMetaArrival: (...a: unknown[]) => enrolMetaArrival(...(a as [])) }));

import { notifyNewQualifiedLeads } from "../metaLeadSync.cron.js";

const OLD = new Date(Date.now() - 5 * 86_400_000).toISOString().replace(/\.\d+Z$/, "+0000");
const NEW = new Date().toISOString().replace(/\.\d+Z$/, "+0000");

describe("sync safety net: held leads never starve fresh ones", () => {
  beforeEach(() => {
    rows.length = 0;
    execute.mockClear(); notifyQualifiedLead.mockClear(); enrolMetaArrival.mockClear();
    for (let i = 0; i < 150; i++) {
      const autoOff = i % 2 === 0;
      rows.push({ id: `held-${i}`, created_at: i, auto_notify_off: autoOff ? 1 : 0, meta_created: autoOff ? NEW : OLD, held: true });
    }
    for (let i = 0; i < 5; i++) rows.push({ id: `fresh-${i}`, created_at: 1000 + i, auto_notify_off: 0, meta_created: NEW, held: false });
  });

  it("notifies the 5 fresh leads although 150 held leads are older and still unstamped", async () => {
    const out = await notifyNewQualifiedLeads();
    const notified = notifyQualifiedLead.mock.calls.map((c) => (c as unknown[])[0]);
    expect(notified).toEqual(["fresh-0", "fresh-1", "fresh-2", "fresh-3", "fresh-4"]);
    expect(out.sent).toBe(5);
  });

  it("still enrols held leads (held_manual, D13) and never messages them", async () => {
    await notifyNewQualifiedLeads();
    const enrolled = enrolMetaArrival.mock.calls.map((c) => (c as unknown[])[0] as string);
    expect(enrolled.length).toBe(100);
    expect(enrolled.every((id) => id.startsWith("held-"))).toBe(true);
    // auto_notify off: enrolled without skipOutreach (HR holds it); backfill: skipOutreach (held for HR).
    expect(enrolMetaArrival).toHaveBeenCalledWith("held-0", { skipOutreach: false });
    expect(enrolMetaArrival).toHaveBeenCalledWith("held-1", { skipOutreach: true });
    expect(notifyQualifiedLead.mock.calls.some((c) => String((c as unknown[])[0]).startsWith("held-"))).toBe(false);
  });

  it("the held pass skips leads already enrolled, so it never re-selects them", async () => {
    await notifyNewQualifiedLeads();
    const heldSql = execute.mock.calls.map((c) => c[0]).find((s) => s.includes("HAVING (auto_notify_off = 1 OR is_backfill = 1)"));
    expect(heldSql).toMatch(/NOT EXISTS \(SELECT 1 FROM qualified_followup q2 WHERE q2\.meta_lead_id = meta_lead_raw\.id/);
  });
});
