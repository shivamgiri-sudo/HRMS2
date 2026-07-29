/**
 * Guards the fillable EPF Form 2 (nomination and declaration).
 *
 * Built rather than downloaded because the EPFO-issued PDF is a flat scan with
 * no form fields, so nothing can be written into it.
 *
 * The split that matters and is easy to regress: Part A (provident fund) is
 * auto-filled from employee_nominee, but Part B (pension family) is NOT, because
 * no pension-family records exist — nominee_for only ever contains
 * 'gratuity,pf'. Deriving a family from the PF nominee would put a false
 * statutory declaration in front of a member for signature, so every Part B map
 * must stay source-less.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { PDFDocument } from "pdf-lib";
import {
  buildEpfNominationPdf,
  epfNominationFieldMaps,
  EPF_NOMINATION_FIELD_NAMES,
} from "../src/modules/employees/epfNominationForm.js";
import { fillAcroFormPdf } from "../src/modules/employees/pdfAcroFormFill.service.js";

async function buildToDisk(dir: string) {
  const file = path.join(dir, "EPF_NOMINATION_FORM2-v1.pdf");
  fs.writeFileSync(file, await buildEpfNominationPdf());
  return file;
}

/** Mirrors formatValueForField: a checkbox with checked_when keeps its raw value. */
function storedValue(raw: unknown, fieldType?: string, checkedWhen?: string | null) {
  if (raw == null) return "";
  if (fieldType === "checkbox") return checkedWhen ? String(raw) : raw ? "Yes" : "";
  return String(raw);
}

describe("EPF nomination form (Form 2)", () => {
  it("TC-NOM-01: every mapped field exists in the PDF, and nothing is orphaned", async () => {
    const form = (await PDFDocument.load(await buildEpfNominationPdf())).getForm();
    const inPdf = form.getFields().map((f) => f.getName());
    const mapped = epfNominationFieldMaps().map((m) => m.pdf_field_name);

    const missing = mapped.filter((n) => !inPdf.includes(n));
    expect(missing, `maps would point at nothing: ${missing.join(", ")}`).toEqual([]);
    const orphaned = inPdf.filter((n) => !mapped.includes(n));
    expect(orphaned, `fields nothing ever fills: ${orphaned.join(", ")}`).toEqual([]);
    expect(new Set(inPdf).size).toBe(inPdf.length);
    expect([...EPF_NOMINATION_FIELD_NAMES].sort()).toEqual([...inPdf].sort());
  });

  it("TC-NOM-02: Part B carries no source path, so no family is ever invented", () => {
    // If this fails, someone has wired pension-family boxes to data that does
    // not describe a family — a false declaration on a signed statutory form.
    const partB = epfNominationFieldMaps().filter((m) =>
      /^family_\d+_|^eps_nominee_/.test(m.pdf_field_name),
    );
    expect(partB.length).toBeGreaterThanOrEqual(20);
    for (const map of partB) {
      expect(map.source_path, `${map.pdf_field_name} must be member-completed`).toBeNull();
    }
  });

  it("TC-NOM-03: a real nominee lands in the Part A row", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nom-"));
    try {
      const maps = epfNominationFieldMaps().map((m) => ({ ...m, mapping_mode: "acroform" }));
      // What buildSourceContext produces for an employee with one PF nominee.
      const source: Record<string, unknown> = {
        "epf.employee_name": "KAMAL SINGH RAWAT",
        "epf.father_or_spouse_name": "RAMESH SINGH RAWAT",
        "epf.relationship_type": "father",
        "epf.date_of_birth": "1994-03-07",
        "epf.gender": "Male",
        "epf.marital_status": "Married",
        "epf.uan_masked": "100987654321",
        "epf.branch_name_snapshot": "NOIDA-2",
        "employee.permanent_address": "H.No. 214, Sector 12, Noida, Uttar Pradesh, 201301",
        "employee.current_address": "Flat 9B, Sector 62, Noida, Uttar Pradesh, 201309",
        "nominee.n1_name": "RAMESH SINGH RAWAT",
        "nominee.n1_relationship": "Father",
        "nominee.n1_date_of_birth": "1966-11-02",
        "nominee.n1_share_percentage": "100",
        "nominee.n1_address": "H.No. 214, Sector 12, Noida",
        "nominee.n1_guardian_name": null,
        "system.current_date": "2026-07-29",
        "system.company_name": "Mas Callnet India Pvt. Ltd.",
      };
      const values = maps.map((m) => ({
        field_key: m.field_key,
        value_text: storedValue(source[String(m.source_path ?? "")], m.field_type, m.checked_when),
      }));

      const out = await fillAcroFormPdf({ templatePath: await buildToDisk(dir), fieldMaps: maps, values });
      const form = (await PDFDocument.load(out)).getForm();

      expect(form.getTextField("member_name").getText()).toBe("KAMAL SINGH RAWAT");
      expect(form.getTextField("dob_day").getText()).toBe("07");
      expect(form.getTextField("dob_year").getText()).toBe("1994");
      expect(form.getTextField("permanent_address").getText()).toContain("Sector 12");
      expect(form.getTextField("temporary_address").getText()).toContain("Sector 62");

      // The nominee row — the whole point of this form.
      expect(form.getTextField("nominee_1_name").getText()).toBe("RAMESH SINGH RAWAT");
      expect(form.getTextField("nominee_1_relationship").getText()).toBe("Father");
      expect(form.getTextField("nominee_1_share").getText()).toBe("100");
      // A major nominee must not carry a guardian.
      expect(form.getTextField("nominee_1_guardian").getText() ?? "").toBe("");

      expect(form.getCheckBox("relationship_father").isChecked()).toBe(true);
      expect(form.getCheckBox("relationship_husband").isChecked()).toBe(false);
      expect(form.getCheckBox("gender_male").isChecked()).toBe(true);
      expect(form.getCheckBox("marital_status_married").isChecked()).toBe(true);
      expect(form.getCheckBox("marital_status_unmarried").isChecked()).toBe(false);

      // Part B stays empty for the member to complete.
      expect(form.getTextField("family_1_name").getText() ?? "").toBe("");
      expect(form.getTextField("eps_nominee_name").getText() ?? "").toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TC-NOM-04: unused nominee rows stay blank rather than repeating row 1", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nom2-"));
    try {
      const maps = epfNominationFieldMaps().map((m) => ({ ...m, mapping_mode: "acroform" }));
      const values = maps.map((m) => ({
        field_key: m.field_key,
        value_text: m.field_key === "nominee_1_name" ? "RAMESH SINGH RAWAT" : "",
      }));
      const out = await fillAcroFormPdf({ templatePath: await buildToDisk(dir), fieldMaps: maps, values });
      const form = (await PDFDocument.load(out)).getForm();
      expect(form.getTextField("nominee_1_name").getText()).toBe("RAMESH SINGH RAWAT");
      for (const n of [2, 3, 4]) {
        expect(form.getTextField(`nominee_${n}_name`).getText() ?? "").toBe("");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
