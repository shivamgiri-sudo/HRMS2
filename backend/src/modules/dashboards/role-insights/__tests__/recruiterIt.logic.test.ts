import { describe, expect, it } from "vitest";
import { buildFunnel, candidateDepth, noShowRate, offerOutcomes, recruiterLeague, requisitionAgeing, sourceYield, stageDepth, type CohortCandidate } from "../providers/recruiterLogic.js";
import { ageBuckets, classifyTask, slaCompliance } from "../providers/itLogic.js";
import { canOpen, pickHref } from "../providers/pageAccess.js";

const c = (o: Partial<CohortCandidate>): CohortCandidate => ({ id: "1", stage: "Applied", status: "Waiting", source: "WALKIN", recruiter: "RAKHI", branch: null, process: null, createdDate: "2026-09-20", updatedDate: "2026-09-20", walkInDate: "2026-09-20", loggedStages: [], joined: false, ...o });

describe("recruiter funnel", () => {
  it("is monotone and uses the furthest step reached, not the current stage", () => {
    const cands = [c({}), c({ stage: "Round 2- Op's", status: "Rejected" }), c({ stage: "Applied", loggedStages: ["Onboarding Link Sent"] }), c({ joined: true })];
    const f = buildFunnel(cands.map(candidateDepth));
    for (let i = 1; i < f.length; i++) expect(f[i].reached).toBeLessThanOrEqual(f[i - 1].reached);
    expect(f[0].reached).toBe(4);
    expect(f[8].reached).toBe(1);
    expect(candidateDepth(cands[1])).toBe(2);
  });
  it("does not force unknown stages into a bucket", () => { expect(stageDepth("mystery")).toBe(-1); });
  it("no-show excludes today and returns null with no due candidates", () => {
    expect(noShowRate([c({ walkInDate: "2026-10-01", status: "No Show" })], "2026-10-01").ratePct).toBeNull();
    expect(noShowRate([c({ status: "No Show" }), c({})], "2026-10-01").ratePct).toBe(50);
  });
  it("league merges case variants and aliases", () => {
    const l = recruiterLeague([c({ recruiter: "SOFIYA SULTAN" }), c({ recruiter: "Sofiya Sultan" }), c({ recruiter: null })]);
    expect(l.find((r) => r.recruiter === "Unassigned")?.registered).toBe(1);
    expect(l.filter((r) => /sofiya/i.test(r.recruiter))).toHaveLength(1);
  });
  it("source yield counts joined", () => {
    const y = sourceYield([c({ joined: true }), c({})]);
    expect(y[0]).toMatchObject({ registered: 2, joined: 1, joinedPct: 50 });
  });
});

describe("offers and requisitions", () => {
  it("offer-to-join ignores offers not yet due and unlinked old offers", () => {
    const o = offerOutcomes([
      { status: "bh_approved", doj: "2026-09-25", approvedAt: null, submittedAt: null, joined: true },
      { status: "bh_approved", doj: "2026-09-26", approvedAt: null, submittedAt: null, joined: false },
      { status: "bh_approved", doj: "2026-10-05", approvedAt: null, submittedAt: null, joined: false },
      { status: "bh_approved", doj: "2026-06-01", approvedAt: null, submittedAt: null, joined: false },
    ], "2026-10-01");
    expect(o.dueCount).toBe(2);
    expect(o.offerToJoinPct).toBe(50);
    expect(o.week).toHaveLength(1);
  });
  it("requisition ageing counts only open seats", () => {
    const a = requisitionAgeing([{ code: "A", process: "P", branch: null, requested: 10, fulfilled: 4, approvedAt: "2026-09-01", createdAt: "2026-09-01", target: "2026-09-15", priority: null }, { code: "B", process: "P", branch: null, requested: 2, fulfilled: 2, approvedAt: null, createdAt: "2026-09-01", target: null, priority: null }], "2026-10-01");
    expect(a.seats).toBe(6);
    expect(a.overdue).toHaveLength(1);
  });
});

describe("IT calculations", () => {
  it("classifies the combined task once, and exit tasks apart from joiner buckets", () => {
    expect(classifyTask("IT_EMAIL_DOMAIN_ASSET")).toBe("Email + domain + asset");
    expect(classifyTask("domain_delete")).toBe("Domain");
  });
  it("SLA compliance is null without SLA data and never divides by open tickets", () => {
    expect(slaCompliance(0, 0)).toBeNull();
    expect(slaCompliance(3, 4)).toBe(75);
  });
  it("age buckets cover every task", () => { expect(ageBuckets([0, 3, 9, 40]).reduce((s, b) => s + b.value, 0)).toBe(4); });
});

describe("page access", () => {
  it("falls back when the role cannot open a page", () => {
    const allowed = new Set(["ATS_CANDIDATE_MASTER"]);
    expect(canOpen(allowed, "/ats/bgv")).toBe(false);
    expect(pickHref(allowed, ["/ats/bgv", "/ats/candidate-master"], "/x")).toBe("/ats/candidate-master");
    expect(pickHref(allowed, ["/ats/bgv"], "/x")).toBe("/x");
  });
});

describe("every emitted href is a mounted route", () => {
  it("exists in the route files", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dir = resolve(__dirname, "../../../../../../src/config/routes");
    const src = readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => readFileSync(resolve(dir, f), "utf8")).join("\n");
    const hrefs = ["/ats/candidate-master", "/ats/walkin-queue", "/ats/waiting-queue", "/ats/offer-approvals", "/ats/bgv", "/ats/onboarding-requests", "/ats/joining-documents-tracker", "/ats/joining-control-room", "/ats/recruiter/workspace", "/ats/sourcing-analysis", "/recruitment/job-requisition", "/provisioning/it", "/it-provisioning", "/assets-manager", "/helpdesk"];
    for (const h of hrefs) expect(src, h).toContain(`path="${h}"`);
  });
});
