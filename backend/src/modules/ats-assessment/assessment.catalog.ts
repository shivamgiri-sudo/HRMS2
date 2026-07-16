export type AssessmentProcess = "inbound" | "outbound" | "backoffice" | "document" | "email";
export type AssessmentRole = "executive" | "team_leader" | "quality_auditor";
export type QuestionType = "single" | "multi" | "text";
export type DifficultyLevel = "basic" | "intermediate" | "advanced";

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
  difficulty: DifficultyLevel;
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
  experienceLevel: "any" | "fresher" | "experienced";
  durationMinutes: number;
  passingPercentage: number;
  difficulty: DifficultyLevel;
  instructions: string[];
  typing: TypingDefinition;
  questions: AssessmentQuestionDefinition[];
}

const choice = (
  id: string,
  sectionKey: string,
  sectionTitle: string,
  prompt: string,
  options: string[],
  correctAnswer: string | string[],
  marks = 6,
  difficulty: DifficultyLevel = "intermediate",
  explanation?: string,
): AssessmentQuestionDefinition => ({
  id,
  sectionKey,
  sectionTitle,
  type: Array.isArray(correctAnswer) ? "multi" : "single",
  prompt,
  options,
  correctAnswer,
  marks,
  difficulty,
  explanation,
});

const written = (
  id: string,
  sectionKey: string,
  sectionTitle: string,
  prompt: string,
  keywords: string[],
  marks = 16,
): AssessmentQuestionDefinition => ({
  id,
  sectionKey,
  sectionTitle,
  type: "text",
  prompt,
  keywords,
  marks,
  difficulty: "advanced",
  manualReview: true,
});

const COMMON: Record<AssessmentRole, AssessmentQuestionDefinition[]> = {
  executive: [
    choice(
      "exec-grammar",
      "communication",
      "Communication",
      "Choose the most professional sentence.",
      [
        "Send it again. It is wrong.",
        "Please resend the document because the current copy is unclear.",
        "Your document is bad.",
        "Do it fast.",
      ],
      "Please resend the document because the current copy is unclear.",
      5,
      "basic",
    ),
    choice(
      "exec-privacy",
      "compliance",
      "Compliance",
      "A customer asks for another customer's information. What should you do?",
      [
        "Share limited information.",
        "Refuse politely and follow the approved privacy process.",
        "Ask a colleague to share it.",
        "Share it if the request sounds genuine.",
      ],
      "Refuse politely and follow the approved privacy process.",
      5,
      "basic",
    ),
    choice(
      "exec-comprehension-arrival",
      "comprehension",
      "Comprehension",
      "Read: The form was submitted Monday, reviewed Tuesday, and returned because one mandatory field was blank. The corrected form arrived Wednesday. When did the corrected form arrive?",
      ["Monday", "Tuesday", "Wednesday", "Thursday"],
      "Wednesday",
      5,
      "basic",
    ),
    choice(
      "exec-comprehension-reason",
      "comprehension",
      "Comprehension",
      "Why was the form returned in the previous passage?",
      ["It was late.", "A mandatory field was blank.", "It was fraudulent.", "The customer requested it."],
      "A mandatory field was blank.",
      5,
      "basic",
    ),
    choice(
      "exec-security-link",
      "digital_safety",
      "Digital Safety",
      "You receive an unexpected link asking for your login password. What is the safest action?",
      [
        "Open it on a personal phone.",
        "Forward it to colleagues.",
        "Do not open it; report it through the approved security channel.",
        "Enter a temporary password.",
      ],
      "Do not open it; report it through the approved security channel.",
      5,
      "basic",
    ),
  ],
  team_leader: [
    choice(
      "tl-coaching",
      "leadership",
      "Leadership",
      "A strong employee misses target for three consecutive days. What should the Team Leader do first?",
      [
        "Issue a warning immediately.",
        "Review data, identify the cause, and conduct focused coaching.",
        "Reduce work permanently.",
        "Ignore it until month end.",
      ],
      "Review data, identify the cause, and conduct focused coaching.",
      6,
    ),
    choice(
      "tl-team-health",
      "operations",
      "Operational Control",
      "Which combination best shows team health?",
      [
        "Attendance only",
        "Productivity only",
        "Productivity, quality, SLA, attendance, and shrinkage",
        "Customer complaints only",
      ],
      "Productivity, quality, SLA, attendance, and shrinkage",
      6,
    ),
    choice(
      "tl-critical-escalation",
      "leadership",
      "Leadership",
      "A critical client escalation is received. What is the best first response?",
      [
        "Defend the team before checking facts.",
        "Acknowledge, secure evidence, contain risk, and communicate an action timeline.",
        "Forward it without ownership.",
        "Wait for the next review.",
      ],
      "Acknowledge, secure evidence, contain risk, and communicate an action timeline.",
      6,
      "advanced",
    ),
    choice(
      "tl-shrinkage",
      "workforce",
      "Workforce Control",
      "Planned shrinkage is higher than available staffing during peak volume. What should the Team Leader do?",
      [
        "Approve every activity and accept the service impact.",
        "Coordinate priorities, reschedule non-critical activity, and document the recovery plan.",
        "Cancel all breaks.",
        "Hide the staffing gap.",
      ],
      "Coordinate priorities, reschedule non-critical activity, and document the recovery plan.",
      6,
      "advanced",
    ),
    choice(
      "tl-fairness",
      "people_management",
      "People Management",
      "Two employees make the same error. One is a top performer. What is the fairest response?",
      [
        "Ignore the top performer.",
        "Apply the same evidence-based policy while considering documented context consistently.",
        "Penalize the lower performer more.",
        "Let the team vote.",
      ],
      "Apply the same evidence-based policy while considering documented context consistently.",
      6,
    ),
  ],
  quality_auditor: [
    choice(
      "qa-calibration",
      "quality",
      "Quality Governance",
      "The primary purpose of calibration is to:",
      [
        "Increase audit volume only.",
        "Align interpretation of standards and reduce auditor variation.",
        "Replace coaching.",
        "Remove manual audits.",
      ],
      "Align interpretation of standards and reduce auditor variation.",
      6,
    ),
    choice(
      "qa-evidence",
      "quality",
      "Quality Governance",
      "A quality finding should be supported by:",
      ["Personal opinion", "Clear evidence linked to the applicable standard", "Past score only", "A manager's assumption"],
      "Clear evidence linked to the applicable standard",
      6,
      "basic",
    ),
    choice(
      "qa-actionable-feedback",
      "quality",
      "Quality Governance",
      "Which feedback is most actionable?",
      [
        "Be more careful.",
        "At 02:14 mandatory verification was skipped. Use the two-step checklist before disclosure.",
        "Your work was bad.",
        "Improve quality.",
      ],
      "At 02:14 mandatory verification was skipped. Use the two-step checklist before disclosure.",
      6,
      "advanced",
    ),
    choice(
      "qa-sampling",
      "sampling",
      "Sampling",
      "Which sample is most representative for a monthly process review?",
      [
        "Only failed transactions",
        "Transactions across employees, risk levels, shifts, days, and case types",
        "Only the highest performer",
        "Only the last day of the month",
      ],
      "Transactions across employees, risk levels, shifts, days, and case types",
      6,
    ),
    choice(
      "qa-appeal",
      "governance",
      "Audit Governance",
      "An employee challenges an audit with new evidence. What should the auditor do?",
      [
        "Reject the appeal automatically.",
        "Review the evidence against the standard, document the outcome, and correct the score if required.",
        "Delete the audit.",
        "Ask the employee to accept the score.",
      ],
      "Review the evidence against the standard, document the outcome, and correct the score if required.",
      6,
      "advanced",
    ),
  ],
};

const PROCESS_BANK: Record<AssessmentProcess, Record<AssessmentRole, AssessmentQuestionDefinition[]>> = {
  inbound: {
    executive: [
      choice(
        "in-exec-repeat-caller",
        "customer_handling",
        "Inbound Customer Handling",
        "An angry repeat caller says the issue was reported twice. What is the best opening?",
        [
          "Explain the policy again.",
          "I understand the frustration. Let me review the earlier notes and take ownership of the next step.",
          "That is not my department.",
          "Call later.",
        ],
        "I understand the frustration. Let me review the earlier notes and take ownership of the next step.",
        8,
      ),
      choice(
        "in-exec-verification",
        "customer_handling",
        "Inbound Customer Handling",
        "Before discussing account-specific information, the agent should:",
        ["Complete required verification.", "Ask only the name.", "Share limited information first.", "Skip verification for repeat callers."],
        "Complete required verification.",
        8,
      ),
      choice(
        "in-exec-outside-policy",
        "customer_handling",
        "Inbound Customer Handling",
        "A customer requests something outside policy. What is the best response?",
        [
          "Promise it.",
          "Explain the limitation, offer the nearest approved solution, and escalate when required.",
          "End the call.",
          "Blame policy.",
        ],
        "Explain the limitation, offer the nearest approved solution, and escalate when required.",
        8,
      ),
      choice(
        "in-exec-hold",
        "call_control",
        "Call Control",
        "Before placing a customer on hold, the agent should:",
        [
          "Mute without explaining.",
          "Explain the reason, seek permission, and provide a realistic check-back time.",
          "Transfer the call.",
          "Continue speaking to colleagues aloud.",
        ],
        "Explain the reason, seek permission, and provide a realistic check-back time.",
        8,
      ),
      choice(
        "in-exec-closure",
        "call_control",
        "Call Closure",
        "Which closure is strongest?",
        [
          "Okay, bye.",
          "I have completed the request and your reference number is 4582. The next update is due tomorrow by 4 PM. Is there anything else I can help with?",
          "You will receive something soon.",
          "Call again if needed.",
        ],
        "I have completed the request and your reference number is 4582. The next update is due tomorrow by 4 PM. Is there anything else I can help with?",
        8,
      ),
    ],
    team_leader: [
      choice(
        "in-tl-service-level",
        "operations",
        "Inbound Operations",
        "Service level drops because volume is 25% above forecast. What should happen first?",
        [
          "Stop quality audits.",
          "Activate the intraday recovery plan: staffing, breaks, routing, and available support.",
          "Force every call shorter.",
          "Wait until end of day.",
        ],
        "Activate the intraday recovery plan: staffing, breaks, routing, and available support.",
        9,
        "advanced",
      ),
      choice(
        "in-tl-aht",
        "operations",
        "Inbound Operations",
        "AHT is high, but repeat calls are low and quality is strong. The best response is to:",
        [
          "Force shorter calls immediately.",
          "Analyze call drivers and handling steps before deciding whether AHT is inefficient.",
          "Remove after-call work.",
          "Reduce verification.",
        ],
        "Analyze call drivers and handling steps before deciding whether AHT is inefficient.",
        9,
      ),
      choice(
        "in-tl-repeat-calls",
        "operations",
        "Inbound Operations",
        "Repeat calls rise for one query type. Which action is most effective?",
        [
          "Ask agents to speak faster.",
          "Review first-contact resolution, knowledge content, process gaps, and call examples.",
          "Reduce the sample size.",
          "Change the roster only.",
        ],
        "Review first-contact resolution, knowledge content, process gaps, and call examples.",
        9,
      ),
      choice(
        "in-tl-escalation-owner",
        "escalation",
        "Escalation Control",
        "A high-risk complaint is unresolved across two shifts. What should the Team Leader establish?",
        [
          "A new ticket without history",
          "A named owner, complete timeline, containment, next update, and handover accountability",
          "An informal chat message",
          "No further contact until closure",
        ],
        "A named owner, complete timeline, containment, next update, and handover accountability",
        9,
        "advanced",
      ),
      written(
        "in-tl-case",
        "case_study",
        "Inbound Case Study",
        "During peak hour the queue doubles, two agents are absent, and a customer escalation is waiting. Explain immediate prioritization, communication, and the post-event corrective plan.",
        ["queue", "staffing", "escalation", "break", "skill", "communication", "sla", "customer", "root cause", "monitor"],
        18,
      ),
    ],
    quality_auditor: [
      choice(
        "in-qa-disclosure",
        "audit",
        "Inbound Audit",
        "An agent discloses account data before mandatory verification. This is normally:",
        ["Cosmetic", "Critical or fatal compliance error", "No error if genuine", "AHT issue"],
        "Critical or fatal compliance error",
        9,
        "advanced",
      ),
      choice(
        "in-qa-empathy-evidence",
        "audit",
        "Inbound Audit",
        "Which evidence best supports an empathy defect?",
        [
          "The call was long.",
          "The agent interrupted a distressed customer and used dismissive language at specific timestamps.",
          "The customer called before.",
          "The monthly score is low.",
        ],
        "The agent interrupted a distressed customer and used dismissive language at specific timestamps.",
        9,
      ),
      choice(
        "in-qa-dead-air",
        "audit",
        "Inbound Audit",
        "Long silence occurs while the agent researches, but the customer was told what was happening and received updates. The auditor should:",
        [
          "Automatically fail the call.",
          "Apply the approved hold or silence standard using duration and communication evidence.",
          "Ignore all silence.",
          "Score only AHT.",
        ],
        "Apply the approved hold or silence standard using duration and communication evidence.",
        9,
      ),
      choice(
        "in-qa-resolution",
        "audit",
        "Inbound Audit",
        "Verification and tone are correct, but the resolution conflicts with policy. The primary defect is:",
        ["Tone", "Resolution or process accuracy", "Opening", "Call duration"],
        "Resolution or process accuracy",
        9,
      ),
      written(
        "in-qa-case",
        "case_study",
        "Inbound Audit Case",
        "Verification and resolution were correct, but the agent promised an unapproved turnaround time. Explain classification, evidence, customer risk, feedback, and prevention.",
        ["promise", "turnaround", "policy", "risk", "classification", "feedback", "evidence", "prevention"],
        18,
      ),
    ],
  },
  outbound: {
    executive: [
      choice(
        "out-exec-not-interested",
        "sales",
        "Outbound Sales",
        "A prospect says 'I am not interested.' What is the best next step?",
        [
          "Argue.",
          "Acknowledge, ask one permission-based question, and respect the response.",
          "Keep reading the script.",
          "Call repeatedly.",
        ],
        "Acknowledge, ask one permission-based question, and respect the response.",
        8,
      ),
      choice(
        "out-exec-compliant-statement",
        "sales",
        "Outbound Sales",
        "Which statement is compliant?",
        [
          "This offer is guaranteed.",
          "Based on approved terms, you may be eligible subject to verification.",
          "There are no conditions.",
          "I can change the price later.",
        ],
        "Based on approved terms, you may be eligible subject to verification.",
        8,
      ),
      choice(
        "out-exec-do-not-call",
        "consent",
        "Consent",
        "A prospect asks to be removed from future calls. The agent should:",
        [
          "Call tomorrow.",
          "Follow the approved do-not-call or consent-withdrawal process.",
          "Transfer the number.",
          "Ignore it.",
        ],
        "Follow the approved do-not-call or consent-withdrawal process.",
        8,
      ),
      choice(
        "out-exec-discovery",
        "sales",
        "Outbound Sales",
        "Which question best supports need discovery?",
        [
          "You want to buy this, right?",
          "What outcome are you trying to achieve, and what is currently preventing it?",
          "Why are you wasting time?",
          "Can I mark you selected?",
        ],
        "What outcome are you trying to achieve, and what is currently preventing it?",
        8,
      ),
      choice(
        "out-exec-objection",
        "sales",
        "Outbound Sales",
        "A customer says the price is high. What is the best response?",
        [
          "Offer an unauthorized discount.",
          "Clarify the concern, explain approved value, and confirm whether the solution fits the need.",
          "Say competitors are worse.",
          "End the call.",
        ],
        "Clarify the concern, explain approved value, and confirm whether the solution fits the need.",
        8,
      ),
    ],
    team_leader: [
      choice(
        "out-tl-conversion",
        "sales_management",
        "Outbound Management",
        "Conversion falls but contact rate is unchanged. What should be investigated?",
        [
          "Attendance only",
          "Lead quality, pitch adherence, objections, offer fit, and agent conversion",
          "Seating",
          "Breaks only",
        ],
        "Lead quality, pitch adherence, objections, offer fit, and agent conversion",
        9,
      ),
      choice(
        "out-tl-false-commitment",
        "sales_management",
        "Outbound Management",
        "An agent has high conversion but frequent false commitments. What is correct?",
        [
          "Reward and ignore compliance.",
          "Contain risk, review affected sales, coach or discipline, and monitor.",
          "Move the agent.",
          "Reduce audits.",
        ],
        "Contain risk, review affected sales, coach or discipline, and monitor.",
        9,
        "advanced",
      ),
      choice(
        "out-tl-contactability",
        "sales_management",
        "Outbound Management",
        "Contact rate drops sharply for one lead source. What should happen first?",
        [
          "Blame agents.",
          "Validate lead freshness, dialing windows, number quality, attempt strategy, and source performance.",
          "Increase promises.",
          "Remove compliance checks.",
        ],
        "Validate lead freshness, dialing windows, number quality, attempt strategy, and source performance.",
        9,
      ),
      choice(
        "out-tl-incentive",
        "sales_management",
        "Outbound Management",
        "Which incentive design is safest?",
        [
          "Pay only for gross sales.",
          "Balance conversion with quality, cancellations, compliance, and validated outcomes.",
          "Pay for call attempts only.",
          "Exclude audit results.",
        ],
        "Balance conversion with quality, cancellations, compliance, and validated outcomes.",
        9,
        "advanced",
      ),
      written(
        "out-tl-case",
        "case_study",
        "Outbound Case Study",
        "A campaign is at 70% of target with five days remaining. Prepare a recovery plan that protects consent and prevents mis-selling.",
        ["target", "lead", "conversion", "coaching", "follow-up", "consent", "quality", "monitor", "forecast", "risk"],
        18,
      ),
    ],
    quality_auditor: [
      choice(
        "out-qa-misrepresentation",
        "audit",
        "Outbound Audit",
        "An agent says an optional feature is mandatory. This is:",
        ["Good persuasion", "Misrepresentation or mis-selling", "Grammar issue", "Acceptable if converted"],
        "Misrepresentation or mis-selling",
        9,
        "advanced",
      ),
      choice(
        "out-qa-consent",
        "audit",
        "Outbound Audit",
        "What is the strongest evidence of valid consent?",
        [
          "Assumed interest",
          "Clear agreement after approved disclosure, captured in the interaction",
          "No disconnection",
          "Agent selected Yes",
        ],
        "Clear agreement after approved disclosure, captured in the interaction",
        9,
      ),
      choice(
        "out-qa-disclosure-order",
        "audit",
        "Outbound Audit",
        "The customer agrees before all mandatory terms are disclosed. The auditor should:",
        [
          "Treat the sale as fully compliant.",
          "Assess whether informed consent was obtained after complete approved disclosure.",
          "Ignore disclosure order.",
          "Score only tone.",
        ],
        "Assess whether informed consent was obtained after complete approved disclosure.",
        9,
        "advanced",
      ),
      choice(
        "out-qa-cancellation",
        "audit",
        "Outbound Audit",
        "High cancellation after one agent's sales most strongly indicates a need to review:",
        [
          "Only attendance",
          "Need discovery, disclosure, commitment accuracy, and sale validation",
          "Call duration only",
          "Seating plan",
        ],
        "Need discovery, disclosure, commitment accuracy, and sale validation",
        9,
      ),
      written(
        "out-qa-case",
        "case_study",
        "Outbound Audit Case",
        "Explain how you would audit a high-converting agent suspected of false commitments and present findings without bias.",
        ["sample", "evidence", "commitment", "policy", "customer", "bias", "trend", "action", "validation"],
        18,
      ),
    ],
  },
  backoffice: {
    executive: [
      choice(
        "bo-exec-duplicate",
        "accuracy",
        "Backoffice Accuracy",
        "Two records have the same ID but different dates of birth. What should you do?",
        ["Choose randomly.", "Stop and follow the duplicate or mismatch exception process.", "Merge silently.", "Delete both."],
        "Stop and follow the duplicate or mismatch exception process.",
        8,
      ),
      choice(
        "bo-exec-missing-field",
        "accuracy",
        "Backoffice Accuracy",
        "A mandatory source field is missing. The correct action is to:",
        [
          "Invent a value.",
          "Use the approved exception or rework process and record the missing field.",
          "Leave it blank without remarks.",
          "Copy another record.",
        ],
        "Use the approved exception or rework process and record the missing field.",
        8,
      ),
      choice(
        "bo-exec-error-control",
        "accuracy",
        "Backoffice Accuracy",
        "Which practice reduces data-entry errors?",
        ["Enter from memory.", "Use field validation and a final source-to-entry check.", "Copy the previous record.", "Ignore formatting."],
        "Use field validation and a final source-to-entry check.",
        8,
      ),
      choice(
        "bo-exec-priority",
        "tat",
        "Turnaround Time",
        "You have five cases due in one hour and ten newer cases due tomorrow. What should you do?",
        [
          "Process newest first.",
          "Follow approved priority and aging rules, completing the near-due cases first unless risk rules say otherwise.",
          "Choose easiest cases only.",
          "Wait for a reminder.",
        ],
        "Follow approved priority and aging rules, completing the near-due cases first unless risk rules say otherwise.",
        8,
      ),
      choice(
        "bo-exec-confidentiality",
        "compliance",
        "Confidentiality",
        "A colleague asks you to send customer data to a personal email for convenience. What should you do?",
        [
          "Send only part of it.",
          "Refuse and use only approved systems and access channels.",
          "Compress the file first.",
          "Send it after work.",
        ],
        "Refuse and use only approved systems and access channels.",
        8,
        "basic",
      ),
    ],
    team_leader: [
      choice(
        "bo-tl-backlog",
        "operations",
        "Backoffice Operations",
        "Backlog grows while average productivity looks normal. What should be checked?",
        [
          "Total output only",
          "Arrival volume, case mix, aging, rework, staffing, and interval productivity",
          "Tenure only",
          "Next month attendance",
        ],
        "Arrival volume, case mix, aging, rework, staffing, and interval productivity",
        9,
      ),
      choice(
        "bo-tl-speed-quality",
        "operations",
        "Backoffice Operations",
        "High output with rising errors indicates:",
        [
          "Excellent performance",
          "A speed-quality imbalance requiring controlled correction",
          "Quality target is wrong",
          "Audits should stop",
        ],
        "A speed-quality imbalance requiring controlled correction",
        9,
      ),
      choice(
        "bo-tl-aging",
        "operations",
        "Backoffice Operations",
        "Which dashboard view best prevents hidden SLA risk?",
        [
          "Daily total only",
          "Aging buckets by due time, priority, case type, owner, and rework status",
          "Employee names only",
          "Monthly average only",
        ],
        "Aging buckets by due time, priority, case type, owner, and rework status",
        9,
      ),
      choice(
        "bo-tl-allocation",
        "operations",
        "Backoffice Operations",
        "Complex work is concentrated with two employees while others are idle. What should the Team Leader do?",
        [
          "Leave it unchanged.",
          "Rebalance by skill, protect critical cases, and create cross-skill actions.",
          "Assign all work randomly.",
          "Stop measuring TAT.",
        ],
        "Rebalance by skill, protect critical cases, and create cross-skill actions.",
        9,
      ),
      written(
        "bo-tl-case",
        "case_study",
        "Backoffice Case Study",
        "A queue has 600 pending cases, 120 due today, 15% rework, and 10% absenteeism. Build a same-day allocation and control plan.",
        ["aging", "due", "rework", "staffing", "allocation", "quality", "hourly", "escalation", "skill", "sla"],
        18,
      ),
    ],
    quality_auditor: [
      choice(
        "bo-qa-wrong-id",
        "audit",
        "Backoffice Audit",
        "A transaction has the correct name but wrong customer ID. This is usually:",
        ["Cosmetic", "Critical data-integrity error", "No error", "Productivity issue"],
        "Critical data-integrity error",
        9,
        "advanced",
      ),
      choice(
        "bo-qa-representative-sample",
        "audit",
        "Backoffice Audit",
        "A representative sample should consider:",
        [
          "Easy transactions only",
          "Volume, risk, process mix, employees, and time periods",
          "One employee",
          "Failed cases only",
        ],
        "Volume, risk, process mix, employees, and time periods",
        9,
      ),
      choice(
        "bo-qa-source-evidence",
        "audit",
        "Backoffice Audit",
        "The system entry differs from the source document. Which evidence controls the audit?",
        [
          "The employee's memory",
          "The authorized source, applicable rule, and timestamped system record",
          "Team average",
          "A previous unrelated case",
        ],
        "The authorized source, applicable rule, and timestamped system record",
        9,
      ),
      choice(
        "bo-qa-rework",
        "audit",
        "Backoffice Audit",
        "A case is corrected after quality sampling but before customer impact. The original error should:",
        [
          "Always be erased.",
          "Be handled according to the approved defect and rework attribution rule with evidence.",
          "Never be reported.",
          "Be counted twice automatically.",
        ],
        "Be handled according to the approved defect and rework attribution rule with evidence.",
        9,
        "advanced",
      ),
      written(
        "bo-qa-case",
        "case_study",
        "Backoffice Audit Case",
        "A process shows 8% defects, mostly from two fields. Explain sampling, validation, root cause, corrective action, and effectiveness checks.",
        ["sample", "field", "validation", "root cause", "training", "system", "action", "trend", "effectiveness"],
        18,
      ),
    ],
  },
  document: {
    executive: [
      choice(
        "doc-exec-name-mismatch",
        "document_review",
        "Document Review",
        "The ID name differs from the application by one unexplained surname. What is best?",
        [
          "Accept.",
          "Follow the documented name-mismatch verification or referral process.",
          "Change the application.",
          "Reject every mismatch.",
        ],
        "Follow the documented name-mismatch verification or referral process.",
        8,
      ),
      choice(
        "doc-exec-expired",
        "document_review",
        "Document Review",
        "A document expiry date is in the past. The assessor should:",
        ["Ignore it.", "Apply the expired-document rule and correct reason.", "Edit the date.", "Use another person's document."],
        "Apply the expired-document rule and correct reason.",
        8,
      ),
      choice(
        "doc-exec-alteration",
        "document_review",
        "Document Review",
        "A suspicious alteration is visible near the date. What should happen?",
        [
          "Correct it.",
          "Use the fraud or suspicion escalation route and preserve evidence.",
          "Ignore it.",
          "Delete the case.",
        ],
        "Use the fraud or suspicion escalation route and preserve evidence.",
        8,
        "advanced",
      ),
      choice(
        "doc-exec-unreadable",
        "document_review",
        "Document Review",
        "A mandatory number is partly unreadable. The best action is to:",
        [
          "Guess the missing digits.",
          "Apply the image-quality or unreadable-field rule and request or refer as defined.",
          "Use the application value without checking.",
          "Approve because the photo is clear.",
        ],
        "Apply the image-quality or unreadable-field rule and request or refer as defined.",
        8,
      ),
      choice(
        "doc-exec-reason-code",
        "document_review",
        "Document Review",
        "Why is the correct rejection or referral reason important?",
        [
          "It only changes color on the screen.",
          "It supports correct customer communication, reporting, rework, and audit evidence.",
          "It replaces the decision.",
          "It is optional when busy.",
        ],
        "It supports correct customer communication, reporting, rework, and audit evidence.",
        8,
      ),
    ],
    team_leader: [
      choice(
        "doc-tl-risk-routing",
        "operations",
        "Document Operations",
        "What is the best queue design for high-risk documents?",
        [
          "No prioritization",
          "Risk-based routing with trained reviewers, SLA controls, and escalation visibility",
          "Freshers only",
          "Easy cases only",
        ],
        "Risk-based routing with trained reviewers, SLA controls, and escalation visibility",
        9,
      ),
      choice(
        "doc-tl-false-rejection",
        "operations",
        "Document Operations",
        "False rejection rises after a policy update. What should happen first?",
        [
          "Continue rejecting.",
          "Validate interpretation through calibration and review impacted decisions.",
          "Lower targets.",
          "Remove policy.",
        ],
        "Validate interpretation through calibration and review impacted decisions.",
        9,
      ),
      choice(
        "doc-tl-policy-version",
        "operations",
        "Document Operations",
        "How should a Team Leader control a policy change?",
        [
          "Send an informal message only.",
          "Version the instruction, confirm understanding, calibrate examples, and monitor decisions.",
          "Let every reviewer interpret it.",
          "Apply it only after errors rise.",
        ],
        "Version the instruction, confirm understanding, calibrate examples, and monitor decisions.",
        9,
        "advanced",
      ),
      choice(
        "doc-tl-referral-aging",
        "operations",
        "Document Operations",
        "Referral cases are aging without ownership. What control is strongest?",
        [
          "A shared mailbox without SLA",
          "Named ownership, aging alerts, evidence requirements, escalation levels, and closure tracking",
          "More rejection",
          "A monthly review only",
        ],
        "Named ownership, aging alerts, evidence requirements, escalation levels, and closure tracking",
        9,
      ),
      written(
        "doc-tl-case",
        "case_study",
        "Document Case Study",
        "A policy change caused inconsistent decisions across three teams. Explain containment, calibration, impacted-case review, rework, and communication.",
        ["contain", "calibration", "policy", "sample", "rework", "communication", "decision", "monitor", "impact"],
        18,
      ),
    ],
    quality_auditor: [
      choice(
        "doc-qa-unreadable-accept",
        "audit",
        "Document Audit",
        "An assessor accepts a document where the mandatory ID number is unreadable. This is likely:",
        ["No error", "False acceptance and potentially critical defect", "Typing issue", "Customer-service issue"],
        "False acceptance and potentially critical defect",
        9,
        "advanced",
      ),
      choice(
        "doc-qa-wrong-reason",
        "audit",
        "Document Audit",
        "The rejection decision is correct but the rejection reason is wrong. The auditor should:",
        [
          "Pass fully.",
          "Apply the reason-code defect because it affects communication and reporting.",
          "Change silently.",
          "Mark fraud.",
        ],
        "Apply the reason-code defect because it affects communication and reporting.",
        9,
      ),
      choice(
        "doc-qa-authenticity",
        "audit",
        "Document Audit",
        "A document looks unusual but no approved fraud indicator is met. The auditor should:",
        [
          "Declare fraud based on intuition.",
          "Apply the documented evidence standard and referral rule without unsupported conclusions.",
          "Approve automatically.",
          "Delete the image.",
        ],
        "Apply the documented evidence standard and referral rule without unsupported conclusions.",
        9,
        "advanced",
      ),
      choice(
        "doc-qa-date-format",
        "audit",
        "Document Audit",
        "A reviewer rejects 03/04/2027 because they assumed the wrong regional date format. The key control is:",
        [
          "Use personal preference.",
          "Use the document-country or policy-defined date interpretation and evidence.",
          "Reject every ambiguous date.",
          "Ignore expiry.",
        ],
        "Use the document-country or policy-defined date interpretation and evidence.",
        9,
      ),
      written(
        "doc-qa-case",
        "case_study",
        "Document Audit Case",
        "A valid document was rejected because the reviewer misunderstood the date format. Explain classification, evidence, customer impact, correction, and prevention.",
        ["false rejection", "date", "format", "evidence", "impact", "calibration", "training", "prevent", "rework"],
        18,
      ),
    ],
  },
  email: {
    executive: [
      choice(
        "email-exec-subject",
        "email_handling",
        "Email Handling",
        "Which subject line is clearest?",
        ["Hi", "Regarding your request", "Update on Ticket 45821 - Additional Document Required", "Important message"],
        "Update on Ticket 45821 - Additional Document Required",
        8,
      ),
      choice(
        "email-exec-two-requests",
        "email_handling",
        "Email Handling",
        "A customer email contains two requests. The reply should:",
        [
          "Answer the easier request.",
          "Address both requests or clearly explain the next action for each.",
          "Send a generic template.",
          "Ask for two emails.",
        ],
        "Address both requests or clearly explain the next action for each.",
        8,
      ),
      choice(
        "email-exec-tone",
        "email_handling",
        "Email Handling",
        "Which opening has the best tone for a delayed request?",
        [
          "You need to wait.",
          "We regret the delay and understand that you need a clear update.",
          "This is not our fault.",
          "As already told, wait.",
        ],
        "We regret the delay and understand that you need a clear update.",
        8,
      ),
      choice(
        "email-exec-attachment",
        "email_handling",
        "Email Handling",
        "Before sending an email that refers to an attachment, the agent should:",
        [
          "Assume it is attached.",
          "Verify the correct file, recipient, classification, and attachment are present.",
          "Send the attachment separately to everyone.",
          "Rename it randomly.",
        ],
        "Verify the correct file, recipient, classification, and attachment are present.",
        8,
      ),
      written(
        "email-exec-draft",
        "written_response",
        "Email Drafting",
        "Draft a concise reply to a customer whose refund is delayed. Acknowledge the concern, explain that review is in progress, give the next update timeline, and avoid an unapproved promise.",
        ["sorry", "concern", "review", "update", "timeline", "thank", "reference"],
        18,
      ),
    ],
    team_leader: [
      choice(
        "email-tl-backlog",
        "operations",
        "Email Operations",
        "The email queue has a growing backlog. What should be reviewed first?",
        [
          "Grammar only",
          "Arrival volume, aging, priority, handling time, staffing, and rework",
          "Seating",
          "Incentives",
        ],
        "Arrival volume, aging, priority, handling time, staffing, and rework",
        9,
      ),
      choice(
        "email-tl-template",
        "operations",
        "Email Operations",
        "Templates should be governed to:",
        [
          "Remove personalization.",
          "Ensure compliant core content while allowing relevant personalization and complete resolution.",
          "Make replies longer.",
          "Avoid quality checks.",
        ],
        "Ensure compliant core content while allowing relevant personalization and complete resolution.",
        9,
      ),
      choice(
        "email-tl-repeat-contact",
        "operations",
        "Email Operations",
        "Repeat contacts rise even though response TAT is met. What should be investigated?",
        [
          "Only typing speed",
          "Resolution completeness, clarity, ownership, and promised next steps",
          "Desk location",
          "Email font",
        ],
        "Resolution completeness, clarity, ownership, and promised next steps",
        9,
      ),
      choice(
        "email-tl-priority",
        "operations",
        "Email Operations",
        "Which allocation rule best protects high-risk email cases?",
        [
          "First name alphabetically",
          "Risk, due time, skill, language, aging, and ownership",
          "Shortest email first only",
          "Random assignment without monitoring",
        ],
        "Risk, due time, skill, language, aging, and ownership",
        9,
        "advanced",
      ),
      written(
        "email-tl-case",
        "case_study",
        "Email Case Study",
        "A queue has 300 aged emails, mixed priorities, and rising repeat contacts. Write a recovery and quality-control plan.",
        ["aging", "priority", "allocation", "repeat", "resolution", "quality", "sla", "monitor", "staffing"],
        18,
      ),
    ],
    quality_auditor: [
      choice(
        "email-qa-wrong-resolution",
        "audit",
        "Email Audit",
        "The email is grammatically correct but gives the wrong resolution. The primary defect is:",
        ["No defect", "Process or resolution accuracy defect", "Formatting", "Tone only"],
        "Process or resolution accuracy defect",
        9,
      ),
      choice(
        "email-qa-privacy",
        "audit",
        "Email Audit",
        "An email exposes another customer's account number. This is:",
        ["Spelling issue", "Critical privacy or compliance defect", "Acceptable if accidental", "Template issue"],
        "Critical privacy or compliance defect",
        9,
        "advanced",
      ),
      choice(
        "email-qa-incomplete",
        "audit",
        "Email Audit",
        "A reply answers one of two customer questions. The auditor should primarily assess:",
        ["Font", "Completeness of resolution", "Typing speed", "Greeting length"],
        "Completeness of resolution",
        9,
      ),
      choice(
        "email-qa-promise",
        "audit",
        "Email Audit",
        "A response promises closure within 24 hours when policy gives no such commitment. This is:",
        [
          "Good customer service",
          "An unsupported commitment with process and customer-expectation risk",
          "Only a punctuation issue",
          "No issue if polite",
        ],
        "An unsupported commitment with process and customer-expectation risk",
        9,
        "advanced",
      ),
      written(
        "email-qa-case",
        "case_study",
        "Email Audit Case",
        "Audit a polite, grammatically correct response that misses one of two requests and gives no next-step timeline. Explain defects, evidence, impact, and feedback.",
        ["incomplete", "request", "timeline", "customer", "resolution", "feedback", "evidence", "impact"],
        18,
      ),
    ],
  },
};

const PASSAGES: Record<AssessmentProcess, string> = {
  inbound:
    "Customer service requires patience, active listening, accurate verification, clear communication, and complete ownership. An effective representative understands the concern, checks available information, explains the approved solution, records the interaction correctly, and confirms the next step before closing the conversation.",
  outbound:
    "A professional outbound conversation begins with consent and a clear introduction. The representative identifies the customer need, explains only approved benefits, handles objections respectfully, avoids false commitments, records the outcome accurately, and follows the requested communication preference.",
  backoffice:
    "Backoffice operations depend on accuracy, consistency, confidentiality, and timely completion. Every record must be compared with source information, validated against applicable rules, entered in the correct field, and routed through the approved exception process whenever information is missing or inconsistent.",
  document:
    "Document assessment requires careful observation and consistent policy application. The reviewer checks document type, image clarity, mandatory fields, expiry, data consistency, and possible alteration indicators. Decisions must be supported by evidence and recorded using the correct acceptance, rejection, or referral reason.",
  email:
    "A professional email should identify the customer concern, acknowledge it with an appropriate tone, provide a complete and accurate response, explain the next step, avoid unsupported promises, and close politely. The subject line and formatting should make the message easy to understand and act upon.",
};

const PROCESS_LABELS: Record<AssessmentProcess, string> = {
  inbound: "Inbound Call Centre",
  outbound: "Outbound Call Centre",
  backoffice: "Backoffice",
  document: "Document Assessment",
  email: "Email Handling",
};

const ROLE_LABELS: Record<AssessmentRole, string> = {
  executive: "Executive",
  team_leader: "Team Leader",
  quality_auditor: "Quality Auditor",
};

const typingFor = (process: AssessmentProcess, role: AssessmentRole): TypingDefinition => ({
  required: ["backoffice", "document", "email"].includes(process),
  durationSeconds: 180,
  minNetWpm: role === "team_leader" ? 35 : role === "quality_auditor" ? 32 : 30,
  minAccuracy: role === "executive" ? 92 : 95,
  maxAttempts: 2,
  passage: PASSAGES[process],
});

export const DEFAULT_ASSESSMENT_TEMPLATES: AssessmentTemplateDefinition[] = (
  ["inbound", "outbound", "backoffice", "document", "email"] as AssessmentProcess[]
).flatMap((process) =>
  (["executive", "team_leader", "quality_auditor"] as AssessmentRole[]).map((role) => ({
    code: `ATS-${process.toUpperCase()}-${role.toUpperCase()}`,
    name: `${PROCESS_LABELS[process]} - ${ROLE_LABELS[role]} Assessment`,
    process,
    role,
    experienceLevel: "any",
    durationMinutes: role === "executive" ? 30 : 45,
    passingPercentage: role === "executive" ? 60 : 70,
    difficulty: role === "executive" ? "intermediate" : "advanced",
    instructions: [
      "The complete assessment can be submitted only once.",
      "All questions are mandatory unless the system marks a section optional.",
      "Typing permits a maximum of two attempts; the better submitted score is used.",
      "Correct and incorrect typing details are displayed only after a typing attempt is submitted.",
      "Do not copy, paste, use another device, or seek assistance during the assessment.",
    ],
    typing: typingFor(process, role),
    questions: [...COMMON[role], ...PROCESS_BANK[process][role]],
  })),
);

export function buildDefaultTemplates() {
  return DEFAULT_ASSESSMENT_TEMPLATES;
}

export function getDefaultTemplate(process: AssessmentProcess, role: AssessmentRole) {
  const found = DEFAULT_ASSESSMENT_TEMPLATES.find(
    (template) => template.process === process && template.role === role,
  );
  if (!found) throw new Error(`Assessment template not found for ${process}/${role}`);
  return found;
}

export function publicTemplate(template: AssessmentTemplateDefinition) {
  const { passage: _passage, ...typing } = template.typing;
  return {
    ...template,
    questionCount: template.questions.length,
    typing,
    questions: template.questions.map(
      ({ correctAnswer: _correctAnswer, keywords: _keywords, explanation: _explanation, ...safe }) => safe,
    ),
  };
}
