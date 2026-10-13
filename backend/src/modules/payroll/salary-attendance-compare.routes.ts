import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { billQuery } from "../../db/billDb.js";

export const salaryAttCompareRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    fn(req, res).catch(next);

salaryAttCompareRouter.use(requireAuth);
salaryAttCompareRouter.use(requireRole("SUPER_ADMIN", "HR_ADMIN", "FINANCE", "PAYROLL_HEAD"));

// ── helpers ────────────────────────────────────────────────────────────────

function parseMonth(raw: unknown): string {
  const s = String(raw ?? "2026-09");
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return "2026-09";
}

// Both DBs store datetimes in IST but as UTC (shifted -5:30). Use DATE_ADD +330 MIN.
function istDateExpr(col: string): string {
  return `DATE(DATE_ADD(${col}, INTERVAL 330 MINUTE))`;
}

// ── GET /list ──────────────────────────────────────────────────────────────

salaryAttCompareRouter.get(
  "/list",
  h(async (req, res) => {
    const month = parseMonth(req.query.month);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const search = String(req.query.search ?? "").trim();
    const branch = String(req.query.branch ?? "").trim();

    const [year, mon] = month.split("-");
    const startDate = `${year}-${mon}-01`;
    const endDate = `${year}-${mon}-31`;

    // ── db_bill salary summary for month ──────────────────────────────────
    let whereClause = `sd.SalDate BETWEEN ? AND ?`;
    const params: string[] = [startDate, endDate];

    if (search) {
      whereClause += ` AND (sd.EmpCode LIKE ? OR sd.EmpName LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (branch) {
      whereClause += ` AND sd.Branch = ?`;
      params.push(branch);
    }

    const countSql = `SELECT COUNT(*) AS total FROM salary_data sd WHERE ${whereClause}`;
    const [countRows] = await (await import("../../db/billDb.js").then(m => m.getBillPool()))
      .execute<RowDataPacket[]>(countSql, params);
    const total = Number((countRows as RowDataPacket[])[0]?.total ?? 0);

    const listSql = `
      SELECT
        sd.EmpCode, sd.EmpName, sd.CostCenter, sd.Branch, sd.Designation,
        sd.WorkingDays, sd.ActualDays, sd.EarnedDays, sd.Leave,
        sd.Basic, sd.HRA, sd.Conv, sd.Bonus, sd.Portfolio,
        sd.MedicalAllowance, sd.SpecialAllowance, sd.OtherAllowance, sd.LTA, sd.PLI1,
        sd.Basic1, sd.HRA1, sd.Conv1, sd.Bonus1, sd.Portfolio1,
        sd.MedicalAllowance1, sd.SpecialAllowance1, sd.OtherAllowance1, sd.Gross1,
        sd.Incentive, sd.ExtraDayIncentive, sd.Arrear, sd.PLI,
        sd.ESIC, sd.EPF, sd.ProTaxDeduction, sd.IncomeTax,
        sd.AdvPaid, sd.LoanDed, sd.LeaveDeduction, sd.TotalDeduction,
        sd.Gross, sd.NetSalary,
        sd.ESICCompany, sd.EPFCompany, sd.AdminChrg, sd.CTC,
        sd.ESIElig, sd.PFELig, sd.Status AS EmpStatus
      FROM salary_data sd
      WHERE ${whereClause}
      ORDER BY sd.Branch, sd.EmpName
      LIMIT ${limit} OFFSET ${offset}
    `;

    const salaryRows = await billQuery<RowDataPacket>(listSql, params);

    if (salaryRows.length === 0) {
      return res.json({ success: true, data: { month, total: 0, page, limit, employees: [] } });
    }

    const empCodes = salaryRows.map(r => r.EmpCode as string);

    // ── db_bill day-wise attendance summary ───────────────────────────────
    const billAttSql = `
      SELECT
        a.EmpCode,
        SUM(CASE WHEN a.Status IN ('P','OP') THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.Status IN ('A') THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN a.Status IN ('WO','WH') THEN 1 ELSE 0 END) AS weekoff,
        SUM(CASE WHEN a.Status IN ('H') THEN 1 ELSE 0 END) AS holiday,
        SUM(CASE WHEN a.Status IN ('L','HL','PL','SL','CL','ML') THEN 1 ELSE 0 END) AS \`leave\`,
        COUNT(*) AS total_records
      FROM Attandence a
      WHERE ${istDateExpr("a.AttandDate")} BETWEEN ? AND ?
        AND a.EmpCode IN (${empCodes.map(() => "?").join(",")})
      GROUP BY a.EmpCode
    `;
    const billAttRows = await billQuery<RowDataPacket>(billAttSql, [startDate, endDate, ...empCodes]);
    const billAttMap = new Map(billAttRows.map(r => [r.EmpCode as string, r]));

    // ── HRMS attendance summary (join via employee_code) ──────────────────
    const hrmsSql = `
      SELECT
        e.employee_code,
        SUM(CASE WHEN adr.attendance_status IN ('PRESENT','HALF_DAY') THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN adr.attendance_status = 'ABSENT' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN adr.attendance_status = 'HALF_DAY' THEN 1 ELSE 0 END) AS half_day,
        SUM(CASE WHEN adr.lwp_value > 0 THEN 1 ELSE 0 END) AS lwp,
        SUM(CASE WHEN adr.attendance_status IN ('WEEK_OFF','HOLIDAY') THEN 1 ELSE 0 END) AS non_working,
        SUM(CASE WHEN adr.late_mark = 1 THEN 1 ELSE 0 END) AS late_marks,
        COUNT(*) AS total_records
      FROM attendance_daily_record adr
      JOIN employees e ON e.id = adr.employee_id
      WHERE ${istDateExpr("adr.record_date")} BETWEEN ? AND ?
        AND e.employee_code IN (${empCodes.map(() => "?").join(",")})
      GROUP BY e.employee_code
    `;
    const hrmsAttRows = await db.execute<RowDataPacket[]>(hrmsSql, [startDate, endDate, ...empCodes]);
    const hrmsAttMap = new Map((hrmsAttRows[0] as RowDataPacket[]).map(r => [r.employee_code as string, r]));

    const employees = salaryRows.map(sd => {
      const billAtt = billAttMap.get(sd.EmpCode as string);
      const hrmsAtt = hrmsAttMap.get(sd.EmpCode as string);

      const billPresent = Number(billAtt?.present ?? 0);
      const hrmsPresent = Number(hrmsAtt?.present ?? 0);

      return {
        empCode: sd.EmpCode,
        empName: sd.EmpName,
        costCenter: sd.CostCenter,
        branch: sd.Branch,
        designation: sd.Designation,
        empStatus: sd.EmpStatus,
        esiElig: sd.ESIElig,
        pfElig: sd.PFELig,
        dbbill: {
          workingDays: Number(sd.WorkingDays),
          actualDays: Number(sd.ActualDays),
          earnedDays: Number(sd.EarnedDays),
          leaveCount: Number(sd.Leave),
          // entitlement components
          basic: Number(sd.Basic),
          hra: Number(sd.HRA),
          conv: Number(sd.Conv),
          bonus: Number(sd.Bonus),
          portfolio: Number(sd.Portfolio),
          medicalAllowance: Number(sd.MedicalAllowance),
          specialAllowance: Number(sd.SpecialAllowance),
          otherAllowance: Number(sd.OtherAllowance),
          lta: Number(sd.LTA || 0),
          gross: Number(sd.Gross),
          // earned (pro-rated)
          basic1: Number(sd.Basic1),
          hra1: Number(sd.HRA1),
          conv1: Number(sd.Conv1),
          bonus1: Number(sd.Bonus1),
          portfolio1: Number(sd.Portfolio1),
          medicalAllowance1: Number(sd.MedicalAllowance1),
          specialAllowance1: Number(sd.SpecialAllowance1),
          otherAllowance1: Number(sd.OtherAllowance1),
          gross1: Number(sd.Gross1),
          // additions
          incentive: Number(sd.Incentive),
          extraDayIncentive: Number(sd.ExtraDayIncentive),
          arrear: Number(sd.Arrear),
          pli: Number(sd.PLI),
          // deductions
          esic: Number(sd.ESIC),
          epf: Number(sd.EPF),
          proTax: Number(sd.ProTaxDeduction),
          tds: Number(sd.IncomeTax),
          advPaid: Number(sd.AdvPaid),
          loanDed: Number(sd.LoanDed),
          leaveDeduction: Number(sd.LeaveDeduction),
          totalDeduction: Number(sd.TotalDeduction),
          netSalary: Number(sd.NetSalary),
          // employer costs
          esicCompany: Number(sd.ESICCompany),
          epfCompany: Number(sd.EPFCompany),
          adminChrg: Number(sd.AdminChrg),
          ctc: Number(sd.CTC),
          // attendance from Attandence table
          attPresent: billPresent,
          attAbsent: Number(billAtt?.absent ?? 0),
          attWeekOff: Number(billAtt?.weekoff ?? 0),
          attHoliday: Number(billAtt?.holiday ?? 0),
          attLeave: Number(billAtt?.leave ?? 0),
          attTotalRecords: Number(billAtt?.total_records ?? 0),
        },
        hrms: {
          attPresent: hrmsPresent,
          attAbsent: Number(hrmsAtt?.absent ?? 0),
          attHalfDay: Number(hrmsAtt?.half_day ?? 0),
          attLwp: Number(hrmsAtt?.lwp ?? 0),
          attNonWorking: Number(hrmsAtt?.non_working ?? 0),
          attLateMarks: Number(hrmsAtt?.late_marks ?? 0),
          attTotalRecords: Number(hrmsAtt?.total_records ?? 0),
        },
        attDiff: billPresent - hrmsPresent,
      };
    });

    return res.json({
      success: true,
      data: { month, total, page, limit, employees },
    });
  }),
);

// ── GET /branches ──────────────────────────────────────────────────────────

salaryAttCompareRouter.get(
  "/branches",
  h(async (req, res) => {
    const month = parseMonth(req.query.month);
    const [year, mon] = month.split("-");
    const rows = await billQuery<RowDataPacket>(
      `SELECT DISTINCT Branch FROM salary_data
       WHERE SalDate BETWEEN ? AND ?
       ORDER BY Branch`,
      [`${year}-${mon}-01`, `${year}-${mon}-31`],
    );
    return res.json({ success: true, data: rows.map(r => r.Branch as string) });
  }),
);

// ── GET /employee/:empCode ─────────────────────────────────────────────────

salaryAttCompareRouter.get(
  "/employee/:empCode",
  h(async (req, res) => {
    const { empCode } = req.params;
    const month = parseMonth(req.query.month);
    const [year, mon] = month.split("-");
    const startDate = `${year}-${mon}-01`;
    const endDate = `${year}-${mon}-31`;

    // ── db_bill salary record ──────────────────────────────────────────────
    const [salRow] = await billQuery<RowDataPacket>(
      `SELECT * FROM salary_data WHERE EmpCode = ? AND SalDate BETWEEN ? AND ? LIMIT 1`,
      [empCode, startDate, endDate],
    );
    if (!salRow) {
      return res.status(404).json({ success: false, error: "No db_bill salary record found for this employee and month." });
    }

    // ── db_bill day-wise attendance ────────────────────────────────────────
    const billDayRows = await billQuery<RowDataPacket>(
      `SELECT
         ${istDateExpr("a.AttandDate")} AS att_date,
         a.Status,
         a.Intime,
         a.OutTime,
         a.EmpStatus,
         a.BranchName,
         a.CostCenter
       FROM Attandence a
       WHERE a.EmpCode = ?
         AND ${istDateExpr("a.AttandDate")} BETWEEN ? AND ?
       ORDER BY att_date`,
      [empCode, startDate, endDate],
    );

    // ── HRMS day-wise attendance ───────────────────────────────────────────
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE employee_code = ? LIMIT 1`,
      [empCode],
    );
    const employeeId = (empRows as RowDataPacket[])[0]?.id ?? null;

    let hrmsDay: RowDataPacket[] = [];
    if (employeeId) {
      const [hrmsRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           ${istDateExpr("adr.record_date")} AS att_date,
           adr.attendance_status,
           adr.lwp_value,
           adr.late_mark,
           adr.late_by_minutes,
           DATE_FORMAT(adr.clock_in_time, '%H:%i') AS clock_in,
           DATE_FORMAT(adr.clock_out_time, '%H:%i') AS clock_out,
           adr.work_mode,
           adr.attendance_source,
           adr.biometric_status
         FROM attendance_daily_record adr
         WHERE adr.employee_id = ?
           AND ${istDateExpr("adr.record_date")} BETWEEN ? AND ?
         ORDER BY att_date`,
        [employeeId, startDate, endDate],
      );
      hrmsDay = hrmsRows as RowDataPacket[];
    }

    // ── Build 30-day calendar ─────────────────────────────────────────────
    const billDayMap = new Map(billDayRows.map(r => [String(r.att_date), r]));
    const hrmsDayMap = new Map(hrmsDay.map(r => [String(r.att_date), r]));

    const daysInMonth = new Date(Number(year), Number(mon), 0).getDate();
    const dayWise = Array.from({ length: daysInMonth }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      const dateStr = `${year}-${mon}-${day}`;
      const bd = billDayMap.get(dateStr);
      const hd = hrmsDayMap.get(dateStr);
      const dow = new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short" });
      return {
        date: dateStr,
        day: i + 1,
        dayOfWeek: dow,
        dbbill: bd
          ? {
              status: bd.Status,
              intime: bd.Intime || null,
              outtime: bd.OutTime || null,
              empStatus: bd.EmpStatus,
            }
          : null,
        hrms: hd
          ? {
              status: hd.attendance_status,
              lwp: Number(hd.lwp_value ?? 0),
              lateMark: Number(hd.late_mark ?? 0),
              lateByMins: Number(hd.late_by_minutes ?? 0),
              clockIn: hd.clock_in || null,
              clockOut: hd.clock_out || null,
              workMode: hd.work_mode,
              source: hd.attendance_source,
              biometricStatus: hd.biometric_status,
            }
          : null,
        match:
          bd && hd
            ? mapBillStatusToCategory(bd.Status as string) ===
              mapHrmsStatusToCategory(hd.attendance_status as string)
            : null,
      };
    });

    const sd = salRow;
    return res.json({
      success: true,
      data: {
        empCode,
        empName: sd.EmpName,
        costCenter: sd.CostCenter,
        branch: sd.Branch,
        designation: sd.Designation,
        month,
        salary: {
          workingDays: Number(sd.WorkingDays),
          actualDays: Number(sd.ActualDays),
          earnedDays: Number(sd.EarnedDays),
          leaveCount: Number(sd.Leave),
          // entitlement
          basic: Number(sd.Basic), hra: Number(sd.HRA), conv: Number(sd.Conv),
          bonus: Number(sd.Bonus), portfolio: Number(sd.Portfolio),
          medicalAllowance: Number(sd.MedicalAllowance),
          specialAllowance: Number(sd.SpecialAllowance),
          otherAllowance: Number(sd.OtherAllowance),
          lta: Number(sd.LTA || 0), pli1: Number(sd.PLI1 || 0),
          gross: Number(sd.Gross),
          // earned
          basic1: Number(sd.Basic1), hra1: Number(sd.HRA1), conv1: Number(sd.Conv1),
          bonus1: Number(sd.Bonus1), portfolio1: Number(sd.Portfolio1),
          medicalAllowance1: Number(sd.MedicalAllowance1),
          specialAllowance1: Number(sd.SpecialAllowance1),
          otherAllowance1: Number(sd.OtherAllowance1),
          gross1: Number(sd.Gross1),
          // additions
          incentive: Number(sd.Incentive), extraDayIncentive: Number(sd.ExtraDayIncentive),
          arrear: Number(sd.Arrear), pli: Number(sd.PLI),
          // deductions
          esic: Number(sd.ESIC), epf: Number(sd.EPF), proTax: Number(sd.ProTaxDeduction),
          tds: Number(sd.IncomeTax), advPaid: Number(sd.AdvPaid), loanDed: Number(sd.LoanDed),
          leaveDeduction: Number(sd.LeaveDeduction), totalDeduction: Number(sd.TotalDeduction),
          netSalary: Number(sd.NetSalary),
          // employer
          esicCompany: Number(sd.ESICCompany), epfCompany: Number(sd.EPFCompany),
          adminChrg: Number(sd.AdminChrg), ctc: Number(sd.CTC),
          esiElig: sd.ESIElig, pfElig: sd.PFELig,
        },
        dayWise,
        attendanceSummary: {
          dbbill: {
            present: billDayRows.filter(r => ["P", "OP"].includes(r.Status)).length,
            absent: billDayRows.filter(r => r.Status === "A").length,
            weekOff: billDayRows.filter(r => ["WO", "WH"].includes(r.Status)).length,
            holiday: billDayRows.filter(r => r.Status === "H").length,
            leave: billDayRows.filter(r => !["P", "OP", "A", "WO", "WH", "H"].includes(r.Status)).length,
            totalRecords: billDayRows.length,
          },
          hrms: {
            present: hrmsDay.filter(r => r.attendance_status === "PRESENT").length,
            halfDay: hrmsDay.filter(r => r.attendance_status === "HALF_DAY").length,
            absent: hrmsDay.filter(r => r.attendance_status === "ABSENT").length,
            weekOff: hrmsDay.filter(r => r.attendance_status === "WEEK_OFF").length,
            holiday: hrmsDay.filter(r => r.attendance_status === "HOLIDAY").length,
            lwp: hrmsDay.filter(r => Number(r.lwp_value) > 0).length,
            lateMarks: hrmsDay.filter(r => Number(r.late_mark) === 1).length,
            totalRecords: hrmsDay.length,
          },
        },
      },
    });
  }),
);

function mapBillStatusToCategory(status: string): string {
  if (["P", "OP"].includes(status)) return "PRESENT";
  if (status === "A") return "ABSENT";
  if (["WO", "WH"].includes(status)) return "WEEK_OFF";
  if (status === "H") return "HOLIDAY";
  return "LEAVE";
}

function mapHrmsStatusToCategory(status: string): string {
  if (["PRESENT", "HALF_DAY"].includes(status)) return "PRESENT";
  if (status === "ABSENT") return "ABSENT";
  if (status === "WEEK_OFF") return "WEEK_OFF";
  if (status === "HOLIDAY") return "HOLIDAY";
  return "LEAVE";
}
