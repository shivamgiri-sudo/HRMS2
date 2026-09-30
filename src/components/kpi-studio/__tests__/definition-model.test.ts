import { describe, expect, it } from "vitest";
import {
  datePart,
  draftFrom,
  friendlyError,
  groupVersions,
  statusOf,
  todayLocal,
  validateRange,
  type DefinitionRow,
} from "../definition-model";

const TODAY = "2026-09-30";

function definition(overrides: Partial<DefinitionRow> = {}): DefinitionRow {
  return {
    id: "d1",
    metric_id: "m1",
    metric_code: "AHT",
    metric_name: "Handle time",
    unit: "seconds",
    direction: "lower_is_better",
    category: "custom",
    branch_id: null,
    branch_name: null,
    process_id: "p1",
    process_name: "Sales",
    designation_id: null,
    designation_name: null,
    employee_id: null,
    employee_code: null,
    employee_name: null,
    data_source_id: "s1",
    source_name: "Dialer",
    source_type: "local_query",
    formula_expression: "talk_seconds / calls",
    aggregation_method: "average",
    scoring_type: null,
    target_value: "240.0000",
    min_threshold: "360.0000",
    max_achievement: "120.0000",
    weightage: "50.0000",
    target_source: "studio",
    effective_from: "2026-09-01",
    effective_to: null,
    notes: "client SLA",
    scope_tier: 5,
    scope_label: "process",
    extra_sources: [{ id: "s2", source_name: "QA sheet", source_type: "google_sheet_csv" }],
    ...overrides,
  };
}

describe("todayLocal / datePart", () => {
  it("builds today from local date parts, not from UTC", () => {
    // 00:30 local on the 1st is still the previous day in UTC for any zone east of Greenwich.
    expect(todayLocal(new Date(2026, 9, 1, 0, 30))).toBe("2026-10-01");
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("takes the date part of a plain date or an ISO timestamp", () => {
    expect(datePart("2026-09-01")).toBe("2026-09-01");
    expect(datePart("2026-09-01T00:00:00.000Z")).toBe("2026-09-01");
    expect(datePart(null)).toBe("");
    expect(datePart("not a date")).toBe("");
  });
});

describe("statusOf", () => {
  it("is current with no end date, and on its first and last day", () => {
    expect(statusOf(definition(), TODAY)).toBe("current");
    expect(statusOf(definition({ effective_from: TODAY }), TODAY)).toBe("current");
    expect(statusOf(definition({ effective_to: TODAY }), TODAY)).toBe("current");
  });

  it("is scheduled when it starts after today", () => {
    expect(statusOf(definition({ effective_from: "2026-10-01" }), TODAY)).toBe("scheduled");
  });

  it("is ended once the end date has passed", () => {
    expect(statusOf(definition({ effective_to: "2026-09-29" }), TODAY)).toBe("ended");
  });

  it("compares ISO timestamps on the date part only", () => {
    expect(statusOf(definition({ effective_to: "2026-09-30T23:59:59.000Z" }), TODAY)).toBe("current");
    expect(statusOf(definition({ effective_from: "2026-10-01T00:00:00.000Z" }), TODAY)).toBe("scheduled");
  });
});

describe("groupVersions", () => {
  it("groups versions of the same KPI and scope, newest first", () => {
    const groups = groupVersions(
      [
        definition({ id: "old", effective_from: "2026-01-01", effective_to: "2026-08-31" }),
        definition({ id: "new", effective_from: "2026-09-01" }),
      ],
      TODAY,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].versions.map((version) => version.id)).toEqual(["new", "old"]);
    expect(groups[0].current.id).toBe("new");
    expect(groups[0].status).toBe("current");
  });

  it("keeps a different scope or a different KPI in its own group", () => {
    const groups = groupVersions(
      [
        definition({ id: "a" }),
        definition({ id: "b", process_id: "p2" }),
        definition({ id: "c", metric_id: "m2" }),
        definition({ id: "d", employee_id: "e1" }),
        definition({ id: "e", branch_id: "b1" }),
        definition({ id: "f", designation_id: "g1" }),
      ],
      TODAY,
    );
    expect(groups).toHaveLength(6);
  });

  it("shows the version in force today even when a newer one is scheduled", () => {
    const [group] = groupVersions(
      [
        definition({ id: "now", effective_from: "2026-09-01", effective_to: "2026-10-14" }),
        definition({ id: "next", effective_from: "2026-10-15" }),
      ],
      TODAY,
    );
    expect(group.versions[0].id).toBe("next");
    expect(group.current.id).toBe("now");
    expect(group.status).toBe("current");
  });

  it("reports scheduled and ended groups", () => {
    const [scheduled] = groupVersions([definition({ effective_from: "2026-11-01" })], TODAY);
    expect(scheduled.status).toBe("scheduled");

    const [ended] = groupVersions(
      [
        definition({ id: "v1", effective_from: "2026-01-01", effective_to: "2026-03-31" }),
        definition({ id: "v2", effective_from: "2026-04-01", effective_to: "2026-06-30" }),
      ],
      TODAY,
    );
    expect(ended.status).toBe("ended");
    expect(ended.current.id).toBe("v2");
  });

  it("returns nothing for an empty list", () => {
    expect(groupVersions([], TODAY)).toEqual([]);
  });
});

describe("draftFrom", () => {
  it("edit keeps the scope and starts the new version today", () => {
    const draft = draftFrom(definition({ effective_from: "2026-01-01" }), "edit", TODAY);
    expect(draft.mode).toBe("edit");
    expect(draft.source_definition_id).toBe("d1");
    expect(draft.values.process_id).toBe("p1");
    expect(draft.values.effective_from).toBe(TODAY);
    expect(draft.values.metric_id).toBe("m1");
    expect(draft.values.data_source_id).toBe("s1");
    expect(draft.values.extra_source_ids).toEqual(["s2"]);
    expect(draft.values.formula_expression).toBe("talk_seconds / calls");
    expect(draft.values.notes).toBe("client SLA");
  });

  it("drops the trailing zeros a DECIMAL column carries", () => {
    const { values } = draftFrom(definition(), "edit", TODAY);
    expect(values.target_value).toBe("240");
    expect(values.min_threshold).toBe("360");
    expect(values.weightage).toBe("50");
    expect(values.max_achievement).toBe("120");
  });

  it("clone keeps formula, source and target but clears every part of the scope", () => {
    const draft = draftFrom(
      definition({ branch_id: "b1", designation_id: "g1", employee_id: "e1", employee_code: "E001" }),
      "clone",
      TODAY,
    );
    expect(draft.mode).toBe("clone");
    expect(draft.values.branch_id).toBe("");
    expect(draft.values.process_id).toBe("");
    expect(draft.values.designation_id).toBe("");
    expect(draft.values.employee_id).toBe("");
    expect(draft.employee_search).toBe("");
    expect(draft.values.formula_expression).toBe("talk_seconds / calls");
    expect(draft.values.data_source_id).toBe("s1");
    expect(draft.values.target_value).toBe("240");
  });

  it("handles a definition with no formula, source or target", () => {
    const { values } = draftFrom(
      definition({ formula_expression: null, data_source_id: null, target_value: null, min_threshold: null, extra_sources: [] }),
      "edit",
      TODAY,
    );
    expect(values.formula_expression).toBe("");
    expect(values.data_source_id).toBe("");
    expect(values.target_value).toBe("");
    expect(values.min_threshold).toBe("");
    expect(values.extra_source_ids).toEqual([]);
  });

  it("says whether the grain came from the server", () => {
    expect(draftFrom(definition(), "edit", TODAY).grain_known).toBe(false);
    expect(draftFrom(definition(), "edit", TODAY).values.grain).toBe("employee");
    const processDraft = draftFrom(definition({ grain: "process" }), "edit", TODAY);
    expect(processDraft.grain_known).toBe(true);
    expect(processDraft.values.grain).toBe("process");
  });

  it("seeds the employee search for an employee-scoped edit", () => {
    const draft = draftFrom(definition({ employee_id: "e1", employee_code: "E001" }), "edit", TODAY);
    expect(draft.employee_search).toBe("E001");
    expect(draft.values.employee_id).toBe("e1");
  });
});

describe("friendlyError", () => {
  it("shows the server's sentence for an out-of-scope refusal", () => {
    const error = Object.assign(new Error("You do not manage the Sales process"), { status: 403, code: "OUT_OF_SCOPE" });
    expect(friendlyError(error)).toBe("You do not manage the Sales process");
  });

  it("strips the code when it is part of the message", () => {
    expect(friendlyError(new Error("OUT_OF_SCOPE: You do not manage the Sales process"))).toBe(
      "You do not manage the Sales process",
    );
  });

  it("unwraps a JSON body that arrived as text", () => {
    expect(friendlyError(new Error('{"success":false,"code":"OUT_OF_SCOPE","message":"Not your process"}'))).toBe(
      "Not your process",
    );
  });

  it("falls back to a plain sentence when the code has no message", () => {
    expect(friendlyError(new Error("OUT_OF_SCOPE"))).toBe("That is outside the processes you manage.");
  });

  it("passes an ordinary message through and never shows an object", () => {
    expect(friendlyError(new Error("The start date is after the end date"))).toBe("The start date is after the end date");
    expect(friendlyError("plain text")).toBe("plain text");
    expect(friendlyError({ message: "from an object" })).toBe("from an object");
    expect(friendlyError(null)).toBe("Something went wrong. Please try again.");
    expect(friendlyError({})).toBe("Something went wrong. Please try again.");
  });
});

describe("validateRange", () => {
  it("accepts a range up to 62 days ending today", () => {
    expect(validateRange("2026-09-01", "2026-09-30", TODAY)).toEqual({ days: 30, message: null });
    expect(validateRange("2026-07-31", "2026-09-30", TODAY).message).toBeNull();
    expect(validateRange("2026-07-31", "2026-09-30", TODAY).days).toBe(62);
    expect(validateRange(TODAY, TODAY, TODAY)).toEqual({ days: 1, message: null });
  });

  it("explains each way a range can be wrong", () => {
    expect(validateRange("", "2026-09-30", TODAY).message).toMatch(/Choose a start date/);
    expect(validateRange("2026-09-30", "2026-09-01", TODAY).message).toMatch(/after the end date/);
    expect(validateRange("2026-09-30", "2026-10-01", TODAY).message).toMatch(/in the future/);
    expect(validateRange("2026-07-30", "2026-09-30", TODAY).message).toMatch(/at most 62 days/);
  });
});
