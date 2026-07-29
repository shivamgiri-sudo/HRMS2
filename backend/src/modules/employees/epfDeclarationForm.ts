/**
 * EPF Declaration (Form 11) as a fillable AcroForm PDF.
 *
 * The supplied EPFO form is a flat scan — 904 embedded images, zero form fields
 * and no vector rectangles, so the character boxes cannot be located
 * programmatically and no coordinates could be calibrated against it. All 69
 * field maps are mapping_mode='acroform' with NULL x/y, which means the
 * coordinate-overlay renderer skipped every one of them and the form came out
 * blank.
 *
 * This rebuilds the form as a real AcroForm using the *same 69 field names*, so
 * document_template_field_map needs no change: set the template's fill_mode to
 * 'acroform' and fillAcroFormPdf fills it by name.
 *
 * Character boxes use PDF comb fields (setMaxLength + enableCombing). A comb
 * field lays one character per cell natively, which means a space occupies its
 * own cell exactly as EPFO expects — "KAMAL SINGH" reads K A M A L _ S I N G H.
 *
 * The header of the EPFO form states "To be retained by the Employer for future
 * reference", so this is an employer-retained declaration rather than a document
 * filed on the prescribed stationery.
 */
import {
  A4, MARGIN, INK, type Ctx,
  combField, lineField, checkBox, dateBoxes,
} from "./pdfFormBuilder.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function buildEpfDeclarationPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("EPF Declaration Form (Form 11)");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();

  // ── Page 1 ──────────────────────────────────────────────────────────────
  let page = doc.addPage([A4.w, A4.h]);
  const ctx: Ctx = { doc, form, page, font, bold, y: A4.h - MARGIN };

  ctx.page.drawText("Declaration Form", { x: MARGIN, y: ctx.y, size: 15, font: bold, color: INK });
  ctx.page.drawText("(To be retained by the Employer for future reference)", { x: MARGIN, y: ctx.y - 13, size: 7, font, color: INK });
  ctx.page.drawText("Employees' Provident Fund Organization", { x: MARGIN, y: ctx.y - 30, size: 12, font: bold, color: INK });
  ctx.page.drawText("The Employees' Provident Funds Scheme, 1952 (Para 34 & 57) & The Employees' Pension Scheme, 1995 (Para 24)", { x: MARGIN, y: ctx.y - 43, size: 7, font, color: INK });

  let y = ctx.y - 70;
  const label = (s: string, dy = 0, size = 8) => ctx.page.drawText(s, { x: MARGIN, y: y - dy, size, font, color: INK });

  label("1)  NAME (as per KYC)");
  combField(ctx, "employee_name", MARGIN + 120, y - 4, 32, 13.5);
  y -= 30;

  label("2)  DATE OF BIRTH  (D D  M M  Y Y Y Y)");
  // Year is four separately-mapped single characters (date_year_1..4).
  combField(ctx, "dob_day", MARGIN + 190, y - 4, 2);
  combField(ctx, "dob_month", MARGIN + 190 + 33, y - 4, 2);
  for (let i = 0; i < 4; i++) {
    combField(ctx, `dob_year_${i + 1}`, MARGIN + 190 + 66 + i * 13.5, y - 4, 1);
  }
  y -= 30;

  label("3)  FATHER'S / HUSBAND'S NAME");
  combField(ctx, "father_or_spouse_name", MARGIN + 150, y - 4, 30, 13.5);
  y -= 30;

  label("4)  RELATIONSHIP");
  checkBox(ctx, "relationship_father", "Father", MARGIN + 150, y - 4, 34);
  checkBox(ctx, "relationship_husband", "Husband", MARGIN + 240, y - 4, 42);
  y -= 26;

  label("5)  GENDER");
  checkBox(ctx, "gender_male", "Male", MARGIN + 150, y - 4, 28);
  checkBox(ctx, "gender_female", "Female", MARGIN + 230, y - 4, 36);
  checkBox(ctx, "gender_other", "Transgender", MARGIN + 320, y - 4, 60);
  y -= 26;

  label("6)  MOBILE NUMBER");
  combField(ctx, "mobile_number", MARGIN + 150, y - 4, 10);
  y -= 30;

  label("7)  EMAIL ID");
  lineField(ctx, "email", MARGIN + 150, y - 4, 300);
  y -= 30;

  label("8)  Earlier a member of the Employees' Provident Fund Scheme, 1952?");
  checkBox(ctx, "previous_pf_member_yes", "Yes", MARGIN + 340, y - 4, 22);
  checkBox(ctx, "previous_pf_member_no", "No", MARGIN + 400, y - 4, 18);
  y -= 26;

  label("9)  Earlier a member of the Employees' Pension Scheme, 1995?");
  checkBox(ctx, "previous_eps_member_yes", "Yes", MARGIN + 340, y - 4, 22);
  checkBox(ctx, "previous_eps_member_no", "No", MARGIN + 400, y - 4, 18);
  y -= 34;

  ctx.page.drawText("A.  PREVIOUS EMPLOYMENT DETAILS  (mandatory if 8 or 9 is Yes)", { x: MARGIN, y, size: 8.5, font: bold, color: INK });
  y -= 22;

  label("10) UNIVERSAL ACCOUNT NUMBER (UAN)");
  combField(ctx, "uan", MARGIN + 200, y - 4, 12);
  y -= 26;

  label("      OR PREVIOUS PF MEMBER ID");
  lineField(ctx, "previous_pf_account_number", MARGIN + 200, y - 4, 240);
  y -= 30;

  label("11) DATE OF EXIT FOR PREVIOUS MEMBER ID");
  dateBoxes(ctx, { day: "date_of_exit_previous_day", month: "date_of_exit_previous_month", year: "date_of_exit_previous_year" }, MARGIN + 230, y - 4);
  y -= 30;

  label("12) (A) SCHEME CERTIFICATE NUMBER");
  lineField(ctx, "scheme_certificate_number", MARGIN + 200, y - 4, 240);
  y -= 24;
  label("      (B) PENSION PAYMENT ORDER (PPO) NUMBER");
  lineField(ctx, "ppo_number", MARGIN + 240, y - 4, 200);

  ctx.page.drawText("Page 1 of 3", { x: A4.w / 2 - 22, y: 24, size: 7, font, color: INK });

  // ── Page 2 ──────────────────────────────────────────────────────────────
  page = doc.addPage([A4.w, A4.h]);
  ctx.page = page;
  y = A4.h - MARGIN;

  ctx.page.drawText("B.  OTHER DETAILS", { x: MARGIN, y, size: 8.5, font: bold, color: INK });
  y -= 26;

  label("13) INTERNATIONAL WORKER");
  checkBox(ctx, "international_worker_yes", "Yes", MARGIN + 200, y - 4, 22);
  checkBox(ctx, "international_worker_no", "No", MARGIN + 260, y - 4, 18);
  y -= 28;

  label("      13(A) COUNTRY OF ORIGIN");
  lineField(ctx, "country_of_origin", MARGIN + 200, y - 4, 240);
  y -= 28;

  label("      13(B) PASSPORT NUMBER");
  lineField(ctx, "passport_number", MARGIN + 200, y - 4, 240);
  y -= 28;

  label("      13(C) PASSPORT VALID FROM");
  dateBoxes(ctx, { day: "passport_valid_from_day", month: "passport_valid_from_month", year: "passport_valid_from_year" }, MARGIN + 200, y - 4);
  y -= 28;

  label("                              TO");
  dateBoxes(ctx, { day: "passport_valid_to_day", month: "passport_valid_to_month", year: "passport_valid_to_year" }, MARGIN + 200, y - 4);
  y -= 36;

  label("14) EDUCATIONAL QUALIFICATION");
  y -= 20;
  checkBox(ctx, "education_illiterate", "Illiterate", MARGIN + 10, y, 48);
  checkBox(ctx, "education_non_matric", "Non-Matric", MARGIN + 150, y, 58);
  checkBox(ctx, "education_matric", "Matric", MARGIN + 300, y, 38);
  y -= 20;
  checkBox(ctx, "education_senior_secondary", "Sr. Secondary", MARGIN + 10, y, 68);
  checkBox(ctx, "education_graduate", "Graduate", MARGIN + 150, y, 48);
  checkBox(ctx, "education_post_graduate", "Post Graduate", MARGIN + 300, y, 70);
  y -= 20;
  checkBox(ctx, "education_doctor", "Doctorate", MARGIN + 10, y, 48);
  checkBox(ctx, "education_technical_professional", "Technical / Professional", MARGIN + 150, y, 110);
  y -= 34;

  label("15) MARITAL STATUS");
  y -= 20;
  checkBox(ctx, "marital_status_married", "Married", MARGIN + 10, y, 44);
  checkBox(ctx, "marital_status_unmarried", "Unmarried", MARGIN + 150, y, 54);
  checkBox(ctx, "marital_status_widow_widower", "Widow / Widower", MARGIN + 300, y, 82);
  y -= 20;
  checkBox(ctx, "marital_status_divorcee", "Divorcee", MARGIN + 10, y, 44);
  y -= 34;

  label("16) SPECIALLY ABLED");
  checkBox(ctx, "specially_abled_yes", "Yes", MARGIN + 150, y - 4, 22);
  checkBox(ctx, "specially_abled_no", "No", MARGIN + 210, y - 4, 18);
  y -= 24;
  label("      IF YES, CATEGORY");
  checkBox(ctx, "disability_locomotive", "Locomotive", MARGIN + 150, y - 4, 56);
  checkBox(ctx, "disability_visual", "Visual", MARGIN + 280, y - 4, 34);
  checkBox(ctx, "disability_hearing", "Hearing", MARGIN + 380, y - 4, 40);

  ctx.page.drawText("Page 2 of 3", { x: A4.w / 2 - 22, y: 24, size: 7, font, color: INK });

  // ── Page 3 ──────────────────────────────────────────────────────────────
  page = doc.addPage([A4.w, A4.h]);
  ctx.page = page;
  y = A4.h - MARGIN;

  ctx.page.drawText("17) KYC DETAILS", { x: MARGIN, y, size: 8.5, font: bold, color: INK });
  y -= 20;
  ctx.page.drawText("Document", { x: MARGIN, y, size: 7.5, font: bold, color: INK });
  ctx.page.drawText("Name as on KYC document", { x: MARGIN + 110, y, size: 7.5, font: bold, color: INK });
  ctx.page.drawText("Number", { x: MARGIN + 300, y, size: 7.5, font: bold, color: INK });
  y -= 20;

  // Bank account and IFSC are the mandatory pair on the EPFO form.
  label("Bank Account *");
  lineField(ctx, "kyc_bank_account_number", MARGIN + 300, y - 4, 200);
  y -= 24;
  label("      IFSC *");
  lineField(ctx, "kyc_bank_ifsc", MARGIN + 300, y - 4, 200);
  y -= 24;

  label("NPR / Aadhaar");
  lineField(ctx, "kyc_aadhaar_name", MARGIN + 110, y - 4, 180);
  lineField(ctx, "kyc_aadhaar_number", MARGIN + 300, y - 4, 200);
  y -= 24;

  label("Permanent Account Number (PAN)");
  lineField(ctx, "kyc_pan_name", MARGIN + 110, y - 4, 180);
  lineField(ctx, "kyc_pan_number", MARGIN + 300, y - 4, 200);
  y -= 22;

  ctx.page.drawText("* Bank account number along with IFSC code is mandatory. Self-attested copies of KYC documents must be attached.", { x: MARGIN, y, size: 6.8, font, color: INK });
  y -= 28;

  ctx.page.drawText("C.  UNDERTAKING", { x: MARGIN, y, size: 8.5, font: bold, color: INK });
  y -= 16;
  for (const line of [
    "A.  I certify that all the information given above is true to the best of my knowledge and belief.",
    "B.  In case I was earlier a member of EPF Scheme, 1952 and/or EPS, 1995:",
    "      (i)   I have ensured the correctness of my UAN / previous PF member ID.",
    "      (ii)  This may also be treated as my request for transfer of funds and service details, if applicable,",
    "            from the previous account as declared above to the present P.F. account.",
    "      (iii) I am aware that I can submit my nomination form through the UAN based member portal.",
  ]) {
    ctx.page.drawText(line, { x: MARGIN, y, size: 7.2, font, color: INK });
    y -= 11;
  }
  y -= 16;

  label("DATE");
  dateBoxes(ctx, { day: "signature_date_day", month: "signature_date_month", year: "signature_date_year" }, MARGIN + 60, y - 4);
  y -= 26;
  label("PLACE");
  lineField(ctx, "place", MARGIN + 60, y - 4, 180);
  ctx.page.drawText("SIGNATURE OF MEMBER", { x: MARGIN + 320, y: y + 2, size: 7.5, font: bold, color: INK });
  lineField(ctx, "employee_signature", MARGIN + 320, y - 18, 180);
  y -= 52;

  ctx.page.drawText("DECLARATION BY PRESENT EMPLOYER", { x: MARGIN, y, size: 8.5, font: bold, color: INK });
  y -= 20;
  label("Name of Employer");
  lineField(ctx, "employer_name", MARGIN + 110, y - 4, 200);
  y -= 26;
  // "employed with effect from" — the only place date of joining appears on Form 11.
  label("The above employee has been employed with effect from");
  dateBoxes(ctx, { day: "doj_day", month: "doj_month", year: "doj_year" }, MARGIN + 250, y - 4);
  y -= 28;
  ctx.page.drawText("SIGNATURE OF EMPLOYER WITH SEAL OF ESTABLISHMENT", { x: MARGIN, y, size: 7.5, font: bold, color: INK });
  lineField(ctx, "employer_signature", MARGIN, y - 22, 240);

  ctx.page.drawText("Page 3 of 3", { x: A4.w / 2 - 22, y: 24, size: 7, font, color: INK });

  // Keep values visible in every viewer without needing an appearance pass.
  form.updateFieldAppearances(font);
  return doc.save();
}

/** Field names this form exposes — asserted against the DB maps in tests. */
export const EPF_FORM_FIELD_NAMES = [
  "employee_name", "dob_day", "dob_month", "dob_year_1", "dob_year_2", "dob_year_3", "dob_year_4",
  "father_or_spouse_name", "relationship_father", "relationship_husband",
  "gender_male", "gender_female", "gender_other", "mobile_number", "email",
  "previous_pf_member_yes", "previous_pf_member_no", "previous_eps_member_yes", "previous_eps_member_no",
  "uan", "previous_pf_account_number",
  "date_of_exit_previous_day", "date_of_exit_previous_month", "date_of_exit_previous_year",
  "scheme_certificate_number", "ppo_number",
  "international_worker_yes", "international_worker_no", "country_of_origin", "passport_number",
  "passport_valid_from_day", "passport_valid_from_month", "passport_valid_from_year",
  "passport_valid_to_day", "passport_valid_to_month", "passport_valid_to_year",
  "education_illiterate", "education_non_matric", "education_matric", "education_senior_secondary",
  "education_graduate", "education_post_graduate", "education_doctor", "education_technical_professional",
  "marital_status_married", "marital_status_unmarried", "marital_status_widow_widower", "marital_status_divorcee",
  "specially_abled_yes", "specially_abled_no", "disability_locomotive", "disability_visual", "disability_hearing",
  "kyc_bank_account_number", "kyc_bank_ifsc", "kyc_aadhaar_name", "kyc_aadhaar_number",
  "kyc_pan_name", "kyc_pan_number",
  "signature_date_day", "signature_date_month", "signature_date_year",
  "place", "employee_signature", "employer_name", "employer_signature",
  "doj_day", "doj_month", "doj_year",
] as const;
