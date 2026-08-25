/**
 * One-off script: send yesterday's daily hiring report to shivam.giri@teammas.in
 * Run: node c:/tmp/send-daily-report-test.mjs
 */

import nodemailer from 'nodemailer';
import mysql from 'mysql2/promise';

const DB = { host: '122.184.128.90', user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'mas_hrms' };
const SMTP = { host: 'smtp.gmail.com', port: 587, user: 'careers@teammas.in', pass: 'tpimnpkbqsltavbd' };
const YESTERDAY = '2026-08-24';
const WEEK_START = '2026-08-18'; // Monday of that week
const MONTH_START = '2026-08-01';
const TO = 'shivam.giri@teammas.in';
const DASHBOARD_URL = 'https://mcnhrms.teammas.in/recruitment/candidates';
const SLA_MINUTES = 240;

const db = await mysql.createPool(DB);

function fmtPct(n, d) { return d ? `${Math.round((n/d)*100)}%` : '0%'; }
function fmtWait(min) {
  if (min === null || min === undefined || min < 0) return '—';
  const h = Math.floor(min/60), m = Math.round(min%60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function periodMetrics(branch, from, to) {
  const [rows] = await db.execute(`
    SELECT
      COUNT(DISTINCT c.id) AS walkin,
      SUM(CASE WHEN c.current_stage IN ('Selected','selected','Offered','offer_approved','converted','payroll_validated','Onboarded') THEN 1 ELSE 0 END) AS selected,
      SUM(CASE WHEN s.walkin_end_stage='rejected' OR s.final_decision IN ('Rejected','rejected','not_selected') THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN s.id IS NOT NULL AND COALESCE(s.final_decision,'') NOT IN ('Selected','selected','offer_given','Rejected','rejected','not_selected','no_show','no_show_confirmed') AND c.current_stage NOT IN ('Selected','Offered','offer_approved','converted','payroll_validated','Onboarded') THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN c.current_stage='Round 3- Client' OR (s.client_round_conducted=0 AND s.id IS NOT NULL) THEN 1 ELSE 0 END) AS client_rnd_pending,
      SUM(CASE WHEN s.walkin_end_stage='no_show' OR s.final_decision IN ('no_show','no_show_confirmed') THEN 1 ELSE 0 END) AS no_show,
      SUM(CASE WHEN s.id IS NOT NULL AND s.interview_started_at IS NOT NULL AND TIMESTAMPDIFF(MINUTE,COALESCE(c.walk_in_date,c.created_at),s.interview_started_at) > ? THEN 1 ELSE 0 END) AS sla_breach,
      SUM(CASE WHEN s.id IS NULL AND c.current_stage IN ('Arrived','Arrival','Screening','Interview') THEN 1 ELSE 0 END) AS pending,
      ROUND(AVG(CASE WHEN s.interview_started_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE,COALESCE(c.walk_in_date,c.created_at),s.interview_started_at) END),0) AS avg_wait
    FROM ats_candidate c LEFT JOIN ats_interview_submission s ON s.candidate_id=c.id
    WHERE c.record_type='candidate' AND c.applied_for_branch=? AND DATE(COALESCE(c.walk_in_date,c.created_at)) BETWEEN ? AND ?`,
    [SLA_MINUTES, branch, from, to]
  );
  const r = rows[0] || {};
  const walkin = Number(r.walkin||0), selected = Number(r.selected||0);
  return { walkin, selected, rejected: Number(r.rejected||0), waiting: Number(r.waiting||0),
    clientRoundPending: Number(r.client_rnd_pending||0), noShow: Number(r.no_show||0),
    slaBreachCount: Number(r.sla_breach||0), pending: Number(r.pending||0),
    selectionPct: fmtPct(selected,walkin), avgWaitMinutes: r.avg_wait!=null?Number(r.avg_wait):null };
}

async function processFtd(branch) {
  const [rows] = await db.execute(`
    SELECT c.applied_for_branch AS branch, COALESCE(c.applied_for_process,'Unknown') AS process,
      COUNT(DISTINCT c.id) AS walkin,
      SUM(CASE WHEN c.current_stage IN ('Selected','selected','Offered','offer_approved','converted','payroll_validated','Onboarded') THEN 1 ELSE 0 END) AS selected,
      SUM(CASE WHEN s.walkin_end_stage='rejected' OR s.final_decision IN ('Rejected','rejected','not_selected') THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN s.id IS NOT NULL AND COALESCE(s.final_decision,'') NOT IN ('Selected','selected','offer_given','Rejected','rejected','not_selected','no_show','no_show_confirmed') AND c.current_stage NOT IN ('Selected','Offered','offer_approved','converted','payroll_validated','Onboarded') THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN c.current_stage='Round 3- Client' OR (s.client_round_conducted=0 AND s.id IS NOT NULL) THEN 1 ELSE 0 END) AS client_rnd_pending,
      SUM(CASE WHEN s.walkin_end_stage='no_show' OR s.final_decision IN ('no_show','no_show_confirmed') THEN 1 ELSE 0 END) AS no_show,
      SUM(CASE WHEN s.id IS NULL AND c.current_stage IN ('Arrived','Arrival','Screening','Interview') THEN 1 ELSE 0 END) AS pending,
      ROUND(AVG(CASE WHEN s.interview_started_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE,COALESCE(c.walk_in_date,c.created_at),s.interview_started_at) END),0) AS avg_wait
    FROM ats_candidate c LEFT JOIN ats_interview_submission s ON s.candidate_id=c.id
    WHERE c.record_type='candidate' AND c.applied_for_branch=? AND DATE(COALESCE(c.walk_in_date,c.created_at))=?
    GROUP BY c.applied_for_branch, c.applied_for_process ORDER BY walkin DESC`, [branch, YESTERDAY]);
  return rows.filter(r => !String(r.process||'').match(/^[0-9a-f]{8}-/)).map(r => {
    const walkin=Number(r.walkin||0), selected=Number(r.selected||0);
    return { branch: String(r.branch||branch), process: String(r.process||'Unknown'),
      walkin, selected, rejected:Number(r.rejected||0), waiting:Number(r.waiting||0),
      clientRoundPending:Number(r.client_rnd_pending||0), noShow:Number(r.no_show||0),
      pending:Number(r.pending||0), selectionPct:fmtPct(selected,walkin), avgWaitMinutes:r.avg_wait!=null?Number(r.avg_wait):null };
  });
}

async function recruiterFtd(branch) {
  const [rows] = await db.execute(`
    SELECT COALESCE(c.recruiter_assigned_name,c.recruiter_name,'Unassigned') AS recruiter,
      c.applied_for_branch AS branch,
      COUNT(DISTINCT c.id) AS sourced,
      SUM(CASE WHEN c.current_stage NOT IN ('Applied','New') THEN 1 ELSE 0 END) AS attended,
      SUM(CASE WHEN s.id IS NOT NULL AND s.interview_started_at IS NOT NULL AND TIMESTAMPDIFF(MINUTE,COALESCE(c.walk_in_date,c.created_at),s.interview_started_at)<=? THEN 1 ELSE 0 END) AS sla_met,
      SUM(CASE WHEN c.current_stage IN ('Selected','selected','Offered','offer_approved','converted','payroll_validated','Onboarded') THEN 1 ELSE 0 END) AS selected,
      SUM(CASE WHEN s.id IS NULL AND c.current_stage IN ('Arrived','Arrival','Screening','Interview') THEN 1 ELSE 0 END) AS pending,
      ROUND(AVG(CASE WHEN s.interview_started_at IS NOT NULL THEN TIMESTAMPDIFF(MINUTE,COALESCE(c.walk_in_date,c.created_at),s.interview_started_at) END),0) AS avg_wait
    FROM ats_candidate c LEFT JOIN ats_interview_submission s ON s.candidate_id=c.id
    WHERE c.record_type='candidate' AND c.applied_for_branch=? AND DATE(COALESCE(c.walk_in_date,c.created_at))=?
    GROUP BY recruiter,c.applied_for_branch ORDER BY attended DESC`, [SLA_MINUTES, branch, YESTERDAY]);
  return rows.map(r => {
    const attended=Number(r.attended||0), selected=Number(r.selected||0), slaMet=Number(r.sla_met||0), pending=Number(r.pending||0);
    const avgWait=r.avg_wait!=null?Number(r.avg_wait):null;
    let attention='Stable';
    if(pending>=3||(avgWait!==null&&avgWait>180)) attention='Critical';
    else if(pending>=1||(avgWait!==null&&avgWait>90)) attention='At Risk';
    return { recruiter:String(r.recruiter||'Unassigned'), branch:String(r.branch||branch),
      sourced:Number(r.sourced||0), attended, slaPct:fmtPct(slaMet,attended),
      selectionPct:fmtPct(selected,attended), avgWaitMinutes:avgWait, pendingCount:pending, attention };
  });
}

function buildHtml(reports) {
  const TH = `style="padding:7px 9px;background:#f3f4f6;font-size:11px;font-weight:700;color:#374151;text-align:left;border:1px solid #e5e7eb;white-space:nowrap;"`;
  const TD = `style="padding:6px 9px;font-size:12px;color:#111827;border:1px solid #e5e7eb;"`;
  const TDN = `style="padding:6px 9px;font-size:12px;color:#111827;border:1px solid #e5e7eb;text-align:center;"`;

  const attBadge = (a) => {
    const s = {Stable:'background:#dcfce7;color:#166534;','At Risk':'background:#fef9c3;color:#854d0e;',Critical:'background:#fee2e2;color:#991b1b;'}[a]||'';
    return `<span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;${s}">${a}</span>`;
  };

  let allInterventions = [];
  let allRecruiterRows = '';
  let allProcessRows = '';

  for (const { branchName, ftd, wtd, mtd, processFtdData, recruiterFtdData, interventions } of reports) {
    allInterventions.push(...interventions.map(i=>`<li style="font-size:13px;color:#7c2d12;line-height:1.8;">${i}</li>`));
    for (const p of processFtdData) {
      allProcessRows += `<tr>
        <td ${TD}>${p.branch}</td><td ${TD}>${p.process}</td>
        <td ${TDN}>${p.walkin}</td><td ${TDN}>${p.selected}</td><td ${TDN}>${p.rejected}</td>
        <td ${TDN}>${p.waiting}</td><td ${TDN}>${p.clientRoundPending}</td><td ${TDN}>${p.noShow}</td>
        <td ${TDN}>${p.pending>0?`<span style="color:#dc2626;font-weight:700;">${p.pending}</span>`:0}</td>
        <td ${TDN}>${p.selectionPct}</td><td ${TDN}>${fmtWait(p.avgWaitMinutes)}</td>
      </tr>`;
    }
    for (const r of recruiterFtdData) {
      allRecruiterRows += `<tr>
        <td ${TD}><strong>${r.recruiter}</strong></td><td ${TD}>${r.branch}</td>
        <td ${TDN}>${r.sourced}</td><td ${TDN}>${r.attended}</td>
        <td ${TDN}>${r.slaPct}</td><td ${TDN}>${r.selectionPct}</td>
        <td ${TDN}>${fmtWait(r.avgWaitMinutes)}</td>
        <td ${TDN}>${r.pendingCount>0?`<span style="color:#dc2626;font-weight:700;">${r.pendingCount}</span>`:0}</td>
        <td style="padding:6px 9px;border:1px solid #e5e7eb;">${attBadge(r.attention)}</td>
      </tr>`;
    }
  }

  // Combined FTD/WTD/MTD across all branches
  const combined = (period) => reports.reduce((acc, r) => {
    const m = r[period];
    acc.walkin += m.walkin; acc.selected += m.selected; acc.rejected += m.rejected;
    acc.waiting += m.waiting; acc.clientRoundPending += m.clientRoundPending;
    acc.noShow += m.noShow; acc.slaBreachCount += m.slaBreachCount; acc.pending += m.pending;
    return acc;
  }, { walkin:0,selected:0,rejected:0,waiting:0,clientRoundPending:0,noShow:0,slaBreachCount:0,pending:0 });

  const [cFtd, cWtd, cMtd] = ['ftd','wtd','mtd'].map(combined);
  const periodRow = (label, m) => `<tr>
    <td ${TD}><strong>${label}</strong></td>
    <td ${TDN}>${m.walkin}</td><td ${TDN}>${m.selected}</td><td ${TDN}>${m.rejected}</td>
    <td ${TDN}>${m.waiting}</td><td ${TDN}>${m.clientRoundPending}</td><td ${TDN}>${m.noShow}</td>
    <td ${TDN}>${m.slaBreachCount}</td>
    <td ${TDN}>${fmtPct(m.selected,m.walkin)}</td>
    <td ${TDN}>—</td>
  </tr>`;

  const interventionHtml = allInterventions.length
    ? `<div style="background:#fff7ed;border-left:4px solid #ea580c;padding:14px 16px;border-radius:6px;margin-bottom:20px;">
        <p style="margin:0 0 8px 0;font-size:13px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:0.5px;">⚠ Top Management Intervention Points</p>
        <ul style="margin:0;padding-left:18px;">${allInterventions.join('')}</ul>
      </div>`
    : `<div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:14px 16px;border-radius:6px;margin-bottom:20px;">
        <p style="margin:0;font-size:13px;color:#166534;">✓ No critical intervention points yesterday. Good work!</p>
      </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<div style="max-width:720px;margin:0 auto;background:#fff;">
  <div style="background:linear-gradient(135deg,#6d28d9 0%,#8b5cf6 100%);padding:28px 24px;">
    <p style="margin:0;font-size:22px;font-weight:900;color:#fff;">MAS Callnet PeopleOS</p>
    <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">Daily Hiring Report · All Branches · Monday, 25 Aug 2026 (Yesterday: 24 Aug)</p>
  </div>
  <div style="padding:24px;">
    <p style="margin:0 0 6px;font-size:14px;color:#374151;">Dear HR Team,</p>
    <p style="margin:0 0 18px;font-size:14px;color:#374151;">Please find below the branch hiring performance snapshot and management intervention points for your review.</p>
    ${interventionHtml}
    <p style="margin:16px 0 6px;font-size:14px;font-weight:700;color:#dc2626;font-style:italic;">WIWO Journey Snapshot (All Branches Combined)</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th ${TH}>Period</th><th ${TH}>Walk-in</th><th ${TH}>Selected</th><th ${TH}>Rejected</th>
        <th ${TH}>Waiting</th><th ${TH}>Client Rnd</th><th ${TH}>No Show</th>
        <th ${TH}>SLA Breach</th><th ${TH}>Selection%</th><th ${TH}>Avg Wait</th>
      </tr></thead>
      <tbody>
        ${periodRow('FTD (24 Aug)',cFtd)}
        ${periodRow('WTD',cWtd)}
        ${periodRow('MTD',cMtd)}
      </tbody>
    </table>
    <p style="margin:20px 0 6px;font-size:14px;font-weight:700;color:#dc2626;font-style:italic;">Process-wise Summary by Branch: FTD (24 Aug)</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th ${TH}>Branch</th><th ${TH}>Process</th><th ${TH}>Walk-in</th><th ${TH}>Selected</th>
        <th ${TH}>Rejected</th><th ${TH}>Waiting</th><th ${TH}>Client Rnd</th><th ${TH}>No Show</th>
        <th ${TH}>Pending</th><th ${TH}>Selection%</th><th ${TH}>Avg Wait</th>
      </tr></thead>
      <tbody>${allProcessRows||`<tr><td colspan="11" style="padding:12px;text-align:center;color:#9ca3af;border:1px solid #e5e7eb;">No walk-ins yesterday</td></tr>`}</tbody>
    </table>
    <p style="margin:20px 0 6px;font-size:14px;font-weight:700;color:#111827;">Recruiter Productivity: FTD (24 Aug)</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th ${TH}>Recruiter</th><th ${TH}>Branch</th><th ${TH}>Sourced</th><th ${TH}>Attended</th>
        <th ${TH}>SLA%</th><th ${TH}>Selection%</th><th ${TH}>Avg Wait</th><th ${TH}>Pending</th><th ${TH}>Attention</th>
      </tr></thead>
      <tbody>${allRecruiterRows||`<tr><td colspan="9" style="padding:12px;text-align:center;color:#9ca3af;border:1px solid #e5e7eb;">No activity</td></tr>`}</tbody>
    </table>
    <div style="margin-top:24px;padding:14px;background:#f9fafb;border-radius:6px;text-align:center;border:1px solid #e5e7eb;">
      <span style="font-size:13px;color:#374151;">ATS Dashboard Link: </span>
      <a href="${DASHBOARD_URL}" style="color:#6d28d9;font-weight:700;font-size:13px;">Click Here to Open Dashboard →</a>
    </div>
  </div>
  <div style="background:#f9fafb;padding:16px 24px;border-top:1px solid #e5e7eb;text-align:center;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">Automated daily report · MAS Callnet PeopleOS · Sample run for 24 Aug 2026</p>
  </div>
</div>
</body></html>`;
}

// -- Main --
const BRANCHES = ['NOIDA', 'NOIDA-2', 'AHMEDABAD-JALDARSHAN'];
const reports = [];

for (const branch of BRANCHES) {
  const [ftd, wtd, mtd, processFtdData, recruiterFtdData] = await Promise.all([
    periodMetrics(branch, YESTERDAY, YESTERDAY),
    periodMetrics(branch, WEEK_START, YESTERDAY),
    periodMetrics(branch, MONTH_START, YESTERDAY),
    processFtd(branch),
    recruiterFtd(branch),
  ]);

  const interventions = [];
  if (ftd.pending > 0) interventions.push(`${ftd.pending} candidate${ftd.pending>1?'s':''} pending interview form submission in <strong>${branch}</strong> (${fmtPct(ftd.pending,ftd.walkin)} of yesterday's walk-ins). Branch head to ensure closure.`);
  for (const p of processFtdData) {
    if (p.pending > 0) interventions.push(`${branch} → ${p.process}: ${p.pending} pending case${p.pending>1?'s':''} with no form submitted.`);
  }
  for (const r of recruiterFtdData) {
    if (r.attention === 'Critical') interventions.push(`Recruiter <strong>${r.recruiter}</strong> (${branch}): ${r.pendingCount} pending form${r.pendingCount>1?'s':''} not submitted. Immediate action needed.`);
  }

  reports.push({ branchName: branch, ftd, wtd, mtd, processFtdData, recruiterFtdData, interventions });
  console.log(`✓ ${branch}: FTD walkin=${ftd.walkin} selected=${ftd.selected} pending=${ftd.pending}`);
}

const html = buildHtml(reports);

const mailer = nodemailer.createTransport({ host: SMTP.host, port: SMTP.port, secure: false, auth: { user: SMTP.user, pass: SMTP.pass } });

const result = await mailer.sendMail({
  from: '"MAS Callnet PeopleOS" <careers@teammas.in>',
  to: TO,
  subject: `[All Branches] Daily Hiring Report – 24 Aug 2026 | FTD: ${reports.reduce((s,r)=>s+r.ftd.walkin,0)} Walk-ins · ${reports.reduce((s,r)=>s+r.ftd.selected,0)} Selected · ${reports.reduce((s,r)=>s+r.ftd.pending,0)} Pending`,
  html,
});

console.log('\n✉ Email sent:', result.messageId);
await db.end();
