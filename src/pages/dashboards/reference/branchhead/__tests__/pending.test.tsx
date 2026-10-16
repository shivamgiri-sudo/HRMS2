import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MAX_PENDING_POLLS, PENDING_POLL_MS, STILL_CALCULATING_PREFIX, hasPendingSections, pendingPollInterval, type PollState } from "../pending";
import { SectionError } from "../SectionPanels";
import { SectionShell } from "../ui";
import { DataHealthChips } from "../sections/DataHealthChips";
import { CallmasterBlock } from "../sections/CallmasterBlock";
import * as fx from "./fixtures";

const MSG = "Still calculating - first load of a month can take up to a minute. Refresh shortly.";
const calc = () => ({ status: "error" as const, data: null, asOf: "2026-10-15", message: MSG });

describe("hasPendingSections", () => {
  it("false for a normal payload, missing data and real errors", () => {
    expect(STILL_CALCULATING_PREFIX).toBe("Still calculating");
    expect(hasPendingSections(fx.payloadOf())).toBe(false);
    expect(hasPendingSections(undefined)).toBe(false);
    expect(hasPendingSections(fx.payloadOf(fx.overviewOf({ finance: fx.err("down") })))).toBe(false);
  });
  it("true for any still-calculating section: processPnl, ops, quality, callmaster parts, data health", () => {
    expect(hasPendingSections(fx.payloadOf(fx.overviewOf({ processPnl: calc() })))).toBe(true);
    expect(hasPendingSections(fx.payloadOf(fx.overviewOf({ operations: calc() })))).toBe(true);
    expect(hasPendingSections(fx.payloadOf(fx.overviewOf({ quality: calc() })))).toBe(true);
    expect(hasPendingSections(fx.payloadOf(fx.overviewOf({ callmaster: calc() })))).toBe(true);
    expect(hasPendingSections(fx.payloadOf(fx.overviewOf({ callmaster: fx.ok({ kpis: calc(), cx: fx.ok({}) }) })))).toBe(true);
    expect(hasPendingSections(fx.payloadOf(undefined, { dataHealth: calc() }))).toBe(true);
  });
});

describe("neutral rendering", () => {
  it("SectionError shows a neutral status, not a red alert, for still-calculating", () => {
    const out = renderToStaticMarkup(<SectionError name="Process P&L" message={MSG} />);
    expect(out).toContain('role="status"');
    expect(out).toContain("Calculating - this can take up to a minute on first load; updating automatically");
    expect(out).not.toContain("could not be loaded");
    expect(out).not.toContain("rose");
    expect(renderToStaticMarkup(<SectionError name="X" message="boom" />)).toContain("could not be loaded");
  });
  it("section shells, callmaster and data health use it", () => {
    const shell = renderToStaticMarkup(<SectionShell title="Process P&L" section={calc()} emptyText="">{() => null}</SectionShell>);
    expect(shell).toContain("Calculating - this can take up to a minute");
    expect(renderToStaticMarkup(<CallmasterBlock section={calc()} />)).toContain("Calculating - this can take up to a minute");
    const dh = renderToStaticMarkup(<DataHealthChips section={calc()} />);
    expect(dh).toContain("Calculating - this can take up to a minute");
    expect(dh).not.toContain("could not be loaded");
  });
});

describe("pendingPollInterval", () => {
  const pendingData = fx.payloadOf(fx.overviewOf({ processPnl: calc() }));
  it("polls every 20 s while pending, stops after 6 polls in a row", () => {
    const s: PollState = { lastAt: 0, polls: 0 };
    const got: Array<number | false> = [];
    for (let t = 1; t <= 8; t += 1) got.push(pendingPollInterval(s, pendingData, t));
    expect(PENDING_POLL_MS).toBe(20_000);
    expect(MAX_PENDING_POLLS).toBe(6);
    // the first pending result schedules poll 1; results 1-6 schedule polls 1-6; the 7th pending result stops
    expect(got).toEqual([20_000, 20_000, 20_000, 20_000, 20_000, 20_000, false, false]);
  });
  it("counts each result once however often it is asked", () => {
    const s: PollState = { lastAt: 0, polls: 0 };
    for (let i = 0; i < 20; i += 1) expect(pendingPollInterval(s, pendingData, 5)).toBe(20_000);
    expect(s.polls).toBe(1);
  });
  it("no polling when nothing is pending, and the count resets", () => {
    const s: PollState = { lastAt: 0, polls: 0 };
    for (let t = 1; t <= 8; t += 1) pendingPollInterval(s, pendingData, t);
    expect(pendingPollInterval(s, fx.payloadOf(), 9)).toBe(false);
    expect(s.polls).toBe(0);
    expect(pendingPollInterval(s, pendingData, 10)).toBe(20_000);
  });
});
