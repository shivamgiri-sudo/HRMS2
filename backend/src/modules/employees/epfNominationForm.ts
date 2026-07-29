/**
 * EPF & EPS Nomination and Declaration Form (Form 2, Revised) as a fillable
 * AcroForm PDF.
 *
 * Built rather than downloaded for the same reason as Form 11: the EPFO-issued
 * PDF is a flat scan with no form fields, so nothing can be written into it and
 * no box coordinates can be recovered from it.
 *
 * What can and cannot be auto-filled, measured against the live data:
 *
 *   Part A (Provident Fund, Para 33 & 61(1)) — auto-filled. employee_nominee
 *   holds a PF nominee for essentially every employee (nominee_for includes
 *   'pf'), with name, relationship, date of birth and share.
 *
 *   Part B (Pension Scheme, Para 18) — NOT auto-filled. It asks for the whole
 *   family, and no pension-family records exist: nominee_for only ever contains
 *   'gratuity,pf'. Inventing a family from the PF nominee would put false
 *   statutory declarations in front of a member for signature, so Part B is
 *   left for the member to complete at signing.
 *
 * Four nominee and four family rows are provided because the form allows
 * several, even though today every employee has exactly one nominee.
 */
import {
  A4, MARGIN, type Ctx,
  newFormDoc, newPage, label, footer, lineField, checkBox, dateBoxes, tableGrid,
} from "./pdfFormBuilder.js";

const NOMINEE_ROWS = 4;
const FAMILY_ROWS = 4;

export async function buildEpfNominationPdf(): Promise<Uint8Array> {
  const ctx = await newFormDoc("EPF & EPS Nomination and Declaration Form (Form 2)");

  // ── Page 1: header + member details + Part A nominee table ──────────────
  label(ctx, "FORM 2 (REVISED)", MARGIN, ctx.y, 13, true);
  label(ctx, "THE EMPLOYEES' PROVIDENT FUNDS SCHEME, 1952 (Paragraph 33 & 61(1))", MARGIN, ctx.y - 15, 7.5);
  label(ctx, "THE EMPLOYEES' PENSION SCHEME, 1995 (Paragraph 18)", MARGIN, ctx.y - 26, 7.5);
  label(ctx, "Nomination and Declaration Form for Unexempted / Exempted Establishments", MARGIN, ctx.y - 40, 8, true);

  let y = ctx.y - 64;
  const row = (text: string, name: string, width = 300, labelW = 200) => {
    label(ctx, text, MARGIN, y, 8);
    lineField(ctx, name, MARGIN + labelW, y - 4, width);
    y -= 24;
  };

  row("1.  Name (in block letters)", "member_name", 330);
  row("2.  Father's / Husband's Name", "father_or_husband_name", 330);

  label(ctx, "3.  Relationship in respect of (2)", MARGIN, y, 8);
  checkBox(ctx, "relationship_father", "Father", MARGIN + 200, y - 4, 34);
  checkBox(ctx, "relationship_husband", "Husband", MARGIN + 290, y - 4, 42);
  y -= 26;

  label(ctx, "4.  Date of Birth  (DD / MM / YYYY)", MARGIN, y, 8);
  dateBoxes(ctx, { day: "dob_day", month: "dob_month", year: "dob_year" }, MARGIN + 200, y - 4);
  y -= 28;

  label(ctx, "5.  Sex", MARGIN, y, 8);
  checkBox(ctx, "gender_male", "Male", MARGIN + 200, y - 4, 28);
  checkBox(ctx, "gender_female", "Female", MARGIN + 280, y - 4, 36);
  checkBox(ctx, "gender_other", "Transgender", MARGIN + 370, y - 4, 60);
  y -= 26;

  label(ctx, "6.  Marital Status", MARGIN, y, 8);
  checkBox(ctx, "marital_status_married", "Married", MARGIN + 200, y - 4, 44);
  checkBox(ctx, "marital_status_unmarried", "Unmarried", MARGIN + 300, y - 4, 54);
  y -= 26;

  row("7.  Account No. / UAN", "account_number", 200);
  row("8.  Permanent Address", "permanent_address", 330);
  row("9.  Temporary Address", "temporary_address", 330);

  y -= 6;
  label(ctx, "PART A  (EPF)", MARGIN, y, 9, true);
  y -= 12;
  label(ctx,
    "I hereby nominate the person(s) / cancel the nomination made by me previously and nominate the person(s) mentioned below to receive the",
    MARGIN, y, 6.8);
  label(ctx,
    "amount standing to my credit in the Employees' Provident Fund, in the event of my death.",
    MARGIN, y - 9, 6.8);
  y -= 26;

  // Columns follow the printed form: name, address, relationship, DOB, share, guardian.
  const nomineeHeads = ["Name of the nominee", "Address", "Relationship", "Date of Birth", "Share %", "Guardian (if minor)"];
  const nomineeWidths = [104, 120, 62, 62, 40, 140];
  label(ctx, "Nominee details", MARGIN, y, 8, true);
  y -= 12;
  const headTop = y;
  const nxs = tableGrid(ctx, MARGIN, headTop, nomineeWidths, 20, NOMINEE_ROWS + 1);
  nomineeHeads.forEach((head, i) => label(ctx, head, nxs[i] + 3, headTop - 13, 6.2, true));

  for (let r = 0; r < NOMINEE_ROWS; r++) {
    const rowY = headTop - 20 * (r + 2) + 3;
    const n = r + 1;
    const cell = (col: number, name: string) =>
      lineField(ctx, name, nxs[col] + 1, rowY, nomineeWidths[col] - 2, 14, 6.5);
    cell(0, `nominee_${n}_name`);
    cell(1, `nominee_${n}_address`);
    cell(2, `nominee_${n}_relationship`);
    cell(3, `nominee_${n}_dob`);
    cell(4, `nominee_${n}_share`);
    cell(5, `nominee_${n}_guardian`);
  }
  y = headTop - 20 * (NOMINEE_ROWS + 1) - 16;

  label(ctx,
    "Certified that I have no family as defined in Para 2(g) of the Employees' Provident Funds Scheme, 1952 and should I acquire a family",
    MARGIN, y, 6.8);
  label(ctx, "hereafter the above nomination shall be deemed as cancelled.", MARGIN, y - 9, 6.8);
  y -= 26;

  label(ctx, "Date:", MARGIN, y, 8);
  dateBoxes(ctx, { day: "parta_date_day", month: "parta_date_month", year: "parta_date_year" }, MARGIN + 34, y - 4);
  label(ctx, "Place:", MARGIN + 190, y, 8);
  lineField(ctx, "parta_place", MARGIN + 224, y - 4, 110);
  label(ctx, "Signature / Thumb impression of the member", MARGIN + 350, y + 2, 6.8, true);
  lineField(ctx, "parta_signature", MARGIN + 350, y - 16, 170);

  footer(ctx, "Page 1 of 2");

  // ── Page 2: Part B + employer certificate ───────────────────────────────
  y = newPage(ctx);
  label(ctx, "PART B  (EPS)  —  Paragraph 18", MARGIN, y, 9, true);
  y -= 14;
  label(ctx,
    "I hereby furnish below particulars of the members of my family who would be eligible to receive Widow / Children pension in the event of my",
    MARGIN, y, 6.8);
  label(ctx, "death.", MARGIN, y - 9, 6.8);
  y -= 26;

  const familyHeads = ["Name of the family member", "Address", "Date of Birth", "Relationship with the member"];
  const familyWidths = [140, 150, 78, 160];
  const fTop = y;
  const fxs = tableGrid(ctx, MARGIN, fTop, familyWidths, 20, FAMILY_ROWS + 1);
  familyHeads.forEach((head, i) => label(ctx, head, fxs[i] + 3, fTop - 13, 6.2, true));
  for (let r = 0; r < FAMILY_ROWS; r++) {
    const rowY = fTop - 20 * (r + 2) + 3;
    const n = r + 1;
    const cell = (col: number, name: string) =>
      lineField(ctx, name, fxs[col] + 1, rowY, familyWidths[col] - 2, 14, 6.5);
    cell(0, `family_${n}_name`);
    cell(1, `family_${n}_address`);
    cell(2, `family_${n}_dob`);
    cell(3, `family_${n}_relationship`);
  }
  y = fTop - 20 * (FAMILY_ROWS + 1) - 18;

  label(ctx,
    "Certified that I have no family as defined in Para 2(vii) of the Employees' Pension Scheme, 1995 and should I acquire a family hereafter I",
    MARGIN, y, 6.8);
  label(ctx, "shall furnish particulars thereon in the above form.", MARGIN, y - 9, 6.8);
  y -= 24;

  label(ctx,
    "I hereby nominate the following person for receiving the monthly widow pension (admissible under Para 16 2(a)(i)(ii)) in the event of my",
    MARGIN, y, 6.8);
  label(ctx, "death without leaving any eligible family member for receiving pension.", MARGIN, y - 9, 6.8);
  y -= 24;

  label(ctx, "Name and address of the nominee:", MARGIN, y, 8);
  lineField(ctx, "eps_nominee_name", MARGIN + 170, y - 4, 170);
  lineField(ctx, "eps_nominee_address", MARGIN + 348, y - 4, 172);
  y -= 26;
  label(ctx, "Date of Birth:", MARGIN, y, 8);
  dateBoxes(ctx, { day: "eps_nominee_dob_day", month: "eps_nominee_dob_month", year: "eps_nominee_dob_year" }, MARGIN + 78, y - 4);
  label(ctx, "Relationship:", MARGIN + 260, y, 8);
  lineField(ctx, "eps_nominee_relationship", MARGIN + 322, y - 4, 150);
  y -= 32;

  label(ctx, "Date:", MARGIN, y, 8);
  dateBoxes(ctx, { day: "partb_date_day", month: "partb_date_month", year: "partb_date_year" }, MARGIN + 34, y - 4);
  label(ctx, "Place:", MARGIN + 190, y, 8);
  lineField(ctx, "partb_place", MARGIN + 224, y - 4, 110);
  label(ctx, "Signature / Thumb impression of the member", MARGIN + 350, y + 2, 6.8, true);
  lineField(ctx, "partb_signature", MARGIN + 350, y - 16, 170);
  y -= 48;

  label(ctx, "CERTIFICATE BY EMPLOYER", MARGIN, y, 9, true);
  y -= 14;
  label(ctx,
    "Certified that the above declaration and nomination has been signed by the member employed in my establishment after he / she has read the",
    MARGIN, y, 6.8);
  label(ctx,
    "entries / the entries have been read over to him / her by me and got confirmed by him / her.",
    MARGIN, y - 9, 6.8);
  y -= 28;

  label(ctx, "Name and address of the establishment:", MARGIN, y, 8);
  lineField(ctx, "establishment_name", MARGIN + 196, y - 4, 320);
  y -= 24;
  label(ctx, "Date:", MARGIN, y, 8);
  dateBoxes(ctx, { day: "employer_date_day", month: "employer_date_month", year: "employer_date_year" }, MARGIN + 34, y - 4);
  label(ctx, "Signature of the employer with designation and rubber stamp", MARGIN + 260, y + 2, 6.8, true);
  lineField(ctx, "employer_signature", MARGIN + 260, y - 16, 260);

  footer(ctx, "Page 2 of 2");

  ctx.form.updateFieldAppearances(ctx.font);
  return ctx.doc.save();
}

/** Field names this form exposes — asserted against the DB maps in tests. */
export const EPF_NOMINATION_FIELD_NAMES: string[] = [
  "member_name", "father_or_husband_name",
  "relationship_father", "relationship_husband",
  "dob_day", "dob_month", "dob_year",
  "gender_male", "gender_female", "gender_other",
  "marital_status_married", "marital_status_unmarried",
  "account_number", "permanent_address", "temporary_address",
  ...Array.from({ length: NOMINEE_ROWS }, (_, i) => i + 1).flatMap((n) => [
    `nominee_${n}_name`, `nominee_${n}_address`, `nominee_${n}_relationship`,
    `nominee_${n}_dob`, `nominee_${n}_share`, `nominee_${n}_guardian`,
  ]),
  "parta_date_day", "parta_date_month", "parta_date_year", "parta_place", "parta_signature",
  ...Array.from({ length: FAMILY_ROWS }, (_, i) => i + 1).flatMap((n) => [
    `family_${n}_name`, `family_${n}_address`, `family_${n}_dob`, `family_${n}_relationship`,
  ]),
  "eps_nominee_name", "eps_nominee_address", "eps_nominee_relationship",
  "eps_nominee_dob_day", "eps_nominee_dob_month", "eps_nominee_dob_year",
  "partb_date_day", "partb_date_month", "partb_date_year", "partb_place", "partb_signature",
  "establishment_name", "employer_signature",
  "employer_date_day", "employer_date_month", "employer_date_year",
];

/**
 * Field maps for Form 2, in the shape document_template_field_map expects.
 * Part B rows carry no source_path: they are member-completed at signing.
 */
export function epfNominationFieldMaps() {
  type Map_ = {
    field_key: string; pdf_field_name: string; field_label: string;
    field_type?: string; source_path?: string | null;
    transform_rule?: string | null; checked_when?: string | null;
  };
  const text = (name: string, field_label: string, source_path: string | null, transform_rule?: string): Map_ =>
    ({ field_key: name, pdf_field_name: name, field_label, field_type: "text", source_path, transform_rule: transform_rule ?? null });
  const check = (name: string, field_label: string, source_path: string | null, checked_when: string): Map_ =>
    ({ field_key: name, pdf_field_name: name, field_label, field_type: "checkbox", source_path, checked_when });

  const maps: Map_[] = [
    text("member_name", "Member Name", "epf.employee_name"),
    text("father_or_husband_name", "Father / Husband Name", "epf.father_or_spouse_name"),
    check("relationship_father", "Relationship - Father", "epf.relationship_type", "father"),
    check("relationship_husband", "Relationship - Husband", "epf.relationship_type", "husband"),
    text("dob_day", "DOB Day", "epf.date_of_birth", "date_day"),
    text("dob_month", "DOB Month", "epf.date_of_birth", "date_month"),
    text("dob_year", "DOB Year", "epf.date_of_birth", "date_year"),
    check("gender_male", "Sex - Male", "epf.gender", "Male"),
    check("gender_female", "Sex - Female", "epf.gender", "Female"),
    check("gender_other", "Sex - Transgender", "epf.gender", "Other"),
    check("marital_status_married", "Marital Status - Married", "epf.marital_status", "Married"),
    check("marital_status_unmarried", "Marital Status - Unmarried", "epf.marital_status", "Unmarried"),
    // Real UAN is supplied at signing; the stored value is masked.
    text("account_number", "Account No. / UAN", "epf.uan_masked"),
    text("permanent_address", "Permanent Address", "employee.permanent_address"),
    text("temporary_address", "Temporary Address", "employee.current_address"),
  ];

  for (let n = 1; n <= NOMINEE_ROWS; n++) {
    maps.push(
      text(`nominee_${n}_name`, `Nominee ${n} Name`, `nominee.n${n}_name`),
      text(`nominee_${n}_address`, `Nominee ${n} Address`, `nominee.n${n}_address`),
      text(`nominee_${n}_relationship`, `Nominee ${n} Relationship`, `nominee.n${n}_relationship`),
      text(`nominee_${n}_dob`, `Nominee ${n} Date of Birth`, `nominee.n${n}_date_of_birth`),
      text(`nominee_${n}_share`, `Nominee ${n} Share %`, `nominee.n${n}_share_percentage`),
      text(`nominee_${n}_guardian`, `Nominee ${n} Guardian`, `nominee.n${n}_guardian_name`),
    );
  }

  maps.push(
    text("parta_date_day", "Part A Date Day", "system.current_date", "date_day"),
    text("parta_date_month", "Part A Date Month", "system.current_date", "date_month"),
    text("parta_date_year", "Part A Date Year", "system.current_date", "date_year"),
    text("parta_place", "Part A Place", "epf.branch_name_snapshot"),
    text("parta_signature", "Part A Signature", null),
  );

  // Part B: pension family particulars. No source — see the note at the top.
  for (let n = 1; n <= FAMILY_ROWS; n++) {
    maps.push(
      text(`family_${n}_name`, `Family Member ${n} Name`, null),
      text(`family_${n}_address`, `Family Member ${n} Address`, null),
      text(`family_${n}_dob`, `Family Member ${n} Date of Birth`, null),
      text(`family_${n}_relationship`, `Family Member ${n} Relationship`, null),
    );
  }

  maps.push(
    text("eps_nominee_name", "EPS Nominee Name", null),
    text("eps_nominee_address", "EPS Nominee Address", null),
    text("eps_nominee_relationship", "EPS Nominee Relationship", null),
    text("eps_nominee_dob_day", "EPS Nominee DOB Day", null, "date_day"),
    text("eps_nominee_dob_month", "EPS Nominee DOB Month", null, "date_month"),
    text("eps_nominee_dob_year", "EPS Nominee DOB Year", null, "date_year"),
    text("partb_date_day", "Part B Date Day", "system.current_date", "date_day"),
    text("partb_date_month", "Part B Date Month", "system.current_date", "date_month"),
    text("partb_date_year", "Part B Date Year", "system.current_date", "date_year"),
    text("partb_place", "Part B Place", "epf.branch_name_snapshot"),
    text("partb_signature", "Part B Signature", null),
    text("establishment_name", "Establishment Name and Address", "system.company_name"),
    text("employer_signature", "Employer Signature", null),
    text("employer_date_day", "Employer Date Day", "system.current_date", "date_day"),
    text("employer_date_month", "Employer Date Month", "system.current_date", "date_month"),
    text("employer_date_year", "Employer Date Year", "system.current_date", "date_year"),
  );

  return maps;
}
