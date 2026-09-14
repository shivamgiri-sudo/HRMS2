-- Typing passage bank seed — safe to re-run (INSERT IGNORE keyed on passage_code unique index)
-- 3 sets × 5 processes = 15 passages; role_key = 'any' so all roles receive these passages.
-- Each passage includes numbers, addresses, pincodes, punctuation, and mixed-case content.

INSERT IGNORE INTO ats_typing_passage_bank
  (id, passage_code, process_key, role_key, difficulty_level, title,
   passage_text, word_count, character_count,
   recommended_duration_seconds, min_wpm_benchmark, min_accuracy_benchmark,
   set_number, active_status)
VALUES

-- ─── INBOUND ───────────────────────────────────────────────────────────────────

(UUID(), 'INB-S1-P1', 'inbound', 'any', 'intermediate',
 'Inbound — Account Verification & Callback',
 'Thank you for calling MAS Callnet Customer Support. I am speaking with Mr. Rajesh Kumar at account number 4872-0193-56, registered at Flat 7B, Sunrise Towers, M.G. Road, Bengaluru - 560 001. Your complaint reference is CMP-2024-09183. The pending refund of Rs. 2,350.00 will be processed within 5 to 7 working days. A confirmation SMS will be sent to the mobile number ending in 4412. We will call you back on 14-July-2026 between 10:00 a.m. and 12:00 p.m. (IST). Is there anything else I can assist you with today?',
 85, 512,
 180, 30, 92.00,
 1, 1),

(UUID(), 'INB-S2-P1', 'inbound', 'any', 'intermediate',
 'Inbound — Address & ID Verification',
 'Good afternoon! This call is to verify your registered address. Our records show: Mr. Anil Sharma, 203, Krishna Apartments, Sector-14, Rohini, New Delhi - 110 085. Date of birth: 12/03/1988. KYC document on file — Aadhaar: XXXX-XXXX-6741. If the details above are incorrect, please visit the nearest branch or call 1800-102-4500 (toll-free, Mon–Sat, 9:00 a.m. to 6:00 p.m.) with a valid photo ID and address proof dated within the last 3 months. Kindly note that any change request takes 2 to 3 business days to reflect in the system.',
 88, 520,
 180, 30, 92.00,
 2, 1),

(UUID(), 'INB-S3-P1', 'inbound', 'any', 'intermediate',
 'Inbound — Refund Processing Note',
 'Refund request logged on 08-July-2026 for Ms. Priya Menon, policy number LI-2021-00847, at 56/A, Pearl Heights, Bandra (West), Mumbai - 400 050. Original charge: Rs. 4,800.00 (transaction ID: TXN-78834920). Approved refund amount: Rs. 4,800.00 — processing fee of Rs. 0.00 as waiver code REF-WAIV-005 was applied. Estimated credit date: 15-July-2026 to the HDFC account ending 2231. Escalation path: if amount not received by 20-July-2026, raise ticket via EMS portal (ref. EMS/2026/07/183) or e-mail support@mascallnet.in quoting this reference.',
 90, 558,
 180, 30, 92.00,
 3, 1),

-- ─── OUTBOUND ──────────────────────────────────────────────────────────────────

(UUID(), 'OUT-S1-P1', 'outbound', 'any', 'intermediate',
 'Outbound — Lead Introduction Script',
 'Good morning, am I speaking with Ms. Deepa Nair? I am calling from MAS Callnet on behalf of QuickCover Insurance (product code: QC-HLTH-2026). We have a special health-cover plan at just Rs. 499.00 per month for a family of four, valid from 01-August-2026. Your nearest branch is at 12, Brigade Road, Bengaluru - 560 025 (contact: 080-4567-8910). This offer is available only until 31-July-2026. If you would like to receive the brochure on your WhatsApp number 98765-43210, please confirm — or I can schedule a callback at a time convenient to you. No advance payment is required at this stage.',
 92, 552,
 180, 30, 92.00,
 1, 1),

(UUID(), 'OUT-S2-P1', 'outbound', 'any', 'intermediate',
 'Outbound — Policy Re-engagement',
 'Hello, I am calling for Mr. Suresh Pillai regarding policy number GEN-AUTO-2019-3381, which lapsed on 30-June-2026. Our records show the last registered address as 88, Gandhi Nagar, Coimbatore - 641 009. To reinstate with zero penalty, the window is open only until 25-July-2026. Premium due: Rs. 7,250.00 for the period 01-July-2026 to 30-June-2027. Payment can be made online at pay.mascallnet.in/renew, by NEFT to account 4009012873 (IFSC: HDFC0001234), or at any authorised collection centre. Please have your vehicle RC and Aadhaar (number ending 5503) ready for verification.',
 91, 556,
 180, 30, 92.00,
 2, 1),

(UUID(), 'OUT-S3-P1', 'outbound', 'any', 'intermediate',
 'Outbound — Post-service Survey Script',
 'Good evening! I am calling on behalf of TeleServ (client code: TS-0047) to conduct a brief 2-minute satisfaction survey regarding your service interaction on 10-July-2026 (ticket no. SV-2026-445821). Could you rate your experience on a scale of 1 to 10? Your feedback will be recorded against customer ID CID-883920, address: 14-C, Lotus Colony, Andheri (East), Mumbai - 400 069. If your rating is below 6, our quality team at quality@teleserv.in will contact you within 48 hours. All responses are strictly confidential and used only for internal improvement. This call may be recorded for training purposes.',
 90, 548,
 180, 30, 92.00,
 3, 1),

-- ─── BACKOFFICE ────────────────────────────────────────────────────────────────

(UUID(), 'BO-S1-P1', 'backoffice', 'any', 'intermediate',
 'Backoffice — Data Entry Task Brief',
 'Data entry task reference: DE-2026-07-0041. Operator: Kavitha R. (employee ID: EMP-1147, branch: Chennai-Central, code: CHN-C). Source documents: 28 account-opening forms received on 11-July-2026 from the Velachery sub-branch (branch code: CHN-V-02, pincode: 600 042). Each form must be entered into CRM module v4.2 under queue ID Q-CHN-1147 before 6:00 p.m. today. Mandatory fields: name, date of birth (DD/MM/YYYY), PAN (format: ABCDE1234F), Aadhaar (last 4 digits only), mobile, and nominee details. Flag any form where signature area is blank or date of birth conflicts with ID proof — use exception code EX-DOB-002 or EX-SIG-001 accordingly.',
 95, 602,
 180, 30, 92.00,
 1, 1),

(UUID(), 'BO-S2-P1', 'backoffice', 'any', 'intermediate',
 'Backoffice — Reconciliation Note',
 'Reconciliation note — batch REF-RECON-2026-0709. Processed by: Mohan Das, team lead (ID: TL-0034). Total invoices verified: 47. Matched: 44. Discrepancies: 3 (invoice nos. INV-20260708-091, INV-20260708-104, INV-20260708-117 — variance of Rs. 1,240.00, Rs. 875.50, and Rs. 3,600.00 respectively). GST number of vendor: 33AABCU9603R1ZM. NEFT UTR ref: HDFC2026070900012349. Discrepancy flag raised in ERP module under case ID DISC-2026-019 on 09-July-2026 at 14:35 IST. Supervisor review required by 12-July-2026 (EOD). Do not close batch until all 3 discrepancies are resolved and sign-off obtained from Finance Controller (ext. 2218).',
 94, 604,
 180, 30, 92.00,
 2, 1),

(UUID(), 'BO-S3-P1', 'backoffice', 'any', 'intermediate',
 'Backoffice — Employee Record Update',
 'Employee record update request — HR-UPD-2026-0583. Employee: Anitha S. (ID: EMP-2291). Department: Operations — Inbound (dept. code: OPS-IN-03). Branch: Hyderabad-HITEC, pincode: 500 081. Change type: address update and bank account change. New address: 401, Skyline Residency, Madhapur, Hyderabad - 500 081. New bank: Axis Bank, A/C 9204018837261, IFSC: UTIB0002341. Effective date: 01-August-2026. Supporting documents attached: Aadhaar (new address), cancelled cheque (scan ID: DOC-BANK-2291-2026). Approved by HR Manager (emp. ID: EMP-0019) on 10-July-2026. System update must be completed before payroll lock at 11:59 p.m. on 25-July-2026.',
 92, 595,
 180, 30, 92.00,
 3, 1),

-- ─── DOCUMENT ──────────────────────────────────────────────────────────────────

(UUID(), 'DOC-S1-P1', 'document', 'any', 'intermediate',
 'Document — KYC Checklist Verification',
 'KYC verification checklist — case ID: KYC-2026-071-04482. Reviewer: Fathima K. (ID: DOC-R-0087). Document submitted: Passport (no. P1234567, expiry: 31-May-2029). Address: 22, Sea View Apartments, Worli, Mumbai - 400 018. Check 1 — photo clarity: Pass. Check 2 — name matches application (full name: Faisal Ahmed Qureshi): Pass. Check 3 — date of birth (04/11/1985) matches declaration: Pass. Check 4 — address consistency with utility bill (bill date: 15-June-2026, pincode: 400 018): Pass. Check 5 — no visible alteration or lamination: Pass. Check 6 — expiry at least 6 months from today: Pass. Decision: ACCEPTED. Upload to CRM under doc-type PP-KYC and close case by 5:00 p.m.',
 97, 610,
 180, 30, 92.00,
 1, 1),

(UUID(), 'DOC-S2-P1', 'document', 'any', 'intermediate',
 'Document — Address Proof Review',
 'Address proof review — reference no. APR-2026-3301. Submitted document: Electricity bill (BESCOM, consumer no. 200-4391-8827-001, bill date: 05-July-2026). Name on bill: Smt. Lakshmi Venkataraman. Address on bill: No. 9, 3rd Cross, Malleswaram, Bengaluru - 560 003. Application address: No. 9, 3rd Cross, Malleswaram, Bengaluru - 560 003. Name match: exact. Address match: exact. Pincode match: 560 003 — confirmed. Bill age: 18 days (within 90-day limit). Document image quality: clear — no blur, no cut-off corners. Alteration check: none detected. Decision: ACCEPTED (code: AP-ACC-01). Note: if address had differed by even a single field, escalate to senior reviewer under code AP-ESC-03 for manual sign-off.',
 96, 614,
 180, 30, 92.00,
 2, 1),

(UUID(), 'DOC-S3-P1', 'document', 'any', 'intermediate',
 'Document — KYC Rejection Note',
 'KYC rejection notice — case ID: KYC-2026-071-04511. Reviewer: Pooja Bhat (ID: DOC-R-0093). Document submitted: Aadhaar card (UID ending: 7714). Applicant: Mr. Ravi Shankar Tiwari, 15/2, New Colony, Varanasi - 221 001. Rejection reason code: RJ-IMG-002 (image resolution below 200 DPI — text in address block unreadable). Secondary flag: RJ-DOB-001 (date of birth on Aadhaar reads 00/00/0000 — likely masked e-Aadhaar print error). Action required: applicant to resubmit a colour photocopy of original Aadhaar or alternate OVD (Voter ID / Passport / Driving Licence). Resubmission deadline: 25-July-2026. Case automatically escalates to RJ-HOLD on 26-July-2026 if no response. Notify applicant via SMS to 94XXX-XX714.',
 96, 618,
 180, 30, 92.00,
 3, 1),

-- ─── EMAIL ─────────────────────────────────────────────────────────────────────

(UUID(), 'EML-S1-P1', 'email', 'any', 'intermediate',
 'Email — Formal Complaint Response',
 'Subject: Re: Complaint Reference CMP-2026-06-00947 — Resolution Update. Dear Mr. Arvind Mehta, Thank you for writing to us at support@mascallnet.in regarding the billing discrepancy on your account (ID: AC-2026-884-12). We sincerely apologise for the inconvenience caused. Our team has reviewed the concern raised on 28-June-2026 and confirmed that an amount of Rs. 1,150.00 was incorrectly charged on invoice INV-20260625-0341. A credit of Rs. 1,150.00 has been applied to your account today (10-July-2026) and will reflect within 3 working days. Your registered address — 47, Park Lane, Nungambakkam, Chennai - 600 034 — and contact number (044-2822-XXXX) remain unchanged. Please reply to this e-mail quoting the above reference if you need further assistance. Warm regards, Customer Resolution Team, MAS Callnet — Chennai Hub.',
 102, 672,
 180, 30, 92.00,
 1, 1),

(UUID(), 'EML-S2-P1', 'email', 'any', 'intermediate',
 'Email — Escalation to Manager',
 'Subject: ESCALATION — Ticket SV-2026-501234 — SLA Breach (Priority: High). Dear Ms. Sunita Rao (Team Manager, Operations — Outbound), This e-mail is to formally escalate ticket SV-2026-501234 raised by client TeleMax (contract ref. TM-2026-0088, billing cycle: July 2026). The SLA for first response is 2 hours; the ticket was raised at 09:15 a.m. on 09-July-2026 and the first response was sent at 1:47 p.m. — a breach of 2 hours 32 minutes. Root cause identified: staffing shortage at Pune hub (pincode: 411 001) from 08:00 a.m. to 11:30 a.m. due to unplanned absenteeism (8 of 22 agents absent). Please review the breach report attached (file: SLA-BREACH-0709-TM.xlsx) and confirm corrective action to client by 5:00 p.m. today. Escalation owner: Quality Analyst Ramesh Dubey (ext. 3341, ramesh.dubey@mascallnet.in).',
 104, 686,
 180, 30, 92.00,
 2, 1),

(UUID(), 'EML-S3-P1', 'email', 'any', 'intermediate',
 'Email — New Joiner Onboarding Instructions',
 'Subject: Welcome to MAS Callnet — Onboarding Instructions for Batch BT-2026-JUL-04. Dear New Joiner, Congratulations on joining MAS Callnet! Your joining date is 15-July-2026 at our Bengaluru - Whitefield hub, 3rd Floor, Prestige Tech Park, Outer Ring Road, Bengaluru - 560 066. Reporting time: 9:00 a.m. sharp. Documents to carry (originals + 2 photocopies each): Aadhaar, PAN, highest educational certificate, last 3 months'' payslips (if applicable), and 2 passport-size photographs. Log in to the HR portal at portal.mascallnet.in/onboarding using your registered e-mail and the temporary PIN mailed separately (valid for 48 hours; change it on first login). IT desk (ext. 1100) will issue your system credentials on Day 1. For queries, contact hr.joining@mascallnet.in or call 1800-MAS-JOIN (1800-627-5646). We look forward to welcoming you on 15-July-2026!',
 105, 698,
 180, 30, 92.00,
 3, 1);
