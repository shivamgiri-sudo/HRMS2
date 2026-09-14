/**
 * Question Bank Seed — MAS Callnet PeopleOS
 *
 * Run via: ts-node question-bank-seed.ts  (or call seedQuestionBank() from a one-time script)
 *
 * Coverage:
 *  - backoffice  / executive   — document verification, data extraction, PII, data protection (Sets 1-3)
 *  - inbound     / executive   — call handling, customer service, Indian BPO context (Sets 1-3)
 *  - outbound    / executive   — sales calls, objection handling, BPO context (Sets 1-3)
 *  - any         / team_leader — leadership, escalation, SLA, coaching (Sets 1-2)
 *  - any         / quality_auditor — QA, audit, feedback, compliance (Sets 1-2)
 */

import { importQuestions } from "./question-bank.service.js";

// ─── Helper ────────────────────────────────────────────────────────────────

function q(
  code: string,
  processKey: string,
  roleKey: string,
  sectionKey: string,
  sectionTitle: string,
  type: "single" | "multi" | "text",
  difficulty: "basic" | "intermediate" | "advanced",
  prompt: string,
  options: string[] | undefined,
  correctAnswer: string | string[] | undefined,
  marks: number,
  setNumber: number,
  explanation?: string,
  keywords?: string[],
  manualReview = false,
) {
  return {
    questionCode: code,
    processKey: processKey as any,
    roleKey: roleKey as any,
    sectionKey,
    sectionTitle,
    questionType: type,
    difficultyLevel: difficulty,
    prompt,
    options,
    correctAnswer,
    keywords,
    explanation,
    marks,
    manualReview,
    setNumber,
  };
}

// ─── BACKOFFICE — Document Verification, Data Extraction, PII ──────────────
// 3 sets × ~15 questions = 45 questions for backoffice/executive

const backofficeSet1 = [
  q("BO-S1-001","backoffice","executive","doc_verification","Document Verification","single","basic",
    "A customer submits a photocopy of their Aadhaar card for KYC. You notice the photo looks slightly different from the person's selfie. What should you do first?",
    ["Approve it — minor difference is acceptable","Flag it for supervisor review and request a clearer selfie","Reject it immediately and close the case","Proceed with processing; appearance changes are normal"],
    "Flag it for supervisor review and request a clearer selfie",
    10, 1,
    "Any discrepancy between KYC photo and selfie must be escalated before approval."
  ),
  q("BO-S1-002","backoffice","executive","doc_verification","Document Verification","single","basic",
    "Which of the following is NOT a valid government-issued ID for KYC in India?",
    ["PAN Card","Voter ID","Ration Card","Driving Licence"],
    "Ration Card",
    10, 1,
    "Ration Card is not accepted as valid KYC proof by most regulated entities."
  ),
  q("BO-S1-003","backoffice","executive","doc_verification","Document Verification","single","intermediate",
    "A submitted bank statement shows the account holder's name as 'Ramesh Kumar' but the application form says 'R. Kumar'. What is the correct action?",
    ["Accept — initials are commonly used","Reject immediately","Flag for name mismatch and send a clarification request to the customer","Manually correct the name in the system"],
    "Flag for name mismatch and send a clarification request to the customer",
    10, 1,
    "Name mismatches must be resolved with supporting documents, not assumed or self-corrected."
  ),
  q("BO-S1-004","backoffice","executive","data_extraction","Data Extraction","single","basic",
    "While extracting data from a scanned invoice, you find a field is partially cut off. What is the best practice?",
    ["Enter your best guess","Leave the field blank and note it as unreadable","Enter N/A and move on","Skip the invoice entirely"],
    "Leave the field blank and note it as unreadable",
    10, 1,
    "Entering guessed data causes downstream errors. Flagging it allows follow-up."
  ),
  q("BO-S1-005","backoffice","executive","data_extraction","Data Extraction","single","intermediate",
    "You are extracting date fields from a document. The date reads '05/06/2024'. In India, this most likely means:",
    ["May 6, 2024","June 5, 2024","Either — you should clarify with the document source","5th day of the 6th month, i.e., 5 June 2024"],
    "5th day of the 6th month, i.e., 5 June 2024",
    10, 1,
    "India follows DD/MM/YYYY format. Always confirm format from document header or context."
  ),
  q("BO-S1-006","backoffice","executive","pii_protection","PII & Data Protection","single","basic",
    "PII stands for:",
    ["Personal Identification Information","Personally Identifiable Information","Private Internal Information","Public Identity Index"],
    "Personally Identifiable Information",
    10, 1
  ),
  q("BO-S1-007","backoffice","executive","pii_protection","PII & Data Protection","single","basic",
    "Which of the following is an example of PII?",
    ["Name of a city","Company's annual revenue","A customer's mobile number","Product catalogue price"],
    "A customer's mobile number",
    10, 1,
    "Mobile number directly identifies an individual and is classified as PII."
  ),
  q("BO-S1-008","backoffice","executive","pii_protection","PII & Data Protection","single","intermediate",
    "A colleague asks you to share a customer's address over WhatsApp to send them a courier. What should you do?",
    ["Share it — it's just an address","Use the official internal channel or ticket system only","Send only the pincode, not full address","Call the customer directly and give address to the courier"],
    "Use the official internal channel or ticket system only",
    10, 1,
    "PII must never be shared on personal messaging apps regardless of intent."
  ),
  q("BO-S1-009","backoffice","executive","pii_protection","PII & Data Protection","multi","intermediate",
    "Which of the following actions violate data protection policies? (Select all that apply)",
    ["Saving customer documents on personal email","Sharing client data files on personal WhatsApp","Using the secure internal portal to upload KYC","Printing customer records and leaving them unattended on your desk"],
    ["Saving customer documents on personal email","Sharing client data files on personal WhatsApp","Printing customer records and leaving them unattended on your desk"],
    15, 1,
    "All actions that move data outside secured systems or leave it exposed are violations."
  ),
  q("BO-S1-010","backoffice","executive","data_quality","Data Quality & Accuracy","single","basic",
    "After entering data from a document, what is the recommended quality check?",
    ["Submit immediately to meet TAT","Re-read the source document and compare field by field","Ask a colleague to verbally confirm","Check only the mandatory fields"],
    "Re-read the source document and compare field by field",
    10, 1
  ),
  q("BO-S1-011","backoffice","executive","data_quality","Data Quality & Accuracy","single","intermediate",
    "The target accuracy rate for data entry in your process is 99%. You made 3 errors in 200 records today. What is your accuracy rate?",
    ["98.5%","98%","97.5%","99%"],
    "98.5%",
    10, 1,
    "(200-3)/200 × 100 = 98.5%"
  ),
  q("BO-S1-012","backoffice","executive","compliance","Compliance & Confidentiality","single","basic",
    "You accidentally processed a document with wrong details. The best next step is:",
    ["Wait and see if anyone notices","Correct it silently without reporting","Immediately report to your supervisor and raise an error ticket","Ask a friend on another team to fix it"],
    "Immediately report to your supervisor and raise an error ticket",
    10, 1,
    "Self-reporting errors is required by compliance policy and enables correction before impact."
  ),
  q("BO-S1-013","backoffice","executive","compliance","Compliance & Confidentiality","single","intermediate",
    "Under India's IT Act, unauthorized disclosure of customer data can result in:",
    ["A verbal warning only","Civil and/or criminal liability","Only a monetary fine","No consequence if unintentional"],
    "Civil and/or criminal liability",
    10, 1
  ),
  q("BO-S1-014","backoffice","executive","doc_verification","Document Verification","single","advanced",
    "A document submitted for verification appears genuine but has a date of issue that predates the issuing authority's existence by 2 years. What does this indicate?",
    ["Normal — government systems backdate records","Likely a forged or fraudulent document","Acceptable if the customer explains it","A printing error — proceed with caution"],
    "Likely a forged or fraudulent document",
    10, 1,
    "Dates that are logically impossible relative to the issuing body are a red flag for fraud."
  ),
  q("BO-S1-015","backoffice","executive","pii_protection","PII & Data Protection","text","advanced",
    "A customer's complete Aadhaar number is visible in a document you are processing. Describe in 2-3 sentences the steps you should follow to handle this data securely.",
    undefined, undefined,
    15, 1,
    undefined,
    ["aadhaar","masking","secure handling","need-to-know","data protection"],
    true
  ),
];

const backofficeSet2 = [
  q("BO-S2-001","backoffice","executive","doc_verification","Document Verification","single","basic",
    "A customer submits a PAN card. Which detail on the PAN card confirms the holder's date of birth?",
    ["The PAN number itself encodes DOB","The 'Date of Birth' field printed on the card","PAN cards do not show date of birth","The last 4 digits of the PAN"],
    "The 'Date of Birth' field printed on the card",
    10, 2
  ),
  q("BO-S2-002","backoffice","executive","doc_verification","Document Verification","single","intermediate",
    "You receive two address proof documents from the same customer — one shows a Mumbai address, another shows a Pune address. What should you do?",
    ["Accept the more recent document","Accept both and enter both addresses","Flag it and ask the customer to clarify their current address","Randomly pick one"],
    "Flag it and ask the customer to clarify their current address",
    10, 2
  ),
  q("BO-S2-003","backoffice","executive","data_extraction","Data Extraction","single","basic",
    "You are extracting numeric data and see a value written as '1,00,000' in an Indian document. In international/system format, this equals:",
    ["1,000","10,000","100,000","1,000,000"],
    "100,000",
    10, 2,
    "Indian numbering uses the lakh system: 1,00,000 = 1 lakh = 100,000."
  ),
  q("BO-S2-004","backoffice","executive","data_extraction","Data Extraction","single","intermediate",
    "When extracting text from a handwritten form, some words are ambiguous. The correct approach is:",
    ["Enter what you think it says","Mark the field as 'Unclear' and escalate per SOP","Skip the record","Auto-fill with the most common value"],
    "Mark the field as 'Unclear' and escalate per SOP",
    10, 2
  ),
  q("BO-S2-005","backoffice","executive","pii_protection","PII & Data Protection","single","basic",
    "Before leaving your workstation for a break, you should:",
    ["Leave the screen as-is — you'll be back in 5 minutes","Minimize all windows","Lock your computer screen","Close only the customer file you were working on"],
    "Lock your computer screen",
    10, 2,
    "Unattended screens displaying customer data are a data breach risk."
  ),
  q("BO-S2-006","backoffice","executive","pii_protection","PII & Data Protection","single","intermediate",
    "Which Aadhaar detail should be masked when storing in internal systems as per UIDAI guidelines?",
    ["Name","Date of Birth","First 8 digits of the 12-digit Aadhaar number","State of residence"],
    "First 8 digits of the 12-digit Aadhaar number",
    10, 2,
    "UIDAI mandates that only the last 4 digits be visible; first 8 must be masked as XXXX-XXXX."
  ),
  q("BO-S2-007","backoffice","executive","pii_protection","PII & Data Protection","multi","intermediate",
    "Which of the following are examples of sensitive PII that require extra protection? (Select all that apply)",
    ["Aadhaar number","Customer's favourite colour","Bank account number","Name of customer's employer","Biometric data"],
    ["Aadhaar number","Bank account number","Biometric data"],
    15, 2
  ),
  q("BO-S2-008","backoffice","executive","data_quality","Data Quality & Accuracy","single","basic",
    "TAT in a backoffice context means:",
    ["Total Accuracy Target","Turnaround Time","Transaction Approval Threshold","Team Attendance Tracker"],
    "Turnaround Time",
    10, 2
  ),
  q("BO-S2-009","backoffice","executive","data_quality","Data Quality & Accuracy","single","intermediate",
    "Your team's SLA says documents must be processed within 4 hours of receipt. You received a batch at 9 AM. By what time must all documents be completed?",
    ["1 PM","12 PM","11 AM","4 PM"],
    "1 PM",
    10, 2
  ),
  q("BO-S2-010","backoffice","executive","compliance","Compliance & Confidentiality","single","basic",
    "A customer's document contains their religious information. This is classified as:",
    ["General data","Sensitive personal data","Public information","Operational data"],
    "Sensitive personal data",
    10, 2,
    "Religious information is classified as sensitive personal data and attracts higher protection."
  ),
  q("BO-S2-011","backoffice","executive","compliance","Compliance & Confidentiality","single","intermediate",
    "DPDP Act 2023 in India primarily governs:",
    ["Data entry speed standards","Digital Personal Data Protection","Document printing protocols","Database performance"],
    "Digital Personal Data Protection",
    10, 2,
    "The Digital Personal Data Protection Act 2023 is India's primary data protection legislation."
  ),
  q("BO-S2-012","backoffice","executive","doc_verification","Document Verification","single","intermediate",
    "A passport submitted for verification is valid but will expire in 15 days. For a process requiring 6-month validity, you should:",
    ["Accept — it is currently valid","Reject — it does not meet the 6-month validity requirement","Accept with a note","Ask the customer to renew and resubmit"],
    "Reject — it does not meet the 6-month validity requirement",
    10, 2
  ),
  q("BO-S2-013","backoffice","executive","doc_verification","Document Verification","single","advanced",
    "You receive a digitally signed PDF document for processing. The signature shows a warning: 'Signature validity unknown'. This means:",
    ["The document is definitely fraudulent","The signing certificate could not be verified — escalate before processing","The PDF is corrupt and must be rejected","This is normal and can be ignored"],
    "The signing certificate could not be verified — escalate before processing",
    10, 2
  ),
  q("BO-S2-014","backoffice","executive","data_extraction","Data Extraction","single","advanced",
    "While extracting data from a financial document, you notice the totals do not add up. The correct response is:",
    ["Correct the total to make it match","Enter the data exactly as shown and flag the discrepancy","Enter the mathematically correct total","Skip the record"],
    "Enter the data exactly as shown and flag the discrepancy",
    10, 2,
    "Data must be extracted accurately as-is. Discrepancies are flagged, not corrected by the operator."
  ),
  q("BO-S2-015","backoffice","executive","pii_protection","PII & Data Protection","text","advanced",
    "Your team receives customer financial statements via email for processing. Describe 3 steps your team should take to ensure these documents are handled securely from receipt to archival.",
    undefined, undefined,
    15, 2,
    undefined,
    ["email security","secure storage","access control","audit trail","deletion policy"],
    true
  ),
];

const backofficeSet3 = [
  q("BO-S3-001","backoffice","executive","doc_verification","Document Verification","single","basic",
    "Which document is used as proof of address AND proof of identity in India?",
    ["PAN Card","Aadhaar Card","Voter ID","Both Aadhaar Card and Voter ID"],
    "Both Aadhaar Card and Voter ID",
    10, 3
  ),
  q("BO-S3-002","backoffice","executive","doc_verification","Document Verification","single","basic",
    "A document shows a rubber stamp that is partially smudged and unreadable. You should:",
    ["Assume it is valid","Reject it outright","Flag it for verification and request a clearer document","Enter what is readable and leave the rest blank"],
    "Flag it for verification and request a clearer document",
    10, 3
  ),
  q("BO-S3-003","backoffice","executive","data_extraction","Data Extraction","single","basic",
    "While extracting IFSC codes from cheques, you must ensure the code is:",
    ["11 characters: 4 letters, 0, and 6 digits","9 characters","Only numeric","Alphanumeric, any length"],
    "11 characters: 4 letters, 0, and 6 digits",
    10, 3,
    "Indian IFSC codes are always 11 characters: first 4 = bank code, 5th = 0, last 6 = branch code."
  ),
  q("BO-S3-004","backoffice","executive","data_extraction","Data Extraction","single","intermediate",
    "You need to enter a customer's full name from their Aadhaar. The name printed is 'PRIYA S NAIR'. How should it be entered in a system with First/Middle/Last name fields?",
    ["First: PRIYA, Middle: S, Last: NAIR","First: PRIYA S, Last: NAIR","First: PRIYA, Last: S NAIR","Enter exactly as printed in the full name field"],
    "First: PRIYA, Middle: S, Last: NAIR",
    10, 3
  ),
  q("BO-S3-005","backoffice","executive","pii_protection","PII & Data Protection","single","basic",
    "You receive a call from someone claiming to be an IT support person and asking for your system login credentials to fix a problem. You should:",
    ["Share the password — IT needs it to help","Share only the username","Refuse and report to your supervisor immediately","Create a temporary password for them"],
    "Refuse and report to your supervisor immediately",
    10, 3,
    "Sharing credentials is always prohibited. Legitimate IT support never needs your password."
  ),
  q("BO-S3-006","backoffice","executive","pii_protection","PII & Data Protection","single","intermediate",
    "The 'need-to-know' principle in data security means:",
    ["Everyone in the office should know all customer data","Only employees whose job requires it should access specific data","Managers should know everything about all customers","Data should be shared freely within the team"],
    "Only employees whose job requires it should access specific data",
    10, 3
  ),
  q("BO-S3-007","backoffice","executive","pii_protection","PII & Data Protection","single","intermediate",
    "A customer's data that is no longer required for the process should be:",
    ["Kept indefinitely as it may be useful later","Deleted or destroyed as per the data retention policy","Moved to personal storage for backup","Shared with other team members for reference"],
    "Deleted or destroyed as per the data retention policy",
    10, 3,
    "Data retention policies define how long data is kept and mandate secure disposal afterwards."
  ),
  q("BO-S3-008","backoffice","executive","data_quality","Data Quality & Accuracy","single","basic",
    "Double-key entry (entering data twice by different operators) is used to:",
    ["Speed up data processing","Detect and reduce data entry errors","Save system storage","Auto-correct scanned documents"],
    "Detect and reduce data entry errors",
    10, 3
  ),
  q("BO-S3-009","backoffice","executive","data_quality","Data Quality & Accuracy","single","intermediate",
    "Your error rate target is below 1%. If you process 500 records and have 6 errors, are you within target?",
    ["Yes — 6 errors on 500 is only 1.2%","No — 6/500 = 1.2%, which is above the 1% target","Yes — you are exactly at target","Cannot be determined without knowing record type"],
    "No — 6/500 = 1.2%, which is above the 1% target",
    10, 3,
    "6/500 = 0.012 = 1.2%. This exceeds the <1% target."
  ),
  q("BO-S3-010","backoffice","executive","compliance","Compliance & Confidentiality","single","basic",
    "Which of the following best describes a data breach?",
    ["System going offline for maintenance","Unauthorized access or disclosure of protected data","Slow network speed affecting work","A customer forgetting their password"],
    "Unauthorized access or disclosure of protected data",
    10, 3
  ),
  q("BO-S3-011","backoffice","executive","compliance","Compliance & Confidentiality","single","intermediate",
    "If you discover that a colleague is taking photos of customer documents on their personal phone, you should:",
    ["Ignore it — not your responsibility","Ask them to stop, and if they continue, report it to your supervisor","Warn them informally","Join them only if the client approves"],
    "Ask them to stop, and if they continue, report it to your supervisor",
    10, 3
  ),
  q("BO-S3-012","backoffice","executive","doc_verification","Document Verification","multi","intermediate",
    "Which of the following are valid checks during document verification? (Select all that apply)",
    ["Check document expiry date","Verify photo matches the applicant","Check for overwriting or corrections","Confirm the document type matches the required proof","Accept any document without checking"],
    ["Check document expiry date","Verify photo matches the applicant","Check for overwriting or corrections","Confirm the document type matches the required proof"],
    15, 3
  ),
  q("BO-S3-013","backoffice","executive","doc_verification","Document Verification","single","advanced",
    "A Form 16 submitted for income verification shows a TAN number that doesn't match the employer's registered TAN. This is:",
    ["Normal — TAN changes every year","A discrepancy that must be escalated as a potential fraud indicator","Acceptable if the employer name matches","Ignored if the income figure looks reasonable"],
    "A discrepancy that must be escalated as a potential fraud indicator",
    10, 3,
    "TAN is unique to each deductor. A mismatch with the registered TAN is a strong fraud indicator."
  ),
  q("BO-S3-014","backoffice","executive","compliance","Compliance & Confidentiality","single","advanced",
    "Under ISO 27001, an Information Security Management System (ISMS) is designed to:",
    ["Increase employee productivity","Systematically manage and protect sensitive information","Replace all paper documents with digital ones","Automate customer data entry"],
    "Systematically manage and protect sensitive information",
    10, 3
  ),
  q("BO-S3-015","backoffice","executive","pii_protection","PII & Data Protection","text","advanced",
    "A team member accidentally emails a spreadsheet containing 200 customers' bank account numbers to an external address. As the team leader's point of contact, describe what immediate steps should be taken.",
    undefined, undefined,
    15, 3,
    undefined,
    ["incident response","data breach","notification","containment","escalation"],
    true
  ),
];

// ─── INBOUND — Indian BPO Call Centre Context ───────────────────────────────
// 3 sets × 15 questions = 45 questions for inbound/executive

const inboundSet1 = [
  q("IN-S1-001","inbound","executive","call_handling","Call Handling & Etiquette","single","basic",
    "A customer calls and is already very angry. Your first response should be:",
    ["Tell them to calm down","Defend your company immediately","Acknowledge their frustration and listen patiently","Transfer the call to your supervisor straightaway"],
    "Acknowledge their frustration and listen patiently",
    10, 1,
    "De-escalation starts with empathy. Acknowledge first, solve next."
  ),
  q("IN-S1-002","inbound","executive","call_handling","Call Handling & Etiquette","single","basic",
    "What does AHT stand for in a call centre?",
    ["Average Hold Time","Average Handling Time","Actual Help Time","Agent Helpdesk Tracker"],
    "Average Handling Time",
    10, 1
  ),
  q("IN-S1-003","inbound","executive","call_handling","Call Handling & Etiquette","single","basic",
    "Before putting a customer on hold, you should:",
    ["Just press the hold button","Tell the customer why and ask for permission, then wait for their response","Hold for up to 5 minutes without telling them","Transfer immediately to avoid hold time"],
    "Tell the customer why and ask for permission, then wait for their response",
    10, 1
  ),
  q("IN-S1-004","inbound","executive","customer_service","Customer Service Skills","single","intermediate",
    "A customer is calling about an electricity bill dispute. They use Hindi mixed with English (Hinglish). You should:",
    ["Insist they speak only in English","Match their preferred language comfort to build rapport","Ask them to call back when they can speak clearly","Immediately escalate to a Hindi-speaking agent"],
    "Match their preferred language comfort to build rapport",
    10, 1,
    "Language flexibility is key in Indian BPO. Matching the customer's comfort increases satisfaction."
  ),
  q("IN-S1-005","inbound","executive","customer_service","Customer Service Skills","single","intermediate",
    "A customer says 'Mujhe koi solution nahi mila pichle 3 din se' (I haven't received any solution in 3 days). Your best response is:",
    ["'Sorry, let me check' and immediately place them on hold","'Sir/Ma'am, I completely understand your frustration. Let me pull up your case right now and personally ensure this gets resolved today.'","'This is not my department, let me transfer you.'","'Please hold' and check with the supervisor"],
    "'Sir/Ma'am, I completely understand your frustration. Let me pull up your case right now and personally ensure this gets resolved today.'",
    10, 1
  ),
  q("IN-S1-006","inbound","executive","customer_service","Customer Service Skills","single","basic",
    "FCR stands for:",
    ["First Call Resolution","Full Customer Record","Fast Communication Response","Field Contact Report"],
    "First Call Resolution",
    10, 1
  ),
  q("IN-S1-007","inbound","executive","compliance","Compliance & Call Protocols","single","basic",
    "Before discussing any account details, you must verify the customer's identity by:",
    ["Their voice tone","Asking their name only","At least 2 security questions or OTP as per SOP","Their registered email address"],
    "At least 2 security questions or OTP as per SOP",
    10, 1
  ),
  q("IN-S1-008","inbound","executive","compliance","Compliance & Call Protocols","single","intermediate",
    "A customer is asking you to share another customer's account details saying they are a family member. You should:",
    ["Share if the caller sounds genuine","Share only the name, not the account number","Refuse — customer data can only be shared with the verified account holder","Ask the supervisor to decide"],
    "Refuse — customer data can only be shared with the verified account holder",
    10, 1
  ),
  q("IN-S1-009","inbound","executive","call_handling","Call Handling & Etiquette","single","intermediate",
    "The ideal hold time per interaction as per most Indian BPO SOPs is:",
    ["No limit as long as the customer is waiting","Under 2 minutes per hold, with updates every 1 minute if longer","Under 10 minutes total","Hold time doesn't matter if the issue is resolved"],
    "Under 2 minutes per hold, with updates every 1 minute if longer",
    10, 1
  ),
  q("IN-S1-010","inbound","executive","product_process","Process & Product Knowledge","single","basic",
    "If you do not know the answer to a customer's query, the best action is:",
    ["Make up a plausible answer to avoid escalation","Tell the customer you don't know and end the call","Put them on hold, find the correct information, then respond accurately","Ask the customer to call back when you're more prepared"],
    "Put them on hold, find the correct information, then respond accurately",
    10, 1
  ),
  q("IN-S1-011","inbound","executive","product_process","Process & Product Knowledge","single","intermediate",
    "A customer asks for a refund. Your SOP says refunds take 5-7 working days. You should tell them:",
    ["'It will be done today'","'I cannot guarantee anything'","'Your refund will be processed and credited within 5-7 working days. You'll receive an SMS confirmation.'","'Refunds are not my department'"],
    "'Your refund will be processed and credited within 5-7 working days. You'll receive an SMS confirmation.'",
    10, 1,
    "Always give clear, accurate timelines. Never overpromise."
  ),
  q("IN-S1-012","inbound","executive","customer_service","Customer Service Skills","multi","intermediate",
    "Which of the following are active listening techniques? (Select all that apply)",
    ["Interrupting to speed up the call","Paraphrasing what the customer said to confirm understanding","Taking notes while the customer explains","Saying 'uh-huh' occasionally to show you are following","Checking your phone while on call"],
    ["Paraphrasing what the customer said to confirm understanding","Taking notes while the customer explains","Saying 'uh-huh' occasionally to show you are following"],
    15, 1
  ),
  q("IN-S1-013","inbound","executive","compliance","Compliance & Call Protocols","single","intermediate",
    "You are handling a call and the customer shares their OTP with you 'to help resolve the issue faster'. You should:",
    ["Use it to process the transaction quickly","Note it down but do not use it","Tell the customer that you will never ask for or use their OTP, and advise them not to share it with anyone","Accept it this time only"],
    "Tell the customer that you will never ask for or use their OTP, and advise them not to share it with anyone",
    10, 1,
    "Legitimate agents never require OTPs. Accepting them is a compliance and fraud risk."
  ),
  q("IN-S1-014","inbound","executive","call_handling","Call Handling & Etiquette","single","advanced",
    "A caller is very aggressive and uses abusive language repeatedly even after two polite warnings. Your best course of action is:",
    ["Continue handling the call without reacting","Shout back to assert yourself","Give one final warning, then follow the SOP for call termination and document it","Hang up immediately without warning"],
    "Give one final warning, then follow the SOP for call termination and document it",
    10, 1
  ),
  q("IN-S1-015","inbound","executive","customer_service","Customer Service Skills","text","advanced",
    "A customer calls saying their broadband connection has been down for 2 days, they work from home, and they've already called twice without resolution. Write what you would say to open this interaction and how you would approach resolving it.",
    undefined, undefined,
    15, 1,
    undefined,
    ["empathy","acknowledgement","ownership","escalation","resolution","follow-up"],
    true
  ),
];

const inboundSet2 = [
  q("IN-S2-001","inbound","executive","call_handling","Call Handling & Etiquette","single","basic",
    "The standard opening greeting for an inbound call should include:",
    ["Just 'Hello, how can I help?'","Company name, your name, and a greeting","Only your employee ID","The team name only"],
    "Company name, your name, and a greeting",
    10, 2
  ),
  q("IN-S2-002","inbound","executive","call_handling","Call Handling & Etiquette","single","basic",
    "CSAT stands for:",
    ["Call Service Accuracy Test","Customer Satisfaction Score","Call Speed and Timing","Customer Service Audit Tool"],
    "Customer Satisfaction Score",
    10, 2
  ),
  q("IN-S2-003","inbound","executive","customer_service","Customer Service Skills","single","intermediate",
    "A customer is calling from a village in Rajasthan and is not comfortable with English. You should:",
    ["Politely decline to help","Switch to Hindi or the regional language if available on your process","Ask them to find someone who speaks English","Stick to English as it is the official language"],
    "Switch to Hindi or the regional language if available on your process",
    10, 2
  ),
  q("IN-S2-004","inbound","executive","product_process","Process & Product Knowledge","single","basic",
    "After completing a customer interaction, you must complete after-call work (ACW). This includes:",
    ["Taking a break","Updating call notes, tagging the reason, and closing the ticket","Discussing the call with a colleague","Calling the customer back to confirm"],
    "Updating call notes, tagging the reason, and closing the ticket",
    10, 2
  ),
  q("IN-S2-005","inbound","executive","compliance","Compliance & Call Protocols","single","intermediate",
    "All calls in your BPO are recorded. This recording is used for:",
    ["Surveillance of personal conversations","Quality monitoring, training, and dispute resolution","Marketing calls to the same customer","Sharing with third parties freely"],
    "Quality monitoring, training, and dispute resolution",
    10, 2
  ),
  q("IN-S2-006","inbound","executive","customer_service","Customer Service Skills","single","intermediate",
    "A customer asks: 'Will this issue definitely not happen again?' The honest answer is:",
    ["'Yes, guaranteed, 100%'","'I cannot make that guarantee, but I am escalating this to ensure we take steps to prevent recurrence.'","'It depends on your luck'","'I don't know, maybe'"],
    "'I cannot make that guarantee, but I am escalating this to ensure we take steps to prevent recurrence.'",
    10, 2,
    "Never make promises you cannot keep. Transparency builds long-term trust."
  ),
  q("IN-S2-007","inbound","executive","call_handling","Call Handling & Etiquette","single","basic",
    "When transferring a call to another department, you must:",
    ["Simply transfer without warning","Brief the next agent with the customer's issue so the customer doesn't repeat themselves","Put the customer on hold indefinitely","Ask the customer to call the other department directly"],
    "Brief the next agent with the customer's issue so the customer doesn't repeat themselves",
    10, 2
  ),
  q("IN-S2-008","inbound","executive","compliance","Compliance & Call Protocols","single","intermediate",
    "A customer disputes a charge and demands a refund on the spot during the call. Your SOP requires approval. You should:",
    ["Approve it yourself to resolve the call quickly","Explain the process, raise a refund request, give a reference number, and set the right expectation","Refuse the refund entirely","Blame the billing system"],
    "Explain the process, raise a refund request, give a reference number, and set the right expectation",
    10, 2
  ),
  q("IN-S2-009","inbound","executive","customer_service","Customer Service Skills","single","intermediate",
    "The term 'ownership' on a call means:",
    ["Taking personal responsibility for the customer's issue until it is resolved or properly handed off","Owning the customer's account in the system","Claiming credit for the resolution in the QA report","Refusing to transfer any call"],
    "Taking personal responsibility for the customer's issue until it is resolved or properly handed off",
    10, 2
  ),
  q("IN-S2-010","inbound","executive","call_handling","Call Handling & Etiquette","single","basic",
    "If you don't understand a customer's accent or language, you should:",
    ["Pretend you understood","Politely ask them to repeat and apologise for the inconvenience","Put them on hold indefinitely","Hang up and mark as wrong number"],
    "Politely ask them to repeat and apologise for the inconvenience",
    10, 2
  ),
  q("IN-S2-011","inbound","executive","product_process","Process & Product Knowledge","single","intermediate",
    "SLA in a contact centre stands for:",
    ["Sales Lead Acquisition","Service Level Agreement","Supervisor Leave Approval","System Log Analysis"],
    "Service Level Agreement",
    10, 2
  ),
  q("IN-S2-012","inbound","executive","compliance","Compliance & Call Protocols","multi","intermediate",
    "Which of the following are examples of good call compliance practices? (Select all that apply)",
    ["Reading the mandatory disclosure script at the start","Not recording personal opinions about customers in notes","Confirming customer's identity before sharing account information","Discussing customer cases loudly in the break room","Ending every call with a proper closing and reference number"],
    ["Reading the mandatory disclosure script at the start","Not recording personal opinions about customers in notes","Confirming customer's identity before sharing account information","Ending every call with a proper closing and reference number"],
    15, 2
  ),
  q("IN-S2-013","inbound","executive","customer_service","Customer Service Skills","single","advanced",
    "A customer on an escalated call says: 'Main directly tumhare CEO ko likhta hoon' (I'll write to your CEO directly). The professional response is:",
    ["Tell them the CEO doesn't deal with complaints","Give them the CEO's email address","Acknowledge their right to escalate, provide the correct escalation channel (email/letter address), and offer to log their complaint formally right now","Tell them the CEO will ignore the email"],
    "Acknowledge their right to escalate, provide the correct escalation channel (email/letter address), and offer to log their complaint formally right now",
    10, 2
  ),
  q("IN-S2-014","inbound","executive","call_handling","Call Handling & Etiquette","single","advanced",
    "A customer has been on hold three times in the same call. When you return, you should:",
    ["Just continue from where you left off","Thank them profusely for holding and summarise where you are","Apologise sincerely for the wait, thank them for their patience, and immediately continue with a clear update","Nothing special is needed"],
    "Apologise sincerely for the wait, thank them for their patience, and immediately continue with a clear update",
    10, 2
  ),
  q("IN-S2-015","inbound","executive","call_handling","Call Handling & Etiquette","text","advanced",
    "You have been assigned to a new process handling utility bill disputes. Describe how you would prepare yourself in the first week to handle customer calls effectively.",
    undefined, undefined,
    15, 2,
    undefined,
    ["product knowledge","SOP","mock calls","buddy calling","escalation matrix","FAQ"],
    true
  ),
];

const inboundSet3 = [
  q("IN-S3-001","inbound","executive","call_handling","Call Handling & Etiquette","single","basic",
    "What is the purpose of a 'wrap-up code' or 'disposition code' after a call?",
    ["To end your shift","To categorise the type of call for reporting and analysis","To block the customer's number","To automatically send an SMS to the customer"],
    "To categorise the type of call for reporting and analysis",
    10, 3
  ),
  q("IN-S3-002","inbound","executive","customer_service","Customer Service Skills","single","basic",
    "A customer says 'I have been a customer for 10 years and this is how you treat me?' The best response acknowledges:",
    ["Nothing — focus on the issue","Their loyalty and express genuine appreciation before addressing the problem","The company's policies that prevent any exceptions","That other customers have worse problems"],
    "Their loyalty and express genuine appreciation before addressing the problem",
    10, 3
  ),
  q("IN-S3-003","inbound","executive","compliance","Compliance & Call Protocols","single","intermediate",
    "Your company has a 'Do Not Call' (DNC) registry policy. A customer on the DNC list calls you inbound. You should:",
    ["Refuse to talk to them","Handle the call normally — DNC applies to outbound only","Flag their number for removal","Ask them to unregister from DNC first"],
    "Handle the call normally — DNC applies to outbound only",
    10, 3,
    "DNC registry restrictions apply to outbound calls only. Inbound calls from any number are handled normally."
  ),
  q("IN-S3-004","inbound","executive","product_process","Process & Product Knowledge","single","basic",
    "NCO / Idle time in BPO metrics refers to:",
    ["Time spent on calls","Time the agent is logged in but not on a call or in ACW","Total break time","Night shift hours"],
    "Time the agent is logged in but not on a call or in ACW",
    10, 3
  ),
  q("IN-S3-005","inbound","executive","customer_service","Customer Service Skills","single","intermediate",
    "Closed questions are useful for:",
    ["Building rapport with customers","Getting detailed explanations","Confirming specific facts (Yes/No or specific answer)","All of the above equally"],
    "Confirming specific facts (Yes/No or specific answer)",
    10, 3
  ),
  q("IN-S3-006","inbound","executive","customer_service","Customer Service Skills","single","intermediate",
    "Open-ended questions are best used to:",
    ["Confirm the customer's address","Get a Yes or No answer","Understand the customer's full issue without limiting their response","Speed up the call"],
    "Understand the customer's full issue without limiting their response",
    10, 3
  ),
  q("IN-S3-007","inbound","executive","call_handling","Call Handling & Etiquette","single","basic",
    "If a call drops accidentally, you should:",
    ["Log it as resolved","Wait for the customer to call back","Call back the customer immediately if your process allows, or follow the callback SOP","Mark it as abandoned"],
    "Call back the customer immediately if your process allows, or follow the callback SOP",
    10, 3
  ),
  q("IN-S3-008","inbound","executive","compliance","Compliance & Call Protocols","single","intermediate",
    "A customer insists that the previous agent promised a discount that is not in the system. You should:",
    ["Apply the discount to satisfy the customer","Tell them the previous agent was wrong and move on","Check the call recording / notes, and if confirmed, honour it or escalate to a supervisor","Deny it without checking"],
    "Check the call recording / notes, and if confirmed, honour it or escalate to a supervisor",
    10, 3
  ),
  q("IN-S3-009","inbound","executive","customer_service","Customer Service Skills","single","advanced",
    "A hearing-impaired customer is communicating through a relay service. How should you adjust your approach?",
    ["Refuse relay calls as they take too long","Speak clearly, avoid slang, pause for relay delay, and be patient with the process","Ask them to use chat support instead","Transfer to a specialist agent"],
    "Speak clearly, avoid slang, pause for relay delay, and be patient with the process",
    10, 3
  ),
  q("IN-S3-010","inbound","executive","product_process","Process & Product Knowledge","single","intermediate",
    "Escalation to a supervisor/team leader is appropriate when:",
    ["The customer asks a product-related question","The customer has been waiting more than 30 seconds","The issue is beyond your authority or the customer specifically requests it","You want to take a break"],
    "The issue is beyond your authority or the customer specifically requests it",
    10, 3
  ),
  q("IN-S3-011","inbound","executive","call_handling","Call Handling & Etiquette","multi","intermediate",
    "Which of the following contribute to a positive call experience? (Select all that apply)",
    ["Using the customer's name during the conversation","Smiling while speaking (it affects your tone)","Multitasking on other applications during the call","Confirming the issue is resolved before closing the call","Using simple, clear language"],
    ["Using the customer's name during the conversation","Smiling while speaking (it affects your tone)","Confirming the issue is resolved before closing the call","Using simple, clear language"],
    15, 3
  ),
  q("IN-S3-012","inbound","executive","compliance","Compliance & Call Protocols","single","advanced",
    "TRAI (Telecom Regulatory Authority of India) guidelines affect your BPO work primarily by:",
    ["Setting your salary structure","Regulating call timing, consent, and marketing communication rules","Controlling the internet speed in the office","Mandating daily attendance"],
    "Regulating call timing, consent, and marketing communication rules",
    10, 3
  ),
  q("IN-S3-013","inbound","executive","customer_service","Customer Service Skills","single","intermediate",
    "A customer from a tier-2 city uses informal language and is unfamiliar with technical terms. You should:",
    ["Use technical jargon to sound professional","Simplify your language and use relatable local examples where helpful","Ask them to consult the product manual","Transfer to a specialist"],
    "Simplify your language and use relatable local examples where helpful",
    10, 3
  ),
  q("IN-S3-014","inbound","executive","product_process","Process & Product Knowledge","single","advanced",
    "What does 'shrinkage' mean in call centre workforce management?",
    ["Customer complaints about call quality","Reduction in team size due to attrition","Percentage of time agents are unavailable (breaks, training, absenteeism) affecting staffing","Decrease in call volume"],
    "Percentage of time agents are unavailable (breaks, training, absenteeism) affecting staffing",
    10, 3
  ),
  q("IN-S3-015","inbound","executive","customer_service","Customer Service Skills","text","advanced",
    "A customer calls extremely upset that they were charged twice for a DTH recharge. They say they will post about it on social media. How do you handle this call from start to finish?",
    undefined, undefined,
    15, 3,
    undefined,
    ["empathy","verification","resolution","social media","escalation","follow-up","refund"],
    true
  ),
];

// ─── OUTBOUND — Indian BPO Sales/Collections Context ───────────────────────
// 3 sets × 10 questions = 30 questions for outbound/executive

const outboundSet1 = [
  q("OUT-S1-001","outbound","executive","outbound_basics","Outbound Call Basics","single","basic",
    "Before making an outbound call, you should ensure:",
    ["The customer owes money","The lead/contact is on the calling list and not on DNC registry","Your headset is expensive","It is after 10 PM for better connect rates"],
    "The lead/contact is on the calling list and not on DNC registry",
    10, 1
  ),
  q("OUT-S1-002","outbound","executive","outbound_basics","Outbound Call Basics","single","basic",
    "TRAI rules in India restrict unsolicited commercial calls to:",
    ["Any time between 7 AM and 11 PM","Between 9 AM and 9 PM only","Only on weekdays","No restrictions apply to commercial calls"],
    "Between 9 AM and 9 PM only",
    10, 1,
    "TRAI guidelines restrict unsolicited commercial calls to 9 AM – 9 PM."
  ),
  q("OUT-S1-003","outbound","executive","sales_skills","Sales & Objection Handling","single","intermediate",
    "A customer says 'Mujhe abhi interest nahi hai' (I'm not interested right now). The best response is:",
    ["Hang up immediately","'May I ask what is holding you back? Sometimes I can help address that concern.'","'You should be interested — this is a great offer'","Mark as DNC and never call again"],
    "'May I ask what is holding you back? Sometimes I can help address that concern.'",
    10, 1
  ),
  q("OUT-S1-004","outbound","executive","sales_skills","Sales & Objection Handling","single","intermediate",
    "The objection 'Thoda mahenga lag raha hai' (Seems a bit expensive) is best addressed by:",
    ["Reducing the price immediately","Agreeing it is expensive and ending the call","Explaining the value and ROI, then offering available payment options","Ignoring the objection and continuing the pitch"],
    "Explaining the value and ROI, then offering available payment options",
    10, 1
  ),
  q("OUT-S1-005","outbound","executive","compliance","Outbound Compliance","single","intermediate",
    "You are calling for a loan collection. The customer says they are at a funeral. You should:",
    ["Continue with the collection pitch — it's business","Apologise sincerely, express condolences, and ask when you may call back","Mark them as refusing to pay","Call back in one hour"],
    "Apologise sincerely, express condolences, and ask when you may call back",
    10, 1
  ),
  q("OUT-S1-006","outbound","executive","outbound_basics","Outbound Call Basics","single","basic",
    "Conversion rate in outbound means:",
    ["Number of calls made in a day","Percentage of calls that result in the desired outcome (sale, appointment, etc.)","Average call duration","Number of callbacks requested"],
    "Percentage of calls that result in the desired outcome (sale, appointment, etc.)",
    10, 1
  ),
  q("OUT-S1-007","outbound","executive","sales_skills","Sales & Objection Handling","single","intermediate",
    "A customer interested in an insurance product asks: 'Agar main cancel karna chahoon toh?' (What if I want to cancel?). You should:",
    ["Avoid the question to keep the sale","Clearly explain the cancellation and free-look period policy","Tell them cancellation is not possible","Make up a policy that sounds good"],
    "Clearly explain the cancellation and free-look period policy",
    10, 1,
    "Transparent disclosure is mandatory. Misrepresentation is a compliance violation."
  ),
  q("OUT-S1-008","outbound","executive","compliance","Outbound Compliance","single","intermediate",
    "During a sales call, the customer gives verbal consent to purchase. You must:",
    ["Immediately close the case","Record the consent clearly on the call and follow the SOP for verbal confirmation","Assume consent and process","Ask them to send a text message"],
    "Record the consent clearly on the call and follow the SOP for verbal confirmation",
    10, 1
  ),
  q("OUT-S1-009","outbound","executive","sales_skills","Sales & Objection Handling","multi","advanced",
    "Which of the following are ethical outbound sales practices? (Select all that apply)",
    ["Giving accurate product information","Pressuring customers into buying before the call ends","Respecting customer requests to not be called again","Offering only products/plans the customer actually needs","Making false claims about competitor products"],
    ["Giving accurate product information","Respecting customer requests to not be called again","Offering only products/plans the customer actually needs"],
    15, 1
  ),
  q("OUT-S1-010","outbound","executive","sales_skills","Sales & Objection Handling","text","advanced",
    "You are calling a customer to renew their expired insurance policy. They say: 'Pichli baar tumhare agent ne jo bola wo hua nahi, toh main kyon trust karun?' (Your agent didn't deliver last time, why should I trust you?) Write how you would respond to rebuild trust and move towards renewal.",
    undefined, undefined,
    15, 1,
    undefined,
    ["empathy","accountability","trust","evidence","assurance","process improvement"],
    true
  ),
];

const outboundSet2 = [
  q("OUT-S2-001","outbound","executive","outbound_basics","Outbound Call Basics","single","basic",
    "A 'right party connect' (RPC) means:",
    ["Calling at the right time of day","Successfully reaching the actual person you need to speak with","Connecting to the right department internally","Having a call without technical issues"],
    "Successfully reaching the actual person you need to speak with",
    10, 2
  ),
  q("OUT-S2-002","outbound","executive","compliance","Outbound Compliance","single","intermediate",
    "A prospect asks you to stop calling them. Under TRAI guidelines, you must:",
    ["Call one more time to confirm","Stop all future calls and register them on DNC within the required timeframe","Continue for 30 days before stopping","Only stop if they put the request in writing"],
    "Stop all future calls and register them on DNC within the required timeframe",
    10, 2
  ),
  q("OUT-S2-003","outbound","executive","sales_skills","Sales & Objection Handling","single","intermediate",
    "The best time to mention price during a sales pitch is:",
    ["Immediately to qualify the lead","After establishing value and need","Never — let the customer ask","At the very end after they agree to everything else"],
    "After establishing value and need",
    10, 2
  ),
  q("OUT-S2-004","outbound","executive","outbound_basics","Outbound Call Basics","single","basic",
    "During a product pitch, using feature-benefit selling means:",
    ["Listing all product features quickly","For each feature, explaining what benefit it gives the customer","Only mentioning the price","Comparing against competitors"],
    "For each feature, explaining what benefit it gives the customer",
    10, 2
  ),
  q("OUT-S2-005","outbound","executive","sales_skills","Sales & Objection Handling","single","intermediate",
    "A customer says 'Ghar mein pooch ke batata hoon' (I'll ask at home and let you know). A good response is:",
    ["Tell them the offer expires today to create urgency dishonestly","Accept it, confirm a specific callback time, and ask if there are any preliminary questions you can answer now","Mark them as a cold lead and stop calling","Ask them to call back when ready"],
    "Accept it, confirm a specific callback time, and ask if there are any preliminary questions you can answer now",
    10, 2
  ),
  q("OUT-S2-006","outbound","executive","compliance","Outbound Compliance","single","basic",
    "Mis-selling in financial products means:",
    ["Selling more than one product at a time","Deliberately giving incorrect or incomplete information to make a sale","Selling to the wrong age group","Making too many calls"],
    "Deliberately giving incorrect or incomplete information to make a sale",
    10, 2
  ),
  q("OUT-S2-007","outbound","executive","sales_skills","Sales & Objection Handling","single","advanced",
    "You are calling a prospect about a credit card. They say: 'Credit card se debt ho jaata hai, main nahi lena' (Credit cards lead to debt, I don't want one). This is a:",
    ["Logistical objection","Price objection","Emotional/belief objection requiring empathy and education","Fake objection — push harder"],
    "Emotional/belief objection requiring empathy and education",
    10, 2,
    "Belief-based objections need empathy first. Acknowledge, validate, then provide balanced information."
  ),
  q("OUT-S2-008","outbound","executive","compliance","Outbound Compliance","single","intermediate",
    "When calling for collections, threatening legal action that you have no authority to initiate is:",
    ["An effective motivator","A violation of SEBI/RBI fair practice guidelines and potentially criminal","Acceptable if said politely","Standard industry practice"],
    "A violation of SEBI/RBI fair practice guidelines and potentially criminal",
    10, 2
  ),
  q("OUT-S2-009","outbound","executive","sales_skills","Sales & Objection Handling","multi","advanced",
    "Which of the following indicate a strong buying signal from a prospect? (Select all that apply)",
    ["Asking about delivery timeline","Asking about payment options","Saying 'I am not interested'","Asking how others have benefited from the product","Requesting to speak to a manager to finalize"],
    ["Asking about delivery timeline","Asking about payment options","Asking how others have benefited from the product","Requesting to speak to a manager to finalize"],
    15, 2
  ),
  q("OUT-S2-010","outbound","executive","outbound_basics","Outbound Call Basics","text","advanced",
    "You have been assigned a cold-calling list of 50 contacts for a home loan product targeted at salaried professionals in Tier-2 cities. Describe how you would structure your pitch and handle the first 30 seconds of the call.",
    undefined, undefined,
    15, 2,
    undefined,
    ["opening","hook","value proposition","qualification","permission to continue","relevance"],
    true
  ),
];

const outboundSet3 = [
  q("OUT-S3-001","outbound","executive","outbound_basics","Outbound Call Basics","single","basic",
    "What does 'dialler' refer to in a BPO outbound setup?",
    ["An employee who manually dials numbers","A software system that automatically dials numbers from a list","A type of headset","The quality monitoring tool"],
    "A software system that automatically dials numbers from a list",
    10, 3
  ),
  q("OUT-S3-002","outbound","executive","compliance","Outbound Compliance","single","basic",
    "The scrubbing of a call list before a campaign means:",
    ["Cleaning the audio quality","Removing DNC-registered numbers and invalid contacts","Deleting old records from the CRM","Sorting by priority"],
    "Removing DNC-registered numbers and invalid contacts",
    10, 3
  ),
  q("OUT-S3-003","outbound","executive","sales_skills","Sales & Objection Handling","single","intermediate",
    "SPIN selling technique stands for:",
    ["Sales, Pitch, Interest, Negotiation","Situation, Problem, Implication, Need-payoff","Simple, Polished, Informative, Natural","Speed, Pace, Impact, Nurture"],
    "Situation, Problem, Implication, Need-payoff",
    10, 3
  ),
  q("OUT-S3-004","outbound","executive","outbound_basics","Outbound Call Basics","single","intermediate",
    "A customer is not responding to standard calls. Which outbound strategy is appropriate next (as per SOP)?",
    ["Call from a different undisclosed number","Send a WhatsApp message or SMS as per campaign rules","Visit their home address","Escalate to legal immediately"],
    "Send a WhatsApp message or SMS as per campaign rules",
    10, 3
  ),
  q("OUT-S3-005","outbound","executive","sales_skills","Sales & Objection Handling","single","intermediate",
    "You have made your pitch and the customer is silent for 10 seconds. You should:",
    ["Fill the silence immediately with more information","Give them space — silence often means they are considering","Assume they said no and end the call","Repeat the pitch louder"],
    "Give them space — silence often means they are considering",
    10, 3
  ),
  q("OUT-S3-006","outbound","executive","compliance","Outbound Compliance","single","intermediate",
    "Under RBI guidelines for collections, calls to a borrower should be made:",
    ["Any time, as many times as needed","Only between 8 AM and 7 PM, with reasonable frequency","Only on working days between 9-5","Unlimited times if the amount is large"],
    "Only between 8 AM and 7 PM, with reasonable frequency",
    10, 3
  ),
  q("OUT-S3-007","outbound","executive","sales_skills","Sales & Objection Handling","single","advanced",
    "The assumptive close technique involves:",
    ["Assuming the customer will say no","Assuming the sale is done and using language like 'When we process your application...'","Assuming the customer's address","Guessing the right product for the customer"],
    "Assuming the sale is done and using language like 'When we process your application...'",
    10, 3,
    "Assumptive close reduces friction by treating the positive outcome as already decided."
  ),
  q("OUT-S3-008","outbound","executive","compliance","Outbound Compliance","single","intermediate",
    "If a customer identifies themselves as a minor during a call for a financial product, you should:",
    ["Continue — age cannot be verified on a call","Immediately stop the sales pitch and follow the process for age-ineligible contacts","Ask them to get a parent's permission on the same call","Proceed if the parent is nearby"],
    "Immediately stop the sales pitch and follow the process for age-ineligible contacts",
    10, 3
  ),
  q("OUT-S3-009","outbound","executive","sales_skills","Sales & Objection Handling","multi","advanced",
    "Effective outbound call notes after a pitch should include: (Select all that apply)",
    ["Customer's stated objections","Agreed callback date and time","Your personal opinion of the customer","Next steps discussed","Whether the lead is warm/cold based on the conversation"],
    ["Customer's stated objections","Agreed callback date and time","Next steps discussed","Whether the lead is warm/cold based on the conversation"],
    15, 3
  ),
  q("OUT-S3-010","outbound","executive","sales_skills","Sales & Objection Handling","text","advanced",
    "You are collecting on a 90-day overdue personal loan EMI. The customer says they lost their job last month and will pay once they find a new one. How do you handle this conversation empathetically while still following your collections SOP?",
    undefined, undefined,
    15, 3,
    undefined,
    ["empathy","hardship","payment plan","escalation","promise-to-pay","documentation","RBI guidelines"],
    true
  ),
];

// ─── TEAM LEADER — Any Process ──────────────────────────────────────────────
// 2 sets × 12 questions = 24 questions for any/team_leader

const tlSet1 = [
  q("TL-S1-001","any","team_leader","leadership","Leadership & Team Management","single","intermediate",
    "An agent on your team has been consistently missing their AHT target. Your first step is:",
    ["Issue a written warning immediately","Have a private coaching conversation to understand the root cause","Publicly highlight the issue in the team huddle","Reassign their calls to better agents"],
    "Have a private coaching conversation to understand the root cause",
    10, 1
  ),
  q("TL-S1-002","any","team_leader","leadership","Leadership & Team Management","single","intermediate",
    "Your team's CSAT dropped from 87% to 79% this week. As team leader, you should first:",
    ["Wait to see if it improves next week","Analyse call recordings to identify patterns before the next team meeting","Blame it on call volume increase","Report it to the manager without investigating"],
    "Analyse call recordings to identify patterns before the next team meeting",
    10, 1
  ),
  q("TL-S1-003","any","team_leader","sla_ops","SLA & Operations","single","basic",
    "Service Level in call centres is typically measured as:",
    ["% of calls answered within a defined time threshold (e.g. 80% in 20 seconds)","Total calls answered in a day","Average customer satisfaction score","Revenue generated per call"],
    "% of calls answered within a defined time threshold (e.g. 80% in 20 seconds)",
    10, 1
  ),
  q("TL-S1-004","any","team_leader","sla_ops","SLA & Operations","single","intermediate",
    "During a sudden spike in call volume, your team is understaffed. Your immediate priority is:",
    ["Leave it to the WFM team entirely","Reduce break time unilaterally","Inform the WFM and operations manager immediately, engage overflow procedures, and support the team on the floor","Send all agents for training"],
    "Inform the WFM and operations manager immediately, engage overflow procedures, and support the team on the floor",
    10, 1
  ),
  q("TL-S1-005","any","team_leader","coaching","Coaching & Feedback","single","intermediate",
    "The SBI feedback model stands for:",
    ["Salary, Benefits, Incentive","Situation, Behaviour, Impact","Standard, Benchmark, Improvement","Score, Baseline, Index"],
    "Situation, Behaviour, Impact",
    10, 1
  ),
  q("TL-S1-006","any","team_leader","coaching","Coaching & Feedback","single","intermediate",
    "An agent rejects your feedback saying 'The customer was just rude, I handled it fine.' You should:",
    ["Drop the feedback to avoid conflict","Insist you are right and enforce the feedback","Acknowledge their perspective, then jointly listen to the call recording to discuss specific moments objectively","Give the feedback to another team leader"],
    "Acknowledge their perspective, then jointly listen to the call recording to discuss specific moments objectively",
    10, 1
  ),
  q("TL-S1-007","any","team_leader","escalation","Escalation Handling","single","basic",
    "When should a team leader take over a customer escalation from an agent?",
    ["Immediately when the customer sounds unhappy","Only when a customer physically threatens to come to the office","When the customer explicitly asks for a supervisor, or the agent has exhausted their options","When the call is going over 10 minutes"],
    "When the customer explicitly asks for a supervisor, or the agent has exhausted their options",
    10, 1
  ),
  q("TL-S1-008","any","team_leader","escalation","Escalation Handling","single","intermediate",
    "After handling a customer escalation, a team leader should:",
    ["Forget about it and move on","Debrief the agent on what happened and what could be done differently","Document it and share it with the whole team as a negative example","Report the agent to HR"],
    "Debrief the agent on what happened and what could be done differently",
    10, 1
  ),
  q("TL-S1-009","any","team_leader","leadership","Leadership & Team Management","multi","advanced",
    "Which of the following are responsibilities of a team leader in a BPO? (Select all that apply)",
    ["Monitoring real-time agent performance","Conducting daily team huddles","Taking all difficult calls personally","Providing individual performance feedback","Managing team attendance and shrinkage"],
    ["Monitoring real-time agent performance","Conducting daily team huddles","Providing individual performance feedback","Managing team attendance and shrinkage"],
    15, 1
  ),
  q("TL-S1-010","any","team_leader","compliance","Compliance & Policy","single","intermediate",
    "An agent on your team discloses that they accidentally emailed customer data to the wrong address. You should:",
    ["Ask them to keep it quiet","Immediately report it to the data security/compliance team per the incident response SOP","Warn them not to do it again and move on","Wait to see if the recipient contacts you"],
    "Immediately report it to the data security/compliance team per the incident response SOP",
    10, 1
  ),
  q("TL-S1-011","any","team_leader","sla_ops","SLA & Operations","single","advanced",
    "Attrition rate of 5% per month means:",
    ["5% of customers are dissatisfied","5% of your team leaves each month","5% of calls are escalated","5% SLA miss rate"],
    "5% of your team leaves each month",
    10, 1
  ),
  q("TL-S1-012","any","team_leader","coaching","Coaching & Feedback","text","advanced",
    "One of your best-performing agents has suddenly shown a 15% drop in their quality scores over two weeks. What steps would you take to identify the cause and support them?",
    undefined, undefined,
    15, 1,
    undefined,
    ["root cause","personal issues","coaching","call review","support plan","motivation"],
    true
  ),
];

const tlSet2 = [
  q("TL-S2-001","any","team_leader","leadership","Leadership & Team Management","single","intermediate",
    "A new agent is making good progress but is not confident. The best leadership approach is:",
    ["Leave them alone — confidence comes with time","Give them the hardest calls to force growth","Provide structured coaching, pair them with a buddy, and increase complexity gradually","Compare them to the top performer publicly"],
    "Provide structured coaching, pair them with a buddy, and increase complexity gradually",
    10, 2
  ),
  q("TL-S2-002","any","team_leader","sla_ops","SLA & Operations","single","basic",
    "Occupancy rate in a contact centre measures:",
    ["How full the office building is","Percentage of time agents spend on calls vs. total login time","Number of seats available","Agent attendance rate"],
    "Percentage of time agents spend on calls vs. total login time",
    10, 2
  ),
  q("TL-S2-003","any","team_leader","coaching","Coaching & Feedback","single","intermediate",
    "Positive reinforcement in a team context means:",
    ["Only praising top performers","Acknowledging and rewarding desired behaviours to encourage repetition","Ignoring negative behaviour","Making performance public at all times"],
    "Acknowledging and rewarding desired behaviours to encourage repetition",
    10, 2
  ),
  q("TL-S2-004","any","team_leader","escalation","Escalation Handling","single","advanced",
    "A customer escalation involves a potential regulatory complaint (e.g., RBI ombudsman threat). You should:",
    ["Resolve it yourself without informing management","Immediately escalate to your operations manager and compliance team","Promise the customer their complaint will be ignored","Tell the customer they have no grounds for complaint"],
    "Immediately escalate to your operations manager and compliance team",
    10, 2
  ),
  q("TL-S2-005","any","team_leader","leadership","Leadership & Team Management","single","intermediate",
    "Your team consistently achieves targets but morale is low. The most likely cause is:",
    ["Targets are too easy","Recognition and feedback quality need improvement","The team is lazy","Nothing — low morale doesn't matter if targets are met"],
    "Recognition and feedback quality need improvement",
    10, 2
  ),
  q("TL-S2-006","any","team_leader","sla_ops","SLA & Operations","single","intermediate",
    "A process has a 95% SLA at 30 seconds. What does this mean?",
    ["95% of calls must last 30 seconds","95% of calls must be answered within 30 seconds","30% of calls will be answered in 95 seconds","Agents must respond within 95% of 30 seconds"],
    "95% of calls must be answered within 30 seconds",
    10, 2
  ),
  q("TL-S2-007","any","team_leader","compliance","Compliance & Policy","single","intermediate",
    "A team leader discovers that two agents are sharing login credentials to cover breaks. This should be:",
    ["Tolerated as a practical workaround","Immediately stopped and reported — shared credentials are a security and audit violation","Only stopped if it affects call quality","Documented but allowed to continue temporarily"],
    "Immediately stopped and reported — shared credentials are a security and audit violation",
    10, 2
  ),
  q("TL-S2-008","any","team_leader","coaching","Coaching & Feedback","single","intermediate",
    "How often should a team leader ideally conduct one-on-one coaching sessions with agents?",
    ["Once a year during appraisal","Only when performance drops","Weekly or bi-weekly, with daily informal check-ins","Monthly at minimum"],
    "Weekly or bi-weekly, with daily informal check-ins",
    10, 2
  ),
  q("TL-S2-009","any","team_leader","leadership","Leadership & Team Management","multi","advanced",
    "When preparing a daily floor performance report, which metrics should a TL include? (Select all that apply)",
    ["Team AHT vs target","Team CSAT score","Each agent's home address","Attendance and shrinkage","FCR rate","Top personal achievements unrelated to work"],
    ["Team AHT vs target","Team CSAT score","Attendance and shrinkage","FCR rate"],
    15, 2
  ),
  q("TL-S2-010","any","team_leader","sla_ops","SLA & Operations","single","advanced",
    "During a process audit, it is found that your team's ACW time is 40% higher than the benchmark. The first investigative step is:",
    ["Reduce ACW time allowance immediately","Review agent call notes to assess if the complexity of ACW work justifies the time","Mark all agents for a PIP","Change the benchmark to match your team's average"],
    "Review agent call notes to assess if the complexity of ACW work justifies the time",
    10, 2
  ),
  q("TL-S2-011","any","team_leader","escalation","Escalation Handling","single","advanced",
    "An agent tells you they are being verbally harassed by a senior colleague. As TL, your first responsibility is:",
    ["Ask the agent to handle it themselves","Mediate informally without documentation","Take it seriously, document it, and report to HR as per the POSH/workplace policy","Wait for HR to notice on their own"],
    "Take it seriously, document it, and report to HR as per the POSH/workplace policy",
    10, 2
  ),
  q("TL-S2-012","any","team_leader","coaching","Coaching & Feedback","text","advanced",
    "You have an agent who performs very well on technical knowledge but consistently gets low scores on 'empathy' in QA audits. Design a 2-week coaching plan to improve this.",
    undefined, undefined,
    15, 2,
    undefined,
    ["empathy","soft skills","role play","call listening","feedback","measurement","target"],
    true
  ),
];

// ─── QUALITY AUDITOR ────────────────────────────────────────────────────────
// 2 sets × 10 questions = 20 questions for any/quality_auditor

const qaSet1 = [
  q("QA-S1-001","any","quality_auditor","audit_basics","QA Audit Fundamentals","single","basic",
    "The primary purpose of a Quality Audit in a BPO is:",
    ["To penalise agents for poor performance","To evaluate call/work quality against defined standards and drive improvement","To monitor agent break times","To report CSAT scores to clients"],
    "To evaluate call/work quality against defined standards and drive improvement",
    10, 1
  ),
  q("QA-S1-002","any","quality_auditor","audit_basics","QA Audit Fundamentals","single","basic",
    "A QA scorecard in a call centre typically covers:",
    ["Agent's personal background","Greeting, compliance, process adherence, resolution, soft skills, and closing","Only the call duration","Number of calls taken"],
    "Greeting, compliance, process adherence, resolution, soft skills, and closing",
    10, 1
  ),
  q("QA-S1-003","any","quality_auditor","calibration","QA Calibration & Standards","single","intermediate",
    "Calibration sessions in QA are conducted to:",
    ["Test new equipment","Ensure all auditors score the same call consistently to reduce scoring bias","Reduce the number of audits required","Discuss client feedback only"],
    "Ensure all auditors score the same call consistently to reduce scoring bias",
    10, 1
  ),
  q("QA-S1-004","any","quality_auditor","compliance_audit","Compliance Auditing","single","intermediate",
    "A 'fatal error' in a QA audit means:",
    ["The agent ended the call rudely","A violation so serious it results in a zero score regardless of other performance","An error that causes a system crash","A missed greeting"],
    "A violation so serious it results in a zero score regardless of other performance",
    10, 1,
    "Fatal errors typically include compliance breaches, mis-selling, PII disclosure, or security violations."
  ),
  q("QA-S1-005","any","quality_auditor","feedback","QA Feedback & Coaching","single","intermediate",
    "When sharing QA feedback with an agent, the best approach is:",
    ["Email the score without explanation","Read out all errors in a public setting","Conduct a private session using specific call examples, focusing on behaviour, not personality","Give only positive feedback to maintain morale"],
    "Conduct a private session using specific call examples, focusing on behaviour, not personality",
    10, 1
  ),
  q("QA-S1-006","any","quality_auditor","audit_basics","QA Audit Fundamentals","single","intermediate",
    "Random sampling in QA means:",
    ["Auditing only the worst-performing agents","Selecting calls for audit without bias so all agents and call types are represented","Only auditing new agents","Auditing only complaint calls"],
    "Selecting calls for audit without bias so all agents and call types are represented",
    10, 1
  ),
  q("QA-S1-007","any","quality_auditor","compliance_audit","Compliance Auditing","single","intermediate",
    "You audit a call where an agent gave incorrect product information but the customer was happy and rated the interaction 5 stars. The QA score should:",
    ["Be full marks — customer was satisfied","Reflect the incorrect information as a process/compliance failure regardless of CSAT","Be adjusted based on the CSAT score","Be skipped since the customer is satisfied"],
    "Reflect the incorrect information as a process/compliance failure regardless of CSAT",
    10, 1,
    "QA and CSAT measure different things. CSAT reflects perception; QA measures compliance and correctness."
  ),
  q("QA-S1-008","any","quality_auditor","calibration","QA Calibration & Standards","multi","intermediate",
    "Which of the following are best practices for a QA auditor? (Select all that apply)",
    ["Audit using a standardised scorecard","Apply personal preferences when scoring","Maintain audit records for dispute resolution","Provide actionable feedback with call timestamps","Score based on the agent's overall track record, not the specific call"],
    ["Audit using a standardised scorecard","Maintain audit records for dispute resolution","Provide actionable feedback with call timestamps"],
    15, 1
  ),
  q("QA-S1-009","any","quality_auditor","compliance_audit","Compliance Auditing","single","advanced",
    "During a backoffice document audit, you find that an agent processed a document where the customer's signature was missing. This should be flagged as:",
    ["Minor — signatures are not always required","A process violation — incomplete documents should not be processed","Acceptable if other details match","A system error, not the agent's fault"],
    "A process violation — incomplete documents should not be processed",
    10, 1
  ),
  q("QA-S1-010","any","quality_auditor","feedback","QA Feedback & Coaching","text","advanced",
    "You have audited 10 calls for an agent this week. 7 out of 10 show the same issue: the agent does not confirm the customer's understanding at the end of the call. Write a structured feedback note you would use in the coaching session.",
    undefined, undefined,
    15, 1,
    undefined,
    ["pattern","example","impact","SOP","improvement","target","follow-up"],
    true
  ),
];

const qaSet2 = [
  q("QA-S2-001","any","quality_auditor","audit_basics","QA Audit Fundamentals","single","basic",
    "DSAT stands for:",
    ["Data Security Audit Tracker","Dissatisfied Customer Score","Daily Service Accuracy Test","Document Submission and Tracking"],
    "Dissatisfied Customer Score",
    10, 2,
    "DSAT = Detractor SAT. It measures the proportion of dissatisfied customers from CSAT surveys."
  ),
  q("QA-S2-002","any","quality_auditor","compliance_audit","Compliance Auditing","single","intermediate",
    "When auditing a backoffice data extraction record, you find the agent entered an account number with one digit different from the source document. This is:",
    ["Acceptable — single digit errors are common","A critical data accuracy error that must be flagged and corrected","Minor and can be noted in the next review","Not the auditor's responsibility"],
    "A critical data accuracy error that must be flagged and corrected",
    10, 2
  ),
  q("QA-S2-003","any","quality_auditor","calibration","QA Calibration & Standards","single","intermediate",
    "Inter-rater reliability in QA calibration means:",
    ["Multiple auditors have similar ratings for the same call","All agents score similarly on the same call","Clients agree with the QA score","The QA tool auto-scores correctly"],
    "Multiple auditors have similar ratings for the same call",
    10, 2
  ),
  q("QA-S2-004","any","quality_auditor","feedback","QA Feedback & Coaching","single","intermediate",
    "An agent disputes your QA score saying 'The customer didn't complain.' The correct response is:",
    ["Revise the score if the agent is persistent","Explain that QA measures process adherence and compliance, not just customer reaction","Agree and lower the error weight","Escalate to the client"],
    "Explain that QA measures process adherence and compliance, not just customer reaction",
    10, 2
  ),
  q("QA-S2-005","any","quality_auditor","audit_basics","QA Audit Fundamentals","single","intermediate",
    "A QA trend report shows that 60% of this month's errors are in the 'closing' section. As QA lead, you should:",
    ["Report to management and wait for instructions","Flag individual agents only","Recommend a targeted refresher for all agents on proper closing procedures and analyse root cause","Increase the weight of closing in the scorecard immediately"],
    "Recommend a targeted refresher for all agents on proper closing procedures and analyse root cause",
    10, 2
  ),
  q("QA-S2-006","any","quality_auditor","compliance_audit","Compliance Auditing","single","intermediate",
    "During a compliance audit, you find that an agent did not read the mandatory disclaimer during a financial product call. This is:",
    ["Minor if the rest of the call was good","A regulatory compliance failure that must be scored as a fatal error","Acceptable if the customer didn't ask about disclaimers","Not the agent's fault — it is a script problem"],
    "A regulatory compliance failure that must be scored as a fatal error",
    10, 2
  ),
  q("QA-S2-007","any","quality_auditor","audit_basics","QA Audit Fundamentals","single","advanced",
    "Targeted auditing (focusing on specific agents/call types rather than random sampling) is useful for:",
    ["Replacing regular random sampling","Investigating specific issue patterns, new agents, or escalation trends alongside regular sampling","Reducing the total number of audits","Auditing only complaint calls"],
    "Investigating specific issue patterns, new agents, or escalation trends alongside regular sampling",
    10, 2
  ),
  q("QA-S2-008","any","quality_auditor","compliance_audit","Compliance Auditing","multi","advanced",
    "Which of the following are examples of fatal errors that would result in a zero QA score? (Select all that apply)",
    ["Not thanking the customer at the end","Sharing customer account details without verification","Mis-selling a financial product by giving false information","Taking 2 seconds longer than AHT benchmark","Calling a customer by the wrong name","Processing a transaction the customer did not authorise"],
    ["Sharing customer account details without verification","Mis-selling a financial product by giving false information","Processing a transaction the customer did not authorise"],
    15, 2
  ),
  q("QA-S2-009","any","quality_auditor","calibration","QA Calibration & Standards","single","advanced",
    "You notice that two auditors consistently score 10+ points differently for the same agents. This indicates:",
    ["One auditor is clearly better","A need for urgent calibration and scorecard anchor review","Normal variation and no action is needed","Management should override one auditor's scores"],
    "A need for urgent calibration and scorecard anchor review",
    10, 2
  ),
  q("QA-S2-010","any","quality_auditor","feedback","QA Feedback & Coaching","text","advanced",
    "Your QA data shows that error rates are higher on Monday mornings and Friday afternoons. How would you investigate and address this pattern at the process level?",
    undefined, undefined,
    15, 2,
    undefined,
    ["pattern analysis","root cause","staffing","scheduling","coaching","process change","trend"],
    true
  ),
];

// ─── Assemble full bank ─────────────────────────────────────────────────────

export const ALL_QUESTIONS = [
  ...backofficeSet1,
  ...backofficeSet2,
  ...backofficeSet3,
  ...inboundSet1,
  ...inboundSet2,
  ...inboundSet3,
  ...outboundSet1,
  ...outboundSet2,
  ...outboundSet3,
  ...tlSet1,
  ...tlSet2,
  ...qaSet1,
  ...qaSet2,
];

export async function seedQuestionBank(createdBy: string | null = null) {
  console.log(`Seeding ${ALL_QUESTIONS.length} questions...`);
  const result = await importQuestions(ALL_QUESTIONS, createdBy);
  console.log(`Done. Imported: ${result.imported}, Skipped: ${result.skipped}`);
  if (result.errors.length) {
    console.error("Errors:", result.errors);
  }
  return result;
}
