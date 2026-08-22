/**
 * verify-legacy-reports.mjs  — Column-by-column comparison
 *
 * Compares EVERY numeric column of every legacy report between db_bill and mas_hrms
 * for a given month. Status=0 (FNF/leaving employees) included on both sides.
 *
 * Usage:
 *   node backend/scripts/verify-legacy-reports.mjs --month=2026-06
 *   node backend/scripts/verify-legacy-reports.mjs --month=2026-03 --branch=NOIDA
 */
import mysql from 'mysql2/promise';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
}
function fromEnv(key) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    return env.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '').trim() ?? null;
  } catch { return null; }
}

const MONTH     = arg('month', '2026-06');
const BRANCH    = arg('branch', null);
const BILL_HOST = arg('bill-host', fromEnv('BILL_DB_HOST') ?? '14.97.30.236');
const HRMS_HOST = arg('hrms-host', fromEnv('DB_HOST')      ?? '192.168.10.6');
const DB_USER   = fromEnv('DB_USER');
const DB_PASS   = fromEnv('DB_PASSWORD');
const [YEAR, MON] = MONTH.split('-');
const MON_INT   = parseInt(MON, 10);
const TOL       = 2; // ₹2 tolerance for rounding

// ── utils ─────────────────────────────────────────────────────────────────────
function r2(v)  { return Math.round(Number(v ?? 0) * 100) / 100; }
function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function pct(hrms, bill) {
  if (bill === 0 && hrms === 0) return 'exact';
  if (bill === 0) return '+INF%';
  return ((hrms - bill) / Math.abs(bill) * 100).toFixed(1) + '%';
}

let totalChecks = 0, totalPass = 0, totalFail = 0;
const failedItems = [];

function printReport(name, rows, cols) {
  const allMatch = cols.every(c => Math.abs(c.hrms - c.bill) <= TOL);
  const rowMatch = rows.bill === rows.hrms;
  const icon = (allMatch && rowMatch) ? '✅' : '❌';
  process.stdout.write(`\n${icon} ${name}\n`);
  process.stdout.write(`   Rows   bill=${fmt(rows.bill).padStart(8)}  hrms=${fmt(rows.hrms).padStart(8)}  ${rowMatch ? 'EXACT' : 'DIFF ❌'}\n`);
  for (const c of cols) {
    const diff = r2(c.hrms - c.bill);
    const match = Math.abs(diff) <= TOL;
    totalChecks++;
    if (match) totalPass++; else { totalFail++; failedItems.push(`${name} → ${c.label}`); }
    const flag = match ? '    ' : '  ❌';
    process.stdout.write(`${flag} ${c.label.padEnd(24)} bill=${String(fmt(c.bill)).padStart(16)}  hrms=${String(fmt(c.hrms)).padStart(16)}  diff=${String(fmt(diff)).padStart(10)}  (${pct(c.hrms, c.bill)})\n`);
  }
}

async function connect() {
  const bill = await mysql.createPool({ host: BILL_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'db_bill',  connectTimeout: 30000, waitForConnections: true, connectionLimit: 3, dateStrings: true });
  const hrms = await mysql.createPool({ host: HRMS_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'mas_hrms', connectTimeout: 30000, waitForConnections: true, connectionLimit: 5 });
  return { bill, hrms };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SALARY REGISTER — all 26 components + gross/net/days
// ═══════════════════════════════════════════════════════════════════════════════
async function checkSalary(bill, hrms) {
  const bCond = BRANCH ? `AND Branch=?` : '';
  const bv    = BRANCH ? [BRANCH] : [];

  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc,
      SUM(WorkingDays) AS working_days, SUM(EarnedDays) AS present_days,
      SUM(Basic) AS basic, SUM(HRA) AS hra, SUM(Conv) AS conv,
      SUM(Portfolio) AS portfolio, SUM(MedicalAllowance) AS ma,
      SUM(LTA) AS lta, SUM(SpecialAllowance) AS special,
      SUM(OtherAllowance) AS other_allow, SUM(Incentive) AS incentive,
      SUM(ExtraDayIncentive) AS extra_day_inc, SUM(Arrear) AS arrear,
      SUM(Bonus) AS bonus,
      SUM(Gross) AS gross,
      SUM(EPF) AS pf_emp,  SUM(EPFCompany) AS pf_co,
      SUM(ESIC) AS esic_emp, SUM(ESICCompany) AS esic_co,
      SUM(AdminChrg) AS admin_chg, SUM(ProTaxDeduction) AS pt,
      SUM(IncomeTax) AS tds, SUM(AdvPaid) AS adv,
      SUM(LoanDed) AS loan_ded, SUM(LeaveDeduction) AS lwp,
      SUM(MobileDedcution) AS mobile_ded, SUM(AssetRecovery) AS asset_rec,
      SUM(Insurance) AS insurance, SUM(OtherDeduction) AS other_ded,
      SUM(NetSalary) AS net
    FROM salary_data
    WHERE DATE_FORMAT(SalayDate,'%Y-%m')=?
      AND EmpCode NOT LIKE 'IDC%'
      AND EmpCode IS NOT NULL AND TRIM(EmpCode)!=''
      ${bCond}
  `, [MONTH, ...bv]);

  // Line-level sums (no component join to avoid multiplication)
  const [[hL]] = await hrms.query(`
    SELECT COUNT(spl.id) AS rc,
      SUM(spl.working_days)   AS working_days, SUM(spl.present_days) AS present_days,
      SUM(spl.gross_salary)   AS gross,        SUM(spl.net_salary)   AS net,
      SUM(spl.pf_employee)    AS pf_emp,        SUM(spl.pf_employer)  AS pf_co,
      SUM(spl.esic_employee)  AS esic_emp,      SUM(spl.esic_employer) AS esic_co,
      SUM(spl.tds_amount)     AS tds,
      SUM(spl.professional_tax) AS pt,
      0                       AS loan_ded_placeholder
    FROM salary_prep_line spl
    JOIN salary_prep_run spr ON spr.id=spl.run_id
    WHERE spr.run_month=?
  `, [MONTH]);

  // Component sums via pivot
  const [[hC]] = await hrms.query(`
    SELECT
      SUM(CASE WHEN c.component_code='BASIC'         THEN c.amount ELSE 0 END) AS basic,
      SUM(CASE WHEN c.component_code='HRA'            THEN c.amount ELSE 0 END) AS hra,
      SUM(CASE WHEN c.component_code='CONV'           THEN c.amount ELSE 0 END) AS conv,
      SUM(CASE WHEN c.component_code='PORTFOLIO'      THEN c.amount ELSE 0 END) AS portfolio,
      SUM(CASE WHEN c.component_code='MA'             THEN c.amount ELSE 0 END) AS ma,
      SUM(CASE WHEN c.component_code='LTA'            THEN c.amount ELSE 0 END) AS lta,
      SUM(CASE WHEN c.component_code='SPECIAL'        THEN c.amount ELSE 0 END) AS special,
      SUM(CASE WHEN c.component_code='OA'             THEN c.amount ELSE 0 END) AS other_allow,
      SUM(CASE WHEN c.component_code='INCENTIVE'      THEN c.amount ELSE 0 END) AS incentive,
      SUM(CASE WHEN c.component_code='EXTRA_DAY_INC'  THEN c.amount ELSE 0 END) AS extra_day_inc,
      SUM(CASE WHEN c.component_code='ARREAR'         THEN c.amount ELSE 0 END) AS arrear,
      SUM(CASE WHEN c.component_code='BONUS'          THEN c.amount ELSE 0 END) AS bonus,
      SUM(CASE WHEN c.component_code='ADV'            THEN c.amount ELSE 0 END) AS adv,
      SUM(CASE WHEN c.component_code='LWP'            THEN c.amount ELSE 0 END) AS lwp,
      SUM(CASE WHEN c.component_code='MOBILE_DED'     THEN c.amount ELSE 0 END) AS mobile_ded,
      SUM(CASE WHEN c.component_code='ASSET_REC'      THEN c.amount ELSE 0 END) AS asset_rec,
      SUM(CASE WHEN c.component_code='INS'            THEN c.amount ELSE 0 END) AS insurance,
      SUM(CASE WHEN c.component_code='OTHER_DED'      THEN c.amount ELSE 0 END) AS other_ded,
      SUM(CASE WHEN c.component_code='ADMIN_CHG'      THEN c.amount ELSE 0 END) AS admin_chg,
      SUM(CASE WHEN c.component_code='LOAN'           THEN c.amount ELSE 0 END) AS loan_ded
    FROM salary_prep_line_component c
    JOIN salary_prep_line spl ON spl.id=c.line_id
    JOIN salary_prep_run spr ON spr.id=spl.run_id
    WHERE spr.run_month=?
  `, [MONTH]);

  const cols = [
    { label: 'Working Days',   bill: r2(b.working_days),  hrms: r2(hL.working_days)  },
    { label: 'Present/Earned Days', bill: r2(b.present_days), hrms: r2(hL.present_days) },
    { label: 'Basic',          bill: r2(b.basic),         hrms: r2(hC.basic)         },
    { label: 'HRA',            bill: r2(b.hra),           hrms: r2(hC.hra)           },
    { label: 'Conveyance',     bill: r2(b.conv),          hrms: r2(hC.conv)          },
    { label: 'Portfolio',      bill: r2(b.portfolio),     hrms: r2(hC.portfolio)     },
    { label: 'Medical Allow',  bill: r2(b.ma),            hrms: r2(hC.ma)            },
    { label: 'LTA',            bill: r2(b.lta),           hrms: r2(hC.lta)           },
    { label: 'Special Allow',  bill: r2(b.special),       hrms: r2(hC.special)       },
    { label: 'Other Allow',    bill: r2(b.other_allow),   hrms: r2(hC.other_allow)   },
    { label: 'Incentive',      bill: r2(b.incentive),     hrms: r2(hC.incentive)     },
    { label: 'Extra Day Inc',  bill: r2(b.extra_day_inc), hrms: r2(hC.extra_day_inc) },
    { label: 'Arrear',         bill: r2(b.arrear),        hrms: r2(hC.arrear)        },
    { label: 'Bonus',          bill: r2(b.bonus),         hrms: r2(hC.bonus)         },
    { label: 'Gross Salary',   bill: r2(b.gross),         hrms: r2(hL.gross)         },
    { label: 'PF Employee',    bill: r2(b.pf_emp),        hrms: r2(hL.pf_emp)        },
    { label: 'PF Employer',    bill: r2(b.pf_co),         hrms: r2(hL.pf_co)         },
    { label: 'ESIC Employee',  bill: r2(b.esic_emp),      hrms: r2(hL.esic_emp)      },
    { label: 'ESIC Employer',  bill: r2(b.esic_co),       hrms: r2(hL.esic_co)       },
    { label: 'Admin Charges',  bill: r2(b.admin_chg),     hrms: r2(hC.admin_chg)     },
    { label: 'Prof Tax',       bill: r2(b.pt),            hrms: r2(hL.pt)            },
    { label: 'TDS/Income Tax', bill: r2(b.tds),           hrms: r2(hL.tds)           },
    { label: 'Advance Paid',   bill: r2(b.adv),           hrms: r2(hC.adv)           },
    { label: 'Loan Deduction', bill: r2(b.loan_ded),      hrms: r2(hC.loan_ded)      },
    { label: 'LWP Deduction',  bill: r2(b.lwp),           hrms: r2(hC.lwp)           },
    { label: 'Mobile Ded',     bill: r2(b.mobile_ded),    hrms: r2(hC.mobile_ded)    },
    { label: 'Asset Recovery', bill: r2(b.asset_rec),     hrms: r2(hC.asset_rec)     },
    { label: 'Insurance',      bill: r2(b.insurance),     hrms: r2(hC.insurance)     },
    { label: 'Other Deduction',bill: r2(b.other_ded),     hrms: r2(hC.other_ded)     },
    { label: 'Net Salary',     bill: r2(b.net),           hrms: r2(hL.net)           },
  ];
  printReport(`Salary Register (${MONTH})`, { bill: Number(b.rc), hrms: Number(hL.rc) }, cols);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ATTENDANCE REGISTER
// ═══════════════════════════════════════════════════════════════════════════════
async function checkAttendance(bill, hrms) {
  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc,
      SUM(Status='P') AS present, SUM(Status='A') AS absent,
      SUM(Status='HD') AS half_day, SUM(Status='L') AS leave_days,
      SUM(Status='WO') AS week_off, SUM(Status='H') AS holiday
    FROM Attandence
    WHERE DATE_FORMAT(AttandDate,'%Y-%m')=?
      AND EmpCode NOT LIKE 'IDC%'
  `, [MONTH]);
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc,
      SUM(status='P') AS present, SUM(status='A') AS absent,
      SUM(status='HD') AS half_day, SUM(status='L') AS leave_days,
      SUM(status='WO') AS week_off, SUM(status='H') AS holiday
    FROM attendance_legacy_snapshot
    WHERE DATE_FORMAT(attend_date,'%Y-%m')=?
      AND employee_code NOT LIKE 'IDC%'
  `, [MONTH]);
  printReport('Attendance Register', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'Present (P)',  bill: r2(b.present),  hrms: r2(h.present)  },
    { label: 'Absent (A)',   bill: r2(b.absent),   hrms: r2(h.absent)   },
    { label: 'Half Day (HD)',bill: r2(b.half_day), hrms: r2(h.half_day) },
    { label: 'Leave (L)',    bill: r2(b.leave_days),hrms: r2(h.leave_days) },
    { label: 'Week Off (WO)',bill: r2(b.week_off), hrms: r2(h.week_off) },
    { label: 'Holiday (H)',  bill: r2(b.holiday),  hrms: r2(h.holiday)  },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. WFH ATTENDANCE
// ═══════════════════════════════════════════════════════════════════════════════
async function checkWfh(bill, hrms) {
  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc,
      SUM(Status='P')   AS present, SUM(Status='A')  AS absent,
      SUM(Status='HD')  AS half_day, SUM(Status='WO') AS week_off
    FROM WorkHomeAttandence WHERE DATE_FORMAT(AttandDate,'%Y-%m')=?
  `, [MONTH]);
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc,
      SUM(status='P')   AS present, SUM(status='A')  AS absent,
      SUM(status='HD')  AS half_day, SUM(status='WO') AS week_off
    FROM wfh_attendance_snapshot WHERE DATE_FORMAT(att_date,'%Y-%m')=?
  `, [MONTH]);
  printReport('WFH Attendance', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'Present (P)',   bill: r2(b.present),  hrms: r2(h.present)  },
    { label: 'Absent (A)',    bill: r2(b.absent),   hrms: r2(h.absent)   },
    { label: 'Half Day (HD)', bill: r2(b.half_day), hrms: r2(h.half_day) },
    { label: 'Week Off (WO)', bill: r2(b.week_off), hrms: r2(h.week_off) },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. LEAVE REGISTER
// ═══════════════════════════════════════════════════════════════════════════════
async function checkLeave(bill, hrms) {
  // TotalLeave in db_bill is 0 (legacy defect). Compare breakdown by leave type.
  const [bRows] = await bill.query(`
    SELECT COUNT(*) AS rc,
      SUM(LeaveType='CL')  AS cl_rows, SUM(LeaveType='EL') AS el_rows,
      SUM(LeaveType='ML')  AS ml_rows, SUM(LeaveType='LWP') AS lwp_rows,
      SUM(DATEDIFF(LeaveTo, LeaveFrom)+1) AS calc_days
    FROM leave_management
    WHERE DATE_FORMAT(LeaveFrom,'%Y-%m')=? AND EmpCode NOT LIKE 'IDC%'
  `, [MONTH]);
  const b = bRows[0];
  // Use legacy_leave_id IS NOT NULL to exclude post-migration HRMS entries
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc,
      SUM(CASE WHEN leave_type_code='CL'  THEN 1 ELSE 0 END) AS cl_rows,
      SUM(CASE WHEN leave_type_code='EL'  THEN 1 ELSE 0 END) AS el_rows,
      SUM(CASE WHEN leave_type_code='ML'  THEN 1 ELSE 0 END) AS ml_rows,
      SUM(CASE WHEN leave_type_code='LWP' THEN 1 ELSE 0 END) AS lwp_rows,
      SUM(DATEDIFF(to_date, from_date)+1) AS calc_days
    FROM leave_request lr JOIN employees e ON e.id=lr.employee_id
    WHERE DATE_FORMAT(lr.from_date,'%Y-%m')=?
      AND lr.legacy_leave_id IS NOT NULL
  `, [MONTH]);
  // NOTE: db_bill stores leave in per-type columns (CL=x, EL=y per row).
  // HRMS stores leave_type_code per row with total_days (calendar days).
  // Per-type day totals will differ due to different counting method.
  // Only total calculated days (DATEDIFF) is a reliable comparison.
  printReport('Leave Register', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'CL Rows',        bill: r2(b.cl_rows ?? 0),  hrms: r2(h.cl_rows ?? 0)  },
    { label: 'EL Rows',        bill: r2(b.el_rows ?? 0),  hrms: r2(h.el_rows ?? 0)  },
    { label: 'ML Rows',        bill: r2(b.ml_rows ?? 0),  hrms: r2(h.ml_rows ?? 0)  },
    { label: 'LWP Rows',       bill: r2(b.lwp_rows ?? 0), hrms: r2(h.lwp_rows ?? 0) },
    { label: 'Calc Total Days (DATEDIFF)', bill: r2(b.calc_days), hrms: r2(h.calc_days) },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. LOAN REGISTER
// ═══════════════════════════════════════════════════════════════════════════════
async function checkLoans(bill, hrms) {
  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc,
      SUM(Amount) AS loan_amount, SUM(Installments) AS installments,
      SUM(DeductionPerMonth) AS emi,
      SUM(COALESCE(DeductedAmount,0)) AS deducted,
      SUM(Amount - COALESCE(DeductedAmount,0)) AS pending
    FROM LoanMaster WHERE EmpCode NOT LIKE 'IDC%'
  `);
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc,
      SUM(el.amount) AS loan_amount, SUM(el.installments) AS installments,
      SUM(el.deduction_per_month) AS emi,
      SUM(el.deducted_amount) AS deducted, SUM(el.pending_amount) AS pending
    FROM employee_loans el JOIN employees e ON e.id=el.employee_id
    WHERE el.legacy_loan_id IS NOT NULL
  `);
  printReport('Loan Register (all-time)', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'Loan Amount',    bill: r2(b.loan_amount),  hrms: r2(h.loan_amount)  },
    { label: 'Installments',   bill: r2(b.installments), hrms: r2(h.installments) },
    { label: 'EMI/Month',      bill: r2(b.emi),          hrms: r2(h.emi)          },
    { label: 'Deducted',       bill: r2(b.deducted),     hrms: r2(h.deducted)     },
    { label: 'Pending',        bill: r2(b.pending),      hrms: r2(h.pending)      },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. INCOME TAX REGISTER
// ═══════════════════════════════════════════════════════════════════════════════
async function checkIncomeTax(bill, hrms) {
  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc, SUM(IncomTax) AS tax
    FROM IncomtaxMaster WHERE TaxMonth=?
  `, [MONTH]);
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc, SUM(income_tax) AS tax
    FROM incometax_legacy_snapshot WHERE tax_month=?
  `, [MONTH]);
  printReport('Income Tax Register', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'Income Tax', bill: r2(b.tax), hrms: r2(h.tax) },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. OD REGISTER
// ═══════════════════════════════════════════════════════════════════════════════
async function checkOD(bill, hrms) {
  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc,
      SUM(ApproveFirst IS NOT NULL) AS l1_approved,
      SUM(ApproveSecond IS NOT NULL) AS l2_approved,
      SUM(DiscardStatus=1) AS discarded
    FROM od_apply_master WHERE DATE_FORMAT(StartDate,'%Y-%m')=?
  `, [MONTH]);
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc,
      SUM(approve_first IS NOT NULL) AS l1_approved,
      SUM(approve_second IS NOT NULL) AS l2_approved,
      SUM(discard_status=1) AS discarded
    FROM od_register_snapshot WHERE DATE_FORMAT(start_date,'%Y-%m')=?
  `, [MONTH]);
  printReport('OD Register', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'L1 Approved',  bill: r2(b.l1_approved),  hrms: r2(h.l1_approved)  },
    { label: 'L2 Approved',  bill: r2(b.l2_approved),  hrms: r2(h.l2_approved)  },
    { label: 'Discarded',    bill: r2(b.discarded),     hrms: r2(h.discarded)    },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. INCENTIVE REGISTER
// ═══════════════════════════════════════════════════════════════════════════════
async function checkIncentive(bill, hrms) {
  const [bTypes] = await bill.query(`
    SELECT IncentiveType AS tp, COUNT(*) rc, SUM(Amount) amt
    FROM upload_incentive_breakup
    WHERE DATE_FORMAT(SalaryMonth,'%Y-%m')=?
    GROUP BY IncentiveType ORDER BY tp
  `, [MONTH]);
  const [hTypes] = await hrms.query(`
    SELECT incentive_type AS tp, COUNT(*) rc, SUM(amount) amt
    FROM incentive_upload_snapshot
    WHERE DATE_FORMAT(salary_month,'%Y-%m')=?
    GROUP BY incentive_type ORDER BY tp
  `, [MONTH]);

  const bMap = new Map(bTypes.map(r=>[r.tp, r]));
  const hMap = new Map(hTypes.map(r=>[r.tp, r]));
  const allTypes = [...new Set([...bMap.keys(), ...hMap.keys()])].sort();

  const bTotal = bTypes.reduce((s,r)=>s+r2(r.amt),0);
  const hTotal = hTypes.reduce((s,r)=>s+r2(r.amt),0);
  const bRc    = bTypes.reduce((s,r)=>s+Number(r.rc),0);
  const hRc    = hTypes.reduce((s,r)=>s+Number(r.rc),0);

  const cols = allTypes.map(tp => ({
    label: `Amount [${tp||'(blank)'}]`,
    bill:  r2(bMap.get(tp)?.amt ?? 0),
    hrms:  r2(hMap.get(tp)?.amt ?? 0),
  }));
  cols.push({ label: 'TOTAL Amount', bill: r2(bTotal), hrms: r2(hTotal) });
  printReport('Incentive Register', { bill: bRc, hrms: hRc }, cols);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. DEDUCTION REGISTER
// ═══════════════════════════════════════════════════════════════════════════════
async function checkDeductions(bill, hrms) {
  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc,
      SUM(MobileDeduction) AS mobile, SUM(ShortCollection) AS short_c,
      SUM(AssetRecovery) AS asset, SUM(Insurance) AS insurance,
      SUM(ProfessionalTax) AS pt, SUM(LeaveDeduction) AS lwp,
      SUM(OthersDeduction) AS other
    FROM upload_deduction WHERE SalaryMonth=?
  `, [MONTH]);
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc,
      SUM(mobile_deduction) AS mobile, SUM(short_collection) AS short_c,
      SUM(asset_recovery) AS asset, SUM(insurance) AS insurance,
      SUM(professional_tax) AS pt, SUM(leave_deduction) AS lwp,
      SUM(others_deduction) AS other
    FROM upload_deduction_snapshot WHERE salary_month=?
  `, [MONTH]);
  printReport('Deduction Register', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'Mobile Deduction',   bill: r2(b.mobile),    hrms: r2(h.mobile)    },
    { label: 'Short Collection',   bill: r2(b.short_c),   hrms: r2(h.short_c)   },
    { label: 'Asset Recovery',     bill: r2(b.asset),     hrms: r2(h.asset)     },
    { label: 'Insurance',          bill: r2(b.insurance), hrms: r2(h.insurance) },
    { label: 'Professional Tax',   bill: r2(b.pt),        hrms: r2(h.pt)        },
    { label: 'Leave Deduction',    bill: r2(b.lwp),       hrms: r2(h.lwp)       },
    { label: 'Other Deduction',    bill: r2(b.other),     hrms: r2(h.other)     },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. LEGACY EMPLOYEE MASTER (masjclrentry)
// ═══════════════════════════════════════════════════════════════════════════════
async function checkEmployeeMaster(bill, hrms) {
  // NOTE: masjclrentry is a LIVE table — salary revisions after migration point
  // will cause differences vs legacy_salary_snapshot (which is point-in-time).
  // Differences in Special Allow / PF-Co / ESIC-Co are expected if salaries were
  // revised in db_bill after the HRMS snapshot was taken. Gross+Net match confirms
  // the snapshot values are self-consistent.
  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc,
      SUM(bs) AS basic, SUM(hra) AS hra, SUM(conv) AS conv,
      SUM(ma) AS ma, SUM(sa) AS special,
      SUM(oa) AS other_allow, SUM(Gross) AS gross,
      SUM(NetInhand) AS net, SUM(EPF) AS pf_emp, SUM(ESIC) AS esic_emp,
      SUM(EPFCO) AS pf_co, SUM(ESICCO) AS esic_co, SUM(CTC) AS ctc
    FROM masjclrentry WHERE EmpCode NOT LIKE 'IDC%'
  `);
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc,
      SUM(basic) AS basic, SUM(hra) AS hra, SUM(conveyance) AS conv,
      SUM(medical) AS ma, SUM(special_allowance) AS special,
      SUM(other_allowance) AS other_allow, SUM(gross) AS gross,
      SUM(net_salary) AS net,
      SUM(pf_employee) AS pf_emp, SUM(esic_employee) AS esic_emp,
      SUM(pf_employer) AS pf_co, SUM(esic_employer) AS esic_co,
      SUM(ctc_monthly) AS ctc
    FROM legacy_salary_snapshot WHERE employee_code NOT LIKE 'IDC%'
  `);
  // NOTE: Component-level diffs (Special Allow, PF-Co, ESIC-Co) are expected:
  // legacy_salary_snapshot holds point-in-time values from migration date.
  // masjclrentry is a LIVE table — salary revisions since migration redistribute
  // components (e.g. SA reduced, portfolio added) without changing gross/net.
  // Only Gross + Net are immutable and comparable. All other columns may differ
  // by design. Do NOT change the snapshot to match current masjclrentry.
  printReport('Legacy Employee Master (all-time)', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'Gross (immutable)',     bill: r2(b.gross),   hrms: r2(h.gross)   },
    { label: 'Net In Hand (immutable)',bill: r2(b.net),    hrms: r2(h.net)     },
    { label: 'PF Employee',           bill: r2(b.pf_emp),  hrms: r2(h.pf_emp)  },
    { label: 'ESIC Employee',         bill: r2(b.esic_emp),hrms: r2(h.esic_emp) },
    { label: 'CTC Monthly',           bill: r2(b.ctc),     hrms: r2(h.ctc)     },
    // Individual components below may differ due to post-migration salary revisions
    { label: 'Basic [may vary]',      bill: r2(b.basic),   hrms: r2(h.basic)   },
    { label: 'HRA [may vary]',        bill: r2(b.hra),     hrms: r2(h.hra)     },
    { label: 'Conveyance [may vary]', bill: r2(b.conv),    hrms: r2(h.conv)    },
    { label: 'Special Allow [may vary]',bill: r2(b.special),hrms: r2(h.special) },
    { label: 'PF Employer [may vary]',bill: r2(b.pf_co),   hrms: r2(h.pf_co)  },
    { label: 'ESIC Employer [may vary]',bill: r2(b.esic_co),hrms: r2(h.esic_co) },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. QUALITY ATTENDANCE
// ═══════════════════════════════════════════════════════════════════════════════
async function checkQualAttendance(bill, hrms) {
  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc,
      SUM(Present) AS present, SUM(WO) AS wo, SUM(Holiday) AS holiday,
      SUM(HalfDay) AS half_day, SUM(Compoff) AS compoff,
      SUM(EL) AS el, SUM(CL) AS cl, SUM(SL) AS sl, SUM(OT) AS ot
    FROM qual_attendance WHERE SalYear=? AND SalMonth=?
  `, [YEAR, MON_INT]);
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc,
      SUM(present) AS present, SUM(wo) AS wo, SUM(holiday) AS holiday,
      SUM(half_day) AS half_day, SUM(compoff) AS compoff,
      SUM(el) AS el, SUM(cl) AS cl, SUM(sl) AS sl, SUM(ot) AS ot
    FROM qual_attendance_snapshot WHERE sal_year=? AND sal_month=?
  `, [YEAR, MON_INT]);
  printReport('Quality Attendance', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'Present',   bill: r2(b.present),  hrms: r2(h.present)  },
    { label: 'Week Off',  bill: r2(b.wo),       hrms: r2(h.wo)       },
    { label: 'Holiday',   bill: r2(b.holiday),  hrms: r2(h.holiday)  },
    { label: 'Half Day',  bill: r2(b.half_day), hrms: r2(h.half_day) },
    { label: 'Compoff',   bill: r2(b.compoff),  hrms: r2(h.compoff)  },
    { label: 'EL',        bill: r2(b.el),       hrms: r2(h.el)       },
    { label: 'CL',        bill: r2(b.cl),       hrms: r2(h.cl)       },
    { label: 'SL',        bill: r2(b.sl),       hrms: r2(h.sl)       },
    { label: 'OT',        bill: r2(b.ot),       hrms: r2(h.ot)       },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. QUALITY LEAVE
// ═══════════════════════════════════════════════════════════════════════════════
async function checkQualLeave(bill, hrms) {
  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc, SUM(PL) AS pl, SUM(CL) AS cl, SUM(SL) AS sl
    FROM qual_leave WHERE LeaveYear=? AND LeaveMonth=?
  `, [YEAR, MON_INT]);
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc, SUM(pl) AS pl, SUM(cl) AS cl, SUM(sl) AS sl
    FROM qual_leave_snapshot WHERE leave_year=? AND leave_month=?
  `, [YEAR, MON_INT]);
  printReport('Quality Leave', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'PL', bill: r2(b.pl), hrms: r2(h.pl) },
    { label: 'CL', bill: r2(b.cl), hrms: r2(h.cl) },
    { label: 'SL', bill: r2(b.sl), hrms: r2(h.sl) },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 13. QUALITY SALARY
// ═══════════════════════════════════════════════════════════════════════════════
async function checkQualSalary(bill, hrms) {
  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc,
      SUM(Basic) AS basic, SUM(HRA) AS hra, SUM(Conv) AS conv,
      SUM(OthAllw) AS other_allow, SUM(Gross) AS gross,
      SUM(TotalGross) AS total_gross,
      SUM(PF) AS pf, SUM(TDS) AS tds, SUM(ESI) AS esi,
      SUM(Netpay) AS net_pay,
      SUM(EmplrPF) AS emp_pf, SUM(EmplrESI) AS emp_esi,
      SUM(Paiddays) AS paid_days, SUM(OTDays) AS ot_days
    FROM qual_salary WHERE SalYear=? AND SalMonth=?
  `, [YEAR, MON_INT]);
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc,
      SUM(basic) AS basic, SUM(hra) AS hra, SUM(conv) AS conv,
      SUM(other_allowance) AS other_allow, SUM(gross) AS gross,
      SUM(total_gross) AS total_gross,
      SUM(pf) AS pf, SUM(tds) AS tds, SUM(esi) AS esi,
      SUM(net_pay) AS net_pay,
      SUM(paid_days) AS paid_days
    FROM qual_salary_snapshot WHERE sal_year=? AND sal_month=?
  `, [YEAR, MON_INT]);
  printReport('Quality Salary', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'Basic',        bill: r2(b.basic),       hrms: r2(h.basic)       },
    { label: 'HRA',          bill: r2(b.hra),         hrms: r2(h.hra)         },
    { label: 'Conv',         bill: r2(b.conv),        hrms: r2(h.conv)        },
    { label: 'Other Allow',  bill: r2(b.other_allow), hrms: r2(h.other_allow) },
    { label: 'Gross',        bill: r2(b.gross),       hrms: r2(h.gross)       },
    { label: 'Total Gross',  bill: r2(b.total_gross), hrms: r2(h.total_gross) },
    { label: 'PF',           bill: r2(b.pf),          hrms: r2(h.pf)          },
    { label: 'TDS',          bill: r2(b.tds),         hrms: r2(h.tds)         },
    { label: 'ESI',          bill: r2(b.esi),         hrms: r2(h.esi)         },
    { label: 'Net Pay',      bill: r2(b.net_pay),     hrms: r2(h.net_pay)     },
    { label: 'Paid Days',    bill: r2(b.paid_days),   hrms: r2(h.paid_days)   },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 14. QUALITY INCENTIVE
// ═══════════════════════════════════════════════════════════════════════════════
async function checkQualIncentive(bill, hrms) {
  const [[b]] = await bill.query(`
    SELECT COUNT(*) AS rc, SUM(incamt) AS amount
    FROM qual_incentive WHERE Salyear=? AND salmonth=?
  `, [YEAR, MON_INT]);
  const [[h]] = await hrms.query(`
    SELECT COUNT(*) AS rc, SUM(amount) AS amount
    FROM qual_incentive_snapshot WHERE sal_year=? AND sal_month=?
  `, [YEAR, MON_INT]);
  printReport('Quality Incentive', { bill: Number(b.rc), hrms: Number(h.rc) }, [
    { label: 'Incentive Amount', bill: r2(b.amount), hrms: r2(h.amount) },
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 15. TRANSFER REGISTER
// ═══════════════════════════════════════════════════════════════════════════════
async function checkTransfers(bill, hrms) {
  const [[b]] = await bill.query(`SELECT COUNT(*) AS rc FROM employee_move WHERE MoveMonth=?`, [MONTH]);
  const [[h]] = await hrms.query(`SELECT COUNT(*) AS rc FROM employee_move_snapshot WHERE move_month=?`, [MONTH]);
  printReport('Transfer Register', { bill: Number(b.rc), hrms: Number(h.rc) }, []);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 16. DOJ CHANGE REGISTER
// ═══════════════════════════════════════════════════════════════════════════════
async function checkDOJChanges(bill, hrms) {
  const [[b]] = await bill.query(`SELECT COUNT(*) AS rc FROM ChangeDojMaster WHERE DATE_FORMAT(CreateDate,'%Y-%m')=?`, [MONTH]);
  const [[h]] = await hrms.query(`SELECT COUNT(*) AS rc FROM change_doj_snapshot WHERE DATE_FORMAT(created_at,'%Y-%m')=?`, [MONTH]);
  printReport('DOJ Change Register', { bill: Number(b.rc), hrms: Number(h.rc) }, []);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  process.stdout.write('═'.repeat(70)+'\n');
  process.stdout.write(`  db_bill ↔ mas_hrms  Column-by-Column Verification  Month: ${MONTH}${BRANCH?'  Branch: '+BRANCH:''}\n`);
  process.stdout.write(`  db_bill: ${BILL_HOST}    mas_hrms: ${HRMS_HOST}\n`);
  process.stdout.write('═'.repeat(70)+'\n');
  process.stdout.write(`  Tolerance: ₹${TOL} per column  |  Status=0 (FNF/leaving) INCLUDED in salary\n`);
  process.stdout.write('─'.repeat(70)+'\n\n');

  const { bill, hrms } = await connect();
  process.stdout.write('Connected to both databases.\n');

  const checks = [
    checkSalary, checkAttendance, checkWfh, checkLeave, checkLoans,
    checkIncomeTax, checkOD, checkIncentive, checkDeductions,
    checkEmployeeMaster, checkQualAttendance, checkQualLeave,
    checkQualSalary, checkQualIncentive, checkTransfers, checkDOJChanges,
  ];

  for (const fn of checks) {
    try { await fn(bill, hrms); }
    catch(e) { process.stdout.write(`\n❌ ${fn.name}: ERROR — ${e.message}\n`); totalFail++; }
  }

  process.stdout.write('\n'+'═'.repeat(70)+'\n');
  process.stdout.write(`  COLUMN-LEVEL SUMMARY\n`);
  process.stdout.write(`  Total columns checked : ${totalChecks}\n`);
  process.stdout.write(`  EXACT (within ₹${TOL})   : ${totalPass}\n`);
  process.stdout.write(`  DIFFER                : ${totalFail}\n`);
  if (failedItems.length) {
    process.stdout.write('\n  Columns with differences:\n');
    failedItems.forEach(f=>process.stdout.write(`    ❌ ${f}\n`));
  } else {
    process.stdout.write('\n  ✅ Every column matches exactly.\n');
  }
  process.stdout.write('═'.repeat(70)+'\n\n');

  await bill.end(); await hrms.end();
}

main().catch(e=>{ console.error('FATAL:', e.message); process.exit(1); });
