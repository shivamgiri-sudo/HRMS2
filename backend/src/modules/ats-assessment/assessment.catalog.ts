export type AssessmentProcess = 'inbound' | 'outbound' | 'backoffice' | 'document' | 'email';
export type AssessmentRole = 'executive' | 'team_leader' | 'quality_auditor';
export type QuestionType = 'single' | 'multi' | 'text';

export interface AssessmentQuestionDefinition {
  id: string;
  sectionKey: string;
  sectionTitle: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  correctAnswer?: string | string[];
  keywords?: string[];
  marks: number;
  difficulty: 'basic' | 'intermediate' | 'advanced';
  explanation?: string;
  manualReview?: boolean;
}

export interface TypingDefinition {
  required: boolean;
  durationSeconds: number;
  minNetWpm: number;
  minAccuracy: number;
  maxAttempts: 2;
  passage: string;
}

export interface AssessmentTemplateDefinition {
  code: string;
  name: string;
  process: AssessmentProcess;
  role: AssessmentRole;
  durationMinutes: number;
  passingPercentage: number;
  difficulty: 'basic' | 'intermediate' | 'advanced';
  typing: TypingDefinition;
  questions: AssessmentQuestionDefinition[];
}

const choice = (id:string, sectionKey:string, sectionTitle:string, prompt:string, options:string[], correctAnswer:string|string[], marks=6, difficulty:AssessmentQuestionDefinition['difficulty']='intermediate'):AssessmentQuestionDefinition => ({ id, sectionKey, sectionTitle, type:Array.isArray(correctAnswer)?'multi':'single', prompt, options, correctAnswer, marks, difficulty });
const written = (id:string, sectionKey:string, sectionTitle:string, prompt:string, keywords:string[], marks=14):AssessmentQuestionDefinition => ({ id, sectionKey, sectionTitle, type:'text', prompt, keywords, marks, difficulty:'advanced', manualReview:true });

const COMMON: Record<AssessmentRole, AssessmentQuestionDefinition[]> = {
  executive: [
    choice('exec-grammar','communication','Communication','Choose the most professional sentence.',['Send it again. It is wrong.','Please resend the document because the current copy is unclear.','Your document is bad.','Do it fast.'],'Please resend the document because the current copy is unclear.',5,'basic'),
    choice('exec-privacy','compliance','Compliance','A customer asks for another customer’s information. What should you do?',['Share limited information.','Refuse politely and follow the approved privacy process.','Ask a colleague to share it.','Share it if the request sounds genuine.'],'Refuse politely and follow the approved privacy process.',5,'basic'),
    choice('exec-comprehension-1','comprehension','Comprehension','Read: “The form was submitted Monday, reviewed Tuesday, and returned because one mandatory field was blank. The corrected form arrived Wednesday.” When did the corrected form arrive?',['Monday','Tuesday','Wednesday','Thursday'],'Wednesday',5,'basic'),
    choice('exec-comprehension-2','comprehension','Comprehension','Why was the form returned?',['It was late.','A mandatory field was blank.','It was fraudulent.','The customer requested it.'],'A mandatory field was blank.',5,'basic'),
  ],
  team_leader: [
    choice('tl-coaching','leadership','Leadership','A strong employee misses target for three consecutive days. What should the Team Leader do first?',['Issue a warning immediately.','Review data, identify the cause, and conduct focused coaching.','Reduce work permanently.','Ignore it until month end.'],'Review data, identify the cause, and conduct focused coaching.',6),
    choice('tl-control','operations','Operational Control','Which combination best shows team health?',['Attendance only','Productivity only','Productivity, quality, SLA, attendance, and shrinkage','Customer complaints only'],'Productivity, quality, SLA, attendance, and shrinkage',6),
    choice('tl-escalation','leadership','Leadership','A critical client escalation is received. What is the best first response?',['Defend the team before checking facts.','Acknowledge, secure evidence, contain risk, and communicate an action timeline.','Forward it without ownership.','Wait for the next review.'],'Acknowledge, secure evidence, contain risk, and communicate an action timeline.',6,'advanced'),
    written('tl-case','case_study','Leadership Case Study','Your team has high absenteeism, a growing backlog, and declining quality. Write a 24-hour recovery plan and a 30-day prevention plan.',['attendance','backlog','quality','allocation','coaching','root cause','monitor','sla'],16),
  ],
  quality_auditor: [
    choice('qa-calibration','quality','Quality Governance','The primary purpose of calibration is to:',['Increase audit volume only.','Align interpretation of standards and reduce auditor variation.','Replace coaching.','Remove manual audits.'],'Align interpretation of standards and reduce auditor variation.',6),
    choice('qa-evidence','quality','Quality Governance','A quality finding should be supported by:',['Personal opinion','Clear evidence linked to the applicable standard','Past score only','A manager’s assumption'],'Clear evidence linked to the applicable standard',6,'basic'),
    choice('qa-feedback','quality','Quality Governance','Which feedback is most actionable?',['Be more careful.','At 02:14 mandatory verification was skipped. Use the two-step checklist before disclosure.','Your call was bad.','Improve quality.'],'At 02:14 mandatory verification was skipped. Use the two-step checklist before disclosure.',6,'advanced'),
    written('qa-case','case_study','Quality Case Study','Quality fell from 93% to 84% in two weeks and most defects relate to one policy step. Explain validation, root-cause analysis, and closure.',['sample','trend','root cause','calibration','coaching','policy','action','monitor'],16),
  ],
};

const BANK: Record<AssessmentProcess, Record<AssessmentRole, AssessmentQuestionDefinition[]>> = {
  inbound: {
    executive: [
      choice('in-e-1','customer_handling','Inbound Customer Handling','An angry repeat caller says the issue was reported twice. What is the best opening?',['Explain it again.','I understand the frustration. Let me review the earlier notes and take ownership of the next step.','That is not my department.','Call later.'],'I understand the frustration. Let me review the earlier notes and take ownership of the next step.',8),
      choice('in-e-2','customer_handling','Inbound Customer Handling','Before discussing account-specific information, the agent should:',['Complete required verification.','Ask only the name.','Share limited information first.','Skip verification for repeat callers.'],'Complete required verification.',8),
      choice('in-e-3','customer_handling','Inbound Customer Handling','A customer requests something outside policy. What is the best response?',['Promise it.','Explain the limitation, offer the nearest approved solution, and escalate when required.','End the call.','Blame policy.'],'Explain the limitation, offer the nearest approved solution, and escalate when required.',8),
    ],
    team_leader: [
      choice('in-tl-1','operations','Inbound Operations','Service level drops because volume is 25% above forecast. What should happen first?',['Stop quality audits.','Activate the intraday recovery plan: staffing, breaks, routing, and available support.','Force every call shorter.','Wait until end of day.'],'Activate the intraday recovery plan: staffing, breaks, routing, and available support.',9,'advanced'),
      choice('in-tl-2','operations','Inbound Operations','AHT is high, but repeat calls are low and quality is strong. The best response is to:',['Force shorter calls immediately.','Analyze call drivers and handling steps before deciding whether AHT is inefficient.','Remove after-call work.','Reduce verification.'],'Analyze call drivers and handling steps before deciding whether AHT is inefficient.',9),
      written('in-tl-3','case_study','Inbound Case Study','During peak hour the queue doubles, two agents are absent, and a customer escalation is waiting. Explain prioritization and communication.',['queue','staffing','escalation','break','skill','communication','sla','customer'],16),
    ],
    quality_auditor: [
      choice('in-qa-1','audit','Inbound Audit','An agent discloses account data before mandatory verification. This is normally:',['Cosmetic','Critical/fatal compliance error','No error if genuine','AHT issue'],'Critical/fatal compliance error',9,'advanced'),
      choice('in-qa-2','audit','Inbound Audit','Which evidence best supports an empathy defect?',['The call was long.','The agent interrupted a distressed customer and used dismissive language at specific timestamps.','The customer called before.','The monthly score is low.'],'The agent interrupted a distressed customer and used dismissive language at specific timestamps.',9),
      written('in-qa-3','case_study','Inbound Audit Case','Verification and resolution were correct, but the agent promised an unapproved turnaround time. Explain classification, risk, and feedback.',['promise','turnaround','policy','risk','classification','feedback','evidence'],16),
    ],
  },
  outbound: {
    executive: [
      choice('out-e-1','sales','Outbound Sales','A prospect says “I am not interested.” What is the best next step?',['Argue.','Acknowledge, ask one permission-based question, and respect the response.','Keep reading the script.','Call repeatedly.'],'Acknowledge, ask one permission-based question, and respect the response.',8),
      choice('out-e-2','sales','Outbound Sales','Which statement is compliant?',['This offer is guaranteed.','Based on approved terms, you may be eligible subject to verification.','There are no conditions.','I can change the price later.'],'Based on approved terms, you may be eligible subject to verification.',8),
      choice('out-e-3','sales','Outbound Sales','A prospect asks to be removed from future calls. The agent should:',['Call tomorrow.','Follow the approved do-not-call/consent withdrawal process.','Transfer the number.','Ignore it.'],'Follow the approved do-not-call/consent withdrawal process.',8),
    ],
    team_leader: [
      choice('out-tl-1','sales_management','Outbound Management','Conversion falls but contact rate is unchanged. What should be investigated?',['Attendance only','Lead quality, pitch adherence, objections, offer fit, and agent conversion','Seating','Breaks only'],'Lead quality, pitch adherence, objections, offer fit, and agent conversion',9),
      choice('out-tl-2','sales_management','Outbound Management','An agent has high conversion but frequent false commitments. What is correct?',['Reward and ignore compliance.','Contain risk, review affected sales, coach/discipline, and monitor.','Move the agent.','Reduce audits.'],'Contain risk, review affected sales, coach/discipline, and monitor.',9,'advanced'),
      written('out-tl-3','case_study','Outbound Case Study','A campaign is at 70% of target with five days remaining. Prepare a recovery plan that protects consent and prevents mis-selling.',['target','lead','conversion','coaching','follow-up','consent','quality','monitor'],16),
    ],
    quality_auditor: [
      choice('out-qa-1','audit','Outbound Audit','An agent says an optional feature is mandatory. This is:',['Good persuasion','Misrepresentation/mis-selling','Grammar issue','Acceptable if converted'],'Misrepresentation/mis-selling',9,'advanced'),
      choice('out-qa-2','audit','Outbound Audit','What is the strongest evidence of valid consent?',['Assumed interest','Clear agreement after approved disclosure, captured in the interaction','No disconnection','Agent selected Yes'],'Clear agreement after approved disclosure, captured in the interaction',9),
      written('out-qa-3','case_study','Outbound Audit Case','Explain how you would audit a high-converting agent suspected of false commitments and present findings without bias.',['sample','evidence','commitment','policy','customer','bias','trend','action'],16),
    ],
  },
  backoffice: {
    executive: [
      choice('bo-e-1','accuracy','Backoffice Accuracy','Two records have the same ID but different dates of birth. What should you do?',['Choose randomly.','Stop and follow the duplicate/mismatch exception process.','Merge silently.','Delete both.'],'Stop and follow the duplicate/mismatch exception process.',8),
      choice('bo-e-2','accuracy','Backoffice Accuracy','A mandatory source field is missing. The correct action is to:',['Invent a value.','Use the approved exception/rework process and record the missing field.','Leave it blank without remarks.','Copy another record.'],'Use the approved exception/rework process and record the missing field.',8),
      choice('bo-e-3','accuracy','Backoffice Accuracy','Which practice reduces data-entry errors?',['Enter from memory.','Use field validation and a final source-to-entry check.','Copy the previous record.','Ignore formatting.'],'Use field validation and a final source-to-entry check.',8),
    ],
    team_leader: [
      choice('bo-tl-1','operations','Backoffice Operations','Backlog grows while average productivity looks normal. What should be checked?',['Total output only','Arrival volume, case mix, aging, rework, staffing, and interval productivity','Tenure only','Next month attendance'],'Arrival volume, case mix, aging, rework, staffing, and interval productivity',9),
      choice('bo-tl-2','operations','Backoffice Operations','High output with rising errors indicates:',['Excellent performance','A speed-quality imbalance requiring controlled correction','Quality target is wrong','Audits should stop'],'A speed-quality imbalance requiring controlled correction',9),
      written('bo-tl-3','case_study','Backoffice Case Study','A queue has 600 pending cases, 120 due today, 15% rework, and 10% absenteeism. Build a same-day allocation and control plan.',['aging','due','rework','staffing','allocation','quality','hourly','escalation'],16),
    ],
    quality_auditor: [
      choice('bo-qa-1','audit','Backoffice Audit','A transaction has the correct name but wrong customer ID. This is usually:',['Cosmetic','Critical data-integrity error','No error','Productivity issue'],'Critical data-integrity error',9,'advanced'),
      choice('bo-qa-2','audit','Backoffice Audit','A representative sample should consider:',['Easy transactions only','Volume, risk, process mix, employees, and time periods','One employee','Failed cases only'],'Volume, risk, process mix, employees, and time periods',9),
      written('bo-qa-3','case_study','Backoffice Audit Case','A process shows 8% defects, mostly from two fields. Explain sampling, validation, root cause, and corrective action.',['sample','field','validation','root cause','training','system','action','trend'],16),
    ],
  },
  document: {
    executive: [
      choice('doc-e-1','document_review','Document Review','The ID name differs from the application by one unexplained surname. What is best?',['Accept.','Follow the documented name-mismatch verification/referral process.','Change the application.','Reject every mismatch.'],'Follow the documented name-mismatch verification/referral process.',8),
      choice('doc-e-2','document_review','Document Review','A document expiry date is in the past. The assessor should:',['Ignore it.','Apply the expired-document rule and correct reason.','Edit the date.','Use another person’s document.'],'Apply the expired-document rule and correct reason.',8),
      choice('doc-e-3','document_review','Document Review','A suspicious alteration is visible near the date. What should happen?',['Correct it.','Use the fraud/suspicion escalation route and preserve evidence.','Ignore it.','Delete the case.'],'Use the fraud/suspicion escalation route and preserve evidence.',8,'advanced'),
    ],
    team_leader: [
      choice('doc-tl-1','operations','Document Operations','What is the best queue design for high-risk documents?',['No prioritization','Risk-based routing with trained reviewers, SLA controls, and escalation visibility','Freshers only','Easy cases only'],'Risk-based routing with trained reviewers, SLA controls, and escalation visibility',9),
      choice('doc-tl-2','operations','Document Operations','False rejection rises after a policy update. What should happen first?',['Continue rejecting.','Validate interpretation through calibration and review impacted decisions.','Lower targets.','Remove policy.'],'Validate interpretation through calibration and review impacted decisions.',9),
      written('doc-tl-3','case_study','Document Case Study','A policy change caused inconsistent decisions across three teams. Explain containment, calibration, rework, and communication.',['contain','calibration','policy','sample','rework','communication','decision','monitor'],16),
    ],
    quality_auditor: [
      choice('doc-qa-1','audit','Document Audit','An assessor accepts a document where the mandatory ID number is unreadable. This is likely:',['No error','False acceptance and potentially critical defect','Typing issue','Customer-service issue'],'False acceptance and potentially critical defect',9,'advanced'),
      choice('doc-qa-2','audit','Document Audit','The rejection decision is correct but the rejection reason is wrong. The auditor should:',['Pass fully.','Apply the reason-code defect because it affects communication/reporting.','Change silently.','Mark fraud.'],'Apply the reason-code defect because it affects communication/reporting.',9),
      written('doc-qa-3','case_study','Document Audit Case','A valid document was rejected because the reviewer misunderstood the date format. Explain classification, evidence, impact, and prevention.',['false rejection','date','format','evidence','impact','calibration','training','prevent'],16),
    ],
  },
  email: {
    executive: [
      choice('email-e-1','email_handling','Email Handling','Which subject line is clearest?',['Hi','Regarding your request','Update on Ticket 45821 – Additional Document Required','Important message'],'Update on Ticket 45821 – Additional Document Required',8),
      choice('email-e-2','email_handling','Email Handling','A customer email contains two requests. The reply should:',['Answer the easier request.','Address both requests or clearly explain the next action for each.','Send a generic template.','Ask for two emails.'],'Address both requests or clearly explain the next action for each.',8),
      written('email-e-3','written_response','Email Drafting','Draft a concise reply to a customer whose refund is delayed. Acknowledge the concern, explain review, give the next update timeline, and avoid an unapproved promise.',['sorry','concern','review','update','timeline','thank'],16),
    ],
    team_leader: [
      choice('email-tl-1','operations','Email Operations','The email queue has a growing backlog. What should be reviewed first?',['Grammar only','Arrival volume, aging, priority, handling time, staffing, and rework','Seating','Incentives'],'Arrival volume, aging, priority, handling time, staffing, and rework',9),
      choice('email-tl-2','operations','Email Operations','Templates should be governed to:',['Remove personalization.','Ensure compliant core content while allowing relevant personalization and complete resolution.','Make replies longer.','Avoid quality checks.'],'Ensure compliant core content while allowing relevant personalization and complete resolution.',9),
      written('email-tl-3','case_study','Email Case Study','A queue has 300 aged emails, mixed priorities, and rising repeat contacts. Write a recovery and quality-control plan.',['aging','priority','allocation','repeat','resolution','quality','sla','monitor'],16),
    ],
    quality_auditor: [
      choice('email-qa-1','audit','Email Audit','The email is grammatically correct but gives the wrong resolution. The primary defect is:',['No defect','Process/resolution accuracy defect','Formatting','Tone only'],'Process/resolution accuracy defect',9),
      choice('email-qa-2','audit','Email Audit','An email exposes another customer’s account number. This is:',['Spelling issue','Critical privacy/compliance defect','Acceptable if accidental','Template issue'],'Critical privacy/compliance defect',9,'advanced'),
      written('email-qa-3','case_study','Email Audit Case','Audit a polite, grammatically correct response that misses one of two requests and gives no next-step timeline.',['incomplete','request','timeline','customer','resolution','feedback','evidence'],16),
    ],
  },
};

const PASSAGES: Record<AssessmentProcess,string> = {
  inbound:'Customer service requires patience, active listening, accurate verification, clear communication, and complete ownership. An effective representative understands the concern, checks available information, explains the approved solution, records the interaction correctly, and confirms the next step before closing the conversation.',
  outbound:'A professional outbound conversation begins with consent and a clear introduction. The representative identifies the customer need, explains only approved benefits, handles objections respectfully, avoids false commitments, records the outcome accurately, and follows the requested communication preference.',
  backoffice:'Backoffice operations depend on accuracy, consistency, confidentiality, and timely completion. Every record must be compared with source information, validated against applicable rules, entered in the correct field, and routed through the approved exception process whenever information is missing or inconsistent.',
  document:'Document assessment requires careful observation and consistent policy application. The reviewer checks document type, image clarity, mandatory fields, expiry, data consistency, and possible alteration indicators. Decisions must be supported by evidence and recorded using the correct acceptance, rejection, or referral reason.',
  email:'A professional email should identify the customer concern, acknowledge it with an appropriate tone, provide a complete and accurate response, explain the next step, avoid unsupported promises, and close politely. The subject line and formatting should make the message easy to understand and act upon.',
};

const typingFor=(process:AssessmentProcess,role:AssessmentRole):TypingDefinition=>({ required:['backoffice','document','email'].includes(process), durationSeconds:180, minNetWpm:role==='team_leader'?35:role==='quality_auditor'?32:30, minAccuracy:role==='executive'?92:95, maxAttempts:2, passage:PASSAGES[process] });

export const DEFAULT_ASSESSMENT_TEMPLATES: AssessmentTemplateDefinition[] = (['inbound','outbound','backoffice','document','email'] as AssessmentProcess[]).flatMap(process => (['executive','team_leader','quality_auditor'] as AssessmentRole[]).map(role => {
  const roleLabel=role==='executive'?'Executive':role==='team_leader'?'Team Leader':'Quality Auditor';
  const processLabel=process==='backoffice'?'Backoffice':process==='document'?'Document Assessment':process==='email'?'Email Handling':process[0].toUpperCase()+process.slice(1);
  return { code:`ATS-${process.toUpperCase()}-${role.toUpperCase()}`, name:`${processLabel} - ${roleLabel} Assessment`, process, role, durationMinutes:role==='executive'?30:45, passingPercentage:role==='executive'?60:70, difficulty:role==='executive'?'intermediate':'advanced', typing:typingFor(process,role), questions:[...COMMON[role],...BANK[process][role]] };
}));

export function buildDefaultTemplates(){ return DEFAULT_ASSESSMENT_TEMPLATES; }
export function getDefaultTemplate(process:AssessmentProcess,role:AssessmentRole){ const found=DEFAULT_ASSESSMENT_TEMPLATES.find(t=>t.process===process&&t.role===role); if(!found) throw new Error(`Assessment template not found for ${process}/${role}`); return found; }
export function publicTemplate(template:AssessmentTemplateDefinition){ const {passage:_passage,...typing}=template.typing; return {...template,questionCount:template.questions.length,typing,questions:template.questions.map(({correctAnswer:_correctAnswer,keywords:_keywords,explanation:_explanation,...safe})=>safe)}; }
