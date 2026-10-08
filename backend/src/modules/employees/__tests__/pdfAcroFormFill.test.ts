import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import {
  fillAcroFormPdf,
  inspectAcroFormFieldsFromPdfBytes,
  validateAcroFormTemplate,
} from "../pdfAcroFormFill.service.js";
import fs from "fs";
import os from "os";
import path from "path";

async function makeTemplate(fields: Array<{ name: string; type?: "text" | "checkbox" }>) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const form = pdfDoc.getForm();
  fields.forEach((field, index) => {
    if (field.type === "checkbox") {
      form.createCheckBox(field.name).addToPage(page, { x: 50, y: 780 - index * 24, width: 12, height: 12 });
    } else {
      form.createTextField(field.name).addToPage(page, { x: 50, y: 780 - index * 24, width: 180, height: 18 });
    }
  });
  return Buffer.from(await pdfDoc.save());
}

function tempPdf(bytes: Buffer) {
  const file = path.join(os.tmpdir(), `hrms2-acro-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  fs.writeFileSync(file, bytes);
  return file;
}

const maps = [
  { field_key: "employee_name", pdf_field_name: "employee_name", mapping_mode: "acroform", field_type: "text", required: true, max_font_size: 9, min_font_size: 5 },
  { field_key: "dob_day", pdf_field_name: "dob_day", mapping_mode: "acroform", field_type: "text", required: true, transform_rule: "date_day" },
  { field_key: "dob_month", pdf_field_name: "dob_month", mapping_mode: "acroform", field_type: "text", required: true, transform_rule: "date_month" },
  { field_key: "dob_year_1", pdf_field_name: "dob_year_1", mapping_mode: "acroform", field_type: "text", required: true, transform_rule: "date_year_1" },
  { field_key: "gender_male", pdf_field_name: "gender_male", mapping_mode: "acroform", field_type: "checkbox", required: true, checked_when: "Male" },
];

describe("PdfAcroFormFillService", () => {
  it("detects named AcroForm fields", async () => {
    const bytes = await makeTemplate([{ name: "employee_name" }, { name: "gender_male", type: "checkbox" }]);
    const fields = await inspectAcroFormFieldsFromPdfBytes(bytes, maps);
    expect(fields.map((field) => field.fieldName)).toContain("employee_name");
    expect(fields.find((field) => field.fieldName === "gender_male")?.fieldType).toBe("checkbox");
  });

  it("blocks generation when a required mapped field is missing", async () => {
    const file = tempPdf(await makeTemplate([{ name: "employee_name" }]));
    const result = await validateAcroFormTemplate(file, maps);
    expect(result.valid).toBe(false);
    expect(result.missingRequiredFields.map((field) => field.fieldName)).toContain("dob_day");
  });

  it("fills preview by field name and keeps fields editable", async () => {
    const file = tempPdf(await makeTemplate([
      { name: "employee_name" },
      { name: "dob_day" },
      { name: "dob_month" },
      { name: "dob_year_1" },
      { name: "gender_male", type: "checkbox" },
    ]));
    const output = await fillAcroFormPdf({
      templatePath: file,
      fieldMaps: maps,
      values: [
        { field_key: "employee_name", value_text: "SOFIYA SULTAN" },
        { field_key: "dob_day", value_text: "1995-01-05" },
        { field_key: "dob_month", value_text: "1995-01-05" },
        { field_key: "dob_year_1", value_text: "1995-01-05" },
        { field_key: "gender_male", value_text: "Male" },
      ],
      flatten: false,
    });
    const loaded = await PDFDocument.load(output);
    const form = loaded.getForm();
    expect(form.getTextField("employee_name").getText()).toBe("SOFIYA SULTAN");
    expect(form.getTextField("dob_day").getText()).toBe("05");
    expect(form.getTextField("dob_month").getText()).toBe("01");
    expect(form.getTextField("dob_year_1").getText()).toBe("1");
    expect(form.getCheckBox("gender_male").isChecked()).toBe(true);
  });

  it("flattens final PDF fields", async () => {
    const file = tempPdf(await makeTemplate([{ name: "employee_name" }]));
    const output = await fillAcroFormPdf({
      templatePath: file,
      fieldMaps: [maps[0]],
      values: [{ field_key: "employee_name", value_text: "A VERY LONG EMPLOYEE NAME FOR AUTOSHRINK" }],
      flatten: true,
    });
    const loaded = await PDFDocument.load(output);
    expect(loaded.getForm().getFields()).toHaveLength(0);
  });
});
