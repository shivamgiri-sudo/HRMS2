import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertRule } from "../alerts.types.js";

const repo = vi.hoisted(() => ({
  listEnabledRules: vi.fn(), touchEvaluated: vi.fn(), lastFiredMs: vi.fn(), insertEvent: vi.fn(), markNotified: vi.fn(),
}));
const data = vi.hoisted(() => ({ loadAlertContext: vi.fn(), scopedData: vi.fn(), metricSeries: vi.fn(), anomaliesAt: vi.fn(), lastDates: vi.fn() }));
const notify = vi.hoisted(() => ({ notifyAlert: vi.fn(), publicBaseUrl: () => "https://hr.test", sendEmails: vi.fn(), emptySummary: () => ({}), ALERT_EVENT_CODE: "a", DIGEST_EVENT_CODE: "d", INBOX_ENTITY: "e", INBOX_TYPE: "t" }));
vi.mock("../alerts.repo.js", () => repo);
vi.mock("../alerts.data.js", () => data);
vi.mock("../alerts.notify.js", () => notify);
vi.mock("../../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn() } }));
vi.mock("../../../communication/email.service.js", () => ({ emailService: {} }));
vi.mock("../../../../logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../alerts.digest.js", () => ({ buildDigestData: vi.fn(), digestDue: vi.fn(), renderDigest: vi.fn() }));

const { runAlertSweep } = await import("../alerts.service.js");
const { PdError } = await import("../../pd.source.js");

const rule = (o: Partial<AlertRule> = {}): AlertRule => ({ id: "r1", processId: "p1", name: "AHT", metricKey: "aht", comparator: "gt", threshold: 400, windowDays: 1, consecutiveDays: 1, scopeTl: null, scopeLob: null, severity: "warn",
  recipients: { roles: ["manager"], tls: [], employeeIds: [] }, channels: ["in_app"], cooldownMinutes: 1440, enabled: true, lastEvaluatedAt: null, lastFiredAt: null, createdBy: null, createdAt: null, updatedAt: null, ...o });
const ctx = { asOf: "2026-09-30", ds: {}, loaded: { cfg: { label: "Dalmia" }, resolved: { mapped: new Set(["calls"]) } } };
const NOW = new Date("2026-09-30T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  data.loadAlertContext.mockResolvedValue(ctx);
  data.scopedData.mockReturnValue({ rows: [], qa: [] });
  data.lastDates.mockImplementation((asOf: string, n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(`${asOf}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (n - 1 - i)); return d.toISOString().slice(0, 10); }));
  data.metricSeries.mockImplementation((_r: unknown, _q: unknown, _m: unknown, _k: string, _w: number, dates: string[]) => dates.map((date) => ({ date, value: 500 })));
  repo.listEnabledRules.mockResolvedValue([rule()]);
  repo.lastFiredMs.mockResolvedValue(null);
  repo.insertEvent.mockResolvedValue("ev1");
  notify.notifyAlert.mockResolvedValue({ recipients: 2, dropped: 0, inApp: 2, email: 0, emailFailed: 0, emailSkippedNoAddress: 0 });
});

describe("runAlertSweep", () => {
  it("fires once, records the event for the latest data date and notifies", async () => {
    const s = await runAlertSweep(NOW);
    expect(s).toMatchObject({ fired: 1, notified: 1, deduped: 0, cooledDown: 0 });
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ ruleId: "r1", dataDate: "2026-09-30", metricValue: 500, threshold: 400 }));
    expect(notify.notifyAlert).toHaveBeenCalledTimes(1);
    expect(repo.markNotified).toHaveBeenCalledWith("ev1", expect.anything(), true);
  });
  it("does not notify when the same rule + data date already fired (dedupe)", async () => {
    repo.insertEvent.mockResolvedValue(null);
    const s = await runAlertSweep(NOW);
    expect(s).toMatchObject({ fired: 0, deduped: 1 }); expect(notify.notifyAlert).not.toHaveBeenCalled();
  });
  it("honours cooldown: no event, no notification", async () => {
    repo.lastFiredMs.mockResolvedValue(NOW.getTime() - 60 * 60_000);
    const s = await runAlertSweep(NOW);
    expect(s).toMatchObject({ fired: 0, cooledDown: 1 }); expect(repo.insertEvent).not.toHaveBeenCalled(); expect(notify.notifyAlert).not.toHaveBeenCalled();
  });
  it("fires again once the cooldown has elapsed", async () => {
    repo.lastFiredMs.mockResolvedValue(NOW.getTime() - 25 * 60 * 60_000);
    expect((await runAlertSweep(NOW)).fired).toBe(1);
  });
  it("a day with no value (null) never fires", async () => {
    data.metricSeries.mockImplementation((_r: unknown, _q: unknown, _m: unknown, _k: string, _w: number, dates: string[]) => dates.map((date) => ({ date, value: null })));
    const s = await runAlertSweep(NOW);
    expect(s).toMatchObject({ fired: 0, noData: 1 }); expect(repo.insertEvent).not.toHaveBeenCalled();
  });
  it("a process with no data at all is skipped without error", async () => {
    data.loadAlertContext.mockResolvedValue(null);
    expect(await runAlertSweep(NOW)).toMatchObject({ fired: 0, noData: 1, errors: 0 });
  });
  it("an unconfigured / disabled process (PdError) is skipped, not counted as an error", async () => {
    data.loadAlertContext.mockRejectedValue(new PdError(409, "DISABLED", "off"));
    expect(await runAlertSweep(NOW)).toMatchObject({ fired: 0, errors: 0 });
  });
  it("a threshold that is not breached does not fire", async () => {
    repo.listEnabledRules.mockResolvedValue([rule({ threshold: 900 })]);
    expect((await runAlertSweep(NOW)).fired).toBe(0);
  });
  it("anomaly rules fire on the detector's count and attach the agents", async () => {
    repo.listEnabledRules.mockResolvedValue([rule({ metricKey: "anomaly:login_drop", comparator: "gte", threshold: 1 })]);
    data.anomaliesAt.mockReturnValue({ count: 2, items: [{ agentCode: "E001", name: "A", detail: "d" }, { agentCode: "E002", name: "B", detail: "d" }] });
    const s = await runAlertSweep(NOW);
    expect(s.fired).toBe(1);
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ metricValue: 2, context: expect.objectContaining({ agents: expect.any(Array) }) }));
  });
  it("anomaly rule with no rows for the day (count null) never fires", async () => {
    repo.listEnabledRules.mockResolvedValue([rule({ metricKey: "anomaly:any", comparator: "gte", threshold: 1 })]);
    data.anomaliesAt.mockReturnValue({ count: null, items: [] });
    expect((await runAlertSweep(NOW)).fired).toBe(0);
  });
  it("one failing rule does not stop the others", async () => {
    repo.listEnabledRules.mockResolvedValue([rule({ id: "bad" }), rule({ id: "ok" })]);
    repo.touchEvaluated.mockRejectedValueOnce(new Error("db"));
    const s = await runAlertSweep(NOW);
    expect(s).toMatchObject({ errors: 1, fired: 1 });
  });
});
