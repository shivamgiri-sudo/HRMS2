import { describe, expect, it, vi } from "vitest";

// The service modules import the DB pools at load; the pure helpers under test never touch them.
vi.mock("../../../db/onfidoDb.js", () => ({ getOnfidoPool: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(), query: vi.fn() } }));

import {
  aggregateStaffing, aonBucketForLiveDays, averageKnown, bucketBounds, bucketKeyForDay, buildAonRows, buildMatrix,
  classifyTaskType, computeManpower, computeUtilization, groupTaskTypes, isIsoDay, planAsOf, sumComplete, sumInputs,
  queuesMissingPlan, totalApprovedAsOf, validateRange, weekCommencing, type ManpowerPlanRow, type UtilizationInputs,
} from "../onfido-overview-report.pure.js";
import { buildMtd, buildUtilizationDay, eachDay, monthLabel, utilizationTrend } from "../onfido-utilization.service.js";
import {
  parseManpowerPlanInput, parseUtilizationInputBatch, parseUtilizationInputRow,
} from "../onfido-wfm-inputs.validation.js";
import { jsonNumberExpr } from "../onfido-quality-stages.js";

const inputs = (over: Partial<UtilizationInputs>): UtilizationInputs => ({
  forecastTask: null, forecastTaskPoa: null, actualTask: null, manualFarCases: null, poaLive: null, adhocTime: null,
  analystQc: null, facialChecks: null, crossTrainingTaskPoa: null, poaLiveAuditsPq: null, escalatedTask: null, ...over,
});

describe("Utilization formulas (Utilization Format.xlsx, cached Excel values)", () => {
  it("reproduces row 2 of the sheet exactly", () => {
    const d = computeUtilization(inputs({
      forecastTask: 35626.98891766155, forecastTaskPoa: 5734.423836000001, actualTask: 29580, manualFarCases: 335,
      poaLive: 2901, adhocTime: 7885, analystQc: 2143, crossTrainingTaskPoa: 0, poaLiveAuditsPq: 662, escalatedTask: 32,
    }));
    expect(d.utilizationForecast).toBeCloseTo(52447.96550326155, 6);
    expect(d.utilizationWithAdhoc).toBeCloseTo(50823.066666666666, 6);
    expect(d.utilizationWithoutAdhoc).toBeCloseTo(38089.6, 6);
    expect(d.utilizationWithAdhocPct).toBeCloseTo(96.90188395106797, 6);
    expect(d.utilizationWithoutAdhocPct).toBeCloseTo(72.62359871257799, 6);
    expect(d.poaAnsweringPct).toBeCloseTo(50.58921494061674, 6);
    expect(d.escalatedPct).toBeCloseTo(0.10818120351588911, 6);
  });

  it("reproduces row 7, where cross training and audits are non-zero", () => {
    const d = computeUtilization(inputs({
      forecastTask: 35698.31422080002, forecastTaskPoa: 5991.1561710000005, actualTask: 26162, manualFarCases: 213,
      poaLive: 2837, adhocTime: 9560, analystQc: 2737, crossTrainingTaskPoa: 142, poaLiveAuditsPq: 142 + 363,
    }));
    expect(d.utilizationWithAdhoc).toBeCloseTo(49439.13333333334, 6);
    expect(d.utilizationWithAdhocPct).toBeCloseTo(92.80445224802786, 6);
  });

  it("returns null, never a zero-filled figure, when an input has not been entered", () => {
    const d = computeUtilization(inputs({ actualTask: 29580, poaLive: 2901 }));
    expect(d.utilizationWithoutAdhoc).toBeCloseTo(38089.6, 6); // needs only G and I
    expect(d.utilizationWithAdhoc).toBeNull();                 // needs H, J, K, M, N as well
    expect(d.utilizationForecast).toBeNull();
    expect(d.utilizationWithoutAdhocPct).toBeNull();
    expect(d.escalatedPct).toBeNull();
  });

  it("does not divide by a zero forecast or zero actual task", () => {
    const d = computeUtilization(inputs({ forecastTask: 0, forecastTaskPoa: 0, actualTask: 0, poaLive: 0, escalatedTask: 0 }));
    expect(d.utilizationWithoutAdhocPct).toBeNull();
    expect(d.escalatedPct).toBeNull();
  });

  it("MTD sums are complete-or-null and the MTD formulas run on the sums", () => {
    expect(sumComplete([1, 2, 3])).toBe(6);
    expect(sumComplete([1, null, 3])).toBeNull();
    expect(sumComplete([])).toBeNull();
    expect(averageKnown([0.9, null, 0.8])).toBeCloseTo(0.85, 10);
    const days = [
      inputs({ forecastTask: 100, forecastTaskPoa: 30, actualTask: 90, poaLive: 15 }),
      inputs({ forecastTask: 100, forecastTaskPoa: 30, actualTask: 95, poaLive: 15 }),
    ];
    const total = sumInputs(days);
    expect(total.actualTask).toBe(185);
    expect(computeUtilization(total).utilizationWithoutAdhoc).toBeCloseTo(185 + 30 * (220 / 75), 10);
    expect(sumInputs([days[0], inputs({ actualTask: 5 })]).forecastTask).toBeNull();
  });
});

describe("dates", () => {
  it("computes the Monday week commencing (A - WEEKDAY(A,3))", () => {
    expect(weekCommencing("2026-07-01")).toBe("2026-06-29"); // Sheet C2
    expect(weekCommencing("2026-07-07")).toBe("2026-07-06"); // Sheet C7
    expect(weekCommencing("2026-07-06")).toBe("2026-07-06");
    expect(weekCommencing("2026-07-05")).toBe("2026-06-29"); // Sunday
  });

  it("labels months like TEXT(A,\"mmm-yy\") and buckets like the SQL bucketLabel", () => {
    expect(monthLabel("2026-07-01")).toBe("Jul-26");
    expect(bucketKeyForDay("2026-07-15", "monthly")).toBe("2026-07");
    expect(bucketKeyForDay("2026-07-15", "weekly")).toBe("2026-07-13");
    expect(bucketKeyForDay("2026-07-15", "daily")).toBe("2026-07-15");
    expect(bucketBounds("2026-07-15", "weekly")).toEqual({ start: "2026-07-13", end: "2026-07-19" });
    expect(bucketBounds("2026-02-10", "monthly")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("validates ISO days and ranges", () => {
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("2026-07-01")).toBe(true);
    expect(validateRange("2026-07-01", "2026-07-31")).toBeNull();
    expect(validateRange("2026-07-31", "2026-07-01")).not.toBeNull();
    expect(validateRange(undefined, "2026-07-01")).not.toBeNull();
    expect(eachDay("2026-07-30", "2026-08-02")).toEqual(["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
  });
});

describe("manpower", () => {
  it("applies Required = Approved x 120%, Buffer = (Active-Approved)/Approved, Shortfall = Required-Active", () => {
    expect(computeManpower(100, 110)).toEqual({ approvedHc: 100, requiredHc: 120, activeHc: 110, bufferPct: 10, shortfall: 10 });
    expect(computeManpower(100, 130).shortfall).toBe(-10); // surplus is shown as negative, not hidden
  });

  it("is entirely null-safe when approved HC has not been entered", () => {
    expect(computeManpower(null, 110)).toEqual({ approvedHc: null, requiredHc: null, activeHc: 110, bufferPct: null, shortfall: null });
    expect(computeManpower(0, 110).bufferPct).toBeNull();
  });

  const plan: ManpowerPlanRow[] = [
    { processQueue: "EXTRACTION", effectiveFrom: "2026-07-01", approvedHc: 100, activeHc: null },
    { processQueue: "EXTRACTION", effectiveFrom: "2026-09-01", approvedHc: 120, activeHc: null },
    { processQueue: "POA", effectiveFrom: "2026-08-01", approvedHc: 40, activeHc: null },
  ];
  it("uses the plan row in force on the date and sums queues that have one", () => {
    expect(planAsOf(plan, "EXTRACTION", "2026-08-15")?.approvedHc).toBe(100);
    expect(planAsOf(plan, "EXTRACTION", "2026-09-01")?.approvedHc).toBe(120);
    expect(planAsOf(plan, "POA", "2026-07-31")).toBeNull();
    expect(totalApprovedAsOf(plan, "2026-08-15")).toBeNull(); // Encord has no entry: a partial total would mislead
    expect(queuesMissingPlan(plan, "2026-08-15")).toEqual(["ENCORD"]);
    const full = [...plan, { processQueue: "ENCORD" as const, effectiveFrom: "2026-07-01", approvedHc: 0, activeHc: null }];
    expect(totalApprovedAsOf(full, "2026-08-15")).toBe(140);
    expect(totalApprovedAsOf(plan, "2026-06-01")).toBeNull();
  });
});

describe("AON buckets", () => {
  it("uses the sheet's buckets on live days", () => {
    const cases: [number, string][] = [[0, "0-30"], [30, "0-30"], [31, "31-60"], [90, "61-90"], [91, "91-120"], [120, "91-120"],
      [121, "121-180"], [181, "181-363"], [363, "181-363"], [364, "Above 1 Year"]];
    for (const [days, label] of cases) expect(aonBucketForLiveDays(days)).toBe(label);
    expect(aonBucketForLiveDays(null)).toBeNull();
  });

  it("computes contribution over classified HC and reports unclassified separately", () => {
    const built = buildAonRows([{ liveDays: 10, hc: 30 }, { liveDays: 100, hc: 70 }, { liveDays: null, hc: 5 }]);
    expect(built.rows.find((r) => r.label === "0-30")).toEqual({ label: "0-30", activeHc: 30, contributionPct: 30 });
    expect(built.rows.find((r) => r.label === "91-120")?.contributionPct).toBe(70);
    expect(built.unclassifiedHc).toBe(5);
    expect(built.totalHc).toBe(105);
    expect(built.rows).toHaveLength(7);
  });
});

describe("staffing aggregation (attrition and shrinkage)", () => {
  const days = [
    { day: "2026-07-01", hc: 200, attrition: 2, scheduled: 180, unplannedLeave: 10, actualUl: 9 },
    { day: "2026-07-02", hc: 190, attrition: 1, scheduled: 170, unplannedLeave: 8, actualUl: 8.5 },
    { day: "2026-08-01", hc: 180, attrition: 0, scheduled: 160, unplannedLeave: 0, actualUl: 0 },
  ];
  it("uses the two-point average HC for monthly attrition, matching the Attrition tab", () => {
    const [jul, aug] = aggregateStaffing(days, "monthly");
    expect(jul.bucket).toBe("2026-07");
    expect(jul.avgHc).toBe(195);
    expect(jul.attritionPct).toBeCloseTo((3 / 195) * 100, 2);
    expect(jul.shrinkagePct).toBeCloseTo((17.5 / 350) * 100, 2);
    expect(jul.activeHc).toBe(190);
    expect(aug.attritionPct).toBe(0);
  });
  it("supports daily buckets and returns null when there is no scheduled base", () => {
    expect(aggregateStaffing(days, "daily")).toHaveLength(3);
    const [only] = aggregateStaffing([{ day: "2026-07-01", hc: 0, attrition: 0, scheduled: 0, unplannedLeave: 0, actualUl: 0 }], "daily");
    expect(only.attritionPct).toBeNull();
    expect(only.shrinkagePct).toBeNull();
  });
});

describe("task-type grouping", () => {
  it("tests the specific names before the general ones", () => {
    expect(classifyTaskType("process_labelling_document_raw_extraction")).toBe("Labelling");
    expect(classifyTaskType("process_ewys_address")).toBe("EWYS Address");
    expect(classifyTaskType("process_classification_document")).toBe("Classification");
    expect(classifyTaskType("process_ewys_document")).toBe("EWYS");
    expect(classifyTaskType("process_extraction_document")).toBe("Extraction");
    expect(classifyTaskType("process_consistency_check")).toBe("Consistency");
    expect(classifyTaskType("something_else")).toBe("Other");
    expect(classifyTaskType(null)).toBe("Other");
  });

  it("count-weights AHT inside a group", () => {
    const grouped = groupTaskTypes({
      process_extraction_a: { taskCount: 100, avgAht: 100 },
      process_extraction_b: { taskCount: 300, avgAht: 200 },
    });
    const ext = grouped.get("Extraction")!;
    expect(ext.taskCount).toBe(400);
    expect(ext.ahtWeighted / ext.ahtCount).toBe(175);
  });

  it("aligns sparse series on one axis with nulls, not zeros", () => {
    const m = buildMatrix([
      { label: "A", points: new Map([["2026-07", 1], ["2026-08", 2]]) },
      { label: "B", points: new Map([["2026-08", 5]]) },
    ]);
    expect(m.buckets).toEqual(["2026-07", "2026-08"]);
    expect(m.rows[1].values).toEqual([null, 5]);
  });
});

describe("utilization report assembly", () => {
  const manual = {
    inputDate: "2026-07-01", forecastTask: 100, forecastTaskPoa: 30, manualFarCases: 1, adhocTime: 2, analystQc: 3, facialChecks: 4,
    crossTrainingTaskPoa: 0, poaLiveAuditsPq: 5, remarks: null, createdBy: "u1", createdAt: "2026-09-23 10:00:00", updatedBy: null, updatedAt: null,
  };
  it("takes actuals from the reports and inputs from the WFM row", () => {
    const d = buildUtilizationDay("2026-07-01", { n: 90, aht: 100, esc: 3 }, { n: 15, aht: 190 }, { gd: 0.9, mcn: 0.7, sla: 0.95, aps: 1.08 }, manual);
    expect(d.inputs.actualTask).toBe(90);
    expect(d.inputs.forecastTask).toBe(100);
    expect(d.hasManualInputs).toBe(true);
    expect(d.derived.utilizationForecast).toBeCloseTo(100 + 30 * (220 / 75), 10);
    expect(d.month).toBe("Jul-26");
    expect(d.wc).toBe("2026-06-29");
  });

  it("leaves inputs null when nobody has entered them and MTD stops at the last day with data", () => {
    const withData = buildUtilizationDay("2026-07-01", { n: 90, aht: 100, esc: 3 }, { n: 15, aht: 190 }, undefined, undefined);
    const noData = buildUtilizationDay("2026-07-02", undefined, undefined, undefined, undefined);
    expect(withData.inputs.forecastTask).toBeNull();
    expect(withData.derived.utilizationWithAdhocPct).toBeNull();
    const { throughDate, mtd } = buildMtd([withData, noData], 99, 190);
    expect(throughDate).toBe("2026-07-01");
    expect(mtd.inputs.actualTask).toBe(90);
    expect(mtd.derived.utilizationWithoutAdhoc).toBeCloseTo(90 + 15 * (220 / 75), 10);
    expect(mtd.derived.utilizationWithoutAdhocPct).toBeNull(); // no forecast entered
  });

  it("builds a bucketed utilization trend only from complete buckets", () => {
    const a = buildUtilizationDay("2026-07-01", { n: 90, aht: 100, esc: 0 }, { n: 15, aht: 190 }, undefined, manual);
    const b = buildUtilizationDay("2026-07-02", { n: 80, aht: 100, esc: 0 }, { n: 15, aht: 190 }, undefined, undefined);
    expect(utilizationTrend([a], "daily")[0].utilizationWithAdhocPct).not.toBeNull();
    expect(utilizationTrend([a, b], "monthly")[0].utilizationWithAdhocPct).toBeNull();
  });
});

describe("WFM input validation", () => {
  it("accepts a valid manpower plan row and keeps Active HC for Encord only", () => {
    const encord = parseManpowerPlanInput({ processQueue: "ENCORD", effectiveFrom: "2026-09-01", approvedHc: "50", activeHc: 44 });
    expect(encord).toMatchObject({ ok: true, value: { approvedHc: 50, activeHc: 44 } });
    const poa = parseManpowerPlanInput({ processQueue: "POA", effectiveFrom: "2026-09-01", approvedHc: 50, activeHc: 44 });
    expect(poa).toMatchObject({ ok: true, value: { activeHc: null } });
  });

  it("rejects an unknown queue, bad date, and missing or non-positive approved HC", () => {
    expect(parseManpowerPlanInput({ processQueue: "OTHER", effectiveFrom: "2026-09-01", approvedHc: 5 }).ok).toBe(false);
    expect(parseManpowerPlanInput({ processQueue: "POA", effectiveFrom: "01/09/2026", approvedHc: 5 }).ok).toBe(false);
    expect(parseManpowerPlanInput({ processQueue: "POA", effectiveFrom: "2026-09-01" }).ok).toBe(false);
    expect(parseManpowerPlanInput({ processQueue: "POA", effectiveFrom: "2026-09-01", approvedHc: -3 }).ok).toBe(false);
    expect(parseManpowerPlanInput({ processQueue: "ENCORD", effectiveFrom: "2026-09-01", approvedHc: 0 }).ok).toBe(true);
    expect(parseManpowerPlanInput({ processQueue: "POA", effectiveFrom: "2026-09-01", approvedHc: 2.5 }).ok).toBe(false);
  });

  it("treats blank utilization cells as not entered, and rejects garbage instead of coercing it", () => {
    const ok = parseUtilizationInputRow({ inputDate: "2026-07-01", forecastTask: "35,626.99", adhocTime: "", analystQc: null, manualFarCases: 335 });
    expect(ok).toMatchObject({ ok: true, value: { forecastTask: 35626.99, adhocTime: null, analystQc: null, manualFarCases: 335 } });
    expect(parseUtilizationInputRow({ inputDate: "2026-07-01", forecastTask: "abc" }).ok).toBe(false);
    expect(parseUtilizationInputRow({ inputDate: "2026-07-01", analystQc: 1.5 }).ok).toBe(false);
    expect(parseUtilizationInputRow({ inputDate: "2026-07-01", adhocTime: -1 }).ok).toBe(false);
    expect(parseUtilizationInputRow({ inputDate: "nope" }).ok).toBe(false);
  });

  it("rejects the whole batch when any row is bad, duplicated, empty, or too large", () => {
    expect(parseUtilizationInputBatch([]).ok).toBe(false);
    expect(parseUtilizationInputBatch([{ inputDate: "2026-07-01" }, { inputDate: "2026-07-01" }]).ok).toBe(false);
    expect(parseUtilizationInputBatch([{ inputDate: "2026-07-01" }, { inputDate: "2026-07-02", forecastTask: "x" }]).ok).toBe(false);
    expect(parseUtilizationInputBatch(Array.from({ length: 401 }, (_, i) => ({ inputDate: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` }))).ok).toBe(false);
    expect(parseUtilizationInputBatch([{ inputDate: "2026-07-01" }, { inputDate: "2026-07-02" }]).ok).toBe(true);
  });
});

describe("JSON header expressions", () => {
  it("quotes the header inside the JSON path and refuses unsafe characters", () => {
    expect(jsonNumberExpr("Class. Yes")).toContain(`'$."Class. Yes"'`);
    expect(() => jsonNumberExpr(`x"); DROP TABLE t; --`)).toThrow();
    expect(() => jsonNumberExpr("it's")).toThrow();
  });
});
