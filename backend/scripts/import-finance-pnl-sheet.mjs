/**
 * import-finance-pnl-sheet.mjs
 *
 * Loads Finance's MAS Callnet P&L sheet ("MAS-Projection 2026-27 G-Sheet") into
 * mas_hrms.pnl_finance_sheet_line, one row per month x sheet branch x sheet process.
 *
 * Two tabs, both process-wise and in lakh with 2 decimals (the sheet's own precision):
 *   "Processwise P&L"  revenue, agent salary, DSC, BMC, IDC, interest, OP
 *   "Indirect Cost"    IDC split: communication, computer hire, office rent, CAM/misc,
 *                      electricity, staff welfare, others
 *
 * Owner rule 2026-10-17: for months Finance closed in db_bill (before 2026-10) the HRMS P&L takes
 * salary as the sheet calculates it and adds the sheet's indirect-cost allocations on top of the
 * db_bill GRNs (see pnl-finance-sheet.ts). This script only copies the sheet; it decides nothing.
 *
 * Usage:
 *   node backend/scripts/import-finance-pnl-sheet.mjs                 # 2026-04 .. 2026-09
 *   node backend/scripts/import-finance-pnl-sheet.mjs --from=2026-04 --to=2026-08
 *   node backend/scripts/import-finance-pnl-sheet.mjs --dry-run       # parse and map, write nothing
 *
 * The sheet must stay shared as "anyone with the link can view": it is read through Google's
 * CSV export. DialDesk / I-Spark / IDC are other companies and are not in this sheet.
 */
import { connect } from './lib/db-connect.mjs';

const SHEET_ID = '1xBguML8udGl_Aoz0yMnaEd0JvRjF457w71v_0tE79zU';
const TAB_PROCESSWISE = '1888003733';
const TAB_INDIRECT = '1501799695';

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const FROM = arg('from', '2026-04');
const TO = arg('to', '2026-09');
const DRY = process.argv.includes('--dry-run');

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

/** Sheet branch -> mas_hrms branch_master.branch_name. Onfido and Domestic Okaya both sit in NOIDA-2. */
const BRANCH = {
  'ahmedabad': 'AHMEDABAD-JALDARSHAN',
  'ahmedabad nk': 'AHMEDABAD-NEELAKANTH',
  'noida': 'NOIDA',
  'onfido noida': 'NOIDA-2',
  'domestic okaya domestic': 'NOIDA-2',
  'head office': 'HEAD OFFICE',
};

/**
 * Sheet process -> mas_hrms process_master.id. Matched by monthly revenue against the HRMS P&L
 * (Apr-Jul 2026, to the rupee-thousand) and by cost centre code where the sheet's Working tabs give
 * one. A process left out stays at branch level: its money counts in the branch, not in a process.
 * Not mapped on purpose: ICICI (the HRMS process of that name is NOIDA ISPARK-2, another company),
 * ALTRX, SCPT and Vacant Seats (no HRMS process), Ahmedabad NK and Head Office functions.
 */
const PROCESS = {
  'ahmedabad|godfrey philips india ltd': '04fec0c0-67ba-11f1-adb1-00155d0ab410',
  'ahmedabad|vnt': '04fc5bd7-67ba-11f1-adb1-00155d0ab410',
  'ahmedabad|finfort': 'b0b21b6b-6969-11f1-adb1-00155d0ab410',        // Bluevine Technologies, CC BSS/OB/AHMH-JD/919
  'ahmedabad|finfort onsite': 'b0b21b6b-6969-11f1-adb1-00155d0ab410', // invoiced on the same cost centre
  'ahmedabad|adani group': '04fda031-67ba-11f1-adb1-00155d0ab410',    // Adani Wilmar Limited, CC 728
  'ahmedabad|avore': '378bcf96-9aed-11f1-8f5c-00155d0ab410',
  'ahmedabad|sbi': '0fb9fb5e-b1be-11f1-8f5c-00155d0ab410',
  'noida|neemans': '05150ba3-67ba-11f1-adb1-00155d0ab410',
  'noida|du digital': 'aa5f7dfb-d537-40bb-a45e-37c2ce97e2b6',        // Dudigital Global Limited, CC BSS/OB/Noida/978 (Aug-26 Rs 4.56 L both sides)
  'noida|birla nu': '05168f65-67ba-11f1-adb1-00155d0ab410',
  'noida|satya retails': 'b951facd-4da8-40d2-8f59-5f20e8e2731b',
  'noida|puresta': 'd9f34da7-0ab7-49bb-9b21-cea309dd1ba3',            // HEALTH Q LIFESCIENCES (same Rs 0.49 L invoice, Aug-26)
  'noida|housing': '05191bc1-67ba-11f1-adb1-00155d0ab410',
  'noida|weryze': 'b0cbe708-6969-11f1-adb1-00155d0ab410',             // Aspeya India
  'noida|dalmia cement': '05061340-67ba-11f1-adb1-00155d0ab410',
  'noida|bella-vita organic': 'b0afc80e-6969-11f1-adb1-00155d0ab410', // IDAM Natural Wellness
  'noida|gnc': 'b0b5eb22-6969-11f1-adb1-00155d0ab410',                // Guardian Healthcare
  'noida|clovia': '050de032-67ba-11f1-adb1-00155d0ab410',
  'noida|solveeasy': 'b0c70168-6969-11f1-adb1-00155d0ab410',          // EBC Bridge
  'noida|appreciate wealth': '0510ca4d-67ba-11f1-adb1-00155d0ab410',
  'noida|viega': '0508d1cd-67ba-11f1-adb1-00155d0ab410',
  'noida|exicom': '050a0fa0-67ba-11f1-adb1-00155d0ab410',
  'noida|lawyer panel': 'b0b8cd0f-6969-11f1-adb1-00155d0ab410',       // Eresolution
  'noida|vst': '67c3595f-bdb0-11f1-b9a7-00155d0ab410',
  'onfido noida|onfido': '04f20ddc-67ba-11f1-adb1-00155d0ab410',
  'domestic okaya domestic|reginald': 'b0b6e055-6969-11f1-adb1-00155d0ab410',        // BTM Ventures
  'domestic okaya domestic|reginald repeat': 'b0b6e055-6969-11f1-adb1-00155d0ab410',
  'domestic okaya domestic|bla bli blu': '8a816fc4-b1cf-11f1-8f5c-00155d0ab410',     // Raritiq Designs
  'domestic okaya domestic|gs1': '04f39922-67ba-11f1-adb1-00155d0ab410',
  'domestic okaya domestic|finnable': '04f7be9c-67ba-11f1-adb1-00155d0ab410',
  'domestic okaya domestic|wedding invitation': 'b0b7dfb8-6969-11f1-adb1-00155d0ab410', // Captureatrip
};

const MONTH = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07',
  august: '08', september: '09', october: '10', november: '11', december: '12' };

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function fetchTab(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet tab ${gid}: HTTP ${res.status} — is the sheet still shared by link?`);
  const text = await res.text();
  if (text.trimStart().startsWith('<')) throw new Error(`Sheet tab ${gid}: got HTML, not CSV — sharing changed?`);
  return parseCsv(text);
}

/** 'September2026' -> '2026-09'; anything else -> null. */
function periodOf(label) {
  const m = String(label ?? '').trim().match(/^([A-Za-z]+)\s*(\d{4})$/);
  const mm = m && MONTH[m[1].toLowerCase()];
  return mm ? `${m[2]}-${mm}` : null;
}

/** Lakh with 2 decimals -> rupees. Blank and '#N/A'-style cells are 0. */
const rupees = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.round(n * 100000 * 100) / 100 : 0;
};
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const key = (branch, proc) => `${norm(branch).toLowerCase()}|${norm(proc).toLowerCase()}`;

function columnIndex(header, name) {
  const i = header.findIndex(h => norm(h).toUpperCase() === name);
  if (i < 0) throw new Error(`Column "${name}" not found in the sheet header — layout changed?`);
  return i;
}

async function main() {
  log(`Reading the MAS Callnet P&L sheet, ${FROM} .. ${TO}${DRY ? ' (dry run)' : ''}`);
  const [pw, idc] = await Promise.all([fetchTab(TAB_PROCESSWISE), fetchTab(TAB_INDIRECT)]);

  const lines = new Map();
  const ph = pw[0];
  const c = {
    branch: columnIndex(ph, 'BRANCH'), process: columnIndex(ph, 'PROCESS'), revenue: columnIndex(ph, 'REVENUE'),
    agent: columnIndex(ph, 'AGENT SALARY'), dsc: columnIndex(ph, 'DSC'), bmc: columnIndex(ph, 'BMC'),
    idc: columnIndex(ph, 'IDC'), interest: columnIndex(ph, 'INTEREST'), op: columnIndex(ph, 'OP'), month: columnIndex(ph, 'MONTH'),
  };
  for (const r of pw.slice(1)) {
    const period = periodOf(r[c.month]);
    if (!period || period < FROM || period > TO || !norm(r[c.branch]) || !norm(r[c.process])) continue;
    const k = `${period}|${key(r[c.branch], r[c.process])}`;
    if (lines.has(k)) throw new Error(`Processwise P&L has ${r[c.branch]} / ${r[c.process]} twice for ${period}`);
    lines.set(k, {
      period_code: period, sheet_branch: norm(r[c.branch]), sheet_process: norm(r[c.process]),
      revenue: rupees(r[c.revenue]), agent_salary: rupees(r[c.agent]), dsc_salary: rupees(r[c.dsc]),
      bmc_salary: rupees(r[c.bmc]), idc_total: rupees(r[c.idc]), interest: rupees(r[c.interest]),
      operating_profit: rupees(r[c.op]),
      idc_communication: 0, idc_computer_hire: 0, idc_office_rent: 0, idc_cam_misc: 0, idc_electricity: 0,
      idc_staff_welfare: 0, idc_others: 0,
    });
  }

  const ih = idc[0];
  const d = {
    branch: columnIndex(ih, 'BRANCH'), process: columnIndex(ih, 'PROCESS'), comm: columnIndex(ih, 'COMMUNICATION'),
    hire: columnIndex(ih, 'COMPUTER HIRE'), rent: columnIndex(ih, 'OFFICE RENT'), cam: columnIndex(ih, 'CAM CHARGES/MISC.'),
    elec: columnIndex(ih, 'ELECTRICITY'), welfare: columnIndex(ih, 'STAFF WELFARE'), others: columnIndex(ih, 'OTHERS'),
    total: columnIndex(ih, 'TOTAL'), month: columnIndex(ih, 'MONTH'),
  };
  const idcMismatch = [];
  for (const r of idc.slice(1)) {
    const period = periodOf(r[d.month]);
    if (!period || period < FROM || period > TO || !norm(r[d.branch]) || !norm(r[d.process])) continue;
    const line = lines.get(`${period}|${key(r[d.branch], r[d.process])}`);
    if (!line) { idcMismatch.push(`${period} ${r[d.branch]} / ${r[d.process]} (only in Indirect Cost)`); continue; }
    Object.assign(line, {
      idc_communication: rupees(r[d.comm]), idc_computer_hire: rupees(r[d.hire]), idc_office_rent: rupees(r[d.rent]),
      idc_cam_misc: rupees(r[d.cam]), idc_electricity: rupees(r[d.elec]), idc_staff_welfare: rupees(r[d.welfare]),
      idc_others: rupees(r[d.others]),
    });
    if (Math.abs(rupees(r[d.total]) - line.idc_total) > 1000) {
      idcMismatch.push(`${period} ${r[d.branch]} / ${r[d.process]}: Indirect Cost ${rupees(r[d.total])} vs Processwise ${line.idc_total}`);
    }
  }
  if (idcMismatch.length) {
    log(`  ${idcMismatch.length} Indirect Cost row(s) do not line up with Processwise P&L (Processwise IDC is kept):`);
    for (const m of idcMismatch.slice(0, 20)) log(`    ${m}`);
  }

  const hrms = await connect('mas_hrms', { log });
  try {
    const [branches] = await hrms.query(
      `SELECT UPPER(TRIM(branch_name)) AS name, COALESCE(MAX(CASE WHEN active_status = 1 THEN id END), MAX(id)) AS id
         FROM branch_master GROUP BY UPPER(TRIM(branch_name))`);
    const branchId = new Map(branches.map(b => [b.name, b.id]));
    const processIds = [...new Set(Object.values(PROCESS))];
    const [procs] = await hrms.query(`SELECT id FROM process_master WHERE id IN (${processIds.map(() => '?').join(',')})`, processIds);
    const known = new Set(procs.map(p => p.id));
    const missing = processIds.filter(id => !known.has(id));
    if (missing.length) throw new Error(`Mapped process id(s) not in process_master: ${missing.join(', ')}`);

    const rows = [...lines.values()].map(l => {
      const hrmsBranch = BRANCH[l.sheet_branch.toLowerCase()];
      if (!hrmsBranch) throw new Error(`Sheet branch "${l.sheet_branch}" has no HRMS branch mapping`);
      const bid = branchId.get(hrmsBranch);
      if (!bid) throw new Error(`HRMS branch ${hrmsBranch} not found in branch_master`);
      return { ...l, branch_id: bid, process_id: PROCESS[key(l.sheet_branch, l.sheet_process)] ?? null,
        source_ref: `MAS-Projection 2026-27 G-Sheet ${SHEET_ID}: Processwise P&L + Indirect Cost` };
    });

    const unmapped = [...new Set(rows.filter(r => !r.process_id).map(r => `${r.sheet_branch} / ${r.sheet_process}`))];
    log(`  ${rows.length} line(s); ${unmapped.length} sheet process(es) kept at branch level: ${unmapped.join('; ')}`);
    const byPeriod = {};
    for (const r of rows) {
      const t = (byPeriod[r.period_code] ??= { revenue: 0, salary: 0, idc: 0, op: 0 });
      t.revenue += r.revenue; t.salary += r.agent_salary + r.dsc_salary + r.bmc_salary; t.idc += r.idc_total; t.op += r.operating_profit;
    }
    for (const [p, t] of Object.entries(byPeriod).sort()) {
      log(`  ${p}: revenue ${(t.revenue / 1e5).toFixed(2)} L, salary ${(t.salary / 1e5).toFixed(2)} L, IDC ${(t.idc / 1e5).toFixed(2)} L, OP ${(t.op / 1e5).toFixed(2)} L`);
    }
    if (DRY) { log('Dry run: nothing written.'); return; }

    const cols = ['period_code', 'sheet_branch', 'sheet_process', 'branch_id', 'process_id', 'revenue', 'agent_salary',
      'dsc_salary', 'bmc_salary', 'idc_total', 'idc_communication', 'idc_computer_hire', 'idc_office_rent', 'idc_cam_misc',
      'idc_electricity', 'idc_staff_welfare', 'idc_others', 'interest', 'operating_profit', 'source_ref'];
    const update = cols.slice(3).map(col => `${col} = VALUES(${col})`).concat('imported_at = CURRENT_TIMESTAMP').join(', ');
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await hrms.query(
        `INSERT INTO pnl_finance_sheet_line (${cols.join(',')}) VALUES ${chunk.map(() => `(${cols.map(() => '?').join(',')})`).join(',')}
         ON DUPLICATE KEY UPDATE ${update}`,
        chunk.flatMap(r => cols.map(col => r[col])));
    }
    log(`Done: ${rows.length} line(s) upserted.`);
  } finally {
    await hrms.end();
  }
}

main().catch((e) => { console.error(`FAILED: ${e.message}`); process.exit(1); });
