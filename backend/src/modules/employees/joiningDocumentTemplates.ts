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
  p("I, {{nda_employee_name}}, {{designation}}, do hereby undertake that except with the prior written consent of Mas Callnet India Pvt. Ltd., I shall not disclose to any third party any information that I may acquire in relation to any contract, whether in writing or orally, including but not limited to documents, material, specifications, drawings, reports, trade secrets, and client and internal data (known collectively as “Confidential Information”)."),
  p("I also agree to ensure compliance with the company's information security and asset ownership requirements and would be responsible for any damage or loss, leading to disciplinary action under the code of conduct policy."),
  p("I understand that a breach of confidentiality or misuse of information could result in disciplinary action and can result in termination of employment."),
  p("I further certify that I have gone through the company policies and would abide by the same. I hereby acknowledge updating myself on the company processes, policies and procedures."),
  sp(),
  // Signature block reproduced from the approved form, which asks for
  // department as well as branch and process.
  p("Signature: ______________________          Date: {{nda_signature_date}}"),
  p("Name of the Employee: {{nda_employee_name}}          Branch: {{branch}}"),
  p("Designation: {{designation}}          Department: {{department}}"),
  p("Process: {{process}}          Employee Code: {{employee_code}}"),
  p("Date of Joining: {{date_of_joining}}"),
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
  p("Branch: {{branch}}          Process: {{process}}"),
  p("Date of Joining: {{date_of_joining}}"),
  p("Signature: ______________________          Date: {{it_signature_date}}"),
];

// ── BAMS declaration ───────────────────────────────────────────────────────
const BAMS: Block[] = [
  t("Declaration: Attendance Management"),
  sp(),
  p("Attendance system applicable to me: {{attendance_system_name}}"),
  p("I hereby declare that I will follow the attendance system applicable to my role religiously, and I am completely aware that {{attendance_criterion}}. I understand the importance of the same."),
  p("I am registered for the Biometric Attendance Management System (BAMS)."),
  p("In case I forget to mark my attendance, I will report the same to my manager in a timely manner for his/her approval as per procedure."),
  p("I am aware that my log-in hours requirement is as mentioned below."),
  p("If I forget to punch in or punch out, an approval from my HOD is required to validate the attendance for the day. I also understand that I can take only one exception per month."),
  sp(),
  p("{{attendance_login_hours}}"),
  sp(),
  p("In case the log-in hours requirement is not met as per the above declaration, I will be responsible for any salary deduction against the same."),
  sp(),
  p("Regards,"),
  p("Name: {{bams_employee_name}}"),
  p("Employee Code: {{bams_employee_code}}"),
  p("Date of Joining: {{bams_date_of_joining}}"),
  p("Designation: {{designation}}          Department: {{department}}"),
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
  p("Process: {{process}}"),
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
  p("Employee Code: {{employee_code}}          Branch: {{branch}}          Process: {{process}}"),
  p("Date of Joining: {{date_of_joining}}"),
  p("Signature: ______________________          Date: {{zero_tolerance_signature_date}}"),
];

/**
 * Employment agreement, transcribed from "Employment Contract-Mas (CF).pdf".
 *
 * The clause text is reproduced as approved; only the blanks the original left
 * for handwriting carry placeholders. The remuneration figure in the Appendix
 * is deliberately NOT auto-filled: this document is emailed to the joiner, and
 * pulling a salary into it would put pay data into an outbound attachment. HR
 * confirms the amount, the same way surveillance_hr_name is handled.
 */
const CONTRACT: Block[] = [
  t("AGREEMENT"),
  p("This Agreement is made and entered into at New Delhi on {{current_date}} by and between:"),
  p("Mas Callnet India (P) Ltd, a company registered under the Companies Act, 1956 and having its registered office at {{company_registered_office}}, and an office at {{branch_address}} (hereinafter called the Company / First Party which expression unless repugnant to the context shall mean and include its subsidiaries, its successors and assigns)"),
  p("AND"),
  p("{{employee_name}} {{relation_prefix}} {{father_name}} r/o {{employee_address}} (hereinafter referred to as the Second Party which expression unless repugnant to the context shall mean and include its successors in interest and permitted assigns)"),
  p("WHEREAS the first party is engaged in the business of software development, customisation, Business Process Outsourcing and other Information Technology Enabled and Related Services;"),
  p("AND WHEREAS the second party has represented that it is qualified and trained in the field of {{designation}} and is, therefore, capable of carrying out the activities required of it by the Company including {{process}} etc.;"),
  p("AND WHEREAS the second party has offered its services to the Company and the Company proposes to employ the services of the second party based on the assurances given by the second party."),
  p("NOW THEREFORE, IN CONSIDERATION OF THE MUTUAL COVENANTS HEREIN CONTAINED, THE PARTIES AGREE AS FOLLOWS:"),

  h("1. DEFINITIONS"),
  li("1.1 Product means the product designed, developed, manufactured or otherwise dealt in by the first party or its constituents/ customers."),
  li("1.2 Intellectual Property means existing and future intellectual property held and owned by the first party or its constituents/ customers in the nature of customer database, patents, unregistered or registered, rights to any and all COPYRIGHTS, TRADEMARKS, DESIGNS and other confidential and/ or proprietary information limited to that forming part of the subject matter of the agreement, and inclusive of all intellectual property that is the subject of ownership by the first party and/ or its assigns or nominees having an interest in the first party's business and title."),
  li("1.3 Trademarks means the trademarks as may be specified by the first party in respect of products designed, developed, manufactured and/ or dealt in by the first party or its constituents/ customers."),
  li("1.4 Copyrights means works of design/ authorship, either artistic or literary with reference to the PRODUCT fixed in a tangible medium of expression (including corresponding rights under international agreements and conventions, inclusive of the non-registration and/ or registrations, renewal and extensions of any of the foregoing) whether or not containing a copyright notice, which work(s) was/ were created before or after the execution of this manufacturing agreement. This definition shall include artistic works to be used as TRADEMARKS of the first party or its constituents/ customers and also the packaging materials specifically designed by or for the first party or its constituents/ customers."),
  li("1.5 Know-How means without limitation, the process/ processes and know how for the Product of the first party or its constituents/ customers and also inclusive of any improvements/ modifications effected or caused to be effected to the said process(s) by the first party or its constituents/ customers and/ or the second party while in the employment of the first party."),
  li("1.6 Database: Details consisting of any personal information including but not limited to name, address, number etc., of customers of company or end customers of customers."),
  li("1.7 “Effective Date” shall mean the date on and from which this Agreement comes into force, i.e. {{date_of_joining}}."),

  h("2. JOB REQUIREMENTS"),
  li("2.1 The Second Party shall render services to the first party in respect of {{designation}} including, but not limited to, {{process}}, whether in the existing premises and/ or elsewhere."),

  h("3. REMUNERATION"),
  li("3.1 In respect of various services rendered by the Second Party to the First Party, it shall be paid remuneration as described in the Appendix hereto."),

  h("4. TERM"),
  li("4.1 This Agreement shall become effective from the EFFECTIVE DATE and shall be valid for a period of 36 months."),
  li("4.2 The parties may mutually agree to renew this agreement for any further period upon expiry of the period mentioned in clause 4.1 above upon mutually agreeable terms and conditions. At least one month before expiry of the term of this agreement, either party may inform the other party of its intention to renew or not to renew this agreement. If not renewed, this Agreement shall stand terminated on expiry of the term mentioned above."),

  h("5. TERMINATION OF AGREEMENT"),
  li("5.1 The first party may terminate this agreement forthwith at any time before the expiry of the said period of 36 months by giving the second party a notice in writing upon happening of any of the following events:"),
  li("(a) If the performance/ conduct of the second party is not consistent with the applicable laws and regulations or that the same in any manner whatsoever adversely affects the image and goodwill of the first party. Such acts shall include but not be limited to any deviation from the acceptable standards of quality/ performance/ conduct as well as misuse of the TRADEMARK. The first party shall be the sole determining authority in this respect;"),
  li("(b) In the event the second party commits a breach of any part of this agreement;"),
  li("(c) Upon bankruptcy, insolvency, general assignment for benefit of creditors of the second party; or"),
  li("(d) This Agreement or any material provision thereof is held to be invalid, illegal/ or unenforceable by any final judgment, decree or decision of a court of Competent Jurisdiction;"),
  li("(e) The second party is rendered incapable of carrying out the activities by operation of any law."),
  li("(f) The First Party discontinues or decides to discontinue its activity or business for which the Second Party has been engaged."),
  li("5.2 Upon either party communicating to the other Party of its intention to terminate this agreement by giving a notice of 30 days."),
  li("5.3 The Parties to this Agreement may terminate this agreement by mutual consent."),
  li("5.4 Upon termination or earlier determination/ expiry of this Agreement for reasons as stated above or for any other reason whatsoever, the Second Party shall forthwith cease to represent the first party in any manner whatsoever, shall return all the documents, properties and correspondence, whatsoever."),
  li("5.5 Upon termination or earlier determination/ expiry of this Agreement for reasons as stated above or for any other reason whatsoever, the Second Party shall neither claim nor be entitled to any compensation or any other charges, whatsoever."),

  h("6. NOTICES"),
  li("6.1 All notices, requests, demands or other communications required or permitted to be given or made under this agreement shall only be in writing and delivered personally, or sent by registered post with A/D or a courier of repute to the intended recipient thereof at the address set forth below. The addresses of the parties for the purposes of this agreement are as follow:"),
  p("To First Party: M/s Mas Callnet India (P) Ltd, {{branch_address}}"),
  p("To Second Party: {{employee_name}}, {{employee_address}}"),
  li("6.2 Any Party hereto may change its address for the purpose of this Agreement by giving written notice to the other parties at the address and in the manner provided above."),

  h("7. INDEMNITY"),
  li("7.1 The second party shall discharge its duties in utmost good faith. In respect of any act of the second party in contravention of the good faith provisions, the second party shall be fully responsible for its acts, actions and conduct and indemnify and hold the first party harmless from and indemnified against any and all claims and liabilities for damages, losses and other costs including lawyers' fees arising out of any action instituted against the first party by a third party including Government authorities under any law or laws and rules made thereunder for the time being in force."),

  h("8. NON-EXCLUSIVITY"),
  li("8.1 The First Party shall be entitled to enter into similar agreement(s) with other parties."),

  h("9. NON-COMPETE"),
  li("9.1 During the term of this Agreement, the Second Party shall devote its whole time, attention and abilities to the activities assigned to it by the first party and shall not carry out any other activity, whether or not related to the first party's area of activity."),
  li("9.2 During the term of this Agreement, the second party shall not directly or indirectly, individually or collectively, own, manage, operate, consult or be involved in the similar business including developing, or manufacturing, or marketing any product using the KNOW HOW, Trade Secrets or other proprietary information of the First Party or any variant thereof."),
  li("9.3 The Second Party acknowledges that any breach of this Clause shall cause irreparable injury to the First Party and the First Party shall be entitled to equitable remedy from a competent court/ authority in addition to any other remedy available to it under the law."),

  h("10. CONFIDENTIALITY"),
  li("10.1 This Agreement is strictly confidential and the Second Party undertakes not to disclose its content to third Parties without the previous written consent of the First Party, except where required by law."),
  li("10.2 The Parties recognise that pursuant to and under this Agreement, the Second Party has received and shall receive non-public proprietary and confidential information related to the first party as well as to its constituents/ customers. The Second Party acknowledges that such information is the First Party's property and the Second Party shall receive and hold such information in confidence and shall not disclose such confidential information to others."),
  li("10.3 It is further agreed between the Parties that any and all information, including that herein provided concerning the first party's business and products or to those of the first party's constituents/ customers, which may be disclosed or provided to the Second Party at anytime, whether or not owned or developed by the First Party or whether or not COPYRIGHTED or patented, shall be treated by the Second Party as confidential or proprietary information and shall not be disclosed to any third party without prior written consent of the First Party."),
  li("10.4 The confidentiality obligation of the Second Party shall apply beyond the period of the present contract."),

  h("11. SEVERABILITY"),
  li("11.1 If any term of this Agreement not essential to the commercial purpose of this Agreement shall be held to be illegal, invalid or unenforceable by a court of competent jurisdiction, it is the intention of the Parties that the remaining terms hereof shall constitute their agreement with respect to the subject matter hereof and all such remaining terms shall remain in full force and effect."),

  h("12. WAIVER"),
  li("12.1 No failure on the part of any Party hereto to exercise, and no delay in exercising any right, power or remedy hereunder shall operate as a waiver thereof, nor shall any single or partial exercise of any right, power or remedy by any such Party preclude any other or further exercise thereof or the exercise of any other right, power or remedy."),
  li("12.2 No express waiver or assent by any Party hereto to any breach of or default in any term or condition of this Agreement shall constitute a waiver of or an assent to any succeeding breach of or default in the same or any other term or condition hereof."),

  h("13. ASSIGNMENT"),
  li("13.1 Neither this Agreement nor any interest herein may be assigned or otherwise transferred by the Second Party without prior written consent of the First Party."),

  h("14. ENTIRE AGREEMENT"),
  li("14.1 This Agreement supersedes all prior discussions and agreements between the Parties with respect to the subject matter hereof, and this Agreement contains the sole and entire agreement between the Parties with respect to the matters covered hereby. This Agreement may not be modified or amended except by an instrument in writing signed by or on behalf of all the Parties hereto."),

  h("15. MODIFICATIONS TO THE CONTRACT"),
  li("15.1 No modification or amendment of this Agreement and no waiver of any of the terms and conditions shall be valid or binding unless made in writing and duly executed by both Parties."),

  h("16. RELATIONSHIP BETWEEN PARTIES"),
  li("16.1 This Agreement is executed on an Employer-Employee basis and is purely contractual. None of the provisions of the Agreement shall be deemed to constitute a partnership, agency or any other relationship. The second Party shall have any authority to bind the first Party otherwise than under this Agreement or shall be deemed to be the agent of the other party in any way."),
  li("16.2 It is understood and agreed by and between the Parties that the Second Party would have sole and exclusive responsibility, statutory and contractual, in respect of all his legal obligations and the First Party shall in no way be responsible for the same."),

  h("17. FORCE MAJEURE"),
  li("17.1 Any delays in or failure of performance by any party under this Agreement shall not constitute default hereunder or give rise to any claims for damages if, and to the extent, caused by the following occurrences beyond the control of either party affected - fire, floods, explosions, acts of God, accidents, epidemic, riots, embargoes, outbreak of hostilities, enemy action, any legislative prohibitions or restrictions imposed by any Government or Authority."),

  h("18. JURISDICTION"),
  li("18.1 Any dispute/ difference arising from this Agreement shall be subject to the exclusive jurisdiction of the courts in Delhi."),

  sp(),
  p("IN WITNESS WHEREOF, the Parties have caused this Agreement to be executed under seal as of the day, month and year first above written."),
  sp(),
  // The employer block already existed; only the signatory was anonymous.
  //
  // The line carried a blank rule and nothing else, so a reader could not tell
  // who signed for the company. It now names the Payroll HR of the branch the
  // candidate joins — the same person who signs their EPF forms, so one
  // configuration covers both — while keeping the rule for the wet signature.
  // Blank where a branch has no signatory configured, which is how the line has
  // always read.
  p("For and on behalf of Mas Callnet India (P) Ltd (First Party): ______________________"),
  p("Name: {{payroll_hr_name}}          Designation: {{payroll_hr_designation}}"),
  sp(),
  p("Second Party: {{employee_name}}"),
  p("Employee Code: {{employee_code}}          Date of Joining: {{date_of_joining}}"),
  p("Designation: {{designation}}          Department: {{department}}"),
  p("Branch: {{branch}}          Process: {{process}}"),
  p("Signature: ______________________          Date: {{current_date}}"),
  sp(),
  p("Witness 1: ______________________"),
  p("Witness 2: ______________________"),

  sp(),
  t("APPENDIX FORMING PART OF THE AGREEMENT"),
  p("Dated {{current_date}}, between Mas Callnet India (P) Ltd and {{employee_name}}."),
  h("Remuneration"),
  p("1. The remuneration payable by the first party to the second party for the services rendered under this Agreement shall be as laid down below:"),
  p("Description: All {{designation}} work of the first party's area of activity including, but not limited to, {{process}}, whether in the existing premises and/ or elsewhere."),
  p("Remuneration Payable: Rs. {{monthly_remuneration}} (Rupees {{monthly_remuneration_words}} only) per month. The remuneration is inclusive of all expenses."),
  p("2. The second party shall neither claim nor be entitled to any other remuneration or any other amount, by whatever name called, whether fixed or variable or as a percentage of either profits or any part of the sales, including sales in respect of orders introduced and/ or canvassed by the second party, in any form whatsoever."),
  p("3. In addition to the remuneration as stated above, the second party may be paid an incentive, at the sole discretion of the first party, reimbursed reasonable travelling, boarding and lodging expenses as per actuals provided prior approval thereof has been obtained from the first party."),
  p("4. All payments to be made by the first party to the second party shall be subject to deduction of applicable taxes at source at the rates in force. Payments shall also be subject to any future taxes that may be levied by any Government, whether Central or State or by any other Authority in future under any provisions of law. Thus, all taxes, present and future, shall be borne by the second party and the first party shall not be liable or be called upon to pay such taxes on behalf of the second party."),
  p("5. The second party shall be solely responsible for payment of the taxes on its incomes and the first party shall neither be liable nor be called upon to bear any part of these taxes, whether such taxes are applicable at present or are levied by any Government, whether Central or State or by any other Authority in future under any provisions of law."),
];

const TEMPLATES: Array<{ code: string; blocks: Block[] }> = [
  { code: "EMPLOYMENT_CONTRACT", blocks: CONTRACT },
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
