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

  it("TC-NOM-02: Part B is member-declared and never derived from the nominee", () => {
    // Part B used to require source_path === null, because the only family-shaped
    // data we held was the PF nominee and copying it across would have been a
    // false declaration on a signed statutory form. The candidate now declares
    // their family during onboarding, so Part B has a legitimate source — but
    // the original hazard is unchanged and is what this still guards.
    //
    // If this fails, someone has wired pension-family boxes to data that does
    // not describe a family the member actually declared.
    const partB = epfNominationFieldMaps().filter((m) =>
      /^family_\d+_|^eps_nominee_/.test(m.pdf_field_name),
    );
    expect(partB.length).toBeGreaterThanOrEqual(20);
    for (const map of partB) {
      // Only the member-declared namespaces are admissible here.
      expect(
        map.source_path,
        `${map.pdf_field_name} must come from the declared family, not ${map.source_path}`,
      ).toMatch(/^(family\.f[1-4]_|eps_nominee\.)/);
      // The specific hazard: a nominee is not a family member.
      expect(
        map.source_path,
        `${map.pdf_field_name} must never be derived from the PF nominee`,
      ).not.toMatch(/^nominee\./);
    }
  });

  it("TC-NOM-02b: Part A nominee boxes never read the declared family", () => {
    // The converse mistake: filling a PF nomination from the pension family
    // would nominate people the member never nominated.
    const partA = epfNominationFieldMaps().filter((m) => /^nominee_\d+_/.test(m.pdf_field_name));
    expect(partA.length).toBeGreaterThanOrEqual(20);
    for (const map of partA) {
      expect(map.source_path, `${map.pdf_field_name} must read a nominee`).toMatch(/^nominee\.n[1-4]_/);
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

      // This member declared no family, so Part B stays empty for them to
      // complete at signing — and in particular the Part A nominee above does
      // NOT bleed into it. TC-NOM-04 covers the case where a family exists.
      expect(form.getTextField("family_1_name").getText() ?? "").toBe("");
      expect(form.getTextField("eps_nominee_name").getText() ?? "").toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TC-NOM-04: a declared family lands in the Part B rows", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nom-"));
    try {
      const maps = epfNominationFieldMaps().map((m) => ({ ...m, mapping_mode: "acroform" }));
      // What buildSourceContext produces once the candidate has declared a
      // family during onboarding. The nominee is deliberately a different person
      // from every family member, so any bleed between the parts is visible.
      const source: Record<string, unknown> = {
        "epf.employee_name": "KAMAL SINGH RAWAT",
        "nominee.n1_name": "RAMESH SINGH RAWAT",
        "nominee.n1_relationship": "Father",
        "family.f1_name": "SUNITA RAWAT",
        "family.f1_relationship": "Spouse",
        "family.f1_date_of_birth": "1996-05-21",
        "family.f1_address": "H.No. 214, Sector 12, Noida",
        "family.f2_name": "AARAV RAWAT",
        "family.f2_relationship": "Son",
        "family.f2_date_of_birth": "2019-01-09",
        "eps_nominee.name": "SUNITA RAWAT",
        "eps_nominee.relationship": "Spouse",
        "eps_nominee.date_of_birth": "1996-05-21",
        "eps_nominee.address": "H.No. 214, Sector 12, Noida",
        "system.current_date": "2026-07-29",
      };
      const values = maps.map((m) => ({
        field_key: m.field_key,
        value_text: storedValue(source[String(m.source_path ?? "")], m.field_type, m.checked_when),
      }));

      const out = await fillAcroFormPdf({ templatePath: await buildToDisk(dir), fieldMaps: maps, values });
      const form = (await PDFDocument.load(out)).getForm();

      expect(form.getTextField("family_1_name").getText()).toBe("SUNITA RAWAT");
      expect(form.getTextField("family_1_relationship").getText()).toBe("Spouse");
      expect(form.getTextField("family_1_address").getText()).toContain("Sector 12");
      expect(form.getTextField("family_2_name").getText()).toBe("AARAV RAWAT");
      // An undeclared row stays blank rather than repeating an earlier member.
      expect(form.getTextField("family_3_name").getText() ?? "").toBe("");

      // The EPS date splits across its three boxes via the transform rules.
      expect(form.getTextField("eps_nominee_name").getText()).toBe("SUNITA RAWAT");
      expect(form.getTextField("eps_nominee_dob_day").getText()).toBe("21");
      expect(form.getTextField("eps_nominee_dob_month").getText()).toBe("05");
      expect(form.getTextField("eps_nominee_dob_year").getText()).toBe("1996");

      // Part A is untouched by any of it: the nominee is still the nominee.
      expect(form.getTextField("nominee_1_name").getText()).toBe("RAMESH SINGH RAWAT");
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
