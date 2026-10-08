import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CriteriaSummary, { CompletenessBadge } from "../CriteriaSummary";
import type { CriteriaSummaryData } from "../selectionTypes";

const data = (o: Partial<CriteriaSummaryData> = {}): CriteriaSummaryData => ({
  completeness: { score: 24, label: "incomplete", missing: ["age", "night_shift"], enrolmentReady: false },
  rules: [{ key: "skills", label: "Skills", requiredText: "any of Excel", mode: "prefer", weight: 10, missing: "pass", origin: "column" }],
  legacy: true, version: null, ...o,
});
const NOW = new Date("2026-10-09T12:00:00Z");

describe("CompletenessBadge", () => {
  it("icon + word + score, never colour alone, with an aria label", () => {
    const html = renderToStaticMarkup(<CompletenessBadge completeness={data().completeness} />);
    expect(html).toContain("Incomplete · 24");
    expect(html).toContain('aria-label="Criteria completeness: Incomplete, 24 of 100"');
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("CriteriaSummary", () => {
  it("shows the lines, the enrolment block and the missing decisions as buttons that open the editor at that rule", () => {
    const html = renderToStaticMarkup(<CriteriaSummary data={data()} now={NOW} onEdit={() => undefined} />);
    expect(html).toContain("Skills: any of Excel");
    expect(html).toContain("PREFER +10");
    expect(html).toContain("Enrolment blocked: criteria incomplete");
    expect(html).toContain('aria-label="Decide Age"');
    expect(html).toContain('aria-label="Decide Willing to work night shift"');
    expect(html).toMatch(/min-h-11/);
    expect(html).toContain("dark:");
  });
  it("read-only: no decide buttons", () => {
    const html = renderToStaticMarkup(<CriteriaSummary data={data()} now={NOW} />);
    expect(html).not.toContain("Decide Age");
    expect(html).toContain("Age");
  });
  it("no rules yet: an honest empty state", () => {
    expect(renderToStaticMarkup(<CriteriaSummary data={data({ rules: [] })} now={NOW} />)).toContain("No selection rules apply yet");
  });
  it("defaulted rules are marked as acting as MUST because nobody decided them", () => {
    const html = renderToStaticMarkup(<CriteriaSummary data={data({ legacy: false, rules: [{ key: "rotational_shift", label: "OK with rotational shifts", requiredText: "OK with rotational shifts", mode: "must", weight: 0, missing: "review", origin: "column", defaulted: true }] })} now={NOW} />);
    expect(html).toContain("not decided: acts as MUST");
  });
});
