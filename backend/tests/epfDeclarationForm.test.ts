/**
 * Guards the fillable EPF Form 11.
 *
 * The EPFO-supplied form is a flat scan — 904 embedded images, no AcroForm
 * fields and no vector rectangles — so nothing could be filled into it and no
 * box coordinates could be calibrated from it. This form is rebuilt as a real
 * AcroForm using the same 69 field names the field maps already reference.
 *
 * Two failure modes are silent and are what these tests exist to catch:
 *   1. A field name drifts, so a map points at nothing and the box stays blank
 *      on a statutory document nobody re-reads before filing.
 *   2. A group of checkboxes (gender, relationship, education, marital status)
 *      all render unticked because the value stored for them lost the
 *      discriminant that `checked_when` compares against.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { buildEpfDeclarationPdf, EPF_FORM_FIELD_NAMES } from "../src/modules/employees/epfDeclarationForm.js";
import { fillAcroFormPdf } from "../src/modules/employees/pdfAcroFormFill.service.js";

/**
 * Mirrors formatValueForField in universalDigitalFormFill.service.ts: a
 * checkbox map carrying `checked_when` must keep its raw value, because that
 * value is the discriminant selecting one box out of a group.
 */
function storedValue(raw: unknown, fieldType: string, checkedWhen?: string | null) {
  if (raw == null) return "";
  if (fieldType === "checkbox") return checkedWhen ? String(raw) : raw ? "Yes" : "";
  return String(raw);
}

type Map_ = { field_key: string; pdf_field_name: string; field_type: string; transform_rule?: string; checked_when?: string; mapping_mode: string };
const m = (pdf_field_name: string, field_type: string, extra: Partial<Map_> = {}): Map_ => ({
  field_key: pdf_field_name, pdf_field_name, field_type, mapping_mode: "acroform", ...extra,
});

async function buildToDisk(dir: string) {
  const file = path.join(dir, "EPF_DECLARATION-v1.pdf");
  fs.writeFileSync(file, await buildEpfDeclarationPdf());
  return file;
}

describe("EPF declaration form (Form 11)", () => {
  it("TC-EPF-01: exposes every field name the maps reference", async () => {
    const form = (await PDFDocument.load(await buildEpfDeclarationPdf())).getForm();
    const inPdf = form.getFields().map((f) => f.getName());
    const missing = EPF_FORM_FIELD_NAMES.filter((n) => !inPdf.includes(n));
    expect(missing, `maps would point at nothing: ${missing.join(", ")}`).toEqual([]);
    expect(inPdf).toHaveLength(EPF_FORM_FIELD_NAMES.length);
    // No duplicates — a repeated name silently overwrites the earlier field.
    expect(new Set(inPdf).size).toBe(inPdf.length);
  });

  it("TC-EPF-02: character boxes are comb fields, so a space occupies its own box", async () => {
    const form = (await PDFDocument.load(await buildEpfDeclarationPdf())).getForm();
    const combed = form.getFields().filter((f) => (f as { isCombed?: () => boolean }).isCombed?.());
    // Name, father's name, dates, mobile, UAN and the date-of-joining boxes.
    expect(combed.length).toBeGreaterThanOrEqual(20);
    const name = form.getTextField("employee_name");
    expect(name.isCombed()).toBe(true);
    expect(name.getMaxLength()).toBeGreaterThanOrEqual(30);
  });

  it("TC-EPF-03: a real signing payload lands in the right boxes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epf-"));
    try {
      const maps: Map_[] = [
        m("employee_name", "text"),
        m("dob_day", "text", { transform_rule: "date_day" }),
        m("dob_month", "text", { transform_rule: "date_month" }),
        m("dob_year_1", "text", { transform_rule: "date_year_1" }),
        m("dob_year_4", "text", { transform_rule: "date_year_4" }),
        m("doj_day", "text", { transform_rule: "date_day" }),
        m("doj_year", "text", { transform_rule: "date_year" }),
        m("uan", "text"),
        m("kyc_bank_ifsc", "text"),
      ];
      const values = [
        { field_key: "employee_name", value_text: "KAMAL SINGH RAWAT" },
        { field_key: "dob_day", value_text: "1994-03-07" },
        { field_key: "dob_month", value_text: "1994-03-07" },
        { field_key: "dob_year_1", value_text: "1994-03-07" },
        { field_key: "dob_year_4", value_text: "1994-03-07" },
        { field_key: "doj_day", value_text: "2017-01-19" },
        { field_key: "doj_year", value_text: "2017-01-19" },
        // Real UAN, captured at signing rather than the masked stored form.
        { field_key: "uan", value_text: "100987654321" },
        { field_key: "kyc_bank_ifsc", value_text: "HDFC0001234" },
      ];
      const out = await fillAcroFormPdf({ templatePath: await buildToDisk(dir), fieldMaps: maps, values });
      const form = (await PDFDocument.load(out)).getForm();

      expect(form.getTextField("employee_name").getText()).toBe("KAMAL SINGH RAWAT");
      expect(form.getTextField("dob_day").getText()).toBe("07");
      expect(form.getTextField("dob_month").getText()).toBe("03");
      expect(form.getTextField("dob_year_1").getText()).toBe("1");
      expect(form.getTextField("dob_year_4").getText()).toBe("4");
      expect(form.getTextField("doj_day").getText()).toBe("19");
      expect(form.getTextField("doj_year").getText()).toBe("2017");
      expect(form.getTextField("uan").getText()).toBe("100987654321");
      expect(form.getTextField("kyc_bank_ifsc").getText()).toBe("HDFC0001234");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TC-EPF-04: exactly one box ticks in each mutually exclusive group", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epf-cb-"));
    try {
      // Each group: [pdf field, checked_when, the value actually stored].
      const groups: Array<[string, string, unknown]>[] = [
        [["gender_male", "Male", "Male"], ["gender_female", "Female", "Male"], ["gender_other", "Other", "Male"]],
        [["relationship_father", "father", "father"], ["relationship_husband", "husband", "father"]],
        [["marital_status_married", "Married", "Married"], ["marital_status_unmarried", "Unmarried", "Married"]],
        [["education_graduate", "graduate", "graduate"], ["education_matric", "matric", "graduate"]],
        [["previous_pf_member_yes", "true", true], ["previous_pf_member_no", "true", false]],
      ];
      const maps: Map_[] = [];
      const values: Array<{ field_key: string; value_text: string }> = [];
      for (const group of groups) {
        for (const [name, checkedWhen, raw] of group) {
          maps.push(m(name, "checkbox", { checked_when: checkedWhen }));
          values.push({ field_key: name, value_text: storedValue(raw, "checkbox", checkedWhen) });
        }
      }
      const out = await fillAcroFormPdf({ templatePath: await buildToDisk(dir), fieldMaps: maps, values });
      const form = (await PDFDocument.load(out)).getForm();

      const ticked = maps.filter((map) => form.getCheckBox(map.pdf_field_name).isChecked()).map((map) => map.pdf_field_name);
      expect(ticked.sort()).toEqual([
        "education_graduate", "gender_male", "marital_status_married",
        "previous_pf_member_yes", "relationship_father",
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TC-EPF-05: collapsing a checkbox value to \"Yes\" leaves the whole group blank", async () => {
    // This is the defect the storedValue mirror above guards against: the old
    // behaviour returned "Yes" for any truthy checkbox, so "Male" never matched
    // checked_when and every gender box came out empty on the filed form.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epf-reg-"));
    try {
      const maps = [
        m("gender_male", "checkbox", { checked_when: "Male" }),
        m("gender_female", "checkbox", { checked_when: "Female" }),
      ];
      const out = await fillAcroFormPdf({
        templatePath: await buildToDisk(dir),
        fieldMaps: maps,
        values: maps.map((map) => ({ field_key: map.field_key, value_text: "Yes" })),
      });
      const form = (await PDFDocument.load(out)).getForm();
      expect(form.getCheckBox("gender_male").isChecked()).toBe(false);
      expect(form.getCheckBox("gender_female").isChecked()).toBe(false);
      // …whereas keeping the discriminant ticks the right one.
      expect(storedValue("Male", "checkbox", "Male")).toBe("Male");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
