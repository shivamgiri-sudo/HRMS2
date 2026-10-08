import { describe, expect, it } from "vitest";
import { RULE_CATALOGUE } from "../../../../backend/src/modules/selection/rule-catalogue";
import { RULE_INFO, GROUP_ORDER } from "../ruleInfo";
import { badgeOf, enrolmentNote, relativeAgo, summaryGroups, unknownText, versionLine } from "../completenessModel";
import type { CompiledRuleView } from "../selectionTypes";

const rule = (o: Partial<CompiledRuleView>): CompiledRuleView => ({ key: "age", label: "Age", requiredText: "18 to 35", mode: "must", weight: 0, missing: "review", origin: "column", ...o });

describe("rule info parity with the server catalogue", () => {
  it("every server rule has the same label and group here", () => {
    expect(Object.keys(RULE_INFO).sort()).toEqual(RULE_CATALOGUE.map((e) => e.key).sort());
    for (const e of RULE_CATALOGUE) expect([e.key, RULE_INFO[e.key].label, RULE_INFO[e.key].group]).toEqual([e.key, e.label, e.group]);
  });
});

describe("badgeOf", () => {
  it.each([
    [{ score: 84, label: "complete", enrolmentReady: true }, "Complete", "check"],
    [{ score: 62, label: "partial", enrolmentReady: false }, "Partial", "half"],
    [{ score: 24, label: "incomplete", enrolmentReady: false }, "Incomplete", "alert"],
  ] as const)("%o -> %s", (c, word, icon) => {
    const b = badgeOf({ ...c, missing: [] });
    expect(b).toMatchObject({ word, icon, text: `${word} · ${c.score}`, aria: `Criteria completeness: ${word}, ${c.score} of 100` });
  });
});

describe("summaryGroups", () => {
  it("groups lines Who / Where / ... in order, each with MUST or PREFER and the unknown policy", () => {
    const g = summaryGroups([rule({ key: "night_shift", label: "Willing to work night shift", requiredText: "willing to work night shift", missing: "pass" }),
      rule({}), rule({ key: "skills", label: "Skills", requiredText: "any of Excel", mode: "prefer", weight: 10, missing: "pass" }),
      rule({ key: "location_region", label: "Lives in the branch area", requiredText: "lives in the Noida area", only: ["he"] })]);
    expect(g.map((x) => x.group)).toEqual(["who", "where", "skills", "availability"]);
    expect(g[0].title).toBe("Who");
    expect(g[0].lines[0]).toEqual({ key: "age", text: "Age: 18 to 35", mode: "MUST", unknown: "If unknown: ask HR", scope: null, defaulted: false });
    expect(g[1].lines[0].scope).toBe("drive line-up only");
    expect(g[2].lines[0]).toMatchObject({ mode: "PREFER +10", unknown: null });
    expect(g[3].lines[0].unknown).toBe("If unknown: treat as meeting it");
    expect(GROUP_ORDER[0]).toBe("who");
  });
  it("unknown policy wording", () => {
    expect([unknownText("review"), unknownText("fail"), unknownText("pass")]).toEqual(["If unknown: ask HR", "If unknown: treat as not meeting it", "If unknown: treat as meeting it"]);
  });
});

describe("notes and times", () => {
  const NOW = new Date("2026-10-09T12:00:00Z");
  it("enrolment note only when not ready", () => {
    expect(enrolmentNote({ score: 24, label: "incomplete", missing: [], enrolmentReady: false })).toBe("Enrolment blocked: criteria incomplete");
    expect(enrolmentNote({ score: 90, label: "complete", missing: [], enrolmentReady: true })).toBeNull();
  });
  // now = 2026-10-09 17:30 IST; DB text is IST wall clock, ISO strings carry their own zone
  it.each([["2026-10-09 17:20:00", "10 min ago"], ["2026-10-09 17:30:00", "just now"], ["2026-10-09 15:30:00", "2 h ago"], ["2026-10-07 10:00:00", "2 days ago"], ["2026-10-09T10:00:00.000Z", "2 h ago"], ["garbage", ""]])(
    "relativeAgo(%s IST)", (at, txt) => expect(relativeAgo(at, NOW)).toBe(txt));
  it("version line", () => {
    expect(versionLine({ versionNo: 3, at: "2026-10-09 15:30:00", by: "u1", source: "criteria_panel" }, NOW)).toBe("Version 3, changed 2 h ago in the criteria editor");
    expect(versionLine(null, NOW)).toBe("Not versioned yet");
  });
});
