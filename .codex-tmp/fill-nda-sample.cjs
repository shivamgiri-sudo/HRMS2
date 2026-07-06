const fs = require('fs');
const path = require('path');
const PizZip = require('C:/Users/ADMIN/Desktop/Upgraded HRMS/HRMS2-link/backend/node_modules/pizzip');
function esc(v){return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
const input = 'C:/Users/ADMIN/Desktop/Upgraded HRMS/HRMS2-link/backend/private-storage/document-templates/nda-confidentiality-updated.docx';
const out = 'C:/Users/ADMIN/Downloads/HRMS2-filled-NDA-multi-section-sample.docx';
const replacements = {
  employee_name: 'SOFIYA SULTAN',
  employee_code: 'MAS47814',
  date_of_joining: '2026-07-05',
  branch: 'Noida',
  process: 'MCN HRMS',
  current_date: '2026-07-05',
  nda_employee_name: 'SOFIYA SULTAN',
  nda_signature_date: '2026-07-05',
  it_employee_name: 'SOFIYA SULTAN',
  it_signature_date: '2026-07-05',
  surveillance_candidate_name: 'SOFIYA SULTAN',
  surveillance_hr_name: 'Payroll HR',
  surveillance_signature_date: '2026-07-05',
  bams_employee_name: 'SOFIYA SULTAN',
  bams_employee_code: 'MAS47814',
  bams_date_of_joining: '2026-07-05',
  pi_employee_name: 'SOFIYA SULTAN',
  pi_signature_date: '2026-07-05',
  zero_tolerance_employee_name: 'SOFIYA SULTAN',
  zero_tolerance_signature_date: '2026-07-05',
};
const zip = new PizZip(fs.readFileSync(input));
let xml = zip.file('word/document.xml').asText();
for (const [k,v] of Object.entries(replacements)) xml = xml.split(`{{${k}}}`).join(esc(v));
const employeeName = esc(replacements.employee_name);
const employeeCode = esc(replacements.employee_code);
const joiningDate = esc(replacements.date_of_joining);
const currentDate = esc(replacements.current_date);
const ndaDate = esc(replacements.nda_signature_date ?? currentDate);
const itDate = esc(replacements.it_signature_date ?? currentDate);
const surveillanceDate = esc(replacements.surveillance_signature_date ?? currentDate);
const bamsName = esc(replacements.bams_employee_name ?? employeeName);
const bamsCode = esc(replacements.bams_employee_code ?? employeeCode);
const bamsDoj = esc(replacements.bams_date_of_joining ?? joiningDate);
const piName = esc(replacements.pi_employee_name ?? employeeName);
const piDate = esc(replacements.pi_signature_date ?? currentDate);
const zeroToleranceDate = esc(replacements.zero_tolerance_signature_date ?? currentDate);
const hrName = esc(replacements.surveillance_hr_name ?? '');
xml = xml.split('MOHD UZAIF').join(employeeName);
xml = xml.replace(/(I\s+)([A-Z][A-Z\s.]{2,80})(\s*,\s*agree)/g, `$1${employeeName}$3`);
xml = xml
  .replace(/Name of the Analyst:\s*Date/g, `Name of the Analyst: ${employeeName}    Date: ${ndaDate}`)
  .replace(/Signature\s+Date/g, `Signature: __________________    Date: ${itDate}`)
  .replace(/Name of the candidate:\s*HR Person name\s*:/g, `Name of the candidate: ${employeeName}    HR Person name: ${hrName}`)
  .replace(/Signature\s*:\s*Date\s*:/g, `Signature: __________________    Date: ${surveillanceDate}`)
  .replace(/Regards,\s*Name/g, `Regards, ${bamsName}`)
  .replace(/E Code\s+DOJ/g, `E Code: ${bamsCode}    DOJ: ${bamsDoj}`)
  .replace(/Employee Name\s*:\s*[^<]+/g, `Employee Name: ${piName}`)
  .replace(/Employee Signature\s*:\s*Date\s*:/g, `Employee Signature: __________________    Date: ${piDate}`)
  .replace(/Signature:\s*Date:/g, `Signature: __________________    Date: ${zeroToleranceDate}`);
zip.file('word/document.xml', xml);
fs.writeFileSync(out, zip.generate({type:'nodebuffer'}));
console.log(out);
