import { describe, expect, it } from "vitest";
import { buildAlertEmail, buildDigestEmail, dashboardLink, escapeHtml, formatMetric, type DigestData } from "../alerts.email.js";
import { digestDue } from "../alerts.digest.js";
import { parseDigestInput, parseRecipients, parseRuleInput } from "../alerts.types.js";
import { PdError } from "../../pd.source.js";

const keys = new Map([["aht", { available: true }], ["calls", { available: true }], ["ptp", { available: false }], ["anomaly:login_drop", { available: true }]]);
const base = { name: "AHT high", metricKey: "aht", comparator: "gt", threshold: 420, recipients: { roles: ["manager"] }, channels: ["in_app", "email"] };

describe("parseRuleInput", () => {
  it("accepts a valid rule and applies defaults", () => {
    const d = parseRuleInput(base, keys);
    expect(d).toMatchObject({ metricKey: "aht", comparator: "gt", threshold: 420, windowDays: 1, consecutiveDays: 1, cooldownMinutes: 1440, severity: "warn", enabled: true });
  });
  it("rejects unknown / unavailable metrics, bad comparators and non-finite thresholds", () => {
    expect(() => parseRuleInput({ ...base, metricKey: "salary" }, keys)).toThrow(PdError);
    expect(() => parseRuleInput({ ...base, metricKey: "ptp" }, keys)).toThrow(/not available/);
    expect(() => parseRuleInput({ ...base, comparator: "between" }, keys)).toThrow(/comparator/);
    expect(() => parseRuleInput({ ...base, threshold: "abc" }, keys)).toThrow(/threshold/);
    expect(() => parseRuleInput({ ...base, threshold: 1e15 }, keys)).toThrow(/threshold/);
  });
  it("bounds windows, streaks, cooldown, name and channels", () => {
    for (const bad of [{ windowDays: 0 }, { windowDays: 32 }, { consecutiveDays: 15 }, { consecutiveDays: 1.5 }, { cooldownMinutes: -1 }, { name: " " }, { name: "x".repeat(121) }, { channels: [] }, { channels: ["sms"] }, { severity: "fatal" }])
      expect(() => parseRuleInput({ ...base, ...bad }, keys), JSON.stringify(bad)).toThrow(PdError);
  });
  it("anomaly rules are forced to gte / 1 day and need a whole-number minimum", () => {
    const d = parseRuleInput({ ...base, metricKey: "anomaly:login_drop", comparator: "lt", windowDays: 9, consecutiveDays: 5, threshold: 2 }, keys);
    expect(d).toMatchObject({ comparator: "gte", windowDays: 1, consecutiveDays: 1, threshold: 2 });
    expect(() => parseRuleInput({ ...base, metricKey: "anomaly:login_drop", threshold: 0 }, keys)).toThrow(/minimum/);
  });
  it("requires recipients unless previewing", () => {
    expect(() => parseRuleInput({ ...base, recipients: {} }, keys)).toThrow(/recipient/);
    expect(parseRuleInput({ ...base, recipients: {} }, keys, { requireRecipients: false }).recipients).toEqual({ roles: [], tls: [], employeeIds: [] });
  });
});

describe("parseRecipients", () => {
  it("only dashboard viewer roles, UUID employee ids, deduped and trimmed", () => {
    expect(parseRecipients({ roles: ["Manager", "manager"], tls: [" TL_A ", "TL_A"], employeeIds: ["b1a1d3aa-bc8c-11f1-a5d8-566332af6ea5"] })).toEqual({ roles: ["manager"], tls: ["TL_A"], employeeIds: ["b1a1d3aa-bc8c-11f1-a5d8-566332af6ea5"] });
    expect(() => parseRecipients({ roles: ["employee"] })).toThrow(/cannot be a recipient/);
    expect(() => parseRecipients({ employeeIds: ["1; DROP TABLE"] })).toThrow(PdError);
    expect(() => parseRecipients({ roles: "manager" })).toThrow(/list/);
  });
});

describe("parseDigestInput", () => {
  it("validates frequency, HH:MM and recipients-before-enable", () => {
    expect(parseDigestInput({ frequency: "weekly", sendTime: "07:30", recipients: { roles: ["manager"] }, enabled: true })).toMatchObject({ frequency: "weekly", sendTime: "07:30", enabled: true });
    expect(() => parseDigestInput({ frequency: "hourly" })).toThrow(PdError);
    expect(() => parseDigestInput({ sendTime: "25:00" })).toThrow(/HH:MM/);
    expect(() => parseDigestInput({ enabled: true, recipients: {} })).toThrow(/recipient/);
    expect(parseDigestInput({ enabled: false }).enabled).toBe(false);
  });
});

describe("escaping in rendered mail", () => {
  const evil = `<img src=x onerror="alert(1)">&'`;
  it("escapeHtml neutralises markup", () => { expect(escapeHtml(evil)).not.toContain("<"); expect(escapeHtml(evil)).toContain("&lt;img"); });
  it("alert mail escapes rule name, message and labels", () => {
    const m = buildAlertEmail({ processLabel: evil, ruleName: evil, severity: "critical", message: evil, metricLabel: evil, metricValue: evil, dataDate: "2026-09-30", link: "https://x.test/a?b=1&c=\"2" });
    expect(m.html).not.toMatch(/<img/i); expect(m.html).not.toContain('onerror="alert'); expect(m.html).toContain("&amp;c=&quot;2");
  });
  it("digest escapes agent names, anomaly detail and labels", () => {
    const d: DigestData = { processLabel: evil, frequency: "daily", range: { from: "2026-09-30", to: "2026-09-30" }, link: "https://x.test/p", openAlerts: 2,
      kpis: [{ label: evil, value: evil, deltaPct: -3.2, status: "bad", direction: "higher" }], anomalies: [{ severity: "bad", agent: evil, detail: evil }], top: [{ agent: evil, value: "1" }], bottom: [], rankLabel: evil };
    const m = buildDigestEmail(d);
    expect(m.html).not.toMatch(/<img/i); expect(m.html).toContain("2</b> open alerts"); expect(m.html).toContain("Not enough data"); expect(m.subject).toContain("Daily digest");
    expect(m.html).toContain("▼ -3.2%");
  });
});

describe("formatting + links", () => {
  it("formats by unit and shows a dash for no data", () => {
    expect(formatMetric(null, "percent")).toBe("—"); expect(formatMetric(72.345, "percent")).toBe("72.3%"); expect(formatMetric(252, "seconds")).toBe("4m 12s"); expect(formatMetric(45, "seconds")).toBe("45s");
    expect(formatMetric(1234567, "currency")).toBe("₹12,34,567"); expect(formatMetric(1200)).toBe("1,200");
  });
  it("builds the dashboard link from a trusted base and an encoded id", () => {
    expect(dashboardLink("https://hr.example.com/", "abc def", "alerts")).toBe("https://hr.example.com/performance/process-dashboard/abc%20def?view=alerts");
  });
});

describe("digestDue", () => {
  const d = { frequency: "daily" as const, sendTime: "08:00", enabled: true };
  const at = (iso: string) => new Date(iso);
  it("daily: not before send time, once after it, not again the same day", () => {
    expect(digestDue(d, null, at("2026-09-30T07:59:00"))).toBe(false);
    expect(digestDue(d, null, at("2026-09-30T08:01:00"))).toBe(true);
    expect(digestDue(d, at("2026-09-30T08:05:00").getTime(), at("2026-09-30T20:00:00"))).toBe(false);
    expect(digestDue(d, at("2026-09-29T08:05:00").getTime(), at("2026-09-30T08:01:00"))).toBe(true);
  });
  it("disabled or malformed time is never due; weekly only on Monday", () => {
    expect(digestDue({ ...d, enabled: false }, null, at("2026-09-30T12:00:00"))).toBe(false);
    expect(digestDue({ ...d, sendTime: "xx" }, null, at("2026-09-30T12:00:00"))).toBe(false);
    const w = { ...d, frequency: "weekly" as const };
    expect(digestDue(w, null, at("2026-09-28T09:00:00"))).toBe(true);  // Monday
    expect(digestDue(w, null, at("2026-09-29T09:00:00"))).toBe(false); // Tuesday
  });
});
