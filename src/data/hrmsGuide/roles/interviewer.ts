import type { RoleGuide } from "../types";

/**
 * Interviewer / Ops Round panel guide.
 * Facts checked against: NativeATSRecruiterWorkspace.tsx (the 'Round 2 — Operations' section and
 * 'Second Round Interviewer' picker), NativeWalkinQueueEnhanced.tsx (/ats/walkin-queue, shown as
 * 'Ops Round' in the sidebar), OpsBoard.tsx (/display/ops-board), recruiterInterview.service.ts
 * (what each decision does), queue.routes.ts and meta-campaign.routes.ts (who can call what).
 * Important: HRMS has no interviewer score sheet. The recruiter records the ops-round verdict on
 * the interviewer's behalf; the guide says so rather than inventing a feedback screen.
 */
export const interviewerGuide: RoleGuide = {
  key: "interviewer",
  roleLabel: "Interviewer / Ops Round Panel",
  description:
    "You interview walk-in candidates in the operations (second) round after they clear the HR round, and give the recruiter your verdict: Selected, Rejected, Hold or Client Round - Pending, with a reason and remarks. The recruiter records your verdict in HRMS against your name. Operations managers use the 'Ops Round' page to watch the queue, and everyone can follow results on the live Walk-in Interview Board.",
  appRoles: ["interviewer"],
  routine: [
    {
      when: "On every walk-in day",
      items: [
        "Keep the Walk-in Interview Board (/display/ops-board) open, filtered to your branch",
        "Look for your name in the 'Ops Interviewer' column: those candidates are waiting for you",
        "Interview each candidate, then tell the recruiter your verdict, the VOC reason if rejected, and one line of remarks",
        "Check the 'Ops' and 'Decision' columns update after the recruiter submits",
      ],
    },
    {
      when: "End of day",
      items: [
        "Make sure no candidate you interviewed is still waiting without a decision on the board",
        "Tell the recruiter the follow-up date for anyone you put on Hold or sent to a client round",
        "Reply to any candidate messages in the WhatsApp Inbox",
      ],
    },
  ],
  modules: [
    {
      id: "your-interviews",
      title: "Where Your Interviews Come From",
      icon: "users",
      tone: "violet",
      summary: "How a candidate is assigned to you and where you see them.",
      activities: [
        {
          id: "how-assignment-works",
          title: "Understand How a Candidate Is Sent to You",
          description: "Know the steps before a candidate reaches your ops round, so you know who to ask when someone is missing.",
          path: "/display/ops-board",
          frequency: "one-time",
          steps: [
            { action: "The candidate registers on the interview registration form and gets a queue token." },
            { action: "The recruiter calls the token in 'Walk-in Queue' and conducts the HR round ('Round 1 — HR Screening') and, where used, the 'Skill Test' (typing / AI assessment)." },
            { action: "If the candidate clears, the recruiter sets 'Walk-in End Stage' to 'Round 2- Op's' and picks you in 'Second Round Interviewer'.", detail: "Only employees of the recruiter's own branch can be picked." },
            { action: "Your name now shows in the 'Ops Interviewer' column of the Walk-in Interview Board for that candidate." },
          ],
          example: "Kapil clears HR with recruiter Neha at Noida. Neha picks 'Rohit Mehra' as Second Round Interviewer and sends Kapil to Rohit's cabin. The board shows Rohit in Kapil's 'Ops Interviewer' cell.",
          tip: "HRMS does not send you a notification or Work Inbox item when you are picked. Agree with your recruiters how they will hand candidates over (walk them across, call or message you).",
          troubleshooting: [
            { q: "A recruiter cannot find my name in 'Second Round Interviewer'", a: "You must be an active employee of the same branch as the recruiter. If your branch is wrong in your employee record, ask HR to correct it." },
          ],
          tags: ["ops round", "second round", "assignment", "interviewer", "round 2"],
        },
        {
          id: "watch-interview-board",
          title: "Follow Your Candidates on the Walk-in Interview Board",
          description: "See today's candidates, their HR / skill results and who their ops interviewer is.",
          path: "/display/ops-board",
          frequency: "daily",
          steps: [
            { action: "Open '/display/ops-board' on your HRMS address. No login is needed, so it can run on a lobby or floor TV." },
            { action: "Pick your branch in 'All Branches' and, if you want, your process in 'All Processes'.", detail: "You can bookmark the branch with '?branch=' in the address, e.g. /display/ops-board?branch=<your branch name as shown in the dropdown>." },
            { action: "Find the rows with your name in 'Ops Interviewer'." },
            { action: "Before calling the candidate in, read 'MCQ', 'Typing', 'HR' and 'Skill' so you know how they did in earlier rounds." },
          ],
          screenGuide: "Dark full-screen board titled 'Walk-in Interview Board', 'Live · auto-refreshes every 30s'. Columns: Candidate, Process, Recruiter, MCQ, Typing, Wait, Stage, HR, Skill, Ops, Ops Interviewer, Decision, Rejection Reason.",
          example: "At 12:10 the Noida board shows two candidates with 'Rohit Mehra' as Ops Interviewer: Kapil (Typing 34 WPM, HR Selected, Skill Selected, Wait 18m) and Shalini (Typing 27 WPM, HR Selected). Rohit takes Kapil first because he has waited longer.",
          troubleshooting: [
            { q: "'No candidates recorded today'", a: "Check the branch filter. The board only shows today's candidates." },
            { q: "My candidate is in front of me but not on the board", a: "The recruiter has not submitted the HR round yet. Ask them to submit it with stage 'Round 2- Op's' and your name." },
          ],
          tags: ["ops board", "interview board", "TV display", "live", "walk-in"],
        },
        {
          id: "use-ops-round-page",
          title: "Watch the Live Queue on the Ops Round Page (Operations Managers)",
          description: "See tokens waiting, called, in interview and completed for your branch.",
          path: "/ats/walkin-queue",
          menuPath: "People & Hiring → ATS → Ops Round",
          frequency: "daily",
          prerequisites: ["Operations Manager role (the 'Ops Round' menu item opens the same page recruiters call 'Walk-in Queue')"],
          steps: [
            { action: "Open 'People & Hiring → ATS → Ops Round'. The page is titled 'Live Walk-in Queue' and refreshes every 5 seconds." },
            { action: "Pick your branch in 'All Branches' and today's date." },
            { action: "Use the pills 'Waiting', 'Called', 'In Interview', 'Completed', 'No Show' to see where candidates are." },
            { action: "Read 'Typing' (green at 25+ WPM) and 'Assessment' (% and Pass / Fail) before your interview." },
          ],
          screenGuide: "Chips at the top: 'n In Queue', 'n In Progress', 'n Completed', 'Avg Wait'. Table: Token, Candidate, Role, Branch, Status, Wait, Typing, Assessment, Recruiter, Actions (Call, Start, Complete, No Show).",
          example: "At 11 am the Ops Round page for Gurgaon shows 9 In Queue, 3 In Progress and Avg Wait 22 min. You ask the recruiters to send HR-cleared candidates to the second ops panel.",
          tip: "This page has no Select / Reject buttons. The queue buttons (Call, Start, Complete, No Show) move the token only; your verdict is recorded by the recruiter.",
          troubleshooting: [
            { q: "The page shows a red error banner and no metrics", a: "The live queue data is limited to recruiter, HR, admin and manager accounts, so an operations-manager-only login can be refused. Use the Walk-in Interview Board (/display/ops-board) instead, and ask HR for queue access if you need this page." },
          ],
          tags: ["ops round", "walk-in queue", "operations manager", "live queue", "token"],
        },
      ],
    },
    {
      id: "give-your-verdict",
      title: "Conduct the Ops Round & Give Your Verdict",
      icon: "userCheck",
      tone: "emerald",
      summary: "Interview the candidate and pass a decision the recruiter can record exactly.",
      activities: [
        {
          id: "conduct-ops-interview",
          title: "Conduct the Operations Interview",
          description: "Assess the candidate for process fit and reach one of the decisions HRMS accepts.",
          path: "/display/ops-board",
          frequency: "daily",
          prerequisites: ["The candidate has cleared 'Round 1 — HR Screening' and you are their 'Second Round Interviewer'"],
          steps: [
            { action: "Check the candidate's earlier results on the board (HR, Skill, Typing, MCQ) and their Process." },
            { action: "Interview for the process: product / domain understanding, call handling, shift and location comfort, sales aptitude where relevant." },
            { action: "Decide one of: 'Selected', 'Rejected', 'Hold', 'Client Round - Pending' or 'No Show' (candidate left before your round)." },
            { action: "If rejecting, choose the matching VOC reason (see the next activity)." },
            { action: "Write one clear line of remarks the recruiter can copy into 'Round 2 Remarks'." },
          ],
          example: "Kapil, Axis Inbound: 2 years inbound voice, explained a card-block call clearly, fine with rotational shifts. Verdict 'Selected', remark 'Confident, good product fit, ready for 20 July batch'.",
          tip: "There are no numeric score fields for the ops round in HRMS. Put any score you use (for example 78/100) inside the remark.",
          tags: ["ops interview", "operations round", "assessment", "decision"],
        },
        {
          id: "hand-verdict-to-recruiter",
          title: "Pass Your Verdict to the Recruiter for Recording",
          description: "Give the recruiter exactly what the 'Round 2 — Operations' section needs so your decision is saved against your name.",
          path: "/display/ops-board",
          frequency: "daily",
          steps: [
            { action: "Tell the recruiter the 'Round 2 Result': Selected, Rejected, Hold, Client Round - Pending or No Show." },
            { action: "If Rejected, give the 'Round 2 VOC' from the list: Undergraduate / Qualification Issue, Poor Communication Skill, Poor Reading / Comprehension, Salary Issue, Shift / Timing Issue, Location / Travel Issue, Stability Concern, Documentation Issue, Role / Process Mismatch, Candidate Not Interested, No Show, Age Barrier, Sales Skills Not Up to the Mark, Not Comfortable in Sales, Underconfident / Nervous, MTI Issue, Not Fit for the Process." },
            { action: "Give your 'Round 2 Remarks'." },
            { action: "For Selected, confirm the salary, joining date and reporting time you agreed, because the recruiter must enter 'Offer Salary', 'Date of Joining' and 'Reporting Timing'." },
            { action: "For Hold or Client Round - Pending, give a follow-up date and reason; HRMS makes them mandatory for these decisions." },
          ],
          example: "You message recruiter Neha: 'Shalini – Rejected – VOC: MTI Issue – Remarks: strong regional accent, struggled with US customer roleplay'. Neha submits it in My Candidates within a minute.",
          afterThis: "The recruiter submits the update in 'My Candidates' (Update Candidate → 'Round 2 — Operations'). The queue token closes and the candidate leaves the waiting list.",
          troubleshooting: [
            { q: "Can I record the result myself?", a: "No. The interview submission is open only to recruiter, HR, admin and manager accounts linked to a recruiter profile. Give the verdict to the recruiter." },
          ],
          tags: ["VOC", "rejection reason", "round 2 result", "remarks", "handover"],
        },
        {
          id: "confirm-verdict-recorded",
          title: "Confirm Your Verdict Was Recorded Correctly",
          description: "Check that the decision on screen matches what you said.",
          path: "/display/ops-board",
          frequency: "daily",
          steps: [
            { action: "Open the Walk-in Interview Board for your branch." },
            { action: "Find the candidate and check the 'Ops' column (your round result) and 'Decision' (the final decision)." },
            { action: "For rejections, check 'Rejection Reason' shows the VOC you gave." },
            { action: "If anything is wrong, tell the recruiter straight away (next activity)." },
          ],
          example: "The board shows Kapil: Ops 'Selected', Decision 'Selected', and your name under Ops Interviewer. Done.",
          tags: ["verify", "ops board", "decision"],
        },
        {
          id: "fix-wrong-verdict",
          title: "Get a Wrong Verdict Corrected",
          description: "Have the recruiter fix a decision that was entered wrongly or changed after review.",
          path: "/display/ops-board",
          frequency: "as-needed",
          steps: [
            { action: "Tell the recruiter the candidate's name or mobile and the correct result, VOC and remarks." },
            { action: "The recruiter opens 'My Candidates' → 'Submission History', clicks 'Rectify' on the row, corrects 'Round 2 — Operations' and the 'Final Decision', and clicks 'Submit Update'." },
            { action: "Check the board again after a minute (it refreshes every 30 seconds)." },
          ],
          example: "Neha recorded Arjun as 'Rejected' instead of 'Hold'. She rectifies it to Hold with follow-up 16 July 'Recheck after client feedback'. The board now shows Hold.",
          tip: "Correcting is allowed; HRMS keeps the earlier version in its audit trail. Correct quickly, because a 'Selected' decision sends the onboarding link to the candidate at once.",
          tags: ["correction", "rectify", "wrong decision"],
        },
      ],
    },
    {
      id: "after-the-decision",
      title: "What Happens After Your Decision",
      icon: "gitBranch",
      tone: "sky",
      summary: "The next step for Selected, Rejected, Hold and Client Round candidates.",
      activities: [
        {
          id: "after-selected",
          title: "After You Select a Candidate",
          description: "Know what the candidate receives and who takes over.",
          path: "/display/ops-board",
          frequency: "as-needed",
          steps: [
            { action: "The recruiter submits 'Final Decision' = 'Selected' with offer salary, DOJ and reporting time." },
            { action: "HRMS sends the candidate a secure onboarding link (SMS / email, valid 15 days) to fill personal, KYC, bank, education and family details." },
            { action: "HR reviews the submitted profile, prepares the employment offer and sends it to the Branch Head." },
            { action: "On Branch Head approval the employee code (e.g. MAS12345) is created and joining documents, BGV and provisioning start." },
          ],
          example: "You select Kapil on 12 July. He fills the onboarding form on 13 July, the Branch Head approves his offer on 15 July, and he joins the 20 July batch as MAS12345.",
          afterThis: "You may meet the candidate again in training or on the floor; nothing more is needed from you in HRMS.",
          tags: ["selected", "onboarding", "offer", "employee code", "joining"],
        },
        {
          id: "after-rejected",
          title: "After You Reject a Candidate",
          description: "Know what the candidate is told and how the reason is used.",
          path: "/display/ops-board",
          frequency: "as-needed",
          steps: [
            { action: "The recruiter submits 'Final Decision' = 'Rejected' with your VOC and remarks." },
            { action: "If the candidate gave an email, HRMS sends them a rejection email. A 'No Show' decision sends a similar email." },
            { action: "Your VOC feeds the 'Rejections' tab in ATS Command and the 'Rejected at Ops Round' funnel, so leadership sees why candidates drop at your round." },
          ],
          example: "Shalini is rejected with 'MTI Issue'. She gets the rejection email. In the monthly review, 'MTI Issue' is the top ops-round reason for Noida, so sourcing shifts to areas with better English schooling.",
          tip: "If the candidate walks in again later with the same mobile, the old record is reused and marked 'Re-walk-in', and the recruiter can see the earlier decision in the candidate's journey.",
          tags: ["rejected", "VOC", "rejection email", "re-walk-in"],
        },
        {
          id: "after-hold-or-client-round",
          title: "After You Put a Candidate on Hold or Send Them to a Client Round",
          description: "Know how parked candidates are followed up and finally closed.",
          path: "/display/ops-board",
          frequency: "as-needed",
          steps: [
            { action: "The recruiter submits 'Hold' or 'Client Round - Pending' with a mandatory follow-up date and reason." },
            { action: "For a client round, the recruiter later records 'Round 3 — Client' and the client interviewer's name." },
            { action: "On the follow-up date the recruiter reopens the record ('Resubmit' / 'Rectify') and enters the final decision." },
            { action: "If you are asked to re-interview, give the new verdict to the recruiter the same way." },
          ],
          example: "You put Arjun on Hold until the Amazon client panel on 16 July. On 16 July the client selects him; the recruiter resubmits 'Selected' and his onboarding link goes out.",
          tip: "HRMS has no automatic expiry for Hold. Remind the recruiter if a held candidate is not closed after the follow-up date.",
          tags: ["hold", "client round", "follow-up", "resubmit"],
        },
      ],
    },
    {
      id: "candidate-messages",
      title: "Candidate WhatsApp Messages",
      icon: "message",
      tone: "pink",
      summary: "Answer candidates who reply to campaign WhatsApp messages.",
      activities: [
        {
          id: "reply-whatsapp-inbox",
          title: "Reply to Candidates in the WhatsApp Inbox",
          description: "Read and answer WhatsApp replies from shortlisted campaign candidates at your branch.",
          path: "/ats/whatsapp-inbox",
          menuPath: "People & Hiring → ATS → WhatsApp Inbox",
          frequency: "daily",
          steps: [
            { action: "Open 'People & Hiring → ATS → WhatsApp Inbox'. Conversations refresh every 30 seconds and show unread counts." },
            { action: "Filter with 'All Requisitions' or search in 'Search or start new chat', then click a conversation." },
            { action: "Type in 'Type a message' and press Enter, or attach a file with the paperclip (max 20 MB)." },
          ],
          example: "A candidate asks 'Is the ops round today or tomorrow?'. You reply 'Today after your HR round, around 1 pm, at Floor 2'.",
          tip: "You see only your own branch's conversations. 'Meta Campaigns', 'Shortlist Report' and 'Meta Leads' may also appear in your menu but their data is limited to recruitment roles, so they can show an error for you.",
          troubleshooting: [
            { q: "'Candidate is not shortlisted for this requisition yet — run screening first'", a: "You can only message candidates who qualified or already have a conversation. Ask the recruiter." },
            { q: "'This conversation belongs to another branch'", a: "The candidate applied for another branch; leave it to that branch's team." },
          ],
          tags: ["WhatsApp", "inbox", "candidate message", "reply"],
        },
      ],
    },
  ],
};
