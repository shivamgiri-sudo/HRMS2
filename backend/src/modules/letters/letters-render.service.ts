// backend/src/modules/letters/letters-render.service.ts
// Renders pixel-accurate HTML for every MAS Callnet letter type.
// The HTML is self-contained (inline CSS, no external deps) so it prints
// correctly from both the browser print dialog and headless PDF tools.

// ── Logo: served from /mcn-logo.png (public folder) ──────────────────────────
// In the rendered HTML we use an absolute URL built from the request origin,
// or fall back to a base64 stub so the letter still renders offline.
const LOGO_URL_PLACEHOLDER = "__LOGO_URL__";

// ── Shared layout helpers ─────────────────────────────────────────────────────

function pageStyles(): string {
  return `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11pt;
      color: #000;
      background: #fff;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 18mm 20mm 18mm 20mm;
      position: relative;
      background: #fff;
    }
    /* page break between multi-page letters */
    .page-break { page-break-after: always; }

    /* ── Header ── */
    .header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 10mm; }
    .header-left h1 { font-size: 18pt; font-weight: bold; margin-bottom: 2px; }
    .header-left p { font-size: 8.5pt; color: #333; }
    .header-logo { width: 70px; height: 70px; object-fit: contain; }

    /* ── Footer ── */
    .footer {
      position: fixed;
      bottom: 10mm;
      left: 20mm;
      right: 20mm;
      border-top: 1px solid #ccc;
      padding-top: 4px;
      font-size: 8pt;
      color: #555;
      display: flex;
      justify-content: space-between;
    }

    /* ── Letter body ── */
    .watermark-copy {
      text-align: center;
      font-size: 9pt;
      color: #555;
      margin-bottom: 8mm;
    }
    .to-block { margin-bottom: 6mm; }
    .to-block p { font-size: 11pt; }
    .to-block .name { font-weight: bold; }
    .date-line { font-weight: bold; margin-bottom: 4mm; }
    .subject-line { margin-bottom: 6mm; display: flex; gap: 8px; }
    .subject-label { font-weight: bold; }
    .subject-value { font-weight: bold; }
    .dear { font-weight: bold; margin-bottom: 4mm; }
    .body-para { text-align: justify; margin-bottom: 4mm; line-height: 1.6; }
    .section-heading { font-weight: bold; margin-bottom: 2mm; margin-top: 5mm; }

    /* ── Salary table (appointment + salary slip) ── */
    .salary-table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; font-size: 10pt; }
    .salary-table td, .salary-table th {
      border: 1px solid #000;
      padding: 3px 6px;
      vertical-align: middle;
    }
    .salary-table th { font-weight: bold; background: #f0f0f0; }
    .salary-table .label-col { width: 55%; }
    .salary-table .value-col { width: 45%; }

    /* ── Salary slip specific ── */
    .slip-header-table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; font-size: 10pt; }
    .slip-header-table td { border: 1px solid #000; padding: 3px 6px; }
    .slip-header-table .cell-label { font-weight: bold; white-space: nowrap; }
    .slip-main-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
    .slip-main-table th { border: 1px solid #000; padding: 3px 6px; font-weight: bold; background: #f0f0f0; text-align: center; }
    .slip-main-table td { border: 1px solid #000; padding: 3px 6px; }
    .slip-main-table .right { text-align: right; }
    .slip-main-table .bold { font-weight: bold; }
    .net-row td { font-weight: bold; font-size: 10.5pt; }
    .words-row td { font-style: italic; text-align: right; font-size: 10pt; }
    .computer-note { text-align: center; font-size: 9pt; color: #555; margin-top: 4mm; }
    .dashed-line { border-top: 2px dashed #999; margin: 4mm 0; }

    /* ── Increment / Promotion ── */
    .ctc-table { width: 60%; border-collapse: collapse; margin: 4mm 0; font-size: 10pt; }
    .ctc-table td, .ctc-table th { border: 1px solid #000; padding: 4px 8px; }
    .ctc-table th { background: #f0f0f0; font-weight: bold; }

    /* ── Experience letter ── */
    .exp-header-table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 6mm; }
    .exp-header-table td { padding: 2px 4px; }
    .exp-letterhead-left { float: left; }
    .exp-letterhead-right { float: right; text-align: right; }
    .exp-letterhead-hr { border: none; border-top: 2px solid #000; margin: 3mm 0; clear: both; }

    /* ── Signature block ── */
    .sign-block { margin-top: 10mm; }
    .sign-block p { margin-bottom: 2mm; }

    /* ── Annexure / NDA ── */
    .annexure-title { text-align: center; font-weight: bold; font-size: 12pt; margin: 6mm 0 4mm; }
    .annexure-sub { text-align: center; font-weight: bold; font-size: 10pt; text-decoration: underline; margin-bottom: 4mm; }
    .nda-ol { padding-left: 5mm; margin-bottom: 4mm; }
    .nda-ol li { margin-bottom: 2mm; text-align: justify; line-height: 1.6; }
    .nda-section { font-weight: bold; margin-top: 6mm; margin-bottom: 2mm; font-size: 11pt; }
    .policy-section { font-weight: bold; margin-top: 5mm; margin-bottom: 1mm; }
    .consent-table { width: 100%; border-collapse: collapse; margin-top: 3mm; font-size: 10pt; }
    .consent-table td { padding: 3px 0; }
    .sign-line { border-bottom: 1px solid #000; display: inline-block; min-width: 120px; }

    @media print {
      .page { padding: 10mm 15mm 20mm 15mm; }
      .footer { position: fixed; bottom: 8mm; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>`;
}

function footer(): string {
  return `<div class="footer">
    <span>E-mail : care@teammas.in</span>
    <span>Web : WWW.teammas.in</span>
  </div>`;
}

function letterHeader(logoUrl: string): string {
  return `<div class="header">
    <div class="header-left">
      <h1>Mas Callnet India Pvt. Ltd.</h1>
      <p>(An ISO 9001 : 2008 Certified Company)</p>
    </div>
    <img src="${logoUrl}" alt="MAS Logo" class="header-logo" />
  </div>`;
}

function expLetterHead(logoUrl: string): string {
  // Experience letter uses a different header with two columns and a rule underneath
  return `<table class="exp-header-table" style="margin-bottom:2mm">
    <tr>
      <td style="width:65%;vertical-align:top">
        <strong style="font-size:13pt">Mas Callnet India Pvt. Ltd.</strong><br>
        CIN No. : U74899DL1990PTC038798<br>
        Registered Office : 102/C-1, Kanchan House, Karampura Commercial Complex,<br>
        New Delhi-110015<br>
        Tel . : 011-91-61105550 &nbsp; E-mail : care@teammas.in &nbsp; Web : www.teammas.in
      </td>
      <td style="width:35%;text-align:right;vertical-align:top">
        <img src="${logoUrl}" alt="MAS Logo" style="width:60px;height:60px;object-fit:contain" />
      </td>
    </tr>
  </table>
  <hr style="border:none;border-top:1.5px solid #000;margin-bottom:6mm">`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. APPOINTMENT LETTER
// ─────────────────────────────────────────────────────────────────────────────

export function renderAppointmentLetter(d: Record<string, string>, logoUrl: string): string {
  const rows = [
    ["Basic Salary",             d.basic         || "0.00"],
    ["House Rent Allowance",     d.hra           || "0.00"],
    ["Conveyance Allowance",     d.conveyance    || "0.00"],
    ["Other Allowance",          d.other_allowance || "0.00"],
    ["Special Allowance",        d.special_allowance || "0.00"],
    ["Bonus",                    d.bonus         || "0.00"],
    ["Medical Allowance",        d.medical_allowance || "0.00"],
    ["Portfolio",                d.portfolio     || "0.00"],
    ["PLI",                      d.pli           || ".00"],
    ["<b>Gross Salary</b>",      `<b>${d.gross_salary || "0.00"}</b>`],
    ["ESIC",                     d.esic          || "0.00"],
    ["EPF",                      d.epf           || "0.00"],
    ["<b>Net Salary</b>",        `<b>${d.net_salary || "0.00"}</b>`],
    ["Employer Cont. - ESIC",    d.employer_esic || "0.00"],
    ["Employer Cont. - EPF",     d.employer_epf  || "0.00"],
    ["Admin Charges",            d.admin_charges || "0.00"],
    ["<b>CTC</b>",               `<b>${d.ctc || "0.00"}</b>`],
  ];

  const salaryRows = rows.map(([label, val]) =>
    `<tr><td class="label-col">${label}</td><td>Rs. ${val}</td></tr>`
  ).join("\n");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <title>Appointment Letter – ${d.full_name}</title>
  ${pageStyles()}
  </head><body>
  <div class="page">
    <div class="watermark-copy">Original Copy</div>
    ${letterHeader(logoUrl)}

    <div class="to-block">
      <p>To,</p>
      <p class="name" style="margin-top:3mm">${d.full_name || ""}</p>
      <p class="name">EMP Code - ${d.employee_code || ""}</p>
    </div>

    <p class="date-line">Date : ${d.issued_date || ""}</p>
    <div class="subject-line">
      <span class="subject-label">Subject :</span>
      <span class="subject-value">APPOINTMENT LETTER</span>
    </div>

    <p class="dear">Dear ${d.full_name || ""}</p>
    <p class="body-para">With reference to your application and your subsequent interview with us, we have pleasure to inform you that we have agreed to provide you an appointment with us.</p>

    <p class="section-heading">ON THE FOLLOWING TERMS AND CONDITIONS</p>

    <p class="section-heading">1. APPOINTMENT DATE</p>
    <p class="body-para">1.1&nbsp;This appointment shall be effective from ${d.date_of_joining || ""}</p>

    <p class="section-heading">2. DESIGNATION</p>
    <p class="body-para">2.1 You will be designated as '${(d.designation || "").toUpperCase()}' and you would be reporting to your Reporting Manager.</p>

    <p class="section-heading">3. REMUNERATION</p>
    <p class="body-para">3.1 Your Monthly Salary Breakup would be as follow (In INR)</p>
    <table class="salary-table">
      ${salaryRows}
    </table>
    ${footer()}
  </div>

  <div class="page page-break">
    <p class="section-heading">4.PROBATION</p>
    <p class="body-para">4.1 You will be on a probation for a period of six-months from the date of your joining. This period of probation will be liable to such extension(s) as the management may deem fit at it's sole discretion. Unless an order in writing, confirming your services is issued and accepted by you, your services will not be deemed to have been confirmed. But, if the management is not satisfied with your work, conduct etc., your service shall be liable to terminate without any notice at any time without assigning any reason during or on completion of the initial or extended probationary period. On Confirmation, the termination of this employment can be affected with a notice period of one month or the basic salary of one month in lieu of the notice period.</p>

    <p class="section-heading">5.PLACEMENT</p>
    <p class="body-para">5.1 You will be liable to transferred to any existing or future department, office or establishment forming part and instruction assigned or communicated to you by the management or those in authority over you from time to time.</p>

    <p class="section-heading">6.SECRECY</p>
    <p class="body-para">6.1 You will not give out to any unauthorized person by word of mouth or otherwise particulars or details of manufacturing process, data, technical know how, administration and organizational matters, operations plans etc. concerning the Company or its associates, that you shall both during and after your employment take all reasonable precautions to keep such information secret. In the event of any breach you shall indemnify company from any legal action.</p>

    <p class="section-heading">7.DUTIES/RESPONSIBILITIES</p>
    <p class="body-para">7.1 You will perform, observe and conform to such duties, directions, instructions assigned or communicated to you by the Management and those in authority over you.</p>
    <p class="body-para">7.2 You will have the responsibility of efficient, satisfactory and economical discharge of duties, directions and instructions assigned or communicated to you by the management or those in authority over from time to time.</p>
    <p class="body-para">7.3 You shall at all times, well and truly account for and shall when so required, make over to responsible authority all moneys, properties and things belonging to the company which may have been placed in your custody or under supervision or may otherwise have come into your possession or under control.</p>
    <p class="body-para">7.4 You may be required to travel on company work as and when required. In such cases you will be entitled to travel expenses/allowances as may be in force from time to time.</p>
    <p class="body-para">7.5 You will devote your whole time during working hours in the work of the company and will not undertake any part time or other work whether honorary or remunerative without prior permission of the management.</p>
    ${footer()}
  </div>

  <div class="page page-break">
    <p class="section-heading">8.OTHER RULES AND REGULATIONS</p>
    <p class="body-para">8.1 You will not without prior permission of Management, engage yourself or be interested or concerned in any other business or activity of any kind whether directly or indirectly or publish any information about the affairs or business or the company or enter for any part of your time in any capacity the services of or be employed by any other firm, company or person whether honorary, remuneratory or otherwise. You will devote whole time and attention in discharging your duties with a high standard of initiative, efficiency and economy.</p>
    <p class="body-para">8.2 You will not enter any commitments or dealings on behalf of the Management for which you have no express authority nor alter or be a part to any alternation of any principle or policy of the Management or exceed the authority or discretion vested in you without the prior sanction of the company or those in authority over you.</p>
    <p class="body-para">8.3 You will disclose to us forthwith any discovery, invention, process or improvement made or discovered by you while in our service, and such discovery, invention, process or improvement shall belong absolutely to and be the sole and absolute property of the Company. If and when required to do so by the company, you shall at the Company's expense, take out or apply for Latter's Patent, Licenses or other rights, privileges or protection as may be required by us in respect of any such discovery, invention, process or improvement so that the benefit thereof shall accrue to us for assigning, transferring or otherwise vesting the same and all benefits arising in respect thereof in our favor or in favor of such other person or persons, firms or companies, as we may direct as the sole beneficiary thereof.</p>
    <p class="body-para">8.4 You shall not seek membership of affiliation of any body, local or public or otherwise including educational institutions without first obtaining permission from the Management.</p>

    <p class="section-heading">9.TERMINATION OF SERVICES</p>
    <p class="body-para">9.1 You will automatically retire from the service of the company on attaining the superannuation age of 58 years.</p>
    <p class="body-para">9.2 In case you remain absent without prior permission or authorization or overstay leave for three consecutive calendar days, beyond the period of leave originally granted or subsequently extended it shall be deemed that you have left the services of the company on your own accord without notice and the same shall be treated as abandonment of service on your part.</p>
    <p class="body-para">9.3 During Probation, termination of your employment will be subject to Fifteen Days notice in writing from you.</p>
    <p class="body-para">9.4 On satisfactory completion of the probation period and after your confirmation in writing except for the reasons mentioned in this appointment letter, your services can be terminated by giving notice of one month or payment of basic salary in lieu thereof on either side. However, in event of your resignation, the company in its sole discretion will have an option to accept the same and relieve you prior to completion of the stipulated notice period of one month, without any pay in lieu of the notice period.</p>
    ${footer()}
  </div>

  <div class="page page-break">
    <p class="body-para">9.5 If at any time in our opinion, which in final in this matter, you are insolvent or found guilty of negligence or in-discipline or of any other conduct considered by us as detrimental to our interest, or of violation of one or more terms of this letter, your services are liable to be terminated without any notice or compensation in lieu thereof.</p>
    <p class="body-para">9.6 You are also required to update yourself about Code of Conduct guidelines, company policies and procedures as framed and changed by company from time to time in the light of changing business scenarios. Any Violation of the above terms and any other Code of Conduct guidelines or Company policies and procedures would result in immediate termination of service without any notice or warning or compensation in lieu thereof.</p>
    <p class="body-para">9.7 In case any declaration or particulars given by you in your application for employment is found to be wrong or you are found to have willfully suppressed any material information, this appointment will be liable to termination without any notice or compensation in lieu thereof.</p>
    <p class="body-para">All terms and conditions will be governed by the Company's policies as stated from time to time and the company may in its sole discretion as it deems fit revoke or change such Policies.</p>
    <p class="body-para">The terms of this offer shall be kept strictly confidential. You shall execute all the documents as indicated in Annexure-I so as to give effect to this offer.</p>
    <p class="body-para">Please return the duplicate copy of this letter duly signed in token of your having accepted the offer. Please initial each page in acceptance of the terms and conditions set out herein latest by 10 days of the issuance of the letter else this offer stands automatically withdrawn.</p>
    <p class="body-para">We welcome you and wish you every success in your career with Mas Callnet India Pvt. Ltd.</p>

    <div class="sign-block">
      <p>Sincerely,</p>
      <p style="margin-top:6mm">For Mas Callnet India Pvt. Ltd.</p>
      <p style="margin-top:6mm">Authorized Signatory</p>
      <p style="margin-top:6mm">Date of Joining: ${d.date_of_joining || ""}</p>
    </div>
    ${footer()}
  </div>

  <div class="page">
    <div class="annexure-title">ANNEXURE-I</div>
    <div class="annexure-sub">DOCUMENTS/CREDENTIALS/REQUIRED AT THE TIME OF JOINING</div>
    <ol class="nda-ol">
      <li>Six recent passport sized photographs.</li>
      <li>A Copy of updated Curriculum Vitae</li>
      <li>A Copy of Appointment letter</li>
      <li>Proof of Address ( Copy of Rent Agreement, Ration Card, Voter's ID card, Driving License, Electricity Bill, Landline Bill)</li>
      <li>Secondary School Certificate (10th) / 10th Mark sheet</li>
      <li>Senior Secondary School Certificate (12th)/ 12th Mark sheet</li>
      <li>Bachelor's Degree, All yrs. Mark sheet / Graduation degree certificate/ diploma/ Certification Course</li>
      <li>Post Graduation Certificate.</li>
      <li>Additional Qualification</li>
      <li>Proof of Identity ( Copy of passport/ driving license/ voter's ID card/ bank pass book with photo/ pan card)</li>
      <li>Appointment Letter of Last Organization Served.</li>
      <li>Last Pay Slip drawn</li>
      <li>Form 16 (1) (Pertaining to Tax deducted at source) from the previous or salary certificate.</li>
    </ol>
    <div class="annexure-sub">DOCUMENTS TO BE DULY FILLED AND SIGNED AT THE TIME OF JOINING</div>
    <ol class="nda-ol">
      <li>Employee's Record Form</li>
      <li>Code of Conduct</li>
      <li>Phone Undertaking/Asset Undertaking</li>
      <li>ESI Form</li>
      <li>EPF Form</li>
    </ol>
    <div class="annexure-sub" style="text-decoration:underline">INFORMATION REQUIRED FOR TRANSFERRING PROVIDENT FUND/ SUPERANNUATION FROM PREVIOUS COMPANY</div>
    <p class="body-para">If already a member of a Provident Fund (PF)/ Superannuation Scheme with Previous employer,</p>
    <ol class="nda-ol">
      <li>Employer's name</li>
      <li>Date of Joining and leaving service with them</li>
      <li>Name and address of the PF/ Superannuation Trust or the Regional Provident Fund</li>
      <li>Personal PF/ Superannuation Account No.</li>
      <li>Social Security No. (SSN) if allotted</li>
    </ol>
    ${footer()}
  </div>
  </body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SALARY SLIP
// ─────────────────────────────────────────────────────────────────────────────

export function renderSalarySlip(d: Record<string, string>, logoUrl: string): string {
  const v = (key: string, def = "0") => d[key] || def;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <title>Salary Slip – ${d.full_name} – ${d.month_year}</title>
  ${pageStyles()}
  </head><body>
  <div class="page">
    <div style="text-align:center;margin-bottom:2mm">
      <img src="${logoUrl}" alt="MAS Logo" style="width:55px;height:55px;object-fit:contain;vertical-align:middle;margin-right:10px">
      <span style="font-size:16pt;font-weight:bold;vertical-align:middle">Mas Callnet India Pvt. Ltd</span>
    </div>
    <div style="text-align:center;font-weight:bold;margin-bottom:4mm">Month For : ${v("month_year","")}</div>

    <table class="slip-header-table">
      <tr>
        <td class="cell-label">Emp Name</td>
        <td>${d.full_name || ""}</td>
        <td class="cell-label">Designation</td>
        <td>${d.designation || ""}</td>
        <td class="cell-label">Department</td>
        <td>${d.department || ""}</td>
      </tr>
      <tr>
        <td class="cell-label">Emp Code</td>
        <td>${d.employee_code || ""}</td>
        <td class="cell-label">EPF No</td>
        <td>${d.epf_no || ""}</td>
        <td class="cell-label">Location</td>
        <td>${d.location || ""}</td>
      </tr>
      <tr>
        <td class="cell-label">ESI No</td>
        <td>${d.esi_no || ""}</td>
        <td class="cell-label">W Days</td>
        <td>${v("working_days","31")}</td>
        <td class="cell-label">Earned Days</td>
        <td>${v("earned_days","31")}</td>
      </tr>
    </table>

    <table class="slip-main-table" style="margin-top:2mm">
      <thead>
        <tr>
          <th></th>
          <th>Basic</th><th>HRA</th><th>Bonus</th><th>Conv</th>
          <th>PA</th><th>MA</th><th>SA</th><th>OA</th>
          <th>Arrear</th><th>Incentive</th><th>Total Earn</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="bold">Earnings</td>
          <td>${v("basic")}</td><td>${v("hra")}</td><td>${v("bonus")}</td>
          <td>${v("conveyance")}</td><td>${v("pa")}</td><td>${v("ma")}</td>
          <td>${v("sa")}</td><td>${v("oa")}</td><td>${v("arrear")}</td>
          <td>${v("incentive")}</td>
          <td class="bold right">${v("total_earnings","0.00")}</td>
        </tr>
        <tr>
          <td class="bold" rowspan="2">Deductions</td>
          <td class="bold">PF</td><td class="bold">ESIC</td><td class="bold">Loan</td>
          <td class="bold">Ad.Ded</td><td class="bold">Other Ded</td>
          <td colspan="5"></td>
          <td class="bold right">Total Ded</td>
        </tr>
        <tr>
          <td>${v("pf")}</td><td>${v("esic")}</td><td>${v("loan")}</td>
          <td>${v("advance_deduction")}</td><td>${v("other_deduction")}</td>
          <td colspan="5"></td>
          <td class="bold right">${v("total_deductions","0.00")}</td>
        </tr>
        <tr>
          <td class="bold" colspan="2">Form 16 Summary</td>
          <td class="bold">Gross Salary</td>
          <td class="bold">Exemption U/S 10</td>
          <td class="bold">Balance</td>
          <td class="bold">Deduction U/S 24</td>
          <td class="bold">Gross Total Income</td>
          <td class="bold">Agg Off Chap VI</td>
          <td class="bold">Total Income</td>
          <td class="bold">Tax On Total</td>
          <td class="bold">Tax Payable &amp; Edu Cess</td>
          <td class="bold">Income Tax</td>
        </tr>
        <tr>
          <td colspan="2"></td>
          <td></td><td></td><td></td><td></td>
          <td></td><td></td><td></td><td></td><td></td>
          <td class="right">0</td>
        </tr>
      </tbody>
    </table>

    <table class="slip-main-table" style="margin-top:3mm">
      <tr class="net-row">
        <td style="width:30%">Cheque No :</td>
        <td colspan="10" class="right">Net Salary : ${v("net_salary","0.00")}</td>
      </tr>
      <tr class="words-row">
        <td colspan="11" style="text-align:right;font-weight:bold;padding:4px 6px">${d.net_salary_words || ""}</td>
      </tr>
    </table>

    <p class="computer-note">This is a computer generated statement, hence not signature required</p>
    <div class="dashed-line"></div>
  </div>
  </body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. INCREMENT LETTER
// ─────────────────────────────────────────────────────────────────────────────

export function renderIncrementLetter(d: Record<string, string>, logoUrl: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <title>Increment Letter – ${d.full_name}</title>
  ${pageStyles()}
  </head><body>
  <div class="page">
    ${letterHeader(logoUrl)}

    <div class="to-block">
      <p class="date-line" style="margin-bottom:3mm">Date - ${d.issued_date || ""}</p>
      <p class="name">${d.full_name || ""}</p>
      <p>${d.designation || ""}</p>
      <p>Okaya Center, Noida Sector - 62</p>
    </div>

    <div style="margin:6mm 0 2mm">
      <p style="font-size:10pt;color:#555">Compensation Review: ${d.review_year || "2026-2027"}</p>
      <p class="subject-value" style="font-size:13pt;margin-top:1mm">Increment Letter</p>
    </div>

    <p class="dear">Dear ${d.full_name || ""},</p>
    <p class="body-para">We are happy to inform you that we have completed the Annual Performance Evaluation for the year ${d.eval_year || "2025-2026"} and the management has been pleased to observe the sincerity, dedication, and hard work you have consistently demonstrated in your role.</p>
    <p class="body-para">In recognition of your efforts and performance, management has decided to revise your Total Remuneration (Total cost to Company) TCTC to Rs ${d.revised_ctc || "_________"}/-  per year which is inclusive of all allowances, benefits, perks and perquisites. The revised TCTC shall be with effect from ${d.effective_date || "Apr 1, 2026"}.</p>
    <p class="body-para">Your Total Cost To Company for the Financial Year ${d.financial_year || "2025-26"} is as follows:</p>

    <table class="ctc-table">
      <thead>
        <tr><th>Component</th><th>Amount (in Rs.)</th></tr>
      </thead>
      <tbody>
        <tr><td>Revised Fixed CTC WEF ${d.effective_date || "1 Apr 26"}</td><td>${d.revised_fixed_ctc || ""}</td></tr>
        <tr><td>Performance Linked Variable Pay</td><td>${d.variable_pay || ""}</td></tr>
        <tr><td><strong>Total Cost To Company (TCTC)</strong></td><td><strong>${d.total_tctc || ""}</strong></td></tr>
      </tbody>
    </table>

    <p class="body-para">We look forward to your continued success and outstanding contributions to the company.</p>
    <p class="body-para">If you have any questions or require further clarification, please do not hesitate to reach out.</p>
    <p class="body-para">Please note that the information shared in this letter is confidential and any disclosure of the same shall be considered as a gross violation of the company's ethics.</p>

    <div class="sign-block">
      <p>Best Regards,</p>
      <p style="margin-top:8mm">${d.hr_name || "Sheelu Verma"}</p>
      <p>${d.hr_designation || "Sr. HR"}</p>
    </div>
    ${footer()}
  </div>
  </body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PROMOTION LETTER
// ─────────────────────────────────────────────────────────────────────────────

export function renderPromotionLetter(d: Record<string, string>, logoUrl: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <title>Promotion Letter – ${d.full_name}</title>
  ${pageStyles()}
  </head><body>
  <div class="page">
    ${letterHeader(logoUrl)}

    <div class="to-block">
      <p class="date-line" style="margin-bottom:3mm">Date - ${d.issued_date || ""}</p>
      <p class="name">${(d.full_name || "").toUpperCase()}</p>
      <p>Okaya Center, Noida Sector - 62</p>
    </div>

    <div style="margin:6mm 0 2mm">
      <p class="subject-value" style="font-size:13pt">Promotion Letter</p>
    </div>

    <p class="dear">Dear ${(d.full_name || "").toUpperCase()},</p>
    <p class="body-para">We are happy to inform you that we have completed the Annual Performance Evaluation for the year ${d.eval_year || "2025-2026"} and the management has been pleased to observe the sincerity, dedication, and hard work you have consistently demonstrated in your role.</p>
    <p class="body-para">In recognition of your efforts and performance, management has decided to promote you to the position of ${d.new_designation || ""} in the ${d.new_department || ""} Department from ${d.effective_date || ""}. In your new role you will have increased responsibilities and expectations, details will be shared by your manager and HR.</p>
    <p class="body-para">Once again, congratulations on your well-deserved promotion! We look forward to your continued success and outstanding contributions to the company.</p>
    <p class="body-para">If you have any questions or require further clarification regarding your new role, please do not hesitate to reach out.</p>
    <p class="body-para">Please note that the information shared in this letter is confidential and any disclosure of the same shall be considered as a gross violation of the company's ethics.</p>

    <div class="sign-block">
      <p>Best Regards,</p>
      <p style="margin-top:8mm">${d.hr_name || "Sheelu Verma"}</p>
      <p>${d.hr_designation || "Sr. HR"}</p>
    </div>
    ${footer()}
  </div>
  </body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. EXPERIENCE / RELIEVING LETTER
// ─────────────────────────────────────────────────────────────────────────────

export function renderExperienceLetter(d: Record<string, string>, logoUrl: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <title>Experience Letter – ${d.full_name}</title>
  ${pageStyles()}
  </head><body>
  <div class="page">
    ${expLetterHead(logoUrl)}

    <p style="margin-bottom:4mm"><strong>Date ${d.issued_date || ""}</strong></p>
    <p class="section-heading" style="margin-bottom:4mm">To Whomsoever it May Concern</p>
    <p class="body-para">This is to certify that Mr./Ms. <strong>${d.full_name || ""}</strong> (Emp Code-${d.employee_code || ""}) has worked with Mas Callnet India Pvt. Ltd. from <strong>${d.date_of_joining || ""}</strong> to <strong>${d.date_of_exit || ""}</strong>.</p>
    <p class="body-para"><strong>${d.full_name || ""}</strong> has been relieved from the duties as a Designation- <strong>${(d.designation || "").toUpperCase()}</strong>, Department- <strong>${(d.department || "").toUpperCase()}</strong></p>
    <p class="body-para">During the tenure the employee was sincere and dedicated towards the role and responsibilities. As per our records and knowledge ${d.full_name || ""} has not been involved in any untoward conduct resulting towards any controversy in the organization.</p>
    <p class="body-para">We have no objection to ${d.full_name || ""} joining any other organization.</p>
    <p class="body-para">We wish ${d.full_name || ""} the best in all future endeavors.</p>

    <div class="sign-block">
      <p>Yours Sincerely, ${d.hr_name || "Sheelu Verma"}</p>
      <p style="margin-top:4mm">Authorized Signatory</p>
      <p>Human Resource</p>
    </div>
    ${footer()}
  </div>
  </body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. NDA & JOINING KIT
// ─────────────────────────────────────────────────────────────────────────────

export function renderNdaJoiningKit(d: Record<string, string>, logoUrl: string): string {
  const name = d.full_name || "EMPLOYEE";
  const empCode = d.employee_code || "";
  const doj = d.date_of_joining || "";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <title>NDA &amp; Joining Kit – ${name}</title>
  ${pageStyles()}
  </head><body>

  <!-- PAGE 1: NDA & Confidentiality -->
  <div class="page">
    ${letterHeader(logoUrl)}
    <p class="section-heading" style="font-size:12pt;margin-bottom:4mm">NDA &amp; Confidentiality Agreement:</p>
    <p class="body-para">I acknowledge that as part of my Employment with Mas Callnet India P. Ltd. I will be given access to information that is of a personal and/or proprietary nature, for example: Personal information related to analysts, such as names, email addresses, salaries, academic and employment information and/or sensitive information related to clients or other financial information ("Confidential Information") for the purpose of fulfilling employment obligations.</p>
    <p class="body-para">I therefore agree:</p>
    <ul class="nda-ol" style="list-style-type:disc">
      <li>To hold all confidential information in trust and strict confidence and agree that it shall be used only for the purposes required to fulfill employment obligations and shall not be used for any other purpose, or disclosed to any third party.</li>
      <li>To keep any confidential information in my control or possession in a physically secure location to which only I and other persons who have signed a confidentiality agreement with Mas Callnet will have.</li>
      <li>I would ensure not to remove any confidential information unless, and to the extent that, I obtain written pre-authorizations. I agree to take all necessary steps to keep such confidential information secure and to protect such Confidential Information from unauthorized use, reproduction or disclosure.</li>
      <li>To maintain the absolute confidentiality of personal, confidential and proprietary information in recognition of the privacy and proprietary rights of others at all times, and in both professional and social situations.</li>
      <li>To comply with all privacy laws and regulations, which apply to the collection, use and disclosure of personal information.</li>
      <li>At the conclusion of any discussions, or upon demand by management, to return all confidential information, including prototypes, code, written notes, photographs, sketches, models, memoranda or notes taken, to Mas Callnet concerns responsible (manager/Director)</li>
      <li>To keep all User ID's/passwords (CRM's/LMS/Email) issued to me strictly confidential and would not share them with any other analysts/anybody else. I can be held responsible in case of any misuse of them leading to the disciplinary action under code of conduct.</li>
      <li>Employee further covenants, agrees and undertakes that all equipment, notebooks, documents, memoranda, reports, files, samples, books, correspondence lists or other written and graphic records, and the like, including tangible or intangible computer programs, records and data, affecting or relating to the business of Company, that he/she may prepare, use, construct, observe, possess or control, shall be and shall remain Company's sole property.</li>
      <li>Employee would return any property which belongs to the company and was handed over to them for delivering their duties. E.g. computer, Laptops, Dongles etc.</li>
      <li>Employee will rightfully return all devices including mobile phones, Data cards, Sim cards, Wifi Dongles etc when the company asks them to return it.</li>
      <li>To dedicate their full attention to their job duties during working hours.</li>
      <li>To Adhere to break and attendance schedules agreed upon with their manager</li>
      <li>All Mas Callnet or client-provided assets must only be used for the purpose of executing the operations processes that analysts normally undertake in the office, remotely and not for any personal or other use</li>
      <li>Analysts must not circumvent or attempt to circumvent any security measures implemented on the Mas Callnet or client-provided assets.</li>
      <li>Analysts must not download, install, or attempt to install any unauthorized software on the Mas callnet or client-provided assets, which includes the installation of malware which could capture screen contents and / or key strokes.</li>
    </ul>
    <p class="section-heading" style="margin-top:4mm">Data Confidentiality and Privacy</p>
    <ul class="nda-ol" style="list-style-type:disc">
      <li>Analysts must not take any screen-shots or photographs, videos, written notes of screen contents or make any audio recordings of any business conversations. Analysts must not disclose or discuss any confidential, sensitive or client-related information with any third-parties (such as friends or family members).</li>
      <li>Analysts must not download, install, or attempt to install any unauthorized software on the Mas Callnet India Pvt. Ltd. or client-provided assets, which includes the installation of malware which could capture screen contents and / or key strokes.</li>
    </ul>
    <p class="section-heading" style="margin-top:4mm">Agreement:</p>
    <p class="body-para">I <strong>${name}</strong>, agree do hereby undertake that except prior consent of Mas Callnet India P. Ltd. In writing, I shall not disclose to any third party any other information that I may acquire in relation to any contract whether in writing or orally including the information not only limited to documents, material, specifications, drawings, reports, trade secrets and client and internal data ( known collectively as "Confidential information")</p>
    <p class="body-para">I also agree to ensure compliance on company's information security and assets ownership and would be responsible for any damage/loss leading to the disciplinary action under code of conduct policy.</p>
    <p class="body-para">I understand that a breach of confidentiality or misuse of information could result in disciplinary action and can result into termination of employment.</p>
    <p class="body-para">I further certify that I have gone through the company policies and would abide by the same. Also, I hereby acknowledge updating myself on the company processes, policies and procedures.</p>
    <table class="consent-table">
      <tr>
        <td>Signature: <span class="sign-line">&nbsp;</span></td>
        <td>Name of the Analyst: <span class="sign-line">&nbsp;</span></td>
        <td>Date: <span class="sign-line">&nbsp;</span></td>
      </tr>
    </table>
    ${footer()}
  </div>

  <!-- PAGE 2: IT Compliance -->
  <div class="page page-break">
    ${letterHeader(logoUrl)}
    <p class="section-heading" style="font-size:12pt">Introduction</p>
    <p class="section-heading" style="margin-top:4mm">IT Compliance Agreement</p>
    <p class="body-para">Mascall Net as an organization has its own IT infrastructure which provides the services to its native companies. As an employee of TEAMMAS every employee should have to comply or agree with the same. IT provided assets to employee are fully compliant with MISP (MasCall Net Information Security Policy).</p>
    <p class="body-para">You will be the asset owner of your Laptop, Desktop, Server, Data card etc. The asset owner is accountable for the comprehensive protection of information assets owned by him/her. Any violation from DISP, "IT Act 2000" (Later amendments 2006 &amp; 2008) &amp; copyright Act 1957 (Later amendments 1994 &amp; 1999) will be considered as code of conduct. Code of conduct will be leaded to HR, legal &amp; Disciplinary action against the responsible employee.</p>

    <p class="policy-section">Email Policy Controls</p>
    <ul class="nda-ol" style="list-style-type:disc">
      <li>Company mailing system should not be used for any fraud as per IT Act 2000 AM 2008 section 66A.</li>
      <li>Act of hacking or dishonestly receives or retains any stolen computer resource or communication device knowing or having reason to believe the same to be stolen computer resource or communication device will be considered under code of conduct as per IT Act 2000 AM 2008 section 66B.</li>
      <li>Theft of the electronic signature, password or any other unique identification feature of any other person will be considered under code of conduct as per IT Act 2000 AM 2008 section 66C.</li>
      <li>All messages generated by the E-mail System are considered to be the property of TEAMMAS. The E-mail system shall be used for business purposes only. However, the personal use of the E-mail systems is allowed to a reasonable extent as long as that does not damage the information and/ or reputation of TEAMMAS (IT Act 2000 AM 2008 section 66D).</li>
      <li>Charitable fundraising campaigns, political advocacy efforts, private business activities or personal amusement, advertisement or public representation and entertainment of email system are prohibited.</li>
      <li>Email message containing any disruptive or offensive messages, including offensive comments about race, gender, hair color, disabilities, age, sexual orientation or harassment, pornography, religious beliefs and practice, political beliefs or national origin should not be created or distributed(IT Act 2000 AM 2008 section 67A,B).</li>
      <li>Forwarding of official E-mails to personal E-mail accounts such as Gmail, Yahoo mail, Hotmail, etc. is prohibited.</li>
      <li>Mass mailing, cheating, credit card frauds, money laundering are counted as offensive acts under IT Act 2000 AM 2008 chapter 11 &amp; strictly prohibited.</li>
      <li>Copying and sharing of company data is not to be done at any point of time. Even attempt to do so will be penalized.</li>
      <li>Attempting to access websites and pages apart from the ones allowed is prohibited.</li>
      <li>Sharing of user name/passwords is not to be done.</li>
      <li>Accessing company URL's, sites etc. on systems apart from the one's provided by the company is not allowed. None of production URL's, websites etc. should be accessed from mobile phone and attempting to do the same would invite strictest disciplinary action by the company.</li>
    </ul>
    <p class="policy-section">Software Policy Controls</p>
    <ul class="nda-ol" style="list-style-type:disc">
      <li>Software which is not listed or not approved should not be installed or found during audit on asset owner. Also pirated software, application should not be kept, installed on system.</li>
      <li>Software provided by TEAMMAS is sole property of organization which is not for personal use of any employee.</li>
      <li>According to "Section 13, 14, 16 of copyright Act 1957", it is illegal to make or distribute copies of copyrighted any TEAMMAS software without proper or specific authorization.</li>
    </ul>
    <p class="policy-section">Permitted Use of Internet</p>
    <ul class="nda-ol" style="list-style-type:disc">
      <li>Without prior written permission from Company, the Company's computer network may not be used to disseminate, view or store commercial or personal advertisements, solicitations, promotions, destructive code (e.g., viruses, self-replicating programs, etc.), political material, pornographic text or images, or any other unauthorized materials.</li>
      <li>To ensure security and avoid the spread of viruses, Users accessing the Internet through a computer attached to Company's network must do so through an approved Internet firewall or other security device. Bypassing Company's computer network security by accessing the Internet directly by modem or other means is strictly prohibited unless the computer you are using is not connected to the Company's network.</li>
      <li>You should abide by all the IT policies of the company which are in force from time to time and the company shall have the right to vary or modify any or all of the above controls which shall be binding on you.</li>
    </ul>
    <p class="policy-section">Agreement</p>
    <ul class="nda-ol" style="list-style-type:disc">
      <li>I have read above mentioned MISP controls, written under agreement.</li>
      <li>I agree to comply with the provisions of TEAMMAS IT compliance agreement.</li>
      <li>If I found for any such offence listed above, code of conduct should be invoked for termination of my services or regulatory action.</li>
    </ul>
    <table class="consent-table">
      <tr>
        <td>Signature: <span class="sign-line">&nbsp;</span></td>
        <td>Date: <span class="sign-line">&nbsp;</span></td>
      </tr>
    </table>
    ${footer()}
  </div>

  <!-- PAGE 3: Surveillance / Equal Opportunity -->
  <div class="page page-break">
    ${letterHeader(logoUrl)}
    <p class="section-heading" style="font-size:12pt">Surveillance</p>
    <p class="body-para"><strong>Mas Callnet India Pvt. Ltd. – An Equal Opportunity Employer</strong></p>
    <p class="body-para">At Mas Callnet we don't just stop at accepting difference but we are one of the them who like to celebrate it, support it, and we thrive on it for the benefit of our employees. We do not discriminate in employment on the basis of race, color, religion, sex, marital status, disability, genetic information etc.</p>
    <p class="body-para">We take a zero-tolerance approach to bribery and corruption and are committed to acting professionally, fairly and with integrity in all our business dealings and relationships wherever we operate and implementing and enforcing effective systems to counter bribery and corruption.</p>
    <p class="body-para">Mas Callnet India Pvt. Ltd. and it's employees will never ask for accept money, gifts or anything which can be deemed as bribe against offering an opportunity to work with us or during the course of employment with us and would request to bring to our attention if anybody claims to be doing it.</p>
    <p class="body-para">Contact : 7290093915 &nbsp;&nbsp; Email ID: rajesh.ramachandran@teammas.in</p>
    <p class="body-para">I have read and understood the above mentioned policies of Mas Callnet India P. Ltd.</p>
    <table class="consent-table">
      <tr>
        <td>Name of the candidate: <span class="sign-line">&nbsp;</span></td>
        <td>HR Person name: <span class="sign-line">&nbsp;</span></td>
      </tr>
      <tr>
        <td>Signature: <span class="sign-line">&nbsp;</span></td>
        <td>Date: <span class="sign-line">&nbsp;</span></td>
      </tr>
      <tr>
        <td>Place: <span class="sign-line">&nbsp;</span></td>
        <td>Signature: <span class="sign-line">&nbsp;</span></td>
      </tr>
    </table>
    ${footer()}
  </div>

  <!-- PAGE 4: BAMS Declaration -->
  <div class="page page-break">
    ${letterHeader(logoUrl)}
    <p class="section-heading" style="font-size:12pt;margin-bottom:4mm">Declaration : Biometric Attendance Management System BAMS</p>
    <p class="body-para">I Hereby declare that I will follow the Biometric Attendance Management System Religiously and I am completely aware that Biometric Attendance Management is the only criteria for Tracking my Attendance and I understand the importance of the same.</p>
    <ul class="nda-ol" style="list-style-type:disc">
      <li>I am registered for BAMS.</li>
      <li>In case I forget to mark my attendance through BAMS, I will timely report the same to my manager for his Approval as per procedure.</li>
      <li>I am aware that my log in hours requirement are as mentioned below</li>
      <li>If I forget to punch-in, punch out, then an approval from my HOD is required to validate the attendance for the day. I also understand that I can take only one exception a month.</li>
    </ul>
    <p class="body-para">Log in hours = 8 hours (System log in) + 1 hour (Break)</p>
    <p class="body-para">In case the log in hour's requirement is not met as per the above declaration, I will be responsible for my salary deduction against the same.</p>
    <table class="consent-table" style="margin-top:6mm">
      <tr>
        <td>Regards, Name: <span class="sign-line" style="min-width:150px">&nbsp;</span></td>
        <td>E Code: <span class="sign-line">&nbsp;</span></td>
        <td>DOJ: <span class="sign-line">&nbsp;</span></td>
      </tr>
    </table>
    ${footer()}
  </div>

  <!-- PAGE 5: Employee Consent Form -->
  <div class="page page-break">
    ${letterHeader(logoUrl)}
    <p class="annexure-title" style="font-size:12pt">EMPLOYEE CONSENT FORM FOR PERSONAL INFORMATION PROCESSING</p>
    <p class="body-para"><strong>Employee Name: ${name}</strong></p>
    <p class="body-para">I <strong>${name}</strong>, the undersigned, hereby provide my consent to Mas Callnet India P. Ltd. ("the Company") for the processing and retention of my personal information and data, including but not limited to my Name, Residence Address, Educational qualification details, Aadhaar Card details, PAN Card details, Bank account details, and Previous Employment Details, for the purpose of completing the joining formalities and ongoing employment-related processes.</p>
    <p class="body-para">I understand and agree that the Company will be conducting background verification of my personal information through a third-party Background verification agency. I authorize the Company to share my personal details with this third-party agency for the sole purpose of conducting Background verification.</p>
    <p class="body-para">I further acknowledge that the Company is required to retain employee records as per Section 13A of the Wages Act, which mandates the retention of employee records for three years after the last payroll entry. Therefore, I consent to the Company retaining my personal information and data for a period of three years from my last payroll entry or until the cessation of my employment with the Company, whichever is later.</p>
    <p class="body-para">Furthermore, I am aware that, in accordance with applicable data protection laws and regulations, the Company is committed to protecting the privacy and security of my personal information. The Company will not disclose my personal information to any unauthorized third parties without my explicit consent, except as required by law.</p>
    <p class="body-para">I understand that I have the right to withdraw this consent at any time by providing written notice to the Company's Human Resources department. Upon such withdrawal, the Company will cease processing my personal information, subject to any legal obligations that may require its retention.</p>
    <p class="body-para">I hereby affirm that I have read and understood the terms and conditions of this consent form, and I willingly provide my consent for the processing and retention of my personal information as described herein, including the background verification conducted by a third-party agency.</p>
    <p style="font-size:9pt;font-style:italic;margin-bottom:4mm">Note: Please ensure that you have reviewed and understood the contents of this consent form before signing it. If you have any questions or concerns, please contact the Company's Human Resources department for clarification before providing your consent.</p>
    <table class="consent-table">
      <tr>
        <td>Employee Name: <strong>${name}</strong></td>
      </tr>
      <tr>
        <td>Employee Signature: <span class="sign-line">&nbsp;</span> &nbsp;&nbsp; Date: <span class="sign-line">&nbsp;</span></td>
      </tr>
    </table>
    ${footer()}
  </div>

  <!-- PAGE 6: Zero Tolerance Policy (summary + acknowledgment) -->
  <div class="page page-break">
    ${letterHeader(logoUrl)}
    <p class="section-heading" style="font-size:12pt;margin-bottom:2mm">Introduction</p>
    <p class="body-para">At Mas Callnet India P. Ltd., we are committed to maintaining a safe, respectful, and professional environment for all employees, contractors, and partners. This Zero Tolerance Policy outlines unacceptable behaviors that will not be tolerated within our organization. Any violation of this policy will result in disciplinary action, including possible termination of employment and legal action.</p>
    <p class="policy-section">Scope</p>
    <p class="body-para">This policy applies to all employees, contractors, vendors, and any individuals associated with Mas Callnet India P. Ltd., whether on-site or off-site, including remote work environments.</p>
    <p class="policy-section">Unacceptable Behaviors include (but are not limited to):</p>
    <ul class="nda-ol" style="list-style-type:disc">
      <li><strong>Harassment and Discrimination</strong> — based on race, gender, age, religion, disability, sexual orientation, or any other protected characteristic.</li>
      <li><strong>Violence and Threats</strong> — physical violence, threats, intimidation, or bullying.</li>
      <li><strong>Substance Abuse</strong> — possession, distribution, or being under the influence during work.</li>
      <li><strong>Fraud and Dishonesty</strong> — falsifying documents, embezzlement, or theft.</li>
      <li><strong>Data Security and Privacy Violations</strong> — unauthorized access, sharing, or misuse of sensitive data.</li>
      <li><strong>Sharing Company and Client Data on Social Media</strong> — strictly forbidden.</li>
      <li><strong>Prevention of Sexual Harassment (POSH)</strong> — all forms strictly prohibited.</li>
      <li><strong>Unauthorized Access to Restricted Areas</strong>.</li>
      <li><strong>Non-Compliance with Company Policies</strong>.</li>
      <li><strong>Unauthorized Downloads on Company Systems</strong>.</li>
      <li><strong>Sharing Login Credentials</strong>.</li>
      <li><strong>Zero Tolerance for Bribery</strong>.</li>
    </ul>
    <p class="policy-section">Reporting</p>
    <p class="body-para">Violations may be reported to HR Contacts, Email ID: care@teammas.in, or Whatsapp channel – 2gthr@Mas.</p>
    <p class="annexure-sub" style="margin-top:6mm">Acknowledgment Form</p>
    <p class="body-para">I, <strong>${name}</strong>, have read and understood the Mas Callnet India P. Ltd. Zero Tolerance Policy and agree to comply with its terms and conditions.</p>
    <table class="consent-table" style="margin-top:6mm">
      <tr>
        <td>Signature: <span class="sign-line">&nbsp;</span></td>
        <td>Date: <span class="sign-line">&nbsp;</span></td>
      </tr>
    </table>
    ${footer()}
  </div>

  </body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export function renderLetterHtml(
  letterType: string,
  data: Record<string, string>,
  logoUrl: string
): string {
  switch (letterType) {
    case "appointment":    return renderAppointmentLetter(data, logoUrl);
    case "salary_slip":    return renderSalarySlip(data, logoUrl);
    case "increment":      return renderIncrementLetter(data, logoUrl);
    case "promotion":      return renderPromotionLetter(data, logoUrl);
    case "experience":     return renderExperienceLetter(data, logoUrl);
    case "nda":            return renderNdaJoiningKit(data, logoUrl);
    default:
      return `<html><body><p>Unknown letter type: ${letterType}</p></body></html>`;
  }
}
