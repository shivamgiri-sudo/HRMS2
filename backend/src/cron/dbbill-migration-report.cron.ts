/**
 * db_bill migration-gap report — runs every 3 days.
 *
 * Finds active employees in mas_hrms whose employee_code is NOT in
 * db_bill.masjclrentry, builds an ISPart-compatible Excel (all columns filled
 * from every available source table), and emails it as an attachment to
 * tausif.ansari@teammas.in so the data-migration team can upload the file
 * directly into db_bill.
 *
 * Scheduling: self-rescheduling setTimeout, same pattern as the other crons
 * in this directory. First tick fires 1 minute after startup so the DB pool
 * is warm; subsequent ticks run every 72 hours (3 days).
 */

import XLSX from "xlsx";
import nodemailer from "nodemailer";
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { getBillPool } from "../db/billDb.js";
import { env } from "../config/env.js";

const INTERVAL_MS   = 72 * 60 * 60 * 1000; // 3 days
const FIRST_DELAY_MS =       60 * 1000;     // 1 minute after startup
const RECIPIENT      = "tausif.ansari@teammas.in";

// ── ISPart column order (165 columns — mirrors the file the migration team uses)
const ISPART_HEADERS = [
  "id","EmpType","EmpCode","EmpCodeNo","userid","BranchName","SubLocation","EmpLocation",
  "BioCode","Title","EmpName","ParentType","Father","Husband","Gendar","BloodGruop",
  "NomineeName","NomineeRelation","NomineeDob","MaritalStatus","Qualification","DOB","DOJ","DOL",
  "Adrress1","Adrress2","City","City1","State","StateId","State1","State1Id","PinCode","PinCode1",
  "Mobile","Mobile1","LandLine","LandLine1","EmailId","documentDone","OfficeEmailId",
  "PassportNo","PanNo","AdharId","Dept","Desgination","Stream","Process","Profile","ClientName",
  "CostCenter","Source","KPI","Band","CTC","EPFNo","CancelledChequeImage","AcNo","AcBank",
  "AcBranch","dlNo","EmpCodeDate","Pwd","Age","bs","hra","conv","da","portf","ma","lta","mob",
  "sa","oa","NewEpfNo","pfelig","esielig","moballow","mno","portfolio","nom1","nom2","dispens",
  "remarks","EpfDate","EmpFor","UpdatedBy","IFSCCode","AccHolder","AccType","OfferNo","package",
  "Bonus","Gross","NetInhand","ESIC","EPF","EPFCO","ESICCO","Gratuity","ProfessionalTax",
  "AccountFlag","AppointPrintDate","PayMode","AcValidationStatus","AcValidationDate",
  "AcValidatedBy","AcRejectionRemarks","AdminCharges","SourceType","BoxFileNo","RType",
  "SalaryPaymentMode","ESICNo","Approve","ApproveDate","Approve1","ApproveDate1","Status",
  "ResignationDate","AuthenticationCode","left_type","LeftReason","UAN","PLI","AssignDate",
  "lastUpdated","EntryDate","CreateDate","DownloadCount","ReleasingChequeDate","ChequeAmount",
  "ChequeDate","ChequeNo","ReasonofLeaving","FnfDoc","FnfStatus","NocValidateRemarks",
  "NocValidateDate","NocValidateBy","Interview_Id","Billable_Status","Qualification_Details",
  "Passed_Out_Year","Passed_Out_State_Id","Passed_Out_State","Passed_Out_City","Passed_Out_Percent",
  "Family_Annual_Income","Count_Of_Dependents","Reporting_Manager_Name","Reporting_Manager_Mobile_No",
  "Experience","Experience_Year","Experience_Doc","EsignatureValidateStatus",
  "EsignatureValidateRemarks","Home_Branch","Emp_Location_Type","work_status","manual_update",
  "manual_update_time","Type_Of_Employee","preEmpCode","pli_status",
];

function first(...vals: unknown[]): string {
  for (const v of vals) {
    const s = v !== null && v !== undefined ? String(v).trim() : "";
    if (s) return s;
  }
  return "";
}

function byId<T extends Record<string, unknown>>(arr: T[], key: string): Record<string, T> {
  const m: Record<string, T> = {};
  for (const r of arr) {
    const k = String(r[key] ?? "");
    if (k && !m[k]) m[k] = r;
  }
  return m;
}

function calcAge(dob: string | null): string {
  if (!dob) return "";
  const b = new Date(dob), now = new Date();
  let y = now.getFullYear() - b.getFullYear();
  let m = now.getMonth() - b.getMonth();
  if (now.getDate() < b.getDate()) m--;
  if (m < 0) { y--; m += 12; }
  return `${y} Year   ${Math.abs(m)} Month   `;
}

function fmtDate(d: Date | string | null): string {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
}

async function q<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows as T[];
}

// ─────────────────────────────────────────────────────────────────────────────

async function buildReport(): Promise<{ buffer: Buffer; count: number } | null> {
  // 1. Get EmpCodes already in db_bill
  const billPool = await getBillPool();
  const [billRows] = await billPool.execute<RowDataPacket[]>(
    "SELECT DISTINCT EmpCode FROM masjclrentry WHERE EmpCode IS NOT NULL"
  );
  const inBill = new Set(billRows.map((r) => String(r.EmpCode)));

  // 2. Active employees in mas_hrms
  const allEmps = await q<RowDataPacket>(`
    SELECT e.id AS emp_id, e.employee_code, e.candidate_id,
           e.band, e.source, e.source_type, e.sub_source,
           e.nominee_name, e.nominee_relation,
           e.bank_account_number, e.ifsc_code, e.bank_name, e.bank_branch,
           e.account_holder_name, e.account_type,
           e.epf_number, e.esic_number, e.uan_number,
           e.address_line1, e.address_line2, e.address1, e.address2,
           e.city, e.state, e.pincode,
           e.permanent_city, e.permanent_state, e.permanent_pincode,
           e.official_email, e.office_email, e.personal_email,
           e.father_name, e.gender, e.blood_group, e.marital_status,
           e.date_of_birth, e.date_of_joining,
           e.mobile, e.alternate_mobile,
           e.pan_number, e.pan_number_masked, e.aadhaar_number,
           e.ctc, e.gross_salary, e.net_inhand,
           e.annual_income, e.count_of_dependents,
           e.billable_status, e.is_billable, e.cost_center_code,
           e.emp_type, e.employment_type, e.employee_category,
           b.branch_name, d.dept_name AS department_name,
           dg.designation_name, p.process_name,
           cc.billing_client_name AS client_name,
           rm.full_name AS rm_name, rm.mobile AS rm_mobile
    FROM employees e
    LEFT JOIN branch_master b   ON b.id  = e.branch_id
    LEFT JOIN department_master d   ON d.id  = e.department_id
    LEFT JOIN designation_master dg ON dg.id = e.designation_id
    LEFT JOIN process_master p   ON p.id  = e.process_id
    LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
    LEFT JOIN employees rm ON rm.id = e.reporting_manager_id
    WHERE e.employment_status = 'active'`);

  const missing = allEmps.filter((e) => !inBill.has(String(e.employee_code)));
  if (missing.length === 0) return null;

  const empIds     = missing.map((e) => e.emp_id).filter(Boolean) as string[];
  const candIds    = missing.map((e) => e.candidate_id).filter(Boolean) as string[];
  const phId       = empIds.map(() => "?").join(",");
  const phCid      = candIds.map(() => "?").join(",");

  // 3. Supplementary tables
  const bankRows   = empIds.length ? await q(`
    SELECT employee_id, bank_name, account_holder_name, bank_branch,
           account_number, ifsc_code, account_type, verified, is_primary
    FROM employee_bank_detail WHERE employee_id IN (${phId}) AND active_status=1
    ORDER BY is_primary DESC, verified DESC`, empIds) : [];
  const bankById   = byId(bankRows, "employee_id");

  const obBankRows = candIds.length ? await q(`
    SELECT candidate_id, bank_name, branch_name, account_holder_name,
           account_no_masked, ifsc_code, account_type, name_on_cheque
    FROM candidate_onboarding_bank_detail WHERE candidate_id IN (${phCid})`, candIds) : [];
  const obBankByCid= byId(obBankRows, "candidate_id");

  const atsBankRows= candIds.length ? await q(`
    SELECT id AS candidate_id, bank_account_no_masked, bank_ifsc, bank_name
    FROM ats_candidate WHERE id IN (${phCid})`, candIds) : [];
  const atsBankByCid=byId(atsBankRows, "candidate_id");

  const addrRows   = empIds.length ? await q(`
    SELECT employee_id, address_type, address_line1, address_line2, city, state, pincode
    FROM employee_address WHERE employee_id IN (${phId})`, empIds) : [];
  const curAddr: Record<string, RowDataPacket> = {};
  const perAddr: Record<string, RowDataPacket> = {};
  for (const r of addrRows) {
    const t = String(r.address_type || "").toLowerCase();
    if (t.includes("current")   && !curAddr[r.employee_id as string]) curAddr[r.employee_id as string] = r;
    if (t.includes("permanent") && !perAddr[r.employee_id as string]) perAddr[r.employee_id as string] = r;
  }

  const obProfRows = candIds.length ? await q(`
    SELECT candidate_id, present_city, present_state, present_pincode,
           present_address_line1, present_address_line2,
           permanent_city, permanent_state, permanent_pincode,
           nominee_name, nominee_relation, nominee_date_of_birth
    FROM candidate_onboarding_profile WHERE candidate_id IN (${phCid})`, candIds) : [];
  const obProfByCid= byId(obProfRows, "candidate_id");

  const bgvRows    = candIds.length ? await q(`
    SELECT candidate_id, current_city, current_state, current_pincode,
           permanent_city, permanent_state, permanent_pincode
    FROM ats_bgv_response WHERE candidate_id IN (${phCid}) ORDER BY id DESC`, candIds) : [];
  const bgvByCid   = byId(bgvRows, "candidate_id");

  const nomRows    = empIds.length ? await q(`
    SELECT employee_id, nominee_name, relationship AS nominee_relation, date_of_birth AS nominee_dob
    FROM employee_nominee WHERE employee_id IN (${phId})
    ORDER BY share_percentage DESC, id ASC`, empIds) : [];
  const nomById    = byId(nomRows, "employee_id");

  const obNomRows  = candIds.length ? await q(`
    SELECT candidate_id, nominee_name, relation AS nominee_relation, dob AS nominee_dob
    FROM candidate_onboarding_nominee WHERE candidate_id IN (${phCid}) AND is_primary=1`, candIds) : [];
  const obNomByCid = byId(obNomRows, "candidate_id");

  const salRows    = empIds.length ? await q(`
    SELECT s.employee_id, s.basic, s.hra, s.conveyance, s.bonus, s.portfolio,
           s.medical_allowance, s.lta, s.other_allowance, s.pli,
           s.special_allowance, s.gross, s.ctc, s.net_estimate,
           s.pf_employee, s.esic_employee, s.employer_pf, s.employer_esi,
           s.pf_applicable, s.esi_applicable, s.salary_slab
    FROM salary_component_assignments s
    INNER JOIN (
      SELECT employee_id, MAX(effective_date) AS md
      FROM salary_component_assignments WHERE status='active' AND employee_id IN (${phId})
      GROUP BY employee_id
    ) lat ON lat.employee_id=s.employee_id AND s.effective_date=lat.md
    WHERE s.status='active'`, empIds) : [];
  const salById    = byId(salRows, "employee_id");

  const eduRows    = empIds.length ? await q(`
    SELECT e2.employee_id, e2.qualification, e2.specialization_course_name,
           e2.passed_out_year, e2.passed_out_state, e2.passed_out_city, e2.passed_out_percentage
    FROM employee_education e2
    INNER JOIN (
      SELECT employee_id, MAX(passed_out_year) AS my
      FROM employee_education WHERE employee_id IN (${phId}) GROUP BY employee_id
    ) lat ON lat.employee_id=e2.employee_id AND e2.passed_out_year=lat.my`, empIds) : [];
  const eduById    = byId(eduRows, "employee_id");

  // 4. Build rows
  const sheetRows: unknown[][] = [ISPART_HEADERS];

  for (const e of missing) {
    const eid  = String(e.emp_id  || "");
    const cid  = String(e.candidate_id || "");
    const bank = bankById[eid]     || {};
    const obB  = obBankByCid[cid]  || {};
    const atsB = atsBankByCid[cid] || {};
    const cur  = curAddr[eid]      || {};
    const per  = perAddr[eid]      || {};
    const obP  = obProfByCid[cid]  || {};
    const bgv  = bgvByCid[cid]     || {};
    const nom  = nomById[eid]      || {};
    const obN  = obNomByCid[cid]   || {};
    const sal  = salById[eid]      || null;
    const edu  = eduById[eid]      || null;

    const rawType = String((e.emp_type || e.employment_type) ?? "").trim().toUpperCase();
    const empType = rawType.includes("MGMT") ? "MGMT. TRAINEE"
      : rawType.includes("OFF") ? "OFFROLL" : "ONROLL";

    const pfElig  = sal ? (sal.pf_applicable  ? "YES" : "NO") : (e.epf_number  ? "YES" : "NO");
    const esiElig = sal ? (sal.esi_applicable ? "YES" : "NO") : (e.esic_number ? "YES" : "NO");

    const acNo     = first(bank.account_number, obB.account_no_masked, atsB.bank_account_no_masked, e.bank_account_number);
    const ifsc     = first(bank.ifsc_code, obB.ifsc_code, atsB.bank_ifsc, e.ifsc_code);
    const acBank   = first(bank.bank_name,  obB.bank_name, atsB.bank_name, e.bank_name);
    const acBranch = first(bank.bank_branch, obB.branch_name, e.bank_branch);
    const holder   = first(bank.account_holder_name, obB.account_holder_name, obB.name_on_cheque, e.account_holder_name);
    const accType  = first(bank.account_type, obB.account_type, e.account_type);

    const city   = first(cur.city,    obP.present_city,    bgv.current_city,   e.city);
    const state  = first(cur.state,   obP.present_state,   bgv.current_state,  e.state);
    const pin    = first(cur.pincode, obP.present_pincode, bgv.current_pincode,e.pincode);
    const city1  = first(per.city,    obP.permanent_city,  bgv.permanent_city, e.permanent_city, city);
    const state1 = first(per.state,   obP.permanent_state, bgv.permanent_state,e.permanent_state, state);
    const pin1   = first(per.pincode, obP.permanent_pincode,bgv.permanent_pincode,e.permanent_pincode, pin);
    const addr1  = first(cur.address_line1, obP.present_address_line1, e.address_line1, e.address1);
    const addr2  = first(cur.address_line2, obP.present_address_line2, e.address_line2, e.address2);

    const nomName = first(nom.nominee_name, obN.nominee_name, obP.nominee_name, e.nominee_name);
    const nomRel  = first(nom.nominee_relation, obN.nominee_relation, obP.nominee_relation, e.nominee_relation);
    const nomDob  = first(nom.nominee_dob,  obN.nominee_dob, obP.nominee_date_of_birth);

    const gender = String(e.gender || "").toUpperCase();
    const married = String(e.marital_status || "").toUpperCase() === "MARRIED";
    const title   = gender === "FEMALE" ? (married ? "Mrs" : "Ms") : "Mr";

    const rowMap: Record<string, unknown> = {
      id: "", EmpType: empType, EmpCode: e.employee_code, EmpCodeNo: "", userid: "",
      BranchName: first(e.branch_name), SubLocation: "", EmpLocation: "OnSite",
      BioCode: first(e.employee_code), Title: title,
      EmpName: e.full_name || `${e.first_name || ""} ${e.last_name || ""}`.trim(),
      ParentType: "Father", Father: first(e.father_name), Husband: "", Gendar: gender,
      BloodGruop: first(e.blood_group), NomineeName: nomName, NomineeRelation: nomRel,
      NomineeDob: nomDob, MaritalStatus: first(e.marital_status),
      Qualification: first(edu?.qualification), DOB: fmtDate(e.date_of_birth as string),
      DOJ: fmtDate(e.date_of_joining as string), DOL: "",
      Adrress1: addr1, Adrress2: addr2, City: city, City1: city1,
      State: state, StateId: "", State1: state1, State1Id: "",
      PinCode: pin, PinCode1: pin1,
      Mobile: first(e.mobile), Mobile1: first(e.alternate_mobile, e.mobile),
      LandLine: "", LandLine1: "",
      EmailId: first(e.personal_email), documentDone: "",
      OfficeEmailId: first(e.official_email, e.office_email),
      PassportNo: "", PanNo: first(e.pan_number_masked, e.pan_number),
      AdharId: first(e.aadhaar_number),
      Dept: first(e.department_name), Desgination: first(e.designation_name),
      Stream: "", Process: first(e.process_name), Profile: "",
      ClientName: first(e.client_name), CostCenter: first(e.cost_center_code),
      Source: first(e.source), KPI: "", Band: first(e.band),
      CTC: first(sal?.ctc, e.ctc), EPFNo: first(e.epf_number),
      CancelledChequeImage: "",
      AcNo: acNo, AcBank: acBank, AcBranch: acBranch,
      dlNo: "", EmpCodeDate: "", Pwd: "bpsbps",
      Age: calcAge(e.date_of_birth as string),
      bs: first(sal?.basic), hra: first(sal?.hra), conv: first(sal?.conveyance),
      da: "", portf: first(sal?.portfolio), ma: first(sal?.medical_allowance),
      lta: first(sal?.lta), mob: "", sa: first(sal?.special_allowance),
      oa: first(sal?.other_allowance),
      NewEpfNo: first(e.epf_number), pfelig: pfElig, esielig: esiElig,
      moballow: "", mno: "", portfolio: "", nom1: "", nom2: "", dispens: "", remarks: "",
      EpfDate: "", EmpFor: "HRMS", UpdatedBy: "",
      IFSCCode: ifsc, AccHolder: holder, AccType: accType,
      OfferNo: first(e.employee_code), package: first(sal?.salary_slab),
      Bonus: first(sal?.bonus), Gross: first(sal?.gross, e.gross_salary),
      NetInhand: first(sal?.net_estimate, e.net_inhand),
      ESIC: first(sal?.esic_employee), EPF: first(sal?.pf_employee),
      EPFCO: first(sal?.employer_pf), ESICCO: first(sal?.employer_esi),
      Gratuity: "", ProfessionalTax: "",
      AccountFlag: acNo ? "2" : "",
      AppointPrintDate: "", PayMode: "ECS",
      AcValidationStatus: acNo ? "Yes" : "", AcValidationDate: "", AcValidatedBy: "",
      AcRejectionRemarks: "", AdminCharges: "",
      SourceType: first(e.source_type, e.sub_source), BoxFileNo: "", RType: "",
      SalaryPaymentMode: "Cheque", ESICNo: first(e.esic_number),
      Approve: "", ApproveDate: "", Approve1: "", ApproveDate1: "",
      Status: "1", ResignationDate: "", AuthenticationCode: "",
      left_type: "", LeftReason: "", UAN: first(e.uan_number),
      PLI: first(sal?.pli), AssignDate: "",
      lastUpdated: fmtDate(e.updated_at as string),
      EntryDate: fmtDate(e.created_at as string),
      CreateDate: fmtDate(e.created_at as string),
      DownloadCount: "", ReleasingChequeDate: "", ChequeAmount: "",
      ChequeDate: "", ChequeNo: "", ReasonofLeaving: "", FnfDoc: "", FnfStatus: "",
      NocValidateRemarks: "", NocValidateDate: "", NocValidateBy: "", Interview_Id: "",
      Billable_Status: first(e.billable_status, e.is_billable ? "Yes" : ""),
      Qualification_Details: first(edu?.specialization_course_name),
      Passed_Out_Year: first(edu?.passed_out_year), Passed_Out_State_Id: "",
      Passed_Out_State: first(edu?.passed_out_state),
      Passed_Out_City: first(edu?.passed_out_city),
      Passed_Out_Percent: first(edu?.passed_out_percentage),
      Family_Annual_Income: e.annual_income ?? "",
      Count_Of_Dependents: e.count_of_dependents ?? "",
      Reporting_Manager_Name: first(e.rm_name),
      Reporting_Manager_Mobile_No: first(e.rm_mobile),
      Experience: "", Experience_Year: "", Experience_Doc: "",
      EsignatureValidateStatus: "", EsignatureValidateRemarks: "",
      Home_Branch: "", Emp_Location_Type: "", work_status: "WFO",
      manual_update: "", manual_update_time: "",
      Type_Of_Employee: first(e.employee_category, "BMC"),
      preEmpCode: "", pli_status: 0,
    };

    sheetRows.push(ISPART_HEADERS.map((h) => rowMap[h] ?? ""));
  }

  // 5. Build Excel buffer
  const wbOut = XLSX.utils.book_new();
  const wsOut = XLSX.utils.aoa_to_sheet(sheetRows);
  wsOut["!cols"] = ISPART_HEADERS.map((_, i) => {
    const maxLen = sheetRows.reduce((m, r) => Math.max(m, String((r as unknown[])[i] ?? "").length), 4);
    return { wch: Math.min(maxLen + 2, 40) };
  });
  XLSX.utils.book_append_sheet(wbOut, wsOut, "ISPart Data");
  const buffer = XLSX.write(wbOut, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return { buffer, count: missing.length };
}

// ─────────────────────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host:   env.SMTP_HOST || "smtp.gmail.com",
  port:   Number(env.SMTP_PORT || 587),
  secure: false,
  auth: { user: env.SMTP_USER || "", pass: env.SMTP_PASS || "" },
});

async function sendReport(): Promise<void> {
  console.log("[CRON] dbbill-migration-report: building...");
  try {
    const result = await buildReport();
    if (!result) {
      console.log("[CRON] dbbill-migration-report: no missing employees — skipping email");
      return;
    }

    const today    = new Date().toISOString().slice(0, 10);
    const filename = `ISPart_Missing_Employees_${today}.xlsx`;

    await transporter.sendMail({
      from:    `"MAS PeopleOS" <${env.SMTP_USER}>`,
      to:      RECIPIENT,
      subject: `[PeopleOS] ${result.count} Employees Missing from db_bill — ${today}`,
      html: `
        <p>Hi Tausif,</p>
        <p>The automated db_bill migration check found <strong>${result.count} active employees</strong>
        in MAS HRMS whose employee codes are not yet in <code>db_bill.masjclrentry</code>.</p>
        <p>The attached Excel is ready for direct upload into db_bill (ISPart format, all columns filled
        from onboarding, bank verification, address, nominee and salary data).</p>
        <p>Columns with no data in HRMS yet (bank details not submitted, etc.) are left blank —
        those employees need to complete their onboarding profile first.</p>
        <hr/>
        <p style="color:#888;font-size:12px">Sent automatically every 3 days by MAS PeopleOS.<br/>
        Source: mas_hrms employees vs db_bill.masjclrentry</p>
      `,
      attachments: [{
        filename,
        content:  result.buffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }],
    });

    console.log(`[CRON] dbbill-migration-report: emailed ${result.count} employees to ${RECIPIENT}`);
  } catch (err) {
    console.error("[CRON] dbbill-migration-report: failed —", (err as Error).message);
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

let timer: NodeJS.Timeout | undefined;

function scheduleNext(delayMs: number): void {
  timer = setTimeout(tick, delayMs);
  timer.unref();
}

async function tick(): Promise<void> {
  await sendReport();
  scheduleNext(INTERVAL_MS);
}

export function startDbbillMigrationReportCron(): void {
  scheduleNext(FIRST_DELAY_MS);
  console.log("[CRON] dbbill-migration-report: scheduled — first run in 1 min, then every 3 days");
}
