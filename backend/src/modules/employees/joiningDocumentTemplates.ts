/**
 * Joining-document templates: approved policy text plus the DOCX builder.
 *
 * The fill engine (universalDigitalFormFill.service.ts) already knows these
 * documents: DEFAULT_FIELDS_BY_DOCUMENT lists the exact field keys per document
 * code, and renderPlaceholderDocx substitutes `{{token}}` occurrences. Only the
 * template files themselves were missing, which is why five of the seven
 * mandatory documents produced a placeholder stamped
 * "DRAFT - TEMPLATE NOT CONFIGURED".
 *
 * The definitions live here rather than in the build script so the tests can
 * verify them without depending on generated files, which are gitignored.
 */
import PizZip from "pizzip";

/** Minimal OOXML escaping for text placed into <w:t>. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Block = { text: string; style?: "title" | "heading" | "body" | "bullet" | "spacer" };

function paragraph(block: Block): string {
  const { text, style = "body" } = block;
  if (style === "spacer") return `<w:p/>`;
  const bold = style === "title" || style === "heading" ? `<w:b/>` : "";
  const size =
    style === "title" ? `<w:sz w:val="30"/><w:szCs w:val="30"/>` :
    style === "heading" ? `<w:sz w:val="24"/><w:szCs w:val="24"/>` :
    `<w:sz w:val="20"/><w:szCs w:val="20"/>`;
  const align = style === "title" ? `<w:jc w:val="center"/>` : "";
  const indent = style === "bullet" ? `<w:ind w:left="360" w:hanging="180"/>` : "";
  const spacing = `<w:spacing w:before="${style === "heading" ? 200 : 60}" w:after="60"/>`;
  return (
    `<w:p><w:pPr>${spacing}${align}${indent}</w:pPr>` +
    `<w:r><w:rPr>${bold}${size}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
  );
}

function buildDocx(blocks: Block[]): Buffer {
  const body = blocks.map(paragraph).join("");
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const zip = new PizZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.folder("_rels")!.file(".rels", rels);
  zip.folder("word")!.file("document.xml", documentXml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

const t = (text: string): Block => ({ text, style: "title" });
const h = (text: string): Block => ({ text, style: "heading" });
const p = (text: string): Block => ({ text, style: "body" });
const li = (text: string): Block => ({ text, style: "bullet" });
const sp = (): Block => ({ text: "", style: "spacer" });

// ── NDA & Confidentiality (includes the Equal Opportunity / surveillance
//    acknowledgement, whose surveillance_* fields the engine already expects
//    under this document code) ───────────────────────────────────────────────
const NDA: Block[] = [
  t("Confidentiality and Non-Disclosure Agreement"),
  p("Mas Callnet India Pvt. Ltd. | Private & Confidential"),
  sp(),
  p("I acknowledge that as part of my employment with Mas Callnet India Pvt. Ltd. I will be given access to information that is of a personal and/or proprietary nature, for example: personal information related to analysts, such as names, email addresses, salaries, academic and employment information, and/or sensitive information related to clients or other financial information (“Confidential Information”), for the purpose of fulfilling employment obligations."),
  p("I therefore agree:"),
  li("1. To hold all confidential information in trust and strict confidence and agree that it shall be used only for the purposes required to fulfill employment obligations, and shall not be used for any other purpose, or disclosed to any third party."),
  li("2. To keep any confidential information in my control or possession in a physically secure location to which only I and other persons who have signed a confidentiality agreement with Mas Callnet will have access."),
  li("3. I would ensure not to remove any confidential information unless, and to the extent that, I obtain written pre-authorizations. I agree to take all necessary steps to keep such confidential information secure and to protect it from unauthorized use, reproduction or disclosure."),
  li("4. To maintain the absolute confidentiality of personal, confidential and proprietary information in recognition of the privacy and proprietary rights of others at all times, and in both professional and social situations."),
  li("5. To comply with all privacy laws and regulations which apply to the collection, use and disclosure of personal information."),
  li("6. At the conclusion of any discussions, or upon demand by management, to return all confidential information, including prototypes, code, written notes, photographs, sketches, models, memoranda or notes taken, to the Mas Callnet concerns responsible (manager/Director)."),
  li("7. To keep all User IDs and passwords (CRM / LMS / Email) issued to me strictly confidential and not share them with any other analyst or anybody else. I can be held responsible in case of any misuse leading to disciplinary action under the code of conduct."),
  li("8. All equipment, notebooks, documents, memoranda, reports, files, samples, books, correspondence lists or other written and graphic records, including tangible or intangible computer programs, records and data relating to the business of the Company that I may prepare, use, construct, observe, possess or control shall be and shall remain the Company's sole property."),
  li("9. To return any property belonging to the company that was handed over to me for delivering my duties, e.g. computers, laptops, dongles."),
  li("10. To rightfully return all devices including mobile phones, data cards, SIM cards and Wi-Fi dongles when the company asks for their return."),
  li("11. To dedicate my full attention to my job duties during working hours."),
  li("12. To adhere to break and attendance schedules agreed upon with my manager."),
  li("13. All Mas Callnet or client-provided assets must only be used for executing the operations processes that analysts normally undertake, in the office or remotely, and not for any personal or other use."),
  li("14. Analysts must not circumvent or attempt to circumvent any security measures implemented on Mas Callnet or client-provided assets."),
  li("15. Analysts must not download, install, or attempt to install any unauthorized software on Mas Callnet or client-provided assets, including malware that could capture screen contents and/or keystrokes."),
  sp(),
  h("Data Confidentiality and Privacy"),
  li("1. Analysts must not take screenshots, photographs, videos or written notes of screen contents, or make audio recordings of any business conversations. Analysts must not disclose or discuss any confidential, sensitive or client-related information with third parties (such as friends or family members)."),
  li("2. Analysts must not download, install, or attempt to install any unauthorized software on Mas Callnet or client-provided assets, including malware that could capture screen contents and/or keystrokes."),
  sp(),
  h("Agreement"),
  p("I, {{nda_employee_name}}, hereby undertake that except with the prior written consent of Mas Callnet India Pvt. Ltd., I shall not disclose to any third party any information that I may acquire in relation to any contract, whether in writing or orally, including but not limited to documents, material, specifications, drawings, reports, trade secrets, and client and internal data (known collectively as “Confidential Information”)."),
  p("I also agree to ensure compliance with the company's information security and asset ownership requirements and would be responsible for any damage or loss, leading to disciplinary action under the code of conduct policy."),
  p("I understand that a breach of confidentiality or misuse of information could result in disciplinary action and can result in termination of employment."),
  p("I further certify that I have gone through the company policies and would abide by the same. I hereby acknowledge updating myself on the company processes, policies and procedures."),
  sp(),
  p("Name of the Analyst: {{nda_employee_name}}"),
  p("Employee Code: {{employee_code}}          Date of Joining: {{date_of_joining}}"),
  p("Branch: {{branch}}          Process: {{process}}"),
  p("Signature: ______________________          Date: {{nda_signature_date}}"),
  sp(),
  t("Mas Callnet India Pvt. Ltd. – An Equal Opportunity Employer"),
  p("At Mas Callnet we don't just stop at accepting difference — we celebrate it, support it, and thrive on it for the benefit of our employees. We do not discriminate in employment on the basis of race, colour, religion, sex, marital status, disability, genetic information or any other protected characteristic."),
  p("We take a zero-tolerance approach to bribery and corruption and are committed to acting professionally, fairly and with integrity in all our business dealings and relationships wherever we operate, and to implementing and enforcing effective systems to counter bribery and corruption."),
  p("Mas Callnet India Pvt. Ltd. and its employees will never ask for or accept money, gifts or anything which can be deemed a bribe against offering an opportunity to work with us or during the course of employment with us, and we request that you bring to our attention anybody who claims to be doing so."),
  p("Contact: 7290093915          Email: rajesh.ramachandran@teammas.in"),
  sp(),
  p("I have read and understood the above-mentioned policies of Mas Callnet India Pvt. Ltd."),
  p("Name of the candidate: {{surveillance_candidate_name}}          HR Person name: {{surveillance_hr_name}}"),
  p("Signature: ______________________          Date: {{surveillance_signature_date}}"),
];

// ── IT Compliance ──────────────────────────────────────────────────────────
const IT: Block[] = [
  t("IT Compliance Agreement"),
  h("Introduction"),
  p("Mas Callnet as an organization has its own IT infrastructure which provides services to its native companies. As an employee of TEAMMAS, every employee must comply with the same. IT-provided assets are fully compliant with MISP (Mas Callnet Information Security Policy)."),
  p("You will be the asset owner of your laptop, desktop, server, data card etc. The asset owner is accountable for the comprehensive protection of the information assets owned by him/her. Any violation of the MISP, the IT Act 2000 (later amendments 2006 and 2008) or the Copyright Act 1957 (later amendments 1994 and 1999) will be treated under the code of conduct, and may be referred to HR, Legal and disciplinary action against the responsible employee."),
  h("Email Policy Controls"),
  li("1. The company mailing system must not be used for any fraud, as per IT Act 2000 AM 2008 section 66A."),
  li("2. Hacking, or dishonestly receiving or retaining any stolen computer resource or communication device knowing or having reason to believe it to be stolen, will be treated under the code of conduct as per IT Act 2000 AM 2008 section 66B."),
  li("3. Theft of an electronic signature, password or any other unique identification feature of any other person will be treated under the code of conduct as per IT Act 2000 AM 2008 section 66C."),
  li("4. All messages generated by the email system are the property of TEAMMAS. The email system shall be used for business purposes only; reasonable personal use is allowed so long as it does not damage the information and/or reputation of TEAMMAS (IT Act 2000 AM 2008 section 66D)."),
  li("5. Charitable fundraising campaigns, political advocacy, private business activities, personal amusement, advertisement, public representation and entertainment use of the email system are prohibited."),
  li("6. Email containing disruptive or offensive messages — including offensive comments about race, gender, hair colour, disability, age, sexual orientation, harassment, pornography, religious beliefs and practice, political beliefs or national origin — must not be created or distributed (IT Act 2000 AM 2008 sections 67A, 67B)."),
  li("7. Forwarding official email to personal accounts such as Gmail, Yahoo Mail or Hotmail is prohibited."),
  li("8. Mass mailing, cheating, credit card fraud and money laundering are offences under IT Act 2000 AM 2008 Chapter 11 and are strictly prohibited."),
  li("9. Copying and sharing company data must not be done at any time. Even an attempt to do so will be penalised."),
  li("10. Attempting to access websites and pages other than those allowed is prohibited."),
  li("11. Sharing of usernames and passwords must not be done."),
  li("12. Accessing company URLs and sites on systems other than those provided by the company is not allowed. No production URL or website should be accessed from a mobile phone; attempting to do so will invite the strictest disciplinary action."),
  h("Software Policy Controls"),
  li("1. Software that is not listed or approved must not be installed, and must not be found during an audit of the asset owner. Pirated software and applications must not be kept or installed on any system."),
  li("2. Software provided by TEAMMAS is the sole property of the organization and is not for the personal use of any employee."),
  li("3. Under sections 13, 14 and 16 of the Copyright Act 1957, it is illegal to make or distribute copies of any copyrighted TEAMMAS software without proper or specific authorization."),
  h("Permitted Use of Internet"),
  li("1. Without prior written permission from the Company, the Company's computer network may not be used to disseminate, view or store commercial or personal advertisements, solicitations, promotions, destructive code (e.g. viruses, self-replicating programs), political material, pornographic text or images, or any other unauthorized material."),
  li("2. To ensure security and avoid the spread of viruses, users accessing the internet through a computer attached to the Company's network must do so through an approved internet firewall or other security device. Bypassing the Company's network security by accessing the internet directly by modem or other means is strictly prohibited unless the computer being used is not connected to the Company's network."),
  p("You should abide by all IT policies of the company in force from time to time, and the company shall have the right to vary or modify any or all of the above controls, which shall be binding on you."),
  sp(),
  h("Agreement"),
  li("1. I have read the above-mentioned MISP controls, written under agreement."),
  li("2. I agree to comply with the provisions of the TEAMMAS IT compliance agreement."),
  li("3. If I am found responsible for any such offence listed above, the code of conduct may be invoked for termination of my services or regulatory action."),
  sp(),
  p("Name: {{it_employee_name}}          Employee Code: {{employee_code}}"),
  p("Branch: {{branch}}          Date of Joining: {{date_of_joining}}"),
  p("Signature: ______________________          Date: {{it_signature_date}}"),
];

// ── BAMS declaration ───────────────────────────────────────────────────────
const BAMS: Block[] = [
  t("Declaration: Biometric Attendance Management System (BAMS)"),
  sp(),
  p("I hereby declare that I will follow the Biometric Attendance Management System religiously, and I am completely aware that Biometric Attendance Management is the only criterion for tracking my attendance. I understand the importance of the same."),
  p("I am registered for BAMS."),
  p("In case I forget to mark my attendance through BAMS, I will report the same to my manager in a timely manner for his/her approval as per procedure."),
  p("I am aware that my log-in hours requirement is as mentioned below."),
  p("If I forget to punch in or punch out, an approval from my HOD is required to validate the attendance for the day. I also understand that I can take only one exception per month."),
  sp(),
  p("Log-in hours = 8 hours (system log-in) + 1 hour (break)"),
  sp(),
  p("In case the log-in hours requirement is not met as per the above declaration, I will be responsible for any salary deduction against the same."),
  sp(),
  p("Regards,"),
  p("Name: {{bams_employee_name}}"),
  p("Employee Code: {{bams_employee_code}}"),
  p("Date of Joining: {{bams_date_of_joining}}"),
  p("Branch: {{branch}}          Process: {{process}}"),
  p("Signature: ______________________          Date: {{current_date}}"),
];

// ── Personal information processing consent ────────────────────────────────
const PI: Block[] = [
  t("Employee Consent Form for Personal Information Processing"),
  sp(),
  p("Employee Name: {{pi_employee_name}}"),
  sp(),
  p("I, {{pi_employee_name}}, the undersigned, hereby provide my consent to Mas Callnet India Pvt. Ltd. (“the Company”) for the processing and retention of my personal information and data — including but not limited to my name, residence address, educational qualification details, Aadhaar card details, PAN card details, bank account details and previous employment details — for the purpose of completing joining formalities and ongoing employment-related processes."),
  p("I understand and agree that the Company will conduct background verification of my personal information through a third-party background verification agency. I authorize the Company to share my personal details with this third-party agency for the sole purpose of conducting background verification."),
  p("I further acknowledge that the Company is required to retain employee records as per Section 13A of the Wages Act, which mandates the retention of employee records for three years after the last payroll entry. Therefore, I consent to the Company retaining my personal information and data for a period of three years from my last payroll entry, or until the cessation of my employment with the Company, whichever is later."),
  p("Furthermore, I am aware that, in accordance with applicable data protection laws and regulations, the Company is committed to protecting the privacy and security of my personal information. The Company will not disclose my personal information to any unauthorized third party without my explicit consent, except as required by law."),
  p("I understand that I have the right to withdraw this consent at any time by providing written notice to the Company's Human Resources department. Upon such withdrawal, the Company will cease processing my personal information, subject to any legal obligations that may require its retention."),
  p("I hereby affirm that I have read and understood the terms and conditions of this consent form, and I willingly provide my consent for the processing and retention of my personal information as described herein, including the background verification conducted by a third-party agency."),
  p("Note: Please ensure that you have reviewed and understood the contents of this consent form before signing it. If you have any questions or concerns, please contact the Company's Human Resources department for clarification before providing your consent."),
  sp(),
  p("Employee Name: {{pi_employee_name}}          Employee Code: {{employee_code}}"),
  p("Mobile: {{mobile}}          Email: {{email}}"),
  p("Employee Signature: ______________________          Date: {{pi_signature_date}}"),
];

// ── Zero tolerance policy acknowledgement ──────────────────────────────────
const ZERO: Block[] = [
  t("Zero Tolerance Policy"),
  h("1. Introduction"),
  p("At Mas Callnet India Pvt. Ltd., we are committed to maintaining a safe, respectful and professional environment for all employees, contractors and partners. This Zero Tolerance Policy outlines unacceptable behaviours that will not be tolerated within our organization. Any violation of this policy will result in disciplinary action, including possible termination of employment and legal action."),
  h("2. Scope"),
  p("This policy applies to all employees, contractors, vendors and any individuals associated with Mas Callnet India Pvt. Ltd., whether on-site or off-site, including remote work environments. It covers interactions that occur in person, electronically, or through any other communication channel."),
  h("3. Unacceptable Behaviours"),
  p("Mas Callnet India Pvt. Ltd. has a zero-tolerance approach to any behaviour that undermines the values and safety of our organization. The following are strictly prohibited:"),
  li("a. Harassment and discrimination based on race, gender, age, religion, disability, sexual orientation or any other protected characteristic — including inappropriate jokes, derogatory remarks, unwanted physical contact, or any behaviour creating a hostile work environment."),
  li("b. Violence and threats — physical violence, threats, intimidation or bullying, including verbal threats, physical altercations or aggressive behaviour that endangers others."),
  li("c. Substance abuse — possession, distribution, or being under the influence of alcohol, illegal drugs, or misuse of prescription medication on company premises."),
  li("d. Fraud and dishonesty — fraudulent activity, theft, falsifying documents, embezzlement or stealing company property."),
  li("e. Data security and privacy violations — unauthorized access, sharing or misuse of sensitive company or client data, data breaches, or hacking attempts."),
  li("f. Failure to respect data privacy — unauthorized disclosure of personal information, improper handling of data, or failing to follow data protection protocols."),
  li("g. Sharing company and client data on social media — posting client details, approaching clients through personal channels, or any action that compromises client confidentiality."),
  li("h. Sexual harassment — all forms are strictly prohibited in alignment with our Prevention of Sexual Harassment (POSH) policy, including unwelcome advances, inappropriate comments, or any behaviour creating a sexually hostile work environment."),
  li("i. Intrusion into restricted areas — entering or attempting to enter restricted or unauthorized areas such as server rooms or electrical rooms without permission, tampering with security systems, or violating access control policies."),
  li("j. Non-compliance with company policies — ignoring safety protocols, violating company rules, or engaging in unethical behaviour."),
  li("k. Unauthorized access to URLs and CRM systems — accessing company CRM, web links or URLs on personal phones or laptops, or attempting to log into company portals on non-company devices."),
  li("l. Unauthorized downloads on company systems — installing unauthorized software, downloading non-work-related files, or engaging in activity that compromises system security."),
  li("m. Accessing non-work-related URLs and proxy servers — visiting social media or streaming platforms, or using proxy servers to bypass security protocols during work hours."),
  li("n. Damaging company assets — intentional or negligent damage to company property, including office equipment, furniture and technology."),
  li("o. Sharing login credentials — employees must not share their login credentials with anyone under any circumstances."),
  li("p. Bribery — offering, giving, receiving or soliciting any form of bribe is strictly prohibited."),
  li("q. Misuse of internet and email for personal gain — using company internet or email to conduct personal business, or engaging in offensive, threatening, discriminatory, defamatory, obscene, harassing or illegal activity."),
  h("4. Reporting Procedures"),
  p("Mas Callnet India Pvt. Ltd. encourages employees to report any violation of this policy through our confidential reporting channels. All reports will be handled with the utmost confidentiality and protection against retaliation. Reporting methods: HR contacts (direct communication with Human Resources personnel), email care@teammas.in, or the WhatsApp channel 2gthr@Mas."),
  h("5. Investigation Process"),
  p("All reports will be investigated thoroughly and objectively: initial assessment of severity and nature; confidential investigation including interviews and evidence gathering; and resolution through appropriate disciplinary action based on the findings."),
  h("6. Consequences of Violations"),
  p("Violations will lead to immediate suspension or termination. In cases of severe misconduct, the company may involve legal authorities for further action."),
  h("7. Employee Responsibilities"),
  p("All employees must familiarise themselves with this policy and its implications, actively report any witnessed violations, and cooperate with investigations by providing truthful and relevant information."),
  h("8. Management Responsibilities"),
  p("Managers and supervisors must enforce the policy consistently across all departments, provide ongoing training about acceptable behaviour and policy updates, and encourage a culture of respect and open communication."),
  h("9. Policy Review and Updates"),
  p("Mas Callnet India Pvt. Ltd. is committed to regularly reviewing and updating this policy to ensure its relevance and effectiveness, and encourages employee feedback for continuous improvement and alignment with industry standards."),
  h("10. Acknowledgment"),
  p("All employees are required to sign an acknowledgment indicating they have read, understood and agreed to comply with the Mas Callnet India Pvt. Ltd. Zero Tolerance Policy."),
  sp(),
  h("Acknowledgment"),
  p("I, {{zero_tolerance_employee_name}}, have read and understood the Mas Callnet India Pvt. Ltd. Zero Tolerance Policy and agree to comply with its terms and conditions."),
  p("Employee Code: {{employee_code}}          Branch: {{branch}}          Date of Joining: {{date_of_joining}}"),
  p("Signature: ______________________          Date: {{zero_tolerance_signature_date}}"),
];

const TEMPLATES: Array<{ code: string; blocks: Block[] }> = [
  { code: "NDA_CONFIDENTIALITY", blocks: NDA },
  { code: "IT_COMPLIANCE", blocks: IT },
  { code: "BAMS_DECLARATION", blocks: BAMS },
  { code: "PI_PROCESSING_CONSENT", blocks: PI },
  { code: "ZERO_TOLERANCE_ACK", blocks: ZERO },
];


export const TEMPLATE_DEFINITIONS = TEMPLATES;

/** Builds one template as a DOCX buffer. */
export function buildTemplateDocx(code: string): Buffer {
  const found = TEMPLATES.find((entry) => entry.code === code);
  if (!found) throw new Error(`No template definition for ${code}`);
  return buildDocx(found.blocks);
}

/** Placeholder tokens present in a built template, for validation. */
export function templateTokens(code: string): string[] {
  const xml = new PizZip(buildTemplateDocx(code)).file("word/document.xml")!.asText();
  return [...new Set([...xml.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1].trim()))].sort();
}
