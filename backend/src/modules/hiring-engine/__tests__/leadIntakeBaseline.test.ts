import { describe, expect, it } from "vitest";
import { computeLeadIntake, effectiveLeadTime, evaluateHealth, type HealthSnapshot } from "../he-pipeline-health.js";

const NOW = new Date("2026-10-08T06:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number, extraMs = 0) => new Date(NOW.getTime() - daysAgo * DAY - extraMs);
/** n leads imported (and created) inside day bucket `d` (d=1 is the last 24 h). */
const leadsIn = (d: number, n: number) => Array.from({ length: n }, (_, i) => ({ createdAt: at(d - 1, 60_000 * (i + 1)), metaCreatedTime: null }));

describe("effectiveLeadTime", () => {
  it("prefers the Meta created_time over the import time (ISO with +0000 offset)", () => {
    const t = effectiveLeadTime({ createdAt: new Date("2026-10-07T15:47:42Z"), metaCreatedTime: "2026-09-23T10:00:00+0000" });
    expect(t?.toISOString()).toBe("2026-09-23T10:00:00.000Z");
  });
  it("accepts epoch seconds", () => {
    const t = effectiveLeadTime({ createdAt: new Date("2026-10-07T15:47:42Z"), metaCreatedTime: 1790000000 });
    expect(t?.getTime()).toBe(1790000000 * 1000);
  });
  it("falls back to created_at when the Meta time is missing, junk, or in the future", () => {
    const createdAt = new Date("2026-10-07T15:47:42Z");
    expect(effectiveLeadTime({ createdAt, metaCreatedTime: null })).toEqual(createdAt);
    expect(effectiveLeadTime({ createdAt, metaCreatedTime: "not a date" })).toEqual(createdAt);
    expect(effectiveLeadTime({ createdAt, metaCreatedTime: "2099-01-01T00:00:00+0000" }, NOW)).toEqual(createdAt);
  });
});

describe("computeLeadIntake baseline", () => {
  it("ruling: baseline is the median of non-zero days, so a backfill spike does not inflate it", () => {
    // 142 and 69 are backfill spikes; the typical day is ~10
    const rows = [leadsIn(2, 10), leadsIn(3, 12), leadsIn(4, 9), leadsIn(5, 142), leadsIn(6, 11), leadsIn(9, 69), leadsIn(10, 10)].flat();
    const r = computeLeadIntake(rows, NOW);
    expect(r.avgPerDay).toBe(10);
  });
  it("ruling: days with count over 3x the median are ignored as backfill before the final median", () => {
    const rows = [leadsIn(2, 4), leadsIn(3, 5), leadsIn(4, 6), leadsIn(5, 40)].flat(); // median(4,5,6,40)=5.5, 40 > 16.5 dropped -> median(4,5,6)=5
    expect(computeLeadIntake(rows, NOW).avgPerDay).toBe(5);
  });
  it("ruling: zero days are ignored (an outage gap cannot be told from a quiet day), so they do not drag the baseline down", () => {
    const rows = [leadsIn(2, 8), leadsIn(3, 10), leadsIn(4, 12)].flat(); // 11 empty days
    expect(computeLeadIntake(rows, NOW).avgPerDay).toBe(10);
  });
  it("ruling: no non-zero day in the window gives a zero baseline (check stays quiet)", () => {
    expect(computeLeadIntake([], NOW).avgPerDay).toBe(0);
  });
  it("ruling: the last 24 h are excluded from the baseline and counted separately", () => {
    const r = computeLeadIntake([...leadsIn(1, 4), ...leadsIn(2, 10), ...leadsIn(3, 10)], NOW);
    expect(r.leadsLast24h).toBe(4);
    expect(r.avgPerDay).toBe(10);
  });
  it("ruling: a backfilled old lead (Meta time weeks ago, imported today) counts toward neither the 24 h count nor last lead", () => {
    const old = { createdAt: at(0, 60_000), metaCreatedTime: "2026-08-01T10:00:00+0000" };
    const r = computeLeadIntake([old, old, old, ...leadsIn(2, 10)], NOW);
    expect(r.leadsLast24h).toBe(0);
    expect(r.lastLeadAt?.getTime()).toBe(at(1, 60_000).getTime());
  });
  it("ruling: falls back to created_at for rows with no Meta time", () => {
    expect(computeLeadIntake(leadsIn(1, 3), NOW).leadsLast24h).toBe(3);
  });
  it("the live 2026-10-08 shape (4 leads in 24 h, spikes of 142 and 69 18 days apart) no longer warns", () => {
    // typical real day ~8 by Meta time; spikes are imports of older leads
    const rows = [leadsIn(1, 4), leadsIn(2, 6), leadsIn(3, 7), leadsIn(4, 8), leadsIn(5, 9), leadsIn(6, 7), leadsIn(8, 8)].flat();
    const r = computeLeadIntake(rows, NOW);
    const snap: HealthSnapshot = {
      metaConfigured: true, tokenValid: true, lastLeadAt: r.lastLeadAt, leadsLast24h: r.leadsLast24h, avgLeadsPerDay14d: r.avgPerDay,
      lastSyncFinishedAt: NOW, lastSyncImported: 0, formErrorsLastRun: 0, schedulerRunning: true,
      whatsappFailed24h: 0, whatsappSent24h: 0, followupOverdue: 0,
    };
    expect(evaluateHealth(snap, NOW).find((c) => c.key === "lead_intake")!.level).toBe("ok");
  });
});
