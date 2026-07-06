import fs from "fs";
import path from "path";
import pdfLib from "pdf-lib";
const { PDFDocument, PDFCheckBox, PDFTextField, StandardFonts } = pdfLib;
import type { RowDataPacket } from "mysql2";

type FieldMapLike = RowDataPacket | Record<string, unknown>;

export type AcroFormFieldInfo = {
  fieldName: string;
  fieldType: "text" | "checkbox" | "radio" | "dropdown" | "option_list" | "button" | "signature" | "unknown";
  pageNumber: number | null;
  mapped: boolean;
  required: boolean;
  missing: boolean;
};

export type AcroFormValidationIssue = {
  fieldName: string;
  fieldKey?: string;
  severity: "error" | "warning";
  message: string;
};

export type AcroFormValidationResult = {
  valid: boolean;
  templateFieldCount: number;
  mappedFieldCount: number;
  missingRequiredFields: AcroFormValidationIssue[];
  missingMappedFields: AcroFormValidationIssue[];
  fields: AcroFormFieldInfo[];
};

type FillValue = {
  field_key: string;
  value_text: string | null;
};

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function asBool(value: unknown) {
  const normalized = normalize(value).toLowerCase();
  return ["1", "true", "yes", "y", "checked", "x"].includes(normalized);
}

function fieldName(map: FieldMapLike) {
  return normalize(map.pdf_field_name ?? map.field_key);
}

function fieldKey(map: FieldMapLike) {
  return normalize(map.field_key);
}

function fieldValue(valuesByKey: Map<string, string>, map: FieldMapLike) {
  return valuesByKey.get(fieldKey(map)) ?? "";
}

function fieldTypeOf(field: unknown): AcroFormFieldInfo["fieldType"] {
  const ctor = field && typeof field === "object" ? (field as { constructor?: { name?: string } }).constructor?.name : "";
  if (ctor === "PDFTextField") return "text";
  if (ctor === "PDFCheckBox") return "checkbox";
  if (ctor === "PDFRadioGroup") return "radio";
  if (ctor === "PDFDropdown") return "dropdown";
  if (ctor === "PDFOptionList") return "option_list";
  if (ctor === "PDFButton") return "button";
  if (ctor === "PDFSignature") return "signature";
  return "unknown";
}

function splitIsoDate(value: string) {
  const match = normalize(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { day: "", month: "", year: "" };
  return { year: match[1] ?? "", month: match[2] ?? "", day: match[3] ?? "" };
}

export function applyTransformRule(value: unknown, transformRule?: unknown) {
  const text = normalize(value);
  const rule = normalize(transformRule);
  if (!rule) return text;
  const date = splitIsoDate(text);
  if (rule === "date_day") return date.day;
  if (rule === "date_month") return date.month;
  if (rule === "date_year") return date.year;
  const yearCharMatch = rule.match(/^date_year_(\d)$/);
  if (yearCharMatch) return date.year.charAt(Number(yearCharMatch[1]) - 1);
  if (rule === "digits_only") return text.replace(/\D/g, "");
  if (rule === "aadhaar_last4") return text.replace(/\D/g, "").slice(-4);
  if (rule === "uppercase") return text.toUpperCase();
  return text;
}

export function inspectAcroFormFieldsFromPdfBytes(pdfBytes: Uint8Array, fieldMaps: FieldMapLike[] = []): Promise<AcroFormFieldInfo[]> {
  return PDFDocument.load(pdfBytes).then((pdfDoc) => {
    const form = pdfDoc.getForm();
    const mapped = new Map(fieldMaps.map((map) => [fieldName(map), map]));
    const pageRefs = new Map(pdfDoc.getPages().map((page, index) => [page.ref, index + 1]));
    return form.getFields().map((field) => {
      const name = field.getName();
      const widgets = field.acroField.getWidgets();
      const pageNumber = widgets[0]?.P() ? pageRefs.get(widgets[0].P()!) ?? null : null;
      const map = mapped.get(name);
      return {
        fieldName: name,
        fieldType: fieldTypeOf(field),
        pageNumber,
        mapped: Boolean(map),
        required: Boolean(map?.required),
        missing: false,
      };
    });
  });
}

export async function inspectAcroFormTemplate(templatePath: string, fieldMaps: FieldMapLike[] = []) {
  return inspectAcroFormFieldsFromPdfBytes(fs.readFileSync(templatePath), fieldMaps);
}

export async function validateAcroFormTemplate(templatePath: string, fieldMaps: FieldMapLike[]): Promise<AcroFormValidationResult> {
  const fields = await inspectAcroFormTemplate(templatePath, fieldMaps);
  const templateNames = new Set(fields.map((field) => field.fieldName));
  const missingMappedFields: AcroFormValidationIssue[] = [];
  const missingRequiredFields: AcroFormValidationIssue[] = [];

  for (const map of fieldMaps) {
    if (normalize(map.mapping_mode) !== "acroform") continue;
    const pdfFieldName = fieldName(map);
    if (!pdfFieldName || templateNames.has(pdfFieldName)) continue;
    const issue: AcroFormValidationIssue = {
      fieldName: pdfFieldName,
      fieldKey: fieldKey(map),
      severity: map.required ? "error" : "warning",
      message: `PDF field '${pdfFieldName}' is mapped but missing from the AcroForm template.`,
    };
    missingMappedFields.push(issue);
    if (map.required) missingRequiredFields.push(issue);
    fields.push({
      fieldName: pdfFieldName,
      fieldType: normalize(map.field_type) === "checkbox" ? "checkbox" : "text",
      pageNumber: null,
      mapped: true,
      required: Boolean(map.required),
      missing: true,
    });
  }

  return {
    valid: missingRequiredFields.length === 0,
    templateFieldCount: fields.filter((field) => !field.missing).length,
    mappedFieldCount: fieldMaps.filter((map) => normalize(map.mapping_mode) === "acroform").length,
    missingRequiredFields,
    missingMappedFields,
    fields,
  };
}

function setFieldFontSize(textField: PDFTextField, text: string, maxFontSize: number, minFontSize: number) {
  const widgets = textField.acroField.getWidgets();
  const rect = widgets[0]?.getRectangle();
  if (!rect) {
    textField.setFontSize(maxFontSize);
    return;
  }
  const availableWidth = Math.max(10, rect.width - 4);
  const estimatedCharWidth = 0.56;
  for (let size = maxFontSize; size >= minFontSize; size -= 0.5) {
    if (text.length * size * estimatedCharWidth <= availableWidth) {
      textField.setFontSize(size);
      return;
    }
  }
  textField.setFontSize(minFontSize);
}

export async function fillAcroFormPdf(params: {
  templatePath: string;
  fieldMaps: FieldMapLike[];
  values: FillValue[];
  flatten?: boolean;
}) {
  const validation = await validateAcroFormTemplate(params.templatePath, params.fieldMaps);
  if (!validation.valid) {
    const error = new Error("EPF AcroForm template validation failed: required fields are missing.");
    (error as Error & { validation?: AcroFormValidationResult }).validation = validation;
    throw error;
  }

  const pdfDoc = await PDFDocument.load(fs.readFileSync(params.templatePath));
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const valuesByKey = new Map(params.values.map((value) => [value.field_key, normalize(value.value_text)]));

  for (const map of params.fieldMaps) {
    if (normalize(map.mapping_mode) !== "acroform") continue;
    const name = fieldName(map);
    if (!name) continue;
    const rawValue = fieldValue(valuesByKey, map);
    const value = applyTransformRule(rawValue, map.transform_rule);
    const fieldType = normalize(map.field_type);
    const checkedWhen = normalize(map.checked_when);
    if (fieldType === "checkbox") {
      const checkbox = form.getCheckBox(name);
      const shouldCheck = checkedWhen ? normalize(value).toLowerCase() === checkedWhen.toLowerCase() : asBool(value);
      if (shouldCheck) checkbox.check();
      else checkbox.uncheck();
      continue;
    }

    const textField = form.getTextField(name);
    textField.setText(value);
    setFieldFontSize(textField, value, Number(map.max_font_size ?? map.font_size ?? 9), Number(map.min_font_size ?? 5));
  }

  form.updateFieldAppearances(font);
  if (params.flatten) form.flatten();
  return Buffer.from(await pdfDoc.save());
}

export async function createFillableEpfTemplateFromBase(params: {
  inputPath: string;
  outputPath: string;
  fieldMaps: Array<FieldMapLike & { x?: number; y?: number; width?: number; height?: number; page_no?: number }>;
}) {
  const pdfDoc = await PDFDocument.load(fs.readFileSync(params.inputPath));
  const form = pdfDoc.getForm();
  const pages = pdfDoc.getPages();
  for (const map of params.fieldMaps) {
    const name = fieldName(map);
    if (!name || map.x == null || map.y == null || map.width == null || map.height == null) continue;
    const page = pages[Math.max(0, Number(map.page_no ?? 1) - 1)];
    if (!page) continue;
    if (normalize(map.field_type) === "checkbox") {
      const checkbox = form.createCheckBox(name);
      checkbox.addToPage(page, { x: Number(map.x), y: Number(map.y), width: Number(map.width), height: Number(map.height) });
    } else {
      const text = form.createTextField(name);
      text.addToPage(page, { x: Number(map.x), y: Number(map.y), width: Number(map.width), height: Number(map.height) });
      text.setFontSize(Number(map.max_font_size ?? map.font_size ?? 9));
    }
  }
  form.updateFieldAppearances(await pdfDoc.embedFont(StandardFonts.Helvetica));
  fs.mkdirSync(path.dirname(params.outputPath), { recursive: true });
  fs.writeFileSync(params.outputPath, await pdfDoc.save());
}
