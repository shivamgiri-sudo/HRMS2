/**
 * question-bank-seed-fresher.ts
 * Fresher-level questions for backoffice and call-centre executive roles.
 * No industry jargon assumed. Tests: comprehension, aptitude, proofreading,
 * attention to detail, basic data safety — all in plain everyday language.
 *
 * Codes: BF = Backoffice Fresher, CCF = Call Centre Fresher
 * Sets 1-3 per process. Run via: npx tsx scripts/seed-question-bank-fresher.ts
 */

import { importQuestions } from "./question-bank.service.js";

function q(
  code: string, processKey: string, roleKey: string,
  sectionKey: string, sectionTitle: string,
  type: "single" | "multi" | "text",
  difficulty: "basic" | "intermediate" | "advanced",
  prompt: string,
  options: string[] | undefined,
  correctAnswer: string | string[] | undefined,
  marks: number, setNumber: number,
  explanation?: string, keywords?: string[], manualReview = false,
) {
  return { questionCode: code, processKey: processKey as any, roleKey: roleKey as any,
    sectionKey, sectionTitle, questionType: type, difficultyLevel: difficulty,
    prompt, options, correctAnswer, keywords, explanation, marks, manualReview, setNumber };
}

// ─── PASSAGE A (used in BF Set 1 comprehension) ────────────────────────────
const PASSAGE_A = `Read the following passage carefully and answer the question.\n\n` +
`"Meera joined a data entry company after completing her graduation. On her first day, her manager gave her a simple rule: always double-check what you type before saving. Meera found this boring at first, but one day she accidentally typed a customer's account number wrong. The company had to spend two hours fixing the mistake. After that, Meera understood why accuracy matters. She started verifying every entry and her error rate dropped to almost zero within a month."`;

// ─── PASSAGE B (used in BF Set 2 comprehension) ────────────────────────────
const PASSAGE_B = `Read the following passage carefully and answer the question.\n\n` +
`"Rahul works in a backoffice team that processes loan application documents. One afternoon, a colleague asked Rahul to share a customer's address on WhatsApp so a courier could be sent. Rahul was not sure if this was allowed. He remembered that his company had a rule: customer information should only be shared through official channels. Instead of sending it on WhatsApp, Rahul raised a request through the internal portal and the courier was arranged the proper way. His manager appreciated his decision."`;

// ─── PASSAGE C (used in CCF Set 1 comprehension) ───────────────────────────
const PASSAGE_C = `Read the following passage carefully and answer the question.\n\n` +
`"Priya was nervous on her first day at the call centre. Her trainer told her: 'When a customer is angry, do not argue. First say sorry for the inconvenience, then listen carefully to understand the problem, then offer a solution.' Priya practiced this method. In her first week she received a call from a very angry customer who had been charged twice. Priya apologised, listened without interrupting, checked the account, and confirmed the refund would arrive in 5 days. The customer ended the call satisfied."`;

// ─── PASSAGE D (used in CCF Set 2 comprehension) ───────────────────────────
const PASSAGE_D = `Read the following passage carefully and answer the question.\n\n` +
`"A good call centre agent treats every customer's time as valuable. Before putting a customer on hold, the agent should always explain why the hold is needed and ask for permission. If the hold takes more than 2 minutes, the agent should check back and update the customer. Ending a call without resolving the issue or without giving a reference number is considered poor service. A simple closing like 'Is there anything else I can help you with today?' shows professionalism."`;

// ═══════════════════════════════════════════════════════════════════════════
// BACKOFFICE FRESHER — SET 1
// ═══════════════════════════════════════════════════════════════════════════
const bfSet1 = [

  // COMPREHENSION
  q("BF-S1-001","backoffice","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_A + "\n\nWhat simple rule did Meera's manager give her on the first day?",
    ["Come to work on time","Always double-check what you type before saving","Never talk to customers directly","Use a password for every file"],
    "Always double-check what you type before saving",
    10,1,"The rule is stated directly in the first two sentences of the passage."),

  q("BF-S1-002","backoffice","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_A + "\n\nWhat happened when Meera typed the account number wrong?",
    ["The customer complained directly","The company had to spend two hours fixing the mistake","Meera was fired","Nothing happened"],
    "The company had to spend two hours fixing the mistake",
    10,1),

  q("BF-S1-003","backoffice","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_A + "\n\nWhat is the main lesson from this passage?",
    ["Freshers should not be given important work","Speed is more important than accuracy","Verifying your work carefully prevents costly mistakes","Managers should do the checking themselves"],
    "Verifying your work carefully prevents costly mistakes",
    10,1),

  // APTITUDE
  q("BF-S1-004","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "A data entry operator processes 120 forms in 4 hours. How many forms will they process in 6 hours at the same speed?",
    ["150","180","200","240"],
    "180",
    10,1,"120 ÷ 4 = 30 forms/hour. 30 × 6 = 180."),

  q("BF-S1-005","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "Which number comes next in the series: 2, 4, 8, 16, ___?",
    ["18","24","32","36"],
    "32",
    10,1,"Each number doubles: 16 × 2 = 32."),

  q("BF-S1-006","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "If today is Wednesday, what day will it be after 10 days?",
    ["Friday","Saturday","Sunday","Monday"],
    "Saturday",
    10,1,"10 days from Wednesday: Wed+10 = 7+3 = Saturday."),

  q("BF-S1-007","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "Out of 50 documents received, 8 had errors. What percentage had errors?",
    ["8%","16%","12%","18%"],
    "16%",
    10,1,"8 ÷ 50 × 100 = 16%."),

  // PROOFREADING
  q("BF-S1-008","backoffice","executive","proofreading","Proofreading & Spelling","single","basic",
    "Which of the following sentences has a spelling mistake?",
    [
      "The document was recieved yesterday.",
      "Please verify the account number.",
      "All records have been updated.",
      "The form was submitted on time."
    ],
    "The document was recieved yesterday.",
    10,1,"'recieved' is incorrect. The correct spelling is 'received'. Remember: I before E except after C."),

  q("BF-S1-009","backoffice","executive","proofreading","Proofreading & Spelling","single","basic",
    "Find the error in this sentence: 'The customer's adress has been updated in the system.'",
    ["customer's","adress","updated","system"],
    "adress",
    10,1,"'adress' should be 'address' — double 'd'."),

  q("BF-S1-010","backoffice","executive","proofreading","Proofreading & Spelling","single","basic",
    "Which word is spelled correctly?",
    ["Reciept","Receit","Receipt","Recepit"],
    "Receipt",
    10,1),

  // ATTENTION TO DETAIL
  q("BF-S1-011","backoffice","executive","attention_detail","Attention to Detail","single","basic",
    "Look at these two reference numbers carefully:\n\nNumber A: MCN-2024-00871\nNumber B: MCN-2024-00817\n\nAre they the same?",
    ["Yes, they are the same","No, they are different — digit 8 and 1 are swapped","No, the year is different","Yes, only the prefix differs"],
    "No, they are different — digit 8 and 1 are swapped",
    10,1,"00871 ≠ 00817. Always compare digit by digit."),

  q("BF-S1-012","backoffice","executive","attention_detail","Attention to Detail","single","basic",
    "A form requires the date in DD/MM/YYYY format. A customer has written '15-8-2024'. What is the correctly formatted version?",
    ["08/15/2024","15/08/2024","2024/08/15","15/8/24"],
    "15/08/2024",
    10,1,"DD/MM/YYYY = 15/08/2024. Month must be two digits."),

  q("BF-S1-013","backoffice","executive","attention_detail","Attention to Detail","multi","basic",
    "You are checking a filled application form. Which of the following would you flag as needing correction? (Select all that apply)",
    [
      "Mobile number has only 9 digits instead of 10",
      "Name is written in capital letters",
      "Date of birth field is left blank",
      "Email address has no '@' symbol",
      "Signature is present"
    ],
    ["Mobile number has only 9 digits instead of 10","Date of birth field is left blank","Email address has no '@' symbol"],
    15,1),

  // BASIC DATA SAFETY
  q("BF-S1-014","backoffice","executive","data_safety","Basic Data Safety","single","basic",
    "You finish your work and leave your desk for lunch. Your computer screen shows a customer's personal details. What should you do before leaving?",
    ["Leave it — you'll be back in 30 minutes","Minimize the window only","Lock the computer screen","Ask a colleague to watch your screen"],
    "Lock the computer screen",
    10,1,"Locking the screen takes 1 second and prevents anyone from reading customer data."),

  q("BF-S1-015","backoffice","executive","data_safety","Basic Data Safety","single","basic",
    "A friend who also works in your company asks you to share a customer's phone number on your personal WhatsApp. You should:",
    ["Share it — they are a colleague","Share only if the customer's issue is urgent","Not share it — customer data must only be shared through official work systems","Share it but delete the message later"],
    "Not share it — customer data must only be shared through official work systems",
    10,1,"Personal messaging apps are not secure channels for customer data, even between colleagues."),
];

// ═══════════════════════════════════════════════════════════════════════════
// BACKOFFICE FRESHER — SET 2
// ═══════════════════════════════════════════════════════════════════════════
const bfSet2 = [

  // COMPREHENSION
  q("BF-S2-001","backoffice","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_B + "\n\nWhy did Rahul's colleague ask him to share the customer's address on WhatsApp?",
    ["To send a gift to the customer","So a courier could be sent","To verify the customer's identity","To update the system"],
    "So a courier could be sent",
    10,2),

  q("BF-S2-002","backoffice","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_B + "\n\nWhat did Rahul do instead of sending the address on WhatsApp?",
    ["He called the customer directly","He refused to help his colleague","He raised a request through the internal portal","He asked his manager for permission to use WhatsApp"],
    "He raised a request through the internal portal",
    10,2),

  q("BF-S2-003","backoffice","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_B + "\n\nWhat does this passage tell us about sharing customer information?",
    ["It can be shared on any platform as long as it is for a good reason","It should only be shared through official channels","WhatsApp is acceptable if it is urgent","Only managers are allowed to share customer data"],
    "It should only be shared through official channels",
    10,2),

  // APTITUDE
  q("BF-S2-004","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "A team of 3 people can process 90 files in a day. How many files can 5 people process in a day at the same rate?",
    ["120","150","135","180"],
    "150",
    10,2,"3 people → 90 files. 1 person → 30 files. 5 people → 150 files."),

  q("BF-S2-005","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "APPLE is to FRUIT as ROSE is to ___",
    ["Garden","Colour","Flower","Plant"],
    "Flower",
    10,2,"Apple is a type of fruit. Rose is a type of flower."),

  q("BF-S2-006","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "If you earn ₹15,000 per month, how much do you earn in a year?",
    ["₹1,50,000","₹1,70,000","₹1,80,000","₹2,00,000"],
    "₹1,80,000",
    10,2,"15,000 × 12 = 1,80,000."),

  q("BF-S2-007","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "Which of the following is the odd one out?",
    ["Keyboard","Mouse","Monitor","Chair"],
    "Chair",
    10,2,"Keyboard, Mouse and Monitor are computer hardware devices. Chair is furniture."),

  // PROOFREADING
  q("BF-S2-008","backoffice","executive","proofreading","Proofreading & Spelling","single","basic",
    "Which sentence is grammatically correct?",
    [
      "She don't know the answer.",
      "She doesn't knows the answer.",
      "She doesn't know the answer.",
      "She do not knows the answer."
    ],
    "She doesn't know the answer.",
    10,2),

  q("BF-S2-009","backoffice","executive","proofreading","Proofreading & Spelling","single","basic",
    "Spot the incorrectly spelled word in this list:",
    ["Necessary","Accomodate","Acknowledge","Separate"],
    "Accomodate",
    10,2,"Correct spelling is 'Accommodate' — double 'c' and double 'm'."),

  q("BF-S2-010","backoffice","executive","proofreading","Proofreading & Spelling","single","basic",
    "A data entry form shows: 'Date of Bith: 12/05/2000'. What is wrong?",
    ["The date format is wrong","'Bith' is a spelling error — should be 'Birth'","The year is incorrect","Nothing is wrong"],
    "'Bith' is a spelling error — should be 'Birth'",
    10,2),

  // ATTENTION TO DETAIL
  q("BF-S2-011","backoffice","executive","attention_detail","Attention to Detail","single","basic",
    "A bank account number is 4521 8834 0091. Someone has entered it as 4521 8834 0019. Is it correct?",
    ["Yes, it is the same","No — the last two digits are reversed: 91 became 19","No — the middle four digits are wrong","Yes — small differences are acceptable"],
    "No — the last two digits are reversed: 91 became 19",
    10,2),

  q("BF-S2-012","backoffice","executive","attention_detail","Attention to Detail","single","basic",
    "Count how many times the letter 'e' appears in this sentence: 'The employee entered the details carefully before saving.'",
    ["9","10","11","12"],
    "11",
    10,2,"Count every 'e' (case-insensitive): The(1), employee(3), entered(2), the(1), details(1), carefully(1), before(2) = 11."),

  q("BF-S2-013","backoffice","executive","attention_detail","Attention to Detail","single","basic",
    "Below are two addresses. Are they the same?\n\nAddress A: 14B, Sector 22, Noida – 201301\nAddress B: 14B, Sector 22, Noida – 201301",
    ["Yes, they are identical","No, the sector number is different","No, the PIN code is different","No, the house number is different"],
    "Yes, they are identical",
    10,2,"Careful reading confirms both are exactly the same."),

  // DATA SAFETY
  q("BF-S2-014","backoffice","executive","data_safety","Basic Data Safety","single","basic",
    "You receive a printed document with a customer's bank details. After you have finished using it, what should you do with it?",
    ["Leave it on your desk for later","Put it in the general waste bin","Shred it or dispose of it as per your company's secure disposal policy","Give it to a colleague to keep"],
    "Shred it or dispose of it as per your company's secure disposal policy",
    10,2,"Printed documents with personal data must be securely destroyed, not just thrown away."),

  q("BF-S2-015","backoffice","executive","data_safety","Basic Data Safety","text","basic",
    "In your own simple words, explain why it is important NOT to share a customer's personal information with people who do not need it for their work.",
    undefined, undefined,
    15,2,
    undefined,
    ["privacy","trust","data protection","need to know","customer safety"],
    true),
];

// ═══════════════════════════════════════════════════════════════════════════
// BACKOFFICE FRESHER — SET 3
// ═══════════════════════════════════════════════════════════════════════════
const bfSet3 = [

  // COMPREHENSION (short standalone)
  q("BF-S3-001","backoffice","executive","comprehension","Reading Comprehension","single","basic",
    `Read this paragraph and answer:\n\n"When filling any official form, always use blue or black ink, write clearly in CAPITAL letters, do not leave any required field blank, and do not use correction fluid (whitener). If you make a mistake, draw a single line through it and initial next to it."\n\nAccording to the paragraph, what should you do if you make a mistake on a form?`,
    ["Use whitener to cover it","Tear the form and start again","Draw a single line through it and initial next to it","Leave it and mention it verbally"],
    "Draw a single line through it and initial next to it",
    10,3),

  q("BF-S3-002","backoffice","executive","comprehension","Reading Comprehension","single","basic",
    `Read this instruction and answer:\n\n"All inward documents must be time-stamped on receipt, logged in the tracking register within 15 minutes, and assigned to the relevant team member within 1 hour. Documents received after 5 PM will be processed the next working day."\n\nA document arrives at 5:30 PM on Monday. When will it be processed?`,
    ["Monday evening before close of business","Same day if the team has capacity","Tuesday, the next working day","Within 1 hour of receipt"],
    "Tuesday, the next working day",
    10,3),

  // APTITUDE
  q("BF-S3-003","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "Which of the following does NOT belong in this group: January, March, June, August?",
    ["January","March","June","August"],
    "June",
    10,3,"January (31), March (31), August (31) all have 31 days. June has 30 days."),

  q("BF-S3-004","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "A file has 200 pages. You have read 75 pages. What percentage is remaining?",
    ["62.5%","37.5%","55%","65%"],
    "62.5%",
    10,3,"Remaining = 125 pages. 125 ÷ 200 × 100 = 62.5%."),

  q("BF-S3-005","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "If 'CAT' is coded as 'DBU', what is the code for 'DOG'?",
    ["EPH","EQH","EPG","FPH"],
    "EPH",
    10,3,"Each letter moves one step forward in the alphabet: D→E, O→P, G→H."),

  q("BF-S3-006","backoffice","executive","aptitude","Aptitude & Reasoning","single","basic",
    "A train leaves at 9:45 AM and the journey takes 2 hours 30 minutes. What time does it arrive?",
    ["11:45 AM","12:00 PM","12:15 PM","12:30 PM"],
    "12:15 PM",
    10,3,"9:45 + 2:30 = 12:15 PM."),

  // PROOFREADING
  q("BF-S3-007","backoffice","executive","proofreading","Proofreading & Spelling","single","basic",
    "Read this sentence and find the error:\n'The manger reviewed all the documents before approving them.'",
    ["manger (should be manager)","reviewed","approving","documents"],
    "manger (should be manager)",
    10,3,"'Manger' means a feeding trough. The word needed is 'manager'."),

  q("BF-S3-008","backoffice","executive","proofreading","Proofreading & Spelling","single","basic",
    "Which sentence uses punctuation correctly?",
    [
      "The office, is open from 9 AM to 6 PM.",
      "The office is open from 9 AM to 6 PM.",
      "The office is open, from 9 AM, to 6 PM.",
      "The office is open from 9 AM, to 6 PM."
    ],
    "The office is open from 9 AM to 6 PM.",
    10,3),

  q("BF-S3-009","backoffice","executive","proofreading","Proofreading & Spelling","single","basic",
    "How many errors are in this sentence: 'Please insure that all the relevent documants are submitted by friday.'",
    ["1","2","3","4"],
    "4",
    10,3,"Errors: 'insure'→'ensure', 'relevent'→'relevant', 'documants'→'documents', 'friday'→'Friday' (proper noun)."),

  // ATTENTION TO DETAIL
  q("BF-S3-010","backoffice","executive","attention_detail","Attention to Detail","single","basic",
    "Five names are listed. Which one is spelled differently from the others?\n\nA) Suresh Kumar\nB) Suresh Kumar\nC) Suresh Kumar\nD) Suresh Kuamr\nE) Suresh Kumar",
    ["A","B","D","E"],
    "D",
    10,3,"Option D: 'Kuamr' is a transposition error — should be 'Kumar'."),

  q("BF-S3-011","backoffice","executive","attention_detail","Attention to Detail","single","basic",
    "A form asks for a 10-digit mobile number. A customer has written: 98765-4321. What is the problem?",
    ["The number has a hyphen which is fine","The number has only 9 digits — one digit is missing","The number starts with 9 which is invalid","There is no problem"],
    "The number has only 9 digits — one digit is missing",
    10,3,"98765-4321 = 9 digits. A valid Indian mobile number has 10 digits."),

  q("BF-S3-012","backoffice","executive","attention_detail","Attention to Detail","multi","basic",
    "You are comparing a scanned document with data entered in the system. Which of these are errors that need to be corrected? (Select all that apply)",
    [
      "Document says DOB: 22/07/1999 — System shows: 22/07/1999",
      "Document says Name: Amit Sharma — System shows: Amit Sharme",
      "Document says PAN: ABCDE1234F — System shows: ABCDE1234F",
      "Document says Mobile: 9876543210 — System shows: 9876453210",
      "Document says City: Pune — System shows: Pune"
    ],
    ["Document says Name: Amit Sharma — System shows: Amit Sharme","Document says Mobile: 9876543210 — System shows: 9876453210"],
    15,3),

  // DATA SAFETY
  q("BF-S3-013","backoffice","executive","data_safety","Basic Data Safety","single","basic",
    "Someone you don't know calls you and says they are from the IT department. They ask for your computer login password to fix a problem remotely. What should you do?",
    ["Give them the password — IT needs it to help","Give only your username, not the password","Do not share your password and report the call to your supervisor","Change your password immediately and then share the new one"],
    "Do not share your password and report the call to your supervisor",
    10,3,"No legitimate IT support team ever needs your password. This is a common social engineering trick."),

  q("BF-S3-014","backoffice","executive","data_safety","Basic Data Safety","single","basic",
    "Which of the following is the safest way to create a password for your work computer?",
    ["Your name and date of birth (e.g., Ravi1995)","A mix of letters, numbers and symbols that is not easy to guess (e.g., T#7mK!2v)","The word 'password' because it is easy to remember","Your employee ID"],
    "A mix of letters, numbers and symbols that is not easy to guess (e.g., T#7mK!2v)",
    10,3,"Passwords based on personal info are easy to guess. Strong passwords use a mix of character types."),

  q("BF-S3-015","backoffice","executive","data_safety","Basic Data Safety","single","basic",
    "You accidentally send a customer's details to the wrong email address. What is the FIRST thing you should do?",
    ["Ignore it and hope the recipient doesn't notice","Tell a friend on the team","Immediately inform your supervisor or team leader and follow the company's mistake reporting process","Delete the sent email"],
    "Immediately inform your supervisor or team leader and follow the company's mistake reporting process",
    10,3,"Quick reporting allows the company to take action to reduce harm. Hiding mistakes makes things worse."),
];

// ═══════════════════════════════════════════════════════════════════════════
// CALL CENTRE FRESHER — SET 1
// ═══════════════════════════════════════════════════════════════════════════
const ccfSet1 = [

  // COMPREHENSION
  q("CCF-S1-001","inbound","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_C + "\n\nWhat does Priya's trainer say is the FIRST thing to do when a customer is angry?",
    ["Offer a solution immediately","Transfer the call to a senior","Say sorry for the inconvenience","Ask the customer to calm down"],
    "Say sorry for the inconvenience",
    10,1,"The trainer's exact steps were: first say sorry, then listen, then offer a solution."),

  q("CCF-S1-002","inbound","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_C + "\n\nWhat was the customer's problem when they called Priya?",
    ["Their internet was not working","They had been charged twice","Their account was locked","Their order had not arrived"],
    "They had been charged twice",
    10,1),

  q("CCF-S1-003","inbound","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_C + "\n\nWhat is the main lesson of this passage?",
    ["Freshers should not take difficult calls","Listening to an angry customer carefully and offering a clear solution leads to a satisfied customer","Customers are always right even when they are wrong","Speed of resolution matters more than empathy"],
    "Listening to an angry customer carefully and offering a clear solution leads to a satisfied customer",
    10,1),

  // APTITUDE
  q("CCF-S1-004","inbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "An agent handles 8 calls per hour. How many calls will they handle in a 9-hour shift?",
    ["62","70","72","80"],
    "72",
    10,1,"8 × 9 = 72."),

  q("CCF-S1-005","inbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "If a customer calls at 2:45 PM and the call lasts 12 minutes, what time does the call end?",
    ["2:55 PM","2:57 PM","3:00 PM","2:53 PM"],
    "2:57 PM",
    10,1,"2:45 + 12 min = 2:57 PM."),

  q("CCF-S1-006","inbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "A HAPPY customer is to SATISFIED as an ANGRY customer is to ___",
    ["Cheerful","Upset","Confused","Grateful"],
    "Upset",
    10,1,"Happy and satisfied are synonyms. Angry and upset are synonyms."),

  q("CCF-S1-007","inbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "Out of 200 customer surveys, 160 gave a rating of 4 or 5 stars. What percentage were satisfied?",
    ["70%","75%","80%","85%"],
    "80%",
    10,1,"160 ÷ 200 × 100 = 80%."),

  // PROOFREADING
  q("CCF-S1-008","inbound","executive","proofreading","Proofreading & Written Communication","single","basic",
    "Which message to a customer is written most professionally?",
    [
      "your complaint is noted we will look into it",
      "Thank you for reaching out. Your complaint has been noted and we will resolve it within 24 hours.",
      "We noted ur complaint. Will fix ASAP.",
      "Dear customer complaint noted."
    ],
    "Thank you for reaching out. Your complaint has been noted and we will resolve it within 24 hours.",
    10,1,"Professional communication is complete, polite, and includes a clear timeframe."),

  q("CCF-S1-009","inbound","executive","proofreading","Proofreading & Written Communication","single","basic",
    "Find the spelling mistake: 'We sincerely appologise for the inconvenience caused.'",
    ["sincerely","appologise","inconvenience","caused"],
    "appologise",
    10,1,"Correct spelling is 'apologise' — single 'p'."),

  // ATTENTION TO DETAIL
  q("CCF-S1-010","inbound","executive","attention_detail","Attention to Detail","single","basic",
    "A customer gives their reference number as TKT-2024-00456. You check the system and find TKT-2024-00465. What should you do?",
    ["Process it — close enough","Flag the mismatch and confirm the correct number with the customer","Assume the customer made an error and proceed with the system number","Ask the customer to call back"],
    "Flag the mismatch and confirm the correct number with the customer",
    10,1,"A single transposed digit can mean it is a completely different customer's record."),

  q("CCF-S1-011","inbound","executive","attention_detail","Attention to Detail","single","basic",
    "A customer spells their name: R-A-K-E-S-H  S-H-A-R-M-A. You type: Rakesh Sharma. Is this correct?",
    ["Yes, it is correct","No, the first name is wrong","No, the last name is wrong","No, both names are wrong"],
    "Yes, it is correct",
    10,1),

  // COMMUNICATION & CUSTOMER SERVICE
  q("CCF-S1-012","inbound","executive","communication","Communication Skills","single","basic",
    "A customer is speaking very fast and you miss part of what they said. You should:",
    ["Guess what they said and proceed","Stay quiet and hope they repeat it","Politely say: 'I am sorry, could you please repeat that? I want to make sure I have the correct details.'","Transfer the call immediately"],
    "Politely say: 'I am sorry, could you please repeat that? I want to make sure I have the correct details.'",
    10,1),

  q("CCF-S1-013","inbound","executive","communication","Communication Skills","single","basic",
    "Which greeting is the most professional way to open an inbound call?",
    ["'Hello, who is this?'","'Yeah, what do you need?'","'Good morning, thank you for calling MAS Callnet. This is [Your Name]. How can I help you today?'","'Hi, speak up please.'"],
    "'Good morning, thank you for calling MAS Callnet. This is [Your Name]. How can I help you today?'",
    10,1),

  q("CCF-S1-014","inbound","executive","communication","Communication Skills","single","basic",
    "Before putting a customer on hold, you must:",
    ["Just press the hold button","Tell the customer you are putting them on hold, give a reason, and wait for them to agree","Ask a colleague if it is okay to hold","Put them on hold for as long as needed without saying anything"],
    "Tell the customer you are putting them on hold, give a reason, and wait for them to agree",
    10,1),

  q("CCF-S1-015","inbound","executive","communication","Communication Skills","text","basic",
    "A customer calls and says: 'I have been waiting for my refund for 10 days and nobody has helped me.' Write in 2-3 simple sentences how you would respond at the start of this call.",
    undefined, undefined,
    15,1,undefined,
    ["apologise","empathy","listen","refund","help","check"],
    true),
];

// ═══════════════════════════════════════════════════════════════════════════
// CALL CENTRE FRESHER — SET 2
// ═══════════════════════════════════════════════════════════════════════════
const ccfSet2 = [

  // COMPREHENSION
  q("CCF-S2-001","inbound","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_D + "\n\nAccording to the passage, what must you do before putting a customer on hold?",
    ["Just put them on hold quickly to save time","Explain why the hold is needed and ask for their permission","Transfer them to another agent instead","Ask your supervisor first"],
    "Explain why the hold is needed and ask for their permission",
    10,2),

  q("CCF-S2-002","inbound","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_D + "\n\nIf a hold lasts more than 2 minutes, what should the agent do?",
    ["Let the customer continue waiting quietly","End the call and call back","Check back with the customer and give an update","Nothing — 2 minutes is normal"],
    "Check back with the customer and give an update",
    10,2),

  q("CCF-S2-003","inbound","executive","comprehension","Reading Comprehension","single","basic",
    PASSAGE_D + "\n\nWhich closing question does the passage suggest shows professionalism?",
    ["'Thanks, bye.'","'Is there anything else I can help you with today?'","'Are you satisfied now?'","'Please call back if needed.'"],
    "'Is there anything else I can help you with today?'",
    10,2),

  // APTITUDE
  q("CCF-S2-004","inbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "A call centre team has 12 agents. Each agent handles an average of 50 calls per day. How many calls does the whole team handle per day?",
    ["500","550","600","650"],
    "600",
    10,2,"12 × 50 = 600."),

  q("CCF-S2-005","inbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "The word 'LISTEN' has the same letters as which other word?",
    ["SILENT","ENLIST","TINSEL","All of the above"],
    "All of the above",
    10,2,"LISTEN, SILENT, ENLIST and TINSEL are all anagrams of each other."),

  q("CCF-S2-006","inbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "An agent's target is to handle 40 calls in a shift. By lunch they have handled 22. How many more do they need to reach their target?",
    ["16","18","20","22"],
    "18",
    10,2,"40 − 22 = 18."),

  q("CCF-S2-007","inbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "Which word is most opposite in meaning to 'PATIENT'?",
    ["Calm","Impatient","Careful","Relaxed"],
    "Impatient",
    10,2),

  // PROOFREADING
  q("CCF-S2-008","inbound","executive","proofreading","Proofreading & Written Communication","single","basic",
    "A colleague has written this note to hand over to the next shift: 'Customer called about a billing issue. There complaint has been escalated.' What is wrong?",
    ["'billing' should be 'bill'","'There' should be 'Their'","'escalated' is spelled wrong","Nothing is wrong"],
    "'There' should be 'Their'",
    10,2,"'There' refers to a place. 'Their' shows possession — it belongs to the customer."),

  q("CCF-S2-009","inbound","executive","proofreading","Proofreading & Written Communication","single","basic",
    "Which sentence correctly expresses the same idea: 'The customer want a refund.'",
    ["The customer wants a refund.","The customers want a refund.","The customer wanting a refund.","The customer are wanting a refund."],
    "The customer wants a refund.",
    10,2,"'Customer' is singular, so the verb must be 'wants'."),

  // ATTENTION TO DETAIL
  q("CCF-S2-010","inbound","executive","attention_detail","Attention to Detail","single","basic",
    "A customer gives their email as: ravi.sharma@gmail.com\nYou type: ravi.sarma@gmail.com\nIs there an error?",
    ["No, both are the same","Yes — 'sharma' has been typed as 'sarma'","Yes — the domain is wrong","No — email spelling does not matter"],
    "Yes — 'sharma' has been typed as 'sarma'",
    10,2,"'sh' became 's' — a single missed letter in an email address means the customer will never receive your message."),

  q("CCF-S2-011","inbound","executive","attention_detail","Attention to Detail","single","basic",
    "You need to read back a phone number to confirm: 9 8 7 6 5 4 3 2 1 0. A colleague says you should read it as '9876543210'. Is that right?",
    ["Yes, reading the whole number together is fine","No, you should group it as 98765-43210 for clarity","No, you should ask the customer to repeat it","No, phone numbers should not be read back"],
    "No, you should group it as 98765-43210 for clarity",
    10,2,"Grouping digits makes it easier for the customer to follow and catch any errors."),

  // COMMUNICATION
  q("CCF-S2-012","inbound","executive","communication","Communication Skills","single","basic",
    "A customer uses rude language during the call. What is the correct first response?",
    ["Use the same tone back","Hang up immediately","Calmly ask them to speak politely, saying that you are here to help","Transfer the call silently"],
    "Calmly ask them to speak politely, saying that you are here to help",
    10,2),

  q("CCF-S2-013","inbound","executive","communication","Communication Skills","single","basic",
    "At the end of a call, what should you always do before hanging up?",
    ["Just say 'bye' and end it","Confirm whether the customer's issue has been resolved and if they need anything else","Put them on hold one more time","Ask them to rate the call immediately"],
    "Confirm whether the customer's issue has been resolved and if they need anything else",
    10,2),

  q("CCF-S2-014","inbound","executive","communication","Communication Skills","single","basic",
    "A customer is speaking in Hindi and you understand Hindi. You should:",
    ["Insist on English only — it is the official language","Respond in Hindi to make the customer comfortable","Pretend you do not understand Hindi","Ask them to switch to English"],
    "Respond in Hindi to make the customer comfortable",
    10,2,"Customer comfort increases satisfaction. Use the language that helps the customer best."),

  q("CCF-S2-015","inbound","executive","communication","Communication Skills","text","basic",
    "A customer asks you: 'Can you guarantee that this problem will never happen again?' You do not know for sure. Write a simple, honest reply in 2-3 sentences.",
    undefined, undefined,
    15,2,undefined,
    ["honest","transparent","reassure","steps","no false promise","trust"],
    true),
];

// ═══════════════════════════════════════════════════════════════════════════
// CALL CENTRE FRESHER — SET 3  (also applies to outbound)
// ═══════════════════════════════════════════════════════════════════════════
const ccfSet3 = [

  q("CCF-S3-001","inbound","executive","comprehension","Reading Comprehension","single","basic",
    `Read this and answer:\n\n"A positive attitude on a call makes a bigger difference than most new agents realise. Customers can hear when you are smiling — your voice sounds warmer and more helpful. Even on a very busy day with many difficult calls, taking a 30-second deep breath before picking up the next call helps reset your tone. Customers respond better to agents who sound calm and genuine."\n\nAccording to the passage, what does smiling while on a call affect?`,
    ["The speed of the call","How the agent's voice sounds to the customer","The content of what you say","The call recording quality"],
    "How the agent's voice sounds to the customer",
    10,3),

  q("CCF-S3-002","inbound","executive","comprehension","Reading Comprehension","single","basic",
    `Read and answer:\n\n"When a customer asks a question you do not know the answer to, the worst thing to do is make up an answer. Giving wrong information can cause the customer real problems and damage the company's reputation. The right thing to do is to say: 'That's a great question. Let me find the correct information for you.' Then either look it up, put them on a brief hold, or offer to call back with the right answer."\n\nWhat is the WORST thing to do when you don't know the answer?`,
    ["Ask the customer to hold","Make up an answer","Offer to call back","Look it up in the system"],
    "Make up an answer",
    10,3),

  // APTITUDE
  q("CCF-S3-003","inbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "If you work a 5-day week and handle 60 calls each day, how many calls do you handle in 4 weeks?",
    ["1,000","1,100","1,200","1,400"],
    "1,200",
    10,3,"60 × 5 = 300 per week. 300 × 4 = 1,200."),

  q("CCF-S3-004","inbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "DOCTOR is to PATIENT as TEACHER is to ___",
    ["School","Subject","Student","Classroom"],
    "Student",
    10,3,"A doctor serves a patient. A teacher serves a student."),

  q("CCF-S3-005","inbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "A customer says their bill of ₹850 has an extra charge of ₹120 added by mistake. What should their correct bill be?",
    ["₹700","₹730","₹750","₹970"],
    "₹730",
    10,3,"₹850 − ₹120 = ₹730."),

  // PROOFREADING
  q("CCF-S3-006","inbound","executive","proofreading","Proofreading & Written Communication","single","basic",
    "Which of these call notes is written most clearly?",
    [
      "cust angry refund needed asap billing",
      "Customer called regarding double billing charge. Refund of ₹500 initiated. Expected credit in 5 working days. Reference: TKT-9921.",
      "Customer wants money back. Will do.",
      "Billing problem. Refund. 5 days maybe."
    ],
    "Customer called regarding double billing charge. Refund of ₹500 initiated. Expected credit in 5 working days. Reference: TKT-9921.",
    10,3,"Good call notes are clear, complete and include amounts, timelines and reference numbers."),

  q("CCF-S3-007","inbound","executive","proofreading","Proofreading & Written Communication","single","basic",
    "Spot the error: 'The refund will be credited to you're account within 3 business days.'",
    ["refund","credited","you're (should be your)","business"],
    "you're (should be your)",
    10,3,"'You're' = you are. 'Your' = belonging to you. 'To your account' is correct."),

  // ATTENTION TO DETAIL
  q("CCF-S3-008","inbound","executive","attention_detail","Attention to Detail","single","basic",
    "A customer says their ticket number is TKT-2024-88721. The system shows TKT-2024-88712. Are these the same?",
    ["Yes, they are the same","No — the last two digits are different (21 vs 12)","No — the year is different","Yes — close enough to proceed"],
    "No — the last two digits are different (21 vs 12)",
    10,3),

  q("CCF-S3-009","inbound","executive","attention_detail","Attention to Detail","multi","basic",
    "After a call, you are updating the customer record. Which of these are ERRORS you would fix before saving? (Select all that apply)",
    [
      "Name: Sunita Verma → System: Sunita Verma ✓",
      "Mobile: 9845612300 → System: 9845621300",
      "Email: sunita@gmail.com → System: sunita@gmail.com ✓",
      "Issue type: Billing → System: Billing ✓",
      "Date of call: 15/07/2024 → System: 15/07/2024 ✓",
      "Ticket no: TKT-5521 → System: TKT-5512"
    ],
    ["Mobile: 9845612300 → System: 9845621300","Ticket no: TKT-5521 → System: TKT-5512"],
    15,3),

  // COMMUNICATION
  q("CCF-S3-010","inbound","executive","communication","Communication Skills","single","basic",
    "What does 'active listening' mean on a call?",
    ["Talking more than the customer so the call is quick","Paying full attention to what the customer is saying and not thinking about what to say next","Listening to music while the customer talks","Writing your personal notes while the customer explains"],
    "Paying full attention to what the customer is saying and not thinking about what to say next",
    10,3),

  q("CCF-S3-011","inbound","executive","communication","Communication Skills","single","basic",
    "A customer has called 3 times about the same problem. When they call again, what should you do first?",
    ["Ask them why they keep calling","Apologise that the issue has not been resolved yet and assure them you will personally make sure it is sorted this time","Transfer the call — repeat callers are not your responsibility","Ask them to send an email instead"],
    "Apologise that the issue has not been resolved yet and assure them you will personally make sure it is sorted this time",
    10,3),

  q("CCF-S3-012","inbound","executive","communication","Communication Skills","single","basic",
    "A customer says 'I don't understand what you're saying.' You should:",
    ["Repeat the same sentence louder","Explain again using simpler words and an everyday example","Ask them to consult the help guide","Escalate to a supervisor immediately"],
    "Explain again using simpler words and an everyday example",
    10,3),

  // DATA SAFETY (call centre context)
  q("CCF-S3-013","inbound","executive","data_safety","Basic Data Safety","single","basic",
    "A caller says they are the customer's spouse and asks for account details. You should:",
    ["Share the details — spouse is family","Share only the balance, not the full account number","Not share any details — account information can only be given to the verified account holder","Ask the customer to give verbal permission on the same call"],
    "Not share any details — account information can only be given to the verified account holder",
    10,3,"Sharing account details with anyone other than the verified account holder is a data protection breach."),

  q("CCF-S3-014","inbound","executive","data_safety","Basic Data Safety","single","basic",
    "While talking to a customer, they ask you to confirm their Aadhaar number. You should read back:",
    ["The full 12-digit number","Only the last 4 digits — the first 8 should never be spoken aloud","Only the first 4 digits","No digits at all — Aadhaar cannot be confirmed verbally"],
    "Only the last 4 digits — the first 8 should never be spoken aloud",
    10,3,"UIDAI guidelines require masking the first 8 digits. Only the last 4 should be used for verification."),

  q("CCF-S3-015","inbound","executive","data_safety","Basic Data Safety","text","basic",
    "A customer accidentally tells you their internet banking password during a call. In 2-3 simple sentences, explain what you would say to the customer and why.",
    undefined, undefined,
    15,3,undefined,
    ["password","never share","security","advise","change password","bank"],
    true),
];

// ═══════════════════════════════════════════════════════════════════════════
// OUTBOUND FRESHER — link CCF questions + 1 dedicated set
// ═══════════════════════════════════════════════════════════════════════════
const outboundFresherSet1 = [

  q("OCF-S1-001","outbound","executive","comprehension","Reading Comprehension","single","basic",
    `Read and answer:\n\n"Before making an outbound call, an agent should always check three things: first, that the customer's number is on the approved calling list; second, that it is an acceptable calling hour (between 9 AM and 9 PM); and third, that they know the basic purpose of the call. Calling without preparation wastes the customer's time and gives a poor impression of the company."\n\nAccording to the passage, what are the THREE things to check before calling?`,
    [
      "Call volume, script quality, team approval",
      "Approved calling list, acceptable hour, purpose of the call",
      "Customer name, age, income",
      "Call centre location, manager approval, call duration"
    ],
    "Approved calling list, acceptable hour, purpose of the call",
    10,1),

  q("OCF-S1-002","outbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "You have a list of 80 numbers to call. You complete 35 in the morning session. What percentage is remaining?",
    ["43.75%","50%","56.25%","62.5%"],
    "56.25%",
    10,1,"Remaining = 45. 45 ÷ 80 × 100 = 56.25%."),

  q("OCF-S1-003","outbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "If calling hours are 9 AM to 9 PM, how many hours are available for outbound calls each day?",
    ["10","11","12","8"],
    "12",
    10,1,"9 AM to 9 PM = 12 hours."),

  q("OCF-S1-004","outbound","executive","proofreading","Proofreading & Written Communication","single","basic",
    "Which opening line for an outbound call sounds most professional?",
    [
      "Hello, I'm calling from MAS. You interested in our offer?",
      "Good afternoon, am I speaking with Mr./Ms. [Name]? This is [Your Name] calling from MAS Callnet. Is this a good time to speak?",
      "Hi! We have a great deal for you. Listen quick.",
      "Hello? Yes hi, we are calling about something important."
    ],
    "Good afternoon, am I speaking with Mr./Ms. [Name]? This is [Your Name] calling from MAS Callnet. Is this a good time to speak?",
    10,1),

  q("OCF-S1-005","outbound","executive","attention_detail","Attention to Detail","single","basic",
    "You have a calling list with this entry:\nName: Pradeep Nair | Number: 9845600123 | Last contacted: 12/06/2024\nYou dial 9854600123. Is this correct?",
    ["Yes","No — you have transposed the 4th and 5th digits (845 became 854)","No — the name does not match","Yes — one digit difference is fine"],
    "No — you have transposed the 4th and 5th digits (845 became 854)",
    10,1),

  q("OCF-S1-006","outbound","executive","communication","Communication Skills","single","basic",
    "A customer says 'I am not interested.' The correct response is:",
    ["'Are you sure? This is a very good offer.'","'Thank you for your time, Sir/Ma'am. May I ask if there is a better time to reach you, or shall I remove you from our list?'","'Fine.' and hang up","'Why not? Let me explain again.'"],
    "'Thank you for your time, Sir/Ma'am. May I ask if there is a better time to reach you, or shall I remove you from our list?'",
    10,1),

  q("OCF-S1-007","outbound","executive","communication","Communication Skills","single","basic",
    "If a customer says 'Call me after 7 PM', you should:",
    ["Call them at 9 PM to be safe","Note their preferred time and schedule the callback accordingly","Ignore the request and call at your convenience","Mark them as 'not interested'"],
    "Note their preferred time and schedule the callback accordingly",
    10,1),

  q("OCF-S1-008","outbound","executive","data_safety","Basic Data Safety","single","basic",
    "You are making outbound calls and a person answers who is clearly a child (sounds like they are 10-12 years old). You should:",
    ["Continue the pitch — they might pass the phone to an adult","Ask them to call back when the account holder is available","Try to get information from the child","Discuss the product in simple terms for the child to understand"],
    "Ask them to call back when the account holder is available",
    10,1,"Engaging with minors for sales or data purposes is not appropriate. Wait for the account holder."),

  q("OCF-S1-009","outbound","executive","aptitude","Aptitude & Reasoning","single","basic",
    "Complete the sequence: Greet → Introduce → Explain purpose → ___ → Close",
    ["Take a break","Handle questions or objections","Read the script again","Put on hold"],
    "Handle questions or objections",
    10,1,"The standard outbound call flow: Greet → Introduce → Explain purpose → Handle Q&A → Close."),

  q("OCF-S1-010","outbound","executive","communication","Communication Skills","text","basic",
    "A customer on an outbound call says: 'How did you get my number? I never gave it to you.' Write a simple, polite 2-sentence response.",
    undefined, undefined,
    15,1,undefined,
    ["consent","database","privacy","explain","reassure","opt-out"],
    true),
];

// ═══════════════════════════════════════════════════════════════════════════
// Combine all
// ═══════════════════════════════════════════════════════════════════════════
export const ALL_FRESHER_QUESTIONS = [
  ...bfSet1, ...bfSet2, ...bfSet3,
  ...ccfSet1, ...ccfSet2, ...ccfSet3,
  ...outboundFresherSet1,
];

export async function seedFresherQuestionBank(createdBy: string | null = null) {
  console.log(`Seeding ${ALL_FRESHER_QUESTIONS.length} fresher questions...`);
  const result = await importQuestions(ALL_FRESHER_QUESTIONS, createdBy);
  console.log(`Done. Imported: ${result.imported}, Skipped: ${result.skipped}`);
  if (result.errors.length) console.error('Errors:', result.errors);
  return result;
}
