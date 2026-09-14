/**
 * The Educational Qualifications table must read the columns the table has.
 *
 * The BGV report reached for degree_type / board_university / field_of_study /
 * year_of_passing / marks_percentage. None of those are columns on
 * `candidate_onboarding_qualification`. Only `institution_name` matched, so five
 * of the six columns printed "-" on every report — and because a blank cell is
 * indistinguishable from a candidate who left the field empty, the report looked
 * merely sparse rather than broken.
 *
 * The row below is a real production shape, taken from the live schema:
 *   qualification, specialization_course_name, passed_out_year,
 *   passed_out_percentage, institution_name, board_type
 */
import { describe, it, expect } from "vitest";
import { qualificationRow } from "../bgvReportPdfGenerator";

const PRODUCTION_ROW = {
  qualification: "B.Tech",
  specialization_course_name: "Computer Science",
  passed_out_year: 2021,
  passed_out_percentage: "72.40",
  institution_name: "Rajiv Gandhi Technical University",
  board_type: "University",
  passed_out_state: "Madhya Pradesh",
};

describe("qualificationRow on a real production row", () => {
  const row = qualificationRow(PRODUCTION_ROW);

  it("reads the degree from `qualification`", () => expect(row.degree).toBe("B.Tech"));
  it("reads the board from `board_type`", () => expect(row.board).toBe("University"));
  it("reads the field from `specialization_course_name`", () =>
    expect(row.field).toBe("Computer Science"));
  it("reads the year from `passed_out_year`", () => expect(row.year).toBe("2021"));
  it("reads the marks from `passed_out_percentage`", () => expect(row.marks).toBe("72.40"));
  it("still reads the institution, the one name that always matched", () =>
    expect(row.institution).toBe("Rajiv Gandhi Technical University"));

  it("prints nothing as '-' rather than 'undefined'", () => {
    const empty = qualificationRow({});
    expect(Object.values(empty).every((v) => v === "-")).toBe(true);
  });

  it("does not throw on a null row", () => {
    expect(() => qualificationRow(null)).not.toThrow();
  });
});

describe("legacy field names still work", () => {
  it("falls back for data assembled outside the onboarding tables", () => {
    const row = qualificationRow({
      degree_type: "MBA", board_university: "IGNOU",
      field_of_study: "Finance", year_of_passing: 2019, marks_cgpa: "8.1",
    });
    expect(row.degree).toBe("MBA");
    expect(row.board).toBe("IGNOU");
    expect(row.field).toBe("Finance");
    expect(row.year).toBe("2019");
    expect(row.marks).toBe("8.1");
  });

  it("prefers the real column when both are present", () => {
    const row = qualificationRow({ qualification: "B.Sc", degree_type: "STALE" });
    expect(row.degree).toBe("B.Sc");
  });
});
