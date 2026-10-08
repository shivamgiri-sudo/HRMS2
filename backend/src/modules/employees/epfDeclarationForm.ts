/**
 * EPF Declaration (Form 11) as a fillable AcroForm PDF, set to match the
 * EPFO-issued form.
 *
 * The EPFO PDF is a flat scan — 904 embedded images, zero form fields and no
 * vector rectangles — so nothing can be written into it and its character boxes
 * cannot be located programmatically. Every one of the 69 field maps was
 * mapping_mode 'acroform' with NULL x/y, which meant the coordinate-overlay
 * renderer skipped all of them and the statutory form generated blank.
 *
 * This reproduces the issued form's layout: the numbered items in their printed
 * order, the tick tables for relationship, gender, education, marital status
 * and disability, the grey section bands, the KYC table and both declarations.
 * It uses the same 69 field names the maps already reference, so
 * document_template_field_map needs no change.
 *
 * Character boxes are PDF comb fields: a comb lays exactly one glyph per cell,
 * so a space occupies its own box — "KAMAL SINGH" reads K A M A L _ S I N G H,
 * which is what EPFO expects of a boxed name.
 */
import {
  A4, MARGIN, BOX, type Ctx,
  newFormDoc, newPage, label, footer, combField, lineField, checkBox, dateBoxes,
  sectionBand, tickTable, tableGrid,
} from "./pdfFormBuilder.js";

const W = A4.w - MARGIN * 2;
const CELL = 13.2;

/** "D D M M Y Y Y Y" captions above a date row, as the issued form prints them. */
function dateCaptions(ctx: Ctx, x: number, y: number) {
  ["D", "D", "M", "M", "Y", "Y", "Y", "Y"].forEach((c, i) => {
    label(ctx, c, x + i * CELL + CELL / 2 - 2, y, 6.5, true);
  });
}

export async function buildEpfDeclarationPdf(): Promise<Uint8Array> {
  const ctx = await newFormDoc("EPF Declaration Form (Form 11)");

  // ── Page 1 ──────────────────────────────────────────────────────────────
  let y = A4.h - 40;
  label(ctx, "Declaration Form", A4.w - MARGIN - 118, y, 14, true);
  label(ctx, "(To be retained by the Employer for future reference)", A4.w - MARGIN - 178, y - 11, 6.5);

  y -= 34;
  label(ctx, "Employees' Provident Fund Organization", MARGIN + 96, y, 14, true);
  y -= 15;
  label(ctx, "THE EMPLOYEES' PROVIDENT FUNDS SCHEME, 1952 (PARAGRAPH-34 & 57)", MARGIN + 88, y, 7, true);
  y -= 10;
  label(ctx, "&", MARGIN + 250, y, 7, true);
  y -= 10;
  label(ctx, "THE EMPLOYEES' PENSION SCHEME, 1995 (PARAGRAPH-24)", MARGIN + 120, y, 7, true);

  y -= 18;
  label(ctx, "DECLARATION BY A PERSON TAKING UP EMPLOYMENT IN AN ESTABLISHMENT ON WHICH EMPLOYEES' PROVIDENT", MARGIN, y, 6.4, true);
  y -= 9;
  label(ctx, "FUND SCHEME, 1952 AND/OR EMPLOYEES' PENSION SCHEME, 1995 IS APPLICABLE.", MARGIN + 40, y, 6.4, true);
  y -= 9;
  label(ctx, "(PLEASE GO THROUGH THE INSTRUCTIONS)", MARGIN + 150, y, 6.4, true);

  // 1) NAME — title tick boxes plus a two-row character grid, as issued.
  y -= 26;
  label(ctx, "1)  NAME", MARGIN, y, 7.5);
  label(ctx, "(TITLE)", MARGIN + 56, y, 6.5);
  const gridX = MARGIN + 148;
  const nameCells = Math.floor((A4.w - MARGIN - gridX) / CELL);
  combField(ctx, "employee_name", gridX, y - 4, nameCells, CELL);
  // The issued form prints a second, empty row for a long name.
  for (let i = 0; i < nameCells; i++) {
    ctx.page.drawRectangle({
      x: gridX + i * CELL, y: y - 34, width: CELL, height: 15,
      borderColor: BOX, borderWidth: 0.6,
    });
  }
  y -= 16;
  ["MR.", "MS.", "MRS."].forEach((t, i) => {
    const bx = MARGIN + 14 + i * 36;
    ctx.page.drawRectangle({ x: bx, y: y - 4, width: 34, height: 13, borderColor: BOX, borderWidth: 0.6 });
    label(ctx, t, bx + 9, y - 0.5, 6.5, true);
  });
  y -= 18;
  label(ctx, "(PLEASE TICK)", MARGIN + 14, y, 6);

  // 2) DATE OF BIRTH
  y -= 30;
  label(ctx, "2)  DATE OF BIRTH", MARGIN, y, 7.5);
  dateCaptions(ctx, MARGIN + 148, y + 2);
  combField(ctx, "dob_day", MARGIN + 148, y - 14, 2, CELL);
  combField(ctx, "dob_month", MARGIN + 148 + 2 * CELL, y - 14, 2, CELL);
  for (let i = 0; i < 4; i++) {
    combField(ctx, `dob_year_${i + 1}`, MARGIN + 148 + (4 + i) * CELL, y - 14, 1, CELL);
  }

  // 3) FATHER'S / HUSBAND'S NAME
  y -= 44;
  label(ctx, "3)  FATHER'S /", MARGIN, y, 7.5);
  label(ctx, "HUSBAND'S NAME", MARGIN + 14, y - 9, 7.5);
  ctx.page.drawRectangle({ x: MARGIN + 108, y: y - 8, width: 30, height: 13, borderColor: BOX, borderWidth: 0.6 });
  label(ctx, "MR.", MARGIN + 114, y - 4.5, 6.5, true);
  combField(ctx, "father_or_spouse_name", gridX, y - 8, nameCells, CELL);

  // 4) RELATIONSHIP
  y -= 36;
  label(ctx, "4)  RELATIONSHIP IN RESPECT OF (3) ABOVE", MARGIN, y, 7.5);
  label(ctx, "(PLEASE TICK)", MARGIN + 14, y - 10, 6);
  tickTable(ctx, MARGIN + 240, y + 10, [
    { label: "FATHER", field: "relationship_father" },
    { label: "HUSBAND", field: "relationship_husband" },
  ], 84);

  // 5) GENDER
  y -= 44;
  label(ctx, "5)  GENDER", MARGIN, y, 7.5);
  label(ctx, "(PLEASE TICK)", MARGIN + 14, y - 10, 6);
  tickTable(ctx, MARGIN + 240, y + 10, [
    { label: "MALE", field: "gender_male" },
    { label: "FEMALE", field: "gender_female" },
    { label: "TRANSGENDER", field: "gender_other" },
  ], 68);

  // 6) MOBILE NUMBER
  y -= 46;
  label(ctx, "6)  MOBILE NUMBER", MARGIN, y, 7.5);
  label(ctx, "(IF ANY)", MARGIN + 14, y - 9, 6.5);
  combField(ctx, "mobile_number", MARGIN + 148, y - 6, 10, 18);

  // 7) EMAIL ID
  y -= 32;
  label(ctx, "7)  EMAIL ID (IF ANY)", MARGIN, y, 7.5);
  lineField(ctx, "email", MARGIN + 148, y - 6, A4.w - MARGIN - (MARGIN + 148), 16, 8);

  // 8) and 9) previous membership
  y -= 34;
  label(ctx, "8)  WHETHER EARLIER A MEMBER OF THE EMPLOYEES' PROVIDENT FUND SCHEME, 1952?", MARGIN, y, 6.8);
  label(ctx, "(PLEASE TICK)", MARGIN + 110, y - 13, 6);
  tickTable(ctx, MARGIN + 210, y - 2, [
    { label: "YES", field: "previous_pf_member_yes" },
    { label: "NO", field: "previous_pf_member_no" },
  ], 110, 13, 13);

  y -= 44;
  label(ctx, "9)  WHETHER EARLIER A MEMBER OF THE EMPLOYEES' PENSION SCHEME, 1995?", MARGIN, y, 6.8);
  label(ctx, "(PLEASE TICK)", MARGIN + 110, y - 13, 6);
  tickTable(ctx, MARGIN + 210, y - 2, [
    { label: "YES", field: "previous_eps_member_yes" },
    { label: "NO", field: "previous_eps_member_no" },
  ], 110, 13, 13);

  y -= 46;
  label(ctx, "IF RESPONSE TO ANY OR BOTH OF (8) & (9) ABOVE IS YES, THEN MANDATORILY FILL UP THE PREVIOUS", MARGIN, y, 6.4, true);
  label(ctx, "EMPLOYMENT DETAILS AT (10,11&12):", MARGIN, y - 9, 6.4, true);
  footer(ctx, "Page 1 of 3");

  // ── Page 2 ──────────────────────────────────────────────────────────────
  y = newPage(ctx);
  sectionBand(ctx, "A.   PREVIOUS EMPLOYMENT DETAILS", MARGIN, y - 13, W);
  y -= 28;
  label(ctx, "10)  THE DETAILS OF THE UNIVERSAL ACCOUNT NUMBER (UAN) OR PREVIOUS PF MEMBER ID:", MARGIN, y, 6.8);

  y -= 22;
  label(ctx, "UAN", MARGIN + 8, y, 7.5, true);
  combField(ctx, "uan", MARGIN + 110, y - 4, 12, CELL);
  y -= 20;
  label(ctx, "OR", MARGIN + 8, y, 7);
  y -= 14;
  label(ctx, "PREVIOUS PF MEMBER ID", MARGIN + 8, y, 7.5, true);
  const pfCols = [80, 72, 100, 62, 96];
  const pfWidth = pfCols.reduce((a, b) => a + b, 0);
  const pfX = tableGrid(ctx, MARGIN + 150, y + 13, pfCols, 15, 2);
  ["REGION CODE", "OFFICE CODE", "ESTABLISHMENT ID", "EXTENSION", "ACCOUNT NUMBER"].forEach((h, i) => {
    label(ctx, h, pfX[i] + 3, y + 13 - 10, 5.4, true);
  });
  // The five parts are stored as one value, so the row beneath is one field.
  lineField(ctx, "previous_pf_account_number", MARGIN + 151, y - 16, pfWidth - 2, 13, 7);

  y -= 46;
  label(ctx, "11)  DATE OF EXIT FOR PREVIOUS", MARGIN, y, 6.8);
  label(ctx, "MEMBER ID (DD/MM/YYYY)", MARGIN + 14, y - 9, 6.8);
  dateCaptions(ctx, MARGIN + 190, y + 2);
  dateBoxes(ctx, { day: "date_of_exit_previous_day", month: "date_of_exit_previous_month", year: "date_of_exit_previous_year" }, MARGIN + 190, y - 14);

  y -= 42;
  label(ctx, "12)  (A) IF SCHEME CERTIFICATE ISSUED FOR PREVIOUS EMPLOYMENT, THEN SCHEME CERTIFICATE NUMBER:", MARGIN, y, 6.2);
  lineField(ctx, "scheme_certificate_number", MARGIN + 356, y - 4, 154, 13, 7);
  y -= 20;
  label(ctx, "        (B) IF PENSION PAYMENT ORDER (PPO) ISSUED FOR PREVIOUS EMPLOYMENT, THEN PPO NUMBER:", MARGIN, y, 6.2);
  lineField(ctx, "ppo_number", MARGIN + 346, y - 4, 164, 13, 7);

  y -= 28;
  sectionBand(ctx, "B.   OTHER DETAILS", MARGIN, y - 13, W);
  y -= 32;

  label(ctx, "13)  INTERNATIONAL WORKER", MARGIN, y, 6.8);
  label(ctx, "(PLEASE TICK)", MARGIN + 14, y - 10, 6);
  tickTable(ctx, MARGIN + 190, y + 10, [
    { label: "YES", field: "international_worker_yes" },
    { label: "NO", field: "international_worker_no" },
  ], 96, 13, 13);

  y -= 46;
  label(ctx, "IF THE REPLY TO (13) ABOVE IS YES, THEN ENTER THE DETAILS IN 13(A), 13(B) & 13(C):", MARGIN + 14, y, 6.4, true);
  y -= 16;
  label(ctx, "13(A) COUNTRY OF ORIGIN", MARGIN + 20, y, 6.6);
  lineField(ctx, "country_of_origin", MARGIN + 150, y - 4, 220, 13, 7);
  y -= 24;
  label(ctx, "13(B) PASSPORT NUMBER", MARGIN + 20, y, 6.6);
  lineField(ctx, "passport_number", MARGIN + 150, y - 4, 220, 13, 7);
  y -= 26;
  label(ctx, "13(C) PASSPORT VALID FROM", MARGIN + 20, y, 6.6);
  dateCaptions(ctx, MARGIN + 190, y + 2);
  dateBoxes(ctx, { day: "passport_valid_from_day", month: "passport_valid_from_month", year: "passport_valid_from_year" }, MARGIN + 190, y - 14);
  y -= 34;
  label(ctx, "To", MARGIN + 150, y - 6, 6.6);
  dateCaptions(ctx, MARGIN + 190, y + 2);
  dateBoxes(ctx, { day: "passport_valid_to_day", month: "passport_valid_to_month", year: "passport_valid_to_year" }, MARGIN + 190, y - 14);

  y -= 44;
  label(ctx, "14)  EDUCATIONAL", MARGIN, y, 6.8);
  label(ctx, "QUALIFICATION", MARGIN + 14, y - 9, 6.8);
  label(ctx, "(PLEASE TICK)", MARGIN + 14, y - 22, 6);
  tickTable(ctx, MARGIN + 106, y + 12, [
    { label: "ILLITERATE", field: "education_illiterate" },
    { label: "NON-MATRIC", field: "education_non_matric" },
    { label: "MATRIC", field: "education_matric" },
    { label: "SENIOR SECONDARY", field: "education_senior_secondary" },
    { label: "GRADUATE", field: "education_graduate" },
    { label: "POST GRADUATE", field: "education_post_graduate" },
    { label: "DOCTOR", field: "education_doctor" },
    { label: "TECHNICAL PROFESSIONAL", field: "education_technical_professional" },
  ], 51, 22, 14);

  y -= 54;
  label(ctx, "15)  MARITAL STATUS", MARGIN, y, 6.8);
  label(ctx, "(PLEASE TICK)", MARGIN + 14, y - 10, 6);
  tickTable(ctx, MARGIN + 106, y + 12, [
    { label: "MARRIED", field: "marital_status_married" },
    { label: "UNMARRIED", field: "marital_status_unmarried" },
    { label: "WIDOW/ WIDOWER", field: "marital_status_widow_widower" },
    { label: "DIVORCEE", field: "marital_status_divorcee" },
  ], 88, 18, 14);

  y -= 52;
  label(ctx, "16)  SPECIALLY ABLED", MARGIN, y, 6.8);
  label(ctx, "(PLEASE TICK)", MARGIN + 14, y - 10, 6);
  tickTable(ctx, MARGIN + 106, y + 12, [
    { label: "YES", field: "specially_abled_yes" },
    { label: "NO", field: "specially_abled_no" },
  ], 58, 15, 14);
  label(ctx, "IF YES, TICK THE CATEGORY", MARGIN + 300, y + 16, 6.2, true);
  tickTable(ctx, MARGIN + 246, y + 6, [
    { label: "LOCOMOTIVE", field: "disability_locomotive" },
    { label: "VISUAL", field: "disability_visual" },
    { label: "HEARING", field: "disability_hearing" },
  ], 84, 14, 14);

  footer(ctx, "Page 2 of 3");

  // ── Page 3 ──────────────────────────────────────────────────────────────
  y = newPage(ctx);
  label(ctx, "17)  KYC DETAILS", MARGIN, y - 10, 7.5, true);

  const kycCols = [128, 148, 138, 98];
  const kycTop = y - 18;
  const kycRows: Array<[string, string, string, string]> = [
    ["BANK ACCOUNT-1*", "", "kyc_bank_account_number", "kyc_bank_ifsc"],
    ["NPR/AADHAAR", "kyc_aadhaar_name", "kyc_aadhaar_number", ""],
    ["PERMANENT ACCOUNT NUMBER (PAN)", "kyc_pan_name", "kyc_pan_number", ""],
    ["PASSPORT", "", "", ""],
    ["DRIVING LICENCE", "", "", ""],
    ["ELECTION CARD", "", "", ""],
    ["RATION CARD", "", "", ""],
    ["ESIC CARD", "", "", ""],
  ];
  const kx = tableGrid(ctx, MARGIN + 74, kycTop, kycCols, 16, kycRows.length + 1);
  ["KYC DOCUMENT TYPE", "NAME AS ON KYC DOCUMENT", "NUMBER", "REMARKS, IF ANY"].forEach((h, i) => {
    label(ctx, h, kx[i] + 4, kycTop - 11, 5.6, true);
  });
  kycRows.forEach((row, r) => {
    const rowTop = kycTop - 16 * (r + 1);
    label(ctx, row[0], kx[0] + 3, rowTop - 11, 5.4);
    // Only the documents EPFO treats as mandatory carry fields; the rest are
    // printed for completeness and completed by hand if the member has them.
    if (row[1]) lineField(ctx, row[1], kx[1] + 1, rowTop - 15, kycCols[1] - 2, 14, 6.5);
    if (row[2]) lineField(ctx, row[2], kx[2] + 1, rowTop - 15, kycCols[2] - 2, 14, 6.5);
    if (row[3]) lineField(ctx, row[3], kx[3] + 1, rowTop - 15, kycCols[3] - 2, 14, 6.5);
    if (r === 0) label(ctx, "IFSC CODE*", kx[3] + 4, rowTop - 11, 5.2, true);
  });

  y = kycTop - 16 * (kycRows.length + 1) - 14;
  label(ctx, "* Mandatory Field (NOTE: BANK ACCOUNT NUMBER (ALONG WITH IFSC CODE) IS MANDATORY. YOU ARE HOWEVER ADVISED", MARGIN, y, 5.4);
  label(ctx, "TO PROVIDE ALL KYC DOCUMENTS AVAILABLE WITH YOU IN ADDITION TO MANDATORY KYCS TO AVAIL BETTER SERVICES.", MARGIN, y - 8, 5.4);
  label(ctx, "SELF-ATTESTED PHOTOCOPIES OF THE DOCUMENTS MUST BE ATTACHED WITH THIS FORM.", MARGIN, y - 16, 5.4);

  y -= 32;
  sectionBand(ctx, "C.   UNDERTAKING:", MARGIN, y - 13, W);
  y -= 26;
  for (const line of [
    "A.   I CERTIFY THAT ALL THE INFORMATION GIVEN ABOVE IS TRUE TO THE BEST OF MY KNOWLEDGE AND BELIEF.",
    "B.   IN CASE, EARLIER A MEMBER OF EPF SCHEME, 1952 AND/OR EPS, 1995,",
    "       (I)   I HAVE ENSURED THE CORRECTNESS OF MY UAN/ PREVIOUS PF MEMBER ID.",
    "       (II)  THIS MAY ALSO BE TREATED AS MY REQUEST FOR TRANSFER OF FUNDS AND SERVICE DETAILS IF APPLICABLE FROM",
    "             THE PREVIOUS ACCOUNT AS DECLARED ABOVE TO THE PRESENT P.F. ACCOUNT.",
    "       (III) I AM AWARE THAT I CAN SUBMIT MY NOMINATION FORM THROUGH UAN BASED MEMBER PORTAL.",
  ]) {
    label(ctx, line, MARGIN, y, 5.8, true);
    y -= 9.5;
  }

  y -= 16;
  label(ctx, "DATE:", MARGIN, y, 6.6, true);
  dateBoxes(ctx, { day: "signature_date_day", month: "signature_date_month", year: "signature_date_year" }, MARGIN + 32, y - 4);
  label(ctx, "PLACE:", MARGIN, y - 22, 6.6, true);
  lineField(ctx, "place", MARGIN + 36, y - 26, 130, 13, 7);
  label(ctx, "SIGNATURE OF MEMBER", A4.w - MARGIN - 120, y, 6.4, true);
  lineField(ctx, "employee_signature", A4.w - MARGIN - 160, y - 26, 160, 16, 8);

  y -= 50;
  sectionBand(ctx, "DECLARATION BY PRESENT EMPLOYER", MARGIN, y - 13, W);
  y -= 28;
  label(ctx, "A.    THE MEMBER MR./MS./MRS.", MARGIN, y, 6.2);
  lineField(ctx, "employee_name_employer_decl", MARGIN + 110, y - 4, 128, 12, 6.5);
  label(ctx, "HAS JOINED ON", MARGIN + 244, y, 6.2);
  dateBoxes(ctx, { day: "doj_day", month: "doj_month", year: "doj_year" }, MARGIN + 300, y - 4);
  y -= 22;
  label(ctx, "        AND HAS BEEN ALLOTTED PF MEMBER ID", MARGIN, y, 6.2);
  lineField(ctx, "allotted_pf_member_id", MARGIN + 158, y - 4, 190, 12, 6.5);

  y -= 22;
  label(ctx, "B.    IN CASE THE PERSON WAS EARLIER NOT A MEMBER OF EPF SCHEME, 1952 AND EPS, 1995:", MARGIN, y, 6.2);
  y -= 12;
  label(ctx, "        (POST ALLOTMENT OF UAN) THE UAN ALLOTTED FOR THE MEMBER IS", MARGIN, y, 6.2);
  lineField(ctx, "allotted_uan", MARGIN + 232, y - 4, 150, 12, 6.5);
  y -= 18;
  label(ctx, "        THE KYC DETAILS OF THE ABOVE MEMBER IN THE UAN DATABASE", MARGIN, y, 6.2);
  y -= 14;
  for (const [text, field] of [
    ["HAVE NOT BEEN UPLOADED", "kyc_not_uploaded"],
    ["HAVE BEEN UPLOADED BUT NOT APPROVED", "kyc_uploaded_not_approved"],
    ["HAVE BEEN UPLOADED AND APPROVED WITH DSC", "kyc_uploaded_approved"],
  ] as const) {
    checkBox(ctx, field, "", MARGIN + 26, y - 2, 0);
    label(ctx, text, MARGIN + 46, y + 1, 6.2);
    y -= 13;
  }

  y -= 10;
  label(ctx, "DATE:", MARGIN, y, 6.6, true);
  dateBoxes(ctx, { day: "employer_date_day", month: "employer_date_month", year: "employer_date_year" }, MARGIN + 32, y - 4);
  label(ctx, "EMPLOYER:", MARGIN + 190, y, 6.4, true);
  lineField(ctx, "employer_name", MARGIN + 232, y - 4, 120, 13, 7);
  label(ctx, "SIGNATURE OF EMPLOYER WITH SEAL OF ESTABLISHMENT", A4.w - MARGIN - 214, y - 18, 6.2, true);
  lineField(ctx, "employer_signature", A4.w - MARGIN - 214, y - 48, 214, 26, 8);

  footer(ctx, "Page 3 of 3");

  ctx.form.updateFieldAppearances(ctx.font);
  return ctx.doc.save();
}

/** Field names the document_template_field_map rows fill. */
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

/**
 * Boxes the issued form carries in the employer declaration that no field map
 * fills: Payroll HR completes them after EPFO allots the member ID and UAN,
 * which happens well after the joiner signs. Listed separately so the coverage
 * test can tell them apart from a mapping mistake.
 */
export const EPF_FORM_EMPLOYER_ONLY_FIELDS = [
  "employee_name_employer_decl", "allotted_pf_member_id", "allotted_uan",
  "kyc_not_uploaded", "kyc_uploaded_not_approved", "kyc_uploaded_approved",
  "employer_date_day", "employer_date_month", "employer_date_year",
] as const;
