import PDFDocument from "pdfkit";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  computeForm16Data,
  type Form16Data,
  type Form16Result,
} from "./form16-data.service.js";

/**
 * Form 16 / Form 130 Part B — the salary TDS certificate as an actual printable
 * document, not just a data table.
 *
 * Part B is what the employer produces: the salary breakup, the deductions
 * claimed, and the income chargeable under the head "Salaries". It is rendered
 * here in the layout of the statutory Part B annexure (Rule 31, Annexure II)
 * from the SAME figures the /form16-data endpoint returns — computeForm16Data
 * is the single source of truth, so the PDF and the on-screen data can never
 * disagree.
 *
 * What this deliberately does NOT do:
 *   - It does not invent Part A. Part A (tax deposited, challan/BSR codes,
 *     TRACES verification) comes from TRACES and is ingested separately; the
 *     certificate states Part A's status rather than fabricating it.
 *   - It does not invent the employer's TAN or address. Those are not stored in
 *     this system, and a tax certificate carrying a made-up TAN is worse than
 *     one that leaves it blank for payroll to complete. Missing fields render
 *     as an explicit blank line, never a guess.
 *   - It does not compute tax-on-total-income, rebate or cess. The system
 *     records the TDS actually deducted from payroll; it does not re-derive the
 *     year's tax liability, so the certificate reports what was deducted and
 *     leaves the tax computation to the values that exist.
 */

const COMPANY_NAME = "Mas Callnet India Pvt. Ltd.";

/** org_settings keys that populate the deductor/signatory block, when present. */
const SIGNATORY_KEYS = {
  name: "company_authorised_signatory_name",
  designation: "company_authorised_signatory_designation",
} as const;

interface DeductorBlock {
  companyName: string;
  signatoryName: string | null;
  signatoryDesignation: string | null;
}

async function loadDeductorBlock(): Promise<DeductorBlock> {
  const keys = [SIGNATORY_KEYS.name, SIGNATORY_KEYS.designation];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT setting_key, setting_value FROM org_settings WHERE setting_key IN (?, ?)`,
    keys,
  );
  const map = new Map(
    (rows as Array<{ setting_key: string; setting_value: string | null }>).map(
      (r) => [r.setting_key, r.setting_value],
    ),
  );
  const clean = (v: string | null | undefined) =>
    v && String(v).trim() !== "" ? String(v).trim() : null;
  return {
    companyName: COMPANY_NAME,
    signatoryName: clean(map.get(SIGNATORY_KEYS.name)),
    signatoryDesignation: clean(map.get(SIGNATORY_KEYS.designation)),
  };
}

const INR = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);

/** Assessment year is the year following the financial year the certificate covers. */
function assessmentYear(financialYear: string): string {
  // financial_year is "2025-2026"; AY is "2026-2027".
  const [start, end] = financialYear.split("-").map((s) => Number(s));
  if (Number.isFinite(start) && Number.isFinite(end)) {
    return `${end}-${end + 1}`;
  }
  return "";
}

/**
 * Render the Part B certificate for one employee/run to a PDF buffer.
 *
 * Returns the same discriminated failure kinds as computeForm16Data so the
 * route can map them to HTTP statuses; on success returns the PDF bytes plus
 * the resolved data (so the route can name the file and audit-log the figures).
 */
export type Form16CertificateResult =
  | { ok: true; pdf: Buffer; data: Form16Data; certificateLabel: string }
  | Exclude<Form16Result, { ok: true }>;

export async function generateForm16CertificatePdf(
  runId: string,
  employeeId: string,
): Promise<Form16CertificateResult> {
  const computed = await computeForm16Data(runId, employeeId);
  if (!computed.ok) return computed;

  const data = computed.data;
  const deductor = await loadDeductorBlock();
  const certificateLabel = data.statutory?.certificate_label ?? "Form 16";
  const pdf = await renderPdf(data, deductor, certificateLabel);
  return { ok: true, pdf, data, certificateLabel };
}

// ── Layout ───────────────────────────────────────────────────────────────────

const PAGE_MARGIN = 42;
const INK = "#0f172a";
const MUTED = "#475569";
const LINE = "#cbd5e1";
const HEADBG = "#f1f5f9";

function renderPdf(
  data: Form16Data,
  deductor: DeductorBlock,
  certificateLabel: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "A4" });
      const chunks: Buffer[] = [];
      doc.on("data", (c) =>
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
      );
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const left = PAGE_MARGIN;
      const right = doc.page.width - PAGE_MARGIN;
      const contentWidth = right - left;
      const blank = "____________________";

      // ── Title ────────────────────────────────────────────────────────────
      doc
        .fillColor(INK)
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(certificateLabel.toUpperCase(), left, PAGE_MARGIN, {
          width: contentWidth,
          align: "center",
        });
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor(MUTED)
        .text("PART B (Annexure) — Salary TDS certificate", {
          width: contentWidth,
          align: "center",
        });
      doc
        .fontSize(7.5)
        .text(
          `[See rule 31(1)(a)] — issued under section ${data.statutory?.salary_tds_section ?? "192"} of the ${data.statutory?.act ?? "Income-tax Act, 1961"}`,
          { width: contentWidth, align: "center" },
        );
      doc.moveDown(0.8);

      // ── Assessment/FY line ─────────────────────────────────────────────────
      const ayText = assessmentYear(data.financial_year);
      metaRow(doc, left, contentWidth, [
        ["Financial Year", data.financial_year || blank],
        ["Assessment Year", ayText || blank],
      ]);
      doc.moveDown(0.4);

      // ── Deductor / Employee two-column header ──────────────────────────────
      sectionTitle(
        doc,
        left,
        contentWidth,
        "1. Details of Employer (Deductor) and Employee (Deductee)",
      );
      const colGap = 16;
      const colW = (contentWidth - colGap) / 2;
      const topY = doc.y;

      const empName = data.employee?.name?.trim() || blank;
      const empPan = data.employee?.pan?.trim() || blank;
      const empDesig = data.employee?.designation?.trim() || "—";

      const leftLines: [string, string][] = [
        ["Employer", deductor.companyName],
        ["TAN of Employer", blank], // not stored in this system
        ["PAN of Employer", blank], // not stored in this system
        ["Address", blank], // not stored in this system
      ];
      const rightLines: [string, string][] = [
        ["Employee", empName],
        ["PAN of Employee", empPan],
        ["Designation", empDesig],
        ["Period with Employer", data.employee?.period ?? "—"],
      ];

      const leftBottom = keyValueBlock(doc, left, topY, colW, leftLines);
      const rightBottom = keyValueBlock(
        doc,
        left + colW + colGap,
        topY,
        colW,
        rightLines,
      );
      doc.y = Math.max(leftBottom, rightBottom) + 6;

      // ── Salary / income section ────────────────────────────────────────────
      sectionTitle(
        doc,
        left,
        contentWidth,
        "2. Details of Salary Paid and any other income and tax deducted",
      );

      const decl = data.declaration;
      const exemptS10 = decl ? Number(decl.hra) || 0 : 0;
      const chapterViA = decl
        ? (Number(decl["80c"]) || 0) + (Number(decl["80d"]) || 0)
        : 0;
      const s16Deductions = data.standard_deduction + data.professional_tax;

      // Gross salary as recorded in payroll for the year (annual actual).
      amountRow(
        doc,
        left,
        contentWidth,
        "1.",
        "Gross Salary (u/s 17) — annual actual",
        data.gross_salary,
        { strong: true },
      );
      amountRow(
        doc,
        left,
        contentWidth,
        "2.",
        "Less: Allowances exempt under section 10 (as declared: HRA)",
        exemptS10,
        { negative: true },
      );

      const balanceAfterS10 = Math.max(0, data.gross_salary - exemptS10);
      amountRow(
        doc,
        left,
        contentWidth,
        "3.",
        "Balance (1 - 2)",
        balanceAfterS10,
      );

      // Deductions under section 16
      subHeading(doc, left, contentWidth, "Deductions under section 16");
      amountRow(
        doc,
        left,
        contentWidth,
        "4(a).",
        "Standard deduction (section 16(ia))",
        data.standard_deduction,
        { negative: true, indent: true },
      );
      amountRow(
        doc,
        left,
        contentWidth,
        "4(b).",
        "Tax on employment / Professional tax (section 16(iii))",
        data.professional_tax,
        { negative: true, indent: true },
      );
      amountRow(
        doc,
        left,
        contentWidth,
        "5.",
        "Total deductions under section 16",
        s16Deductions,
        { negative: true },
      );

      const incomeUnderSalaries = Math.max(0, balanceAfterS10 - s16Deductions);
      amountRow(
        doc,
        left,
        contentWidth,
        "6.",
        "Income chargeable under the head 'Salaries' (3 - 5)",
        incomeUnderSalaries,
        { strong: true },
      );

      // Chapter VI-A
      subHeading(
        doc,
        left,
        contentWidth,
        "Deductions under Chapter VI-A (as declared)",
      );
      amountRow(
        doc,
        left,
        contentWidth,
        "7(a).",
        "Section 80C (as declared)",
        decl ? Number(decl["80c"]) || 0 : 0,
        { negative: true, indent: true },
      );
      amountRow(
        doc,
        left,
        contentWidth,
        "7(b).",
        "Section 80D (as declared)",
        decl ? Number(decl["80d"]) || 0 : 0,
        { negative: true, indent: true },
      );
      amountRow(
        doc,
        left,
        contentWidth,
        "8.",
        "Aggregate deductible amount under Chapter VI-A",
        chapterViA,
        { negative: true },
      );

      amountRow(
        doc,
        left,
        contentWidth,
        "9.",
        "Total taxable income",
        data.net_taxable_income,
        { strong: true, box: true },
      );

      doc.moveDown(0.4);
      amountRow(
        doc,
        left,
        contentWidth,
        "10.",
        `Tax deducted at source (TDS) and deposited — as deducted from payroll`,
        data.tds_deducted,
        { strong: true, box: true },
      );

      // Regime note
      if (decl?.regime) {
        doc
          .font("Helvetica")
          .fontSize(7.5)
          .fillColor(MUTED)
          .text(
            `Tax regime as declared by the employee: ${String(decl.regime).toUpperCase()}.`,
            left,
            doc.y + 4,
            { width: contentWidth },
          );
      }
      doc.moveDown(0.6);

      // ── Basis / partial year note ──────────────────────────────────────────
      const basis = data.basis;
      if (basis) {
        const monthsNote =
          `Figures are the actual amounts paid and deducted across ` +
          `${basis.months_paid} of 12 month(s)` +
          (basis.first_month && basis.last_month
            ? ` (${basis.first_month} to ${basis.last_month}).`
            : ".");
        note(
          doc,
          left,
          contentWidth,
          basis.is_partial_year
            ? `${monthsNote} This covers part of the year — correct for a mid-year joiner or leaver; otherwise a payroll run for this year may still be unfinalized.`
            : monthsNote,
        );
      }

      // ── Part A status ──────────────────────────────────────────────────────
      sectionTitle(
        doc,
        left,
        contentWidth,
        "3. Part A (tax deposited, challan/BSR, TRACES verification)",
      );
      const partA = data.part_a;
      const partALine =
        partA?.status === "verified"
          ? `Part A is on file and verified${partA.certificate_number ? ` (Certificate no. ${partA.certificate_number})` : ""}${partA.covers_quarters ? `, covering ${partA.covers_quarters}` : ""}. It is issued by TRACES and provided separately.`
          : partA?.status === "awaiting_verification"
            ? "Part A has been uploaded but is not yet verified by payroll, and is therefore not part of this certificate yet."
            : "Part A has not been uploaded. It is issued by TRACES once the quarterly returns for the year are filed, and cannot be generated here.";
      note(doc, left, contentWidth, partALine);
      if (!data.is_complete) {
        note(
          doc,
          left,
          contentWidth,
          "This document is the Part B (employer) half of the salary TDS certificate. It is complete as a Part B, but a full certificate also requires the TRACES-issued Part A above.",
          { warn: true },
        );
      }

      // ── Verification / signatory ───────────────────────────────────────────
      doc.moveDown(0.8);
      sectionTitle(doc, left, contentWidth, "4. Verification");
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(INK)
        .text(
          `I, ${deductor.signatoryName ?? blank}, ${deductor.signatoryDesignation ? `holding the position of ${deductor.signatoryDesignation}, ` : ""}` +
            `working for ${deductor.companyName}, do hereby certify that the information given above is based on the books of account, ` +
            `documents, TDS statements, and other available records, for the financial year ${data.financial_year}.`,
          left,
          doc.y + 2,
          { width: contentWidth, align: "justify" },
        );

      doc.moveDown(2.2);
      const sigColW = (contentWidth - colGap) / 2;
      const sigY = doc.y;
      doc.font("Helvetica").fontSize(8).fillColor(INK);
      doc.text("Place: ____________________", left, sigY, { width: sigColW });
      doc.text(
        `Date: ${new Date().toLocaleDateString("en-IN")}`,
        left,
        sigY + 16,
        { width: sigColW },
      );

      doc.text("____________________________", left + sigColW + colGap, sigY, {
        width: sigColW,
        align: "center",
      });
      doc.text(
        deductor.signatoryName ??
          "Signature of person responsible for deduction",
        left + sigColW + colGap,
        sigY + 14,
        { width: sigColW, align: "center" },
      );
      if (deductor.signatoryDesignation) {
        doc
          .fillColor(MUTED)
          .fontSize(7.5)
          .text(
            deductor.signatoryDesignation,
            left + sigColW + colGap,
            sigY + 26,
            {
              width: sigColW,
              align: "center",
            },
          );
      }

      // ── Footer ─────────────────────────────────────────────────────────────
      doc
        .font("Helvetica")
        .fontSize(6.5)
        .fillColor(MUTED)
        .text(
          `System-generated ${certificateLabel} Part B from MAS PeopleOS HRMS. Amounts in INR. ` +
            `Generated on ${new Date().toISOString().slice(0, 10)}. This is the employer-computed Part B; Part A is issued by TRACES.`,
          left,
          doc.page.height - PAGE_MARGIN - 18,
          { width: contentWidth, align: "center" },
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Drawing helpers ────────────────────────────────────────────────────────

function sectionTitle(
  doc: PDFKit.PDFDocument,
  left: number,
  width: number,
  text: string,
) {
  const y = doc.y;
  doc.save().rect(left, y, width, 15).fill(HEADBG).restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(INK)
    .text(text, left + 5, y + 4, { width: width - 10 });
  doc.y = y + 19;
}

function subHeading(
  doc: PDFKit.PDFDocument,
  left: number,
  width: number,
  text: string,
) {
  doc
    .font("Helvetica-Bold")
    .fontSize(7.8)
    .fillColor(MUTED)
    .text(text, left, doc.y + 2, { width });
  doc.y += 2;
}

function metaRow(
  doc: PDFKit.PDFDocument,
  left: number,
  width: number,
  pairs: [string, string][],
) {
  const y = doc.y;
  const colW = width / pairs.length;
  pairs.forEach(([label, value], i) => {
    const x = left + i * colW;
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(MUTED)
      .text(`${label}: `, x, y, { continued: true });
    doc.font("Helvetica").fillColor(INK).text(value);
  });
  doc.y = y + 14;
}

/** A stacked key/value block in a fixed column; returns the bottom Y. */
function keyValueBlock(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  lines: [string, string][],
): number {
  let cursor = y;
  for (const [label, value] of lines) {
    doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(label, x, cursor, { width });
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(INK)
      .text(value, x, cursor + 9, { width });
    cursor += 24;
  }
  return cursor;
}

function amountRow(
  doc: PDFKit.PDFDocument,
  left: number,
  width: number,
  sno: string,
  label: string,
  amount: number,
  opts: {
    strong?: boolean;
    negative?: boolean;
    indent?: boolean;
    box?: boolean;
  } = {},
) {
  const rowH = 15;
  const y = doc.y;
  if (opts.box) {
    doc
      .save()
      .rect(left, y - 1, width, rowH + 1)
      .fill(HEADBG)
      .restore();
  }
  const snoX = left + (opts.indent ? 14 : 2);
  const labelX = snoX + 34;
  const amtColW = 110;
  const labelW = width - (labelX - left) - amtColW - 6;

  doc
    .font(opts.strong ? "Helvetica-Bold" : "Helvetica")
    .fontSize(8)
    .fillColor(MUTED);
  doc.text(sno, snoX, y + 3, { width: 32 });
  doc.fillColor(INK).font(opts.strong ? "Helvetica-Bold" : "Helvetica");
  doc.text(label, labelX, y + 3, { width: labelW });

  const shown = `${opts.negative && amount > 0 ? "(-) " : ""}${INR(amount)}`;
  doc
    .font(opts.strong ? "Helvetica-Bold" : "Helvetica")
    .fillColor(INK)
    .text(shown, left + width - amtColW - 2, y + 3, {
      width: amtColW,
      align: "right",
    });

  // Row separator
  doc
    .save()
    .moveTo(left, y + rowH)
    .lineTo(left + width, y + rowH)
    .lineWidth(0.4)
    .strokeColor(LINE)
    .stroke()
    .restore();
  doc.y = y + rowH + 2;
}

function note(
  doc: PDFKit.PDFDocument,
  left: number,
  width: number,
  text: string,
  opts: { warn?: boolean } = {},
) {
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(opts.warn ? "#92400e" : MUTED)
    .text(text, left, doc.y + 2, { width, align: "left" });
  doc.y += 2;
}
