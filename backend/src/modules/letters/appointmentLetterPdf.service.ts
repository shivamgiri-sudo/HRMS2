/**
 * Renders the MAS Callnet appointment letter as a PDF.
 *
 * A PDF is required rather than optional: the company DSC signs a PDF byte
 * range, and the employee's Aadhaar eSign also operates on a PDF. The existing
 * letters system emits HTML only (letters-render.service.ts) and the repo has no
 * HTML-to-PDF converter — no puppeteer, no libreoffice — so the letter could
 * never have been signed at all.
 *
 * Content follows the real issued letter (verified against the copy for
 * MAS60616): terms 1-9, the 17-line remuneration table, and Annexure-I.
 *
 * Two layout rules exist for signature reasons, not aesthetics:
 *
 *   RESERVE.band (180pt) is kept clear at the foot of every page. The Aadhaar
 *   provider stamps the employee's signature at Rect [425,100,545,160] on the
 *   LAST page — measured from a real signed contract, not assumed — and body
 *   text flowing into that band is exactly what produced the overlapping
 *   signature originally reported.
 *
 *   The company signature block sits on the left of that band, so the two
 *   signatures cannot collide.
 */
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { PDFDocument as PDFLibDocument, StandardFonts, rgb } from "pdf-lib";
import type { BranchLetterhead } from "../org/branchAddress.service.js";
import type { AppointmentLetterSalary } from "./appointmentLetterData.service.js";
import { istDisplayDate, istTimestamp } from "./letterFormat.js";

const COMPANY_NAME = "Mas Callnet India Pvt. Ltd.";
const PAGE = { size: "A4" as const, margin: 56 };
const INK = "#111827";
const MUTED = "#6B7280";
const ACCENT = "#0EA5E9";

/**
 * Whitespace held clear on the SIGNATURE page.
 *
 * Must clear y=160: the provider's widget occupies y 100-160. 120pt — the value
 * planned before measuring — would still have been overlapped.
 *
 * Applied to the final page only. The provider stamps the last page (page 4 of 4
 * in the real signed contract), and reserving it on every page left barely 60%
 * of each page usable, turning a five-page letter into fifteen.
 */
export const RESERVE = { band: 180 };

/** Ordinary bottom margin for body pages: enough for the footer, nothing more. */
const BODY_BOTTOM = 70;

export type AppointmentLetterInput = {
  employeeName: string;
  employeeCode: string;
  designation: string;
  dateOfJoining: Date | string | null;
  issueDate?: Date;
  letterNumber: string;
  verificationUrl: string;
  qrPngDataUrl?: string | null;
  letterhead: BranchLetterhead;
  salary: AppointmentLetterSalary;
  signerName: string;
  signerDesignation: string;
  /** Set when the active certificate is not CA-issued. Printed verbatim. */
  selfSignedNotice?: string | null;
};

function logoPath(): string | null {
  for (const p of [
    path.resolve(process.cwd(), "public", "mcn-logo.png"),
    path.resolve(process.cwd(), "..", "public", "mcn-logo.png"),
    path.resolve(process.cwd(), "assets", "mcn-logo.png"),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

type Doc = PDFKit.PDFDocument;

function drawLetterhead(doc: Doc, lh: BranchLetterhead) {
  const top = 34;
  const width = doc.page.width - PAGE.margin * 2;
  const logo = logoPath();
  if (logo) {
    try { doc.image(logo, PAGE.margin, top, { height: 26 }); } catch { /* text fallback below */ }
  }
  doc.font("Helvetica-Bold").fontSize(9).fillColor(INK)
    .text(COMPANY_NAME, PAGE.margin, top, { width, align: "right" });

  const addr = [lh.branchName, ...lh.addressLines].filter(Boolean).join(", ");
  doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
    .text(addr, PAGE.margin, top + 12, { width, align: "right", height: 20, ellipsis: true });

  const ruleY = top + 34;
  doc.moveTo(PAGE.margin, ruleY).lineTo(doc.page.width - PAGE.margin, ruleY)
    .lineWidth(1.2).strokeColor(ACCENT).stroke();
  doc.y = ruleY + 16;
  doc.fillColor(INK);
}

/** Start a new page when the next block would intrude into the reserved band. */
function ensureRoom(doc: Doc, needed: number) {
  if (doc.y + needed > doc.page.height - BODY_BOTTOM) doc.addPage();
}

function heading(doc: Doc, text: string) {
  ensureRoom(doc, 40);
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(text);
  doc.moveDown(0.2);
}

function body(doc: Doc, text: string) {
  ensureRoom(doc, 26);
  doc.font("Helvetica").fontSize(9).fillColor(INK).text(text, { align: "justify", lineGap: 1.5 });
  doc.moveDown(0.35);
}

function salaryTable(doc: Doc, s: AppointmentLetterSalary) {
  const rows: Array<[string, number, boolean]> = [
    ["Basic Salary", s.basic, false],
    ["House Rent Allowance", s.hra, false],
    ["Conveyance Allowance", s.conveyance, false],
    ["Other Allowance", s.otherAllowance, false],
    ["Special Allowance", s.specialAllowance, false],
    ["Bonus", s.bonus, false],
    ["Medical Allowance", s.medicalAllowance, false],
    ["Portfolio", s.portfolio, false],
    ["PLI", s.pli, false],
    ["Gross Salary", s.gross, true],
    ["ESIC", s.esicEmployee, false],
    ["EPF", s.epfEmployee, false],
    ["Net Salary", s.netSalary, true],
    ["Employer Cont. - ESIC", s.esicEmployer, false],
    ["Employer Cont. - EPF", s.epfEmployer, false],
    ["Admin Charges", s.adminCharges, false],
    ["CTC", s.ctc, true],
  ];

  ensureRoom(doc, rows.length * 14 + 30);
  const left = PAGE.margin;
  const width = doc.page.width - PAGE.margin * 2;
  const amountX = left + width - 120;

  for (const [label, amount, bold] of rows) {
    ensureRoom(doc, 16);
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(INK)
      .text(label, left + 6, y, { width: width - 140 })
      .text(`Rs. ${amount.toFixed(2)}`, amountX, y, { width: 114, align: "right" });
    doc.y = y + 13;
    doc.moveTo(left, doc.y - 2).lineTo(left + width, doc.y - 2)
      .lineWidth(0.3).strokeColor("#E5E7EB").stroke();
  }
  doc.moveDown(0.6);
  // The two-column .text() calls above leave doc.x at the right amount column.
  // Reset to the left margin so every subsequent body() call uses the full width.
  doc.x = PAGE.margin;
}

/**
 * The company signature, on a page of its own.
 *
 * A dedicated page rather than a band at the foot of the last content page:
 * that approach split the block across a page boundary when the text happened
 * to end near the bottom, and cost ~40% of every page to reserve space only the
 * final page ever needs.
 *
 * The lower portion is left deliberately empty — the provider stamps the
 * employee's Aadhaar signature at Rect [425,100,545,160] on this page.
 */
function signaturePage(doc: Doc, input: AppointmentLetterInput) {
  doc.addPage();
  const left = PAGE.margin;
  let y = doc.y;

  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("SIGNATURES", left, y);
  y = doc.y + 6;
  doc.moveTo(left, y).lineTo(doc.page.width - PAGE.margin, y)
    .lineWidth(0.8).strokeColor(ACCENT).stroke();
  y += 18;

  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK)
    .text(`For ${COMPANY_NAME}`, left, y, { width: 320 });
  y += 15;
  doc.font("Helvetica").fontSize(8.5).fillColor(INK);
  for (const line of [
    `Digitally signed/authorised by: ${input.signerName}`,
    `Designation: ${input.signerDesignation}`,
    `Date and time of issuance: ${istTimestamp(input.issueDate ?? new Date())}`,
    `Appointment Letter ID: ${input.letterNumber}`,
  ]) {
    doc.text(line, left, y, { width: 330 });
    y += 12;
  }
  doc.fontSize(7).fillColor(MUTED).text(`Verify: ${input.verificationUrl}`, left, y, { width: 340 });
  // Capture bottom of company block before drawing the eSign box (which resets doc.y to box coords).
  const companyBlockBottom = doc.y + 6;

  // Aadhaar eSign box — fixed position matching the provider's stamp rect [425,100,545,160].
  const boxTop = 94;
  const boxHeight = 78;
  doc.rect(420, boxTop, 130, boxHeight).lineWidth(0.8).strokeColor("#CBD5E1").stroke();
  doc.fontSize(6.5).fillColor(MUTED)
    .text("Aadhaar eSign area", 426, boxTop + boxHeight - 14, { width: 120 });

  if (input.qrPngDataUrl) {
    try {
      const b64 = input.qrPngDataUrl.replace(/^data:image\/png;base64,/, "");
      doc.image(Buffer.from(b64, "base64"), doc.page.width - PAGE.margin - 78, boxTop - 6, { width: 78, height: 78 });
    } catch { /* a missing QR must never stop issuance */ }
  }

  // Employee acceptance block — below whichever ends lower: company block or eSign box.
  const acceptY = Math.max(companyBlockBottom, boxTop + boxHeight + 14);
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK)
    .text("Accepted by the employee", left, acceptY, { width: 320 });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED)
    .text(`${input.employeeName} (${input.employeeCode})`, left, acceptY + 14, { width: 320 })
    .text("Signed electronically under Aadhaar eSign.", left, acceptY + 26, { width: 320 });

  if (input.selfSignedNotice) {
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#B45309")
      .text(input.selfSignedNotice, left, doc.page.height - 26, {
        width: doc.page.width - PAGE.margin * 2, align: "center",
      });
  }
}

const TERMS: Array<[string, string[]]> = [
  ["4. PROBATION", [
    "4.1 You will be on probation for a period of six months from the date of your joining. This period of probation will be liable to such extension(s) as the management may deem fit at its sole discretion. Unless an order in writing confirming your services is issued and accepted by you, your services will not be deemed to have been confirmed. If the management is not satisfied with your work or conduct, your service shall be liable to termination without notice at any time, without assigning any reason, during or on completion of the initial or extended probationary period. On confirmation, termination of this employment can be effected with a notice period of one month, or the basic salary of one month in lieu of the notice period.",
  ]],
  ["5. PLACEMENT", [
    "5.1 You will be liable to be transferred to any existing or future department, office or establishment forming part of the Company, as assigned or communicated to you by the management or those in authority over you from time to time.",
  ]],
  ["6. SECRECY", [
    "6.1 You will not give out to any unauthorised person, by word of mouth or otherwise, particulars or details of processes, data, technical know-how, administration and organisational matters, or operations plans concerning the Company or its associates. You shall, both during and after your employment, take all reasonable precautions to keep such information secret. In the event of any breach you shall indemnify the Company from any legal action.",
  ]],
  ["7. DUTIES / RESPONSIBILITIES", [
    "7.1 You will perform, observe and conform to such duties, directions and instructions as are assigned or communicated to you by the management and those in authority over you.",
    "7.2 You will have responsibility for the efficient, satisfactory and economical discharge of the duties, directions and instructions assigned to you from time to time.",
    "7.3 You shall at all times account for, and when required make over to the responsible authority, all monies, properties and things belonging to the Company which may have been placed in your custody or under your supervision, or may otherwise have come into your possession or control.",
    "7.4 You may be required to travel on Company work as and when required. In such cases you will be entitled to travel expenses and allowances as may be in force from time to time.",
    "7.5 You will devote your whole time during working hours to the work of the Company and will not undertake any part-time or other work, whether honorary or remunerative, without prior permission of the management.",
  ]],
  ["8. OTHER RULES AND REGULATIONS", [
    "8.1 You will not, without prior permission of the management, engage or interest yourself in any other business or activity of any kind, whether directly or indirectly, nor publish any information about the affairs or business of the Company, nor enter the service of or be employed by any other firm, company or person.",
    "8.2 You will not enter into any commitments or dealings on behalf of the management for which you have no express authority, nor alter or be party to any alteration of any principle or policy of the management, nor exceed the authority or discretion vested in you without prior sanction.",
    "8.3 You will disclose to us forthwith any discovery, invention, process or improvement made or discovered by you while in our service, and such discovery, invention, process or improvement shall belong absolutely to and be the sole and absolute property of the Company.",
    "8.4 You shall not seek membership or affiliation of any body, local, public or otherwise, including educational institutions, without first obtaining permission from the management.",
  ]],
  ["9. TERMINATION OF SERVICES", [
    "9.1 You will automatically retire from the service of the Company on attaining the superannuation age of 58 years.",
    "9.2 If you remain absent without prior permission or authorisation, or overstay leave for three consecutive calendar days beyond the period originally granted or subsequently extended, it shall be deemed that you have left the services of the Company of your own accord without notice, and the same shall be treated as abandonment of service on your part.",
    "9.3 During probation, termination of your employment will be subject to fifteen days' notice in writing from you.",
    "9.4 On satisfactory completion of the probation period and after your confirmation in writing, except for the reasons mentioned in this appointment letter, your services can be terminated by giving notice of one month or payment of basic salary in lieu thereof on either side. However, in the event of your resignation, the Company at its sole discretion will have the option to accept the same and relieve you prior to completion of the stipulated notice period, without any pay in lieu of the notice period.",
    "9.5 If at any time in our opinion, which is final in this matter, you are insolvent, or found guilty of negligence, indiscipline or any other conduct considered by us as detrimental to our interest, or of violation of one or more terms of this letter, your services are liable to be terminated without any notice or compensation in lieu thereof.",
    "9.6 You are required to keep yourself updated on the Code of Conduct guidelines, Company policies and procedures as framed and changed from time to time. Any violation of the above terms, or of any other Code of Conduct guidelines or Company policies and procedures, would result in immediate termination of service without notice, warning or compensation in lieu thereof.",
    "9.7 If any declaration or particulars given by you in your application for employment is found to be wrong, or you are found to have wilfully suppressed any material information, this appointment will be liable to termination without notice or compensation in lieu thereof.",
  ]],
];

const ANNEXURE_DOCS = [
  "Six recent passport-sized photographs.",
  "A copy of your updated Curriculum Vitae.",
  "A copy of this Appointment Letter.",
  "Proof of Address (rent agreement, ration card, voter's ID, driving licence, electricity bill or landline bill).",
  "Secondary School Certificate (10th) / 10th marksheet.",
  "Senior Secondary School Certificate (12th) / 12th marksheet.",
  "Bachelor's degree, all years' marksheets, graduation degree certificate, diploma or certification course.",
  "Post-graduation certificate.",
  "Additional qualifications.",
  "Proof of Identity (passport, driving licence, voter's ID, bank passbook with photo or PAN card).",
  "Appointment letter of last organisation served.",
  "Last pay slip drawn.",
  "Form 16 (Part A) from the previous employer, or salary certificate.",
];

/** Render the letter. Returns unsigned PDF bytes ready for the company DSC. */
export async function renderAppointmentLetterPdf(input: AppointmentLetterInput): Promise<Buffer> {
  const issue = input.issueDate ?? new Date();
  const unsigned = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: PAGE.size,
      // Body pages use an ordinary margin; the signature gets its own page.
      margins: { top: PAGE.margin, bottom: BODY_BOTTOM, left: PAGE.margin, right: PAGE.margin },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.on("pageAdded", () => drawLetterhead(doc, input.letterhead));
    drawLetterhead(doc, input.letterhead);

    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Original Copy");
    doc.moveDown(0.5);

    doc.font("Helvetica").fontSize(9).fillColor(INK);
    body(doc, "To,");
    doc.font("Helvetica-Bold").fontSize(10).text(input.employeeName);
    doc.font("Helvetica").fontSize(9)
      .text(`EMP Code - ${input.employeeCode}`)
      .text(`Date : ${istDisplayDate(issue)}`);
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold").fontSize(11).text("Subject : APPOINTMENT LETTER");
    doc.moveDown(0.5);
    body(doc, `Dear ${input.employeeName},`);
    body(doc, "With reference to your application and your subsequent interview with us, we have pleasure in informing you that we have agreed to provide you an appointment with us.");

    heading(doc, "ON THE FOLLOWING TERMS AND CONDITIONS");
    heading(doc, "1. APPOINTMENT DATE");
    body(doc, `1.1 This appointment shall be effective from ${istDisplayDate(input.dateOfJoining)}.`);
    heading(doc, "2. DESIGNATION");
    body(doc, `2.1 You will be designated as '${input.designation || "—"}' and you would be reporting to your Reporting Manager.`);
    heading(doc, "3. REMUNERATION");
    body(doc, "3.1 Your monthly salary breakup would be as follows (in INR):");
    salaryTable(doc, input.salary);

    for (const [title, paras] of TERMS) {
      heading(doc, title);
      for (const p of paras) body(doc, p);
    }

    body(doc, "All terms and conditions will be governed by the Company's policies as stated from time to time, and the Company may at its sole discretion, as it deems fit, revoke or change such policies.");
    body(doc, "The terms of this offer shall be kept strictly confidential. You shall execute all the documents indicated in Annexure-I so as to give effect to this offer.");
    body(doc, "Please return the duplicate copy of this letter duly signed in token of your having accepted the offer, and initial each page in acceptance of the terms and conditions set out herein, within 10 days of the issuance of this letter, failing which this offer stands automatically withdrawn.");
    body(doc, `We welcome you and wish you every success in your career with ${COMPANY_NAME}`);
    // Keep the closing block together — ensureRoom for both lines prevents
    // "Sincerely," landing alone at the bottom with "Date of Joining:" orphaned on the next page.
    ensureRoom(doc, 60);
    doc.moveDown(0.4);
    body(doc, "Sincerely,");
    body(doc, `Date of Joining: ${istDisplayDate(input.dateOfJoining)}`);

    doc.addPage();
    heading(doc, "ANNEXURE-I");
    doc.font("Helvetica-Bold").fontSize(9).text("DOCUMENTS / CREDENTIALS REQUIRED AT THE TIME OF JOINING");
    doc.moveDown(0.3);
    ANNEXURE_DOCS.forEach((t, i) => body(doc, `${i + 1}. ${t}`));
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(9).text("DOCUMENTS TO BE DULY FILLED AND SIGNED AT THE TIME OF JOINING");
    doc.moveDown(0.3);
    ["Employee's Record Form", "Code of Conduct", "Phone Undertaking / Asset Undertaking", "ESI Form", "EPF Form"]
      .forEach((t, i) => body(doc, `${i + 1}. ${t}`));

    // The company block goes on the final page, inside the reserved band.
    signaturePage(doc, { ...input, issueDate: issue });
    doc.end();
  });

  // Footer added afterwards so "Page N of M" counts the final page total.
  const lib = await PDFLibDocument.load(unsigned);
  const font = await lib.embedFont(StandardFonts.Helvetica);
  const pages = lib.getPages();
  pages.forEach((page, i) => {
    // The last page is the signature page: nothing may be drawn in its lower
    // half, so it gets no footer at all.
    if (i === pages.length - 1) return;
    const { width } = page.getSize();
    page.drawText(`${COMPANY_NAME} | Private & Confidential | ${input.letterNumber}`, {
      x: PAGE.margin, y: 40, size: 6.5, font, color: rgb(0.42, 0.45, 0.5),
    });
    page.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: width - PAGE.margin - 60, y: 40, size: 6.5, font, color: rgb(0.42, 0.45, 0.5),
    });
  });
  return Buffer.from(await lib.save());
}
