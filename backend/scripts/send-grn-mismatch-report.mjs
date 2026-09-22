/**
 * send-grn-mismatch-report.mjs
 *
 * Compares GRN counts between db_bill (legacy) and mas_hrms (new system)
 * for the current month, then emails a branch-wise + head/subhead-wise
 * mismatch report to each branch admin, CCing branch heads.
 *
 * Usage:
 *   node backend/scripts/send-grn-mismatch-report.mjs              # current month
 *   node backend/scripts/send-grn-mismatch-report.mjs --month=2026-09
 *   node backend/scripts/send-grn-mismatch-report.mjs --dry-run    # print, don't send
 */

import mysql from 'mysql2/promise';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

function fromEnv(key) {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m?.[1]?.replace(/^["']|["']$/g, '').trim() ?? undefined;
  } catch { return undefined; }
}

const arg = (name, fallback) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const DRY_RUN = process.argv.includes('--dry-run');

// Determine report month (default: current calendar month)
function defaultPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const PERIOD = arg('month', defaultPeriod()); // e.g. "2026-09"
const [periodYear, periodMon] = PERIOD.split('-');

// db_bill month name map (Sep → 'Sep' etc.)
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DB_BILL_MONTH = MONTH_NAMES[parseInt(periodMon, 10) - 1];
const DISPLAY_MONTH = new Date(`${PERIOD}-01`).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

// FY derivation
const fyYear = parseInt(periodYear, 10);
const FINANCE_YEAR = parseInt(periodMon, 10) >= 4
  ? `${fyYear}-${String(fyYear + 1).slice(-2)}`
  : `${fyYear - 1}-${String(fyYear).slice(-2)}`;

const HRMS_DB = {
  host: fromEnv('DB_HOST') ?? '122.184.128.90',
  port: parseInt(fromEnv('DB_PORT') ?? '3306', 10),
  user: fromEnv('DB_USER'), password: fromEnv('DB_PASSWORD'),
  database: 'mas_hrms', connectTimeout: 30000,
};
const BILL_DB = {
  host: '192.168.10.22', port: 3306,
  user: fromEnv('DB_USER'), password: fromEnv('DB_PASSWORD'),
  database: 'db_bill', connectTimeout: 30000,
};

// ── db_bill branch ID → name mapping ────────────────────────────────────────
const BRANCH_MAP = {
  2: 'NOIDA', 3: 'HEAD OFFICE', 5: 'AHMEDABAD-JALDARSHAN',
  6: 'AHMEDABAD-NEELAKANTH', 7: 'NOIDA', 9: 'NOIDA-2',
  12: 'DELHI', 13: 'JAIPUR', 14: 'KOLKATA', 15: 'KANPUR',
  16: 'NOIDA-DIALDESK', 17: 'CHANDIGARH', 18: 'NOIDA',
};

// ── Money formatter ──────────────────────────────────────────────────────────
const money = (n) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);

// ── Queries ──────────────────────────────────────────────────────────────────

async function getDbBillGrns(conn) {
  const [rows] = await conn.execute(`
    SELECT
      COALESCE(bm.BranchName,
        CASE eem.BranchId
          WHEN 2 THEN 'NOIDA' WHEN 3 THEN 'HEAD OFFICE' WHEN 5 THEN 'AHMEDABAD-JALDARSHAN'
          WHEN 6 THEN 'AHMEDABAD-NEELAKANTH' WHEN 7 THEN 'NOIDA' WHEN 9 THEN 'NOIDA-2'
          WHEN 12 THEN 'DELHI' WHEN 13 THEN 'JAIPUR' WHEN 16 THEN 'NOIDA-DIALDESK'
          WHEN 17 THEN 'CHANDIGARH' WHEN 18 THEN 'NOIDA'
          ELSE CONCAT('Branch-', CAST(eem.BranchId AS CHAR)) END
      ) AS branch_name,
      COALESCE(hm.HeadName, 'Unknown Head') AS head,
      COALESCE(shm.SubHeadName, 'Unknown Sub-Head') AS sub_head,
      COALESCE(vm.CompanyName, 'Unknown Vendor') AS vendor_name,
      eem.GrnNo AS grn_no,
      CAST(COALESCE(NULLIF(eem.Amount,''), '0') AS DECIMAL(18,2)) AS amount,
      eem.EntryStatus AS entry_status
    FROM expense_entry_master eem
    LEFT JOIN branch_master bm ON bm.Id = eem.BranchId
    LEFT JOIN head_master hm ON hm.Id = eem.HeadId
    LEFT JOIN sub_head_master shm ON shm.Id = eem.SubHeadId
    LEFT JOIN vendor_master vm ON vm.Id = eem.Vendor
    WHERE eem.FinanceYear = ? AND eem.FinanceMonth = ?
      AND COALESCE(eem.EntryStatus,'') != 'Rejected'
    ORDER BY branch_name, head, sub_head, vendor_name
  `, [FINANCE_YEAR, DB_BILL_MONTH]);
  return rows;
}

async function getHrmsGrns(conn) {
  const [rows] = await conn.execute(`
    SELECT
      bm.branch_name,
      gr.head,
      gr.sub_head,
      gr.vendor_name,
      gr.grn_number AS grn_no,
      gr.amount_with_tax AS amount,
      gr.status
    FROM grn_request gr
    LEFT JOIN branch_master bm ON bm.id = gr.branch_id
    WHERE gr.financial_year = ?
      AND gr.grn_number REGEXP ?
      AND gr.grn_type = 'vendor'
      AND gr.status NOT IN ('cancelled','rejected')
    ORDER BY bm.branch_name, gr.head, gr.sub_head, gr.vendor_name
  `, [FINANCE_YEAR, `/${periodMon.replace(/^0/,'')}/[0-9]{2}/`]);
  return rows;
}

async function getBranchContacts(conn) {
  const [rows] = await conn.execute(`
    SELECT DISTINCT
      bm.branch_name,
      ur.role_key AS role,
      COALESCE(e.official_email, au.email) AS email,
      CONCAT(e.first_name, ' ', e.last_name) AS name
    FROM user_roles ur
    JOIN auth_user au ON au.id = ur.user_id AND au.is_active = 1
    JOIN employees e ON e.user_id = ur.user_id AND e.active_status = 1
    JOIN branch_master bm ON bm.id = (
      SELECT branch_id FROM employees WHERE user_id = ur.user_id AND active_status = 1 LIMIT 1
    )
    WHERE ur.role_key IN ('branch_admin', 'branch_head')
      AND ur.active_status = 1
      AND COALESCE(e.official_email, au.email) IS NOT NULL
    ORDER BY bm.branch_name, ur.role_key
  `);
  // Group by branch
  const map = {};
  for (const r of rows) {
    if (!map[r.branch_name]) map[r.branch_name] = { admins: [], heads: [] };
    if (r.role === 'branch_admin') map[r.branch_name].admins.push({ name: r.name, email: r.email });
    else map[r.branch_name].heads.push({ name: r.name, email: r.email });
  }
  return map;
}

// ── Build comparison report per branch ──────────────────────────────────────

function buildReport(dbBillRows, hrmsRows) {
  // Group by branch → head → subhead → vendor
  const key = (branch, head, sub, vendor) => `${branch}||${head}||${sub}||${vendor}`;

  const dbBillMap = {};
  for (const r of dbBillRows) {
    const k = key(r.branch_name, r.head, r.sub_head, r.vendor_name);
    if (!dbBillMap[k]) dbBillMap[k] = { branch: r.branch_name, head: r.head, sub_head: r.sub_head, vendor: r.vendor_name, count: 0, amount: 0 };
    dbBillMap[k].count++;
    dbBillMap[k].amount += Number(r.amount) || 0;
  }

  const hrmsMap = {};
  for (const r of hrmsRows) {
    const k = key(r.branch_name || 'Unknown', r.head || 'Unknown', r.sub_head || 'Unknown', r.vendor_name || 'Unknown');
    if (!hrmsMap[k]) hrmsMap[k] = { branch: r.branch_name || 'Unknown', head: r.head || 'Unknown', sub_head: r.sub_head || 'Unknown', vendor: r.vendor_name || 'Unknown', count: 0, amount: 0 };
    hrmsMap[k].count++;
    hrmsMap[k].amount += Number(r.amount) || 0;
  }

  // Merge all keys
  const allKeys = new Set([...Object.keys(dbBillMap), ...Object.keys(hrmsMap)]);
  const rows = [];
  for (const k of allKeys) {
    const db = dbBillMap[k] || { count: 0, amount: 0 };
    const hr = hrmsMap[k] || { count: 0, amount: 0 };
    const ref = dbBillMap[k] || hrmsMap[k];
    rows.push({
      branch: ref.branch, head: ref.head, sub_head: ref.sub_head, vendor: ref.vendor,
      db_count: db.count, db_amount: db.amount,
      hrms_count: hr.count, hrms_amount: hr.amount,
      diff: hr.count - db.count,
    });
  }

  // Sort by branch, then mismatch first
  rows.sort((a, b) => {
    if (a.branch !== b.branch) return a.branch.localeCompare(b.branch);
    if (a.diff !== b.diff) return Math.abs(b.diff) - Math.abs(a.diff); // biggest mismatch first
    return `${a.head}${a.sub_head}`.localeCompare(`${b.head}${b.sub_head}`);
  });

  // Group by branch
  const byBranch = {};
  for (const r of rows) {
    if (!byBranch[r.branch]) byBranch[r.branch] = [];
    byBranch[r.branch].push(r);
  }

  return byBranch;
}

// ── HTML email builder ───────────────────────────────────────────────────────

function buildHtml(branchName, rows, contacts) {
  const totalDbBill  = rows.reduce((s, r) => s + r.db_count,   0);
  const totalHrms    = rows.reduce((s, r) => s + r.hrms_count, 0);
  const totalDiff    = totalHrms - totalDbBill;
  const mismatchRows = rows.filter(r => r.diff !== 0);
  const matchRows    = rows.filter(r => r.diff === 0);

  const statusColor  = totalDiff === 0 ? '#16a34a' : '#dc2626';
  const statusText   = totalDiff === 0 ? '✅ Counts Match' : `⚠️ Mismatch: ${totalDiff > 0 ? '+' : ''}${totalDiff} vs db_bill`;

  const rowHtml = (r, highlight) => `
    <tr style="background:${highlight ? (r.diff > 0 ? '#fef2f2' : r.diff < 0 ? '#fff7ed' : '#f0fdf4') : '#fff'}">
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px">${r.head}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px">${r.sub_head}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px">${r.vendor}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:12px">${r.db_count}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:12px;color:#6b7280">₹${money(r.db_amount)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:12px">${r.hrms_count}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:12px;color:#6b7280">₹${money(r.hrms_amount)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:center;font-weight:700;font-size:12px;color:${r.diff === 0 ? '#16a34a' : r.diff > 0 ? '#dc2626' : '#d97706'}">${r.diff === 0 ? '✓' : (r.diff > 0 ? '+' : '') + r.diff}</td>
    </tr>`;

  const tableHeader = `
    <tr style="background:#1e293b;color:#fff">
      <th style="padding:10px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.05em">HEAD</th>
      <th style="padding:10px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.05em">SUB-HEAD</th>
      <th style="padding:10px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.05em">VENDOR</th>
      <th style="padding:10px;text-align:center;font-size:11px;font-weight:700;letter-spacing:0.05em">DB-BILL<br>GRNs</th>
      <th style="padding:10px;text-align:right;font-size:11px;font-weight:700;letter-spacing:0.05em">DB-BILL<br>Amount</th>
      <th style="padding:10px;text-align:center;font-size:11px;font-weight:700;letter-spacing:0.05em">HRMS<br>GRNs</th>
      <th style="padding:10px;text-align:right;font-size:11px;font-weight:700;letter-spacing:0.05em">HRMS<br>Amount</th>
      <th style="padding:10px;text-align:center;font-size:11px;font-weight:700;letter-spacing:0.05em">DIFF</th>
    </tr>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif">
<div style="max-width:900px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
  <!-- Header -->
  <div style="background:#1e293b;padding:24px 32px">
    <div style="color:#94a3b8;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px">MAS Callnet PeopleOS · Finance</div>
    <div style="color:#fff;font-size:22px;font-weight:700">GRN Reconciliation Report</div>
    <div style="color:#94a3b8;font-size:13px;margin-top:4px">${DISPLAY_MONTH} · Branch: <strong style="color:#e2e8f0">${branchName}</strong></div>
  </div>

  <!-- Status Banner -->
  <div style="background:${totalDiff === 0 ? '#f0fdf4' : '#fef9c3'};border-bottom:1px solid ${totalDiff === 0 ? '#bbf7d0' : '#fde68a'};padding:14px 32px;display:flex;align-items:center;gap:16px">
    <div>
      <div style="font-size:16px;font-weight:700;color:${statusColor}">${statusText}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px">
        DB-bill (ISPARK): <strong>${totalDbBill}</strong> GRNs &nbsp;|&nbsp;
        MAS HRMS: <strong>${totalHrms}</strong> GRNs &nbsp;|&nbsp;
        Net difference: <strong style="color:${statusColor}">${totalDiff >= 0 ? '+' : ''}${totalDiff}</strong>
      </div>
    </div>
  </div>

  <!-- Context -->
  <div style="padding:16px 32px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;line-height:1.7">
    <strong>Context:</strong> We are running GRN management in parallel across both DB-bill (ISPARK legacy) and MAS HRMS during this transition period.
    Every GRN raised in DB-bill must also be entered in HRMS. This report shows gaps — entries appearing in one system but not the other.
    <br><strong>Action required:</strong> Please ensure all GRNs raised this month in DB-bill are also entered in HRMS with the same vendor, head, sub-head and amount. Contact the Finance team for any discrepancies.
  </div>

  <div style="padding:24px 32px">

    ${mismatchRows.length > 0 ? `
    <!-- Mismatch Section -->
    <div style="margin-bottom:8px">
      <div style="font-size:14px;font-weight:700;color:#dc2626;margin-bottom:4px">⚠️ Mismatches (${mismatchRows.length} rows)</div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:12px">Red = extra in HRMS vs DB-bill · Orange = missing in HRMS vs DB-bill</div>
    </div>
    <div style="overflow-x:auto;margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        ${tableHeader}
        ${mismatchRows.map(r => rowHtml(r, true)).join('')}
      </table>
    </div>` : ''}

    ${matchRows.length > 0 ? `
    <!-- Matching Section -->
    <details>
      <summary style="cursor:pointer;font-size:14px;font-weight:700;color:#16a34a;margin-bottom:12px">✅ Matching entries (${matchRows.length} rows) — click to expand</summary>
      <div style="overflow-x:auto;margin-top:12px">
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
          ${tableHeader}
          ${matchRows.map(r => rowHtml(r, false)).join('')}
        </table>
      </div>
    </details>` : ''}

    ${mismatchRows.length === 0 && matchRows.length === 0 ? `
    <div style="text-align:center;padding:32px;color:#6b7280;font-size:13px">No GRN data found for this branch in ${DISPLAY_MONTH}.</div>` : ''}

  </div>

  <!-- Footer -->
  <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center">
    This is an automated report from MAS Callnet PeopleOS. Do not reply to this email.
    Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
  </div>
</div>
</body>
</html>`;
}

// ── Email transport ──────────────────────────────────────────────────────────

function createTransport() {
  return nodemailer.createTransport({
    host: fromEnv('SMTP_HOST'),
    port: parseInt(fromEnv('SMTP_PORT') ?? '587', 10),
    secure: false,
    auth: { user: fromEnv('SMTP_USER'), pass: fromEnv('SMTP_PASS') },
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📊 GRN Mismatch Report — ${DISPLAY_MONTH} (FY ${FINANCE_YEAR})`);
  console.log(DRY_RUN ? '   MODE: DRY RUN — no emails sent\n' : '   MODE: LIVE — emails will be sent\n');

  const hrms = await mysql.createConnection(HRMS_DB);
  const bill = await mysql.createConnection(BILL_DB);

  console.log('Fetching GRN data from both systems...');
  const [dbBillRows, hrmsRows, contacts] = await Promise.all([
    getDbBillGrns(bill),
    getHrmsGrns(hrms),
    getBranchContacts(hrms),
  ]);

  console.log(`  DB-bill GRNs: ${dbBillRows.length}`);
  console.log(`  HRMS GRNs:    ${hrmsRows.length}`);

  await bill.end();

  const byBranch = buildReport(dbBillRows, hrmsRows);

  // Collect all branches from both sources
  const allBranches = new Set([
    ...Object.keys(byBranch),
    ...Object.keys(contacts),
  ]);

  console.log(`\nBranch summary:`);
  for (const branch of allBranches) {
    const rows = byBranch[branch] ?? [];
    const dbTotal   = rows.reduce((s, r) => s + r.db_count,   0);
    const hrmsTotal = rows.reduce((s, r) => s + r.hrms_count, 0);
    const mismatch  = rows.filter(r => r.diff !== 0).length;
    console.log(`  ${branch.padEnd(35)} db_bill=${dbTotal}  hrms=${hrmsTotal}  mismatches=${mismatch}`);
  }

  if (!DRY_RUN) {
    const transport = createTransport();

    for (const branch of allBranches) {
      const rows = byBranch[branch] ?? [];
      const c    = contacts[branch];

      if (!c || c.admins.length === 0) {
        console.log(`\n⚠️  ${branch}: no branch admin found — skipping email`);
        continue;
      }

      const toList  = c.admins.map(a => a.email).join(',');
      const ccList  = c.heads.map(h => h.email).join(',');
      const toNames = c.admins.map(a => a.name).join(', ');

      const html = buildHtml(branch, rows, c);
      const dbTotal   = rows.reduce((s, r) => s + r.db_count,   0);
      const hrmsTotal = rows.reduce((s, r) => s + r.hrms_count, 0);
      const mismatch  = dbTotal !== hrmsTotal;

      try {
        await transport.sendMail({
          from: `"MAS Callnet HRMS" <${fromEnv('SMTP_FROM') ?? fromEnv('SMTP_USER')}>`,
          to: toList,
          cc: ccList || undefined,
          subject: `[GRN Reconciliation] ${branch} — ${DISPLAY_MONTH} ${mismatch ? `⚠️ MISMATCH (DB-bill: ${dbTotal} vs HRMS: ${hrmsTotal})` : '✅ All Match'}`,
          html,
        });
        console.log(`\n✅ ${branch}: email sent to ${toNames}`);
        if (ccList) console.log(`   CC: ${c.heads.map(h => h.name).join(', ')}`);
      } catch (err) {
        console.error(`\n❌ ${branch}: email failed — ${err.message}`);
      }
    }

    transport.close();
  } else {
    // Dry run: print first branch's HTML to stdout for preview
    const firstBranch = [...allBranches][0];
    if (firstBranch) {
      const rows = byBranch[firstBranch] ?? [];
      const c    = contacts[firstBranch] ?? { admins: [], heads: [] };
      console.log(`\n--- EMAIL PREVIEW: ${firstBranch} ---`);
      console.log(`To:  ${c.admins.map(a => `${a.name} <${a.email}>`).join(', ') || '(no admins)'}`);
      console.log(`CC:  ${c.heads.map(h => `${h.name} <${h.email}>`).join(', ') || '(no heads)'}`);
      console.log(`Subject: [GRN Reconciliation] ${firstBranch} — ${DISPLAY_MONTH}`);
      console.log(`\nRow count: ${rows.length} (${rows.filter(r=>r.diff!==0).length} mismatches)`);
    }
  }

  await hrms.end();
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
