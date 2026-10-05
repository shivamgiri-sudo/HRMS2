/**
 * Single source of truth for every WhatsApp template the engine sends. Bodies use named {variables};
 * Meta needs numbered {{n}} slots, which are derived per language by order of first appearance
 * (word order differs between Hinglish and English, so the numbering differs too).
 * Generated from the approved script pack - edit text here, then re-submit the changed template to Meta.
 */
export type Lang = "hi" | "en";
export type TemplateKey =
  | "he_walkin_invite"
  | "he_walkin_confirmed"
  | "he_reminder_1d"
  | "he_reminder_2h_location"
  | "he_reschedule_offer"
  | "he_no_show_recovery"
  | "he_other_role_offer"
  | "he_winback"
  | "he_missed_call"
  | "he_optout_ack"
  | "he_hr_arrival_alert";

export interface TemplateDef {
  key: TemplateKey;
  category: "UTILITY" | "MARKETING";
  trigger: string;
  body: Record<Lang, string>;
  /** Quick-reply labels; entries starting with "URL:" are dynamic URL buttons (suffix = {location_token}). */
  buttons: Record<Lang, string[]>;
}

export const HE_TEMPLATES: TemplateDef[] = [
  {
    "key": "he_walkin_invite",
    "category": "UTILITY",
    "trigger": "Candidate is invited to a walk-in (after screening/match).",
    "body": {
      "hi": "Namaste {candidate_name} ji, aapki application {role} ke liye {company} mein shortlist hui hai.\n\nWalk-in interview:\nDate: {drive_date}\nTime: {slot_time}\nJagah: {branch_address}\nMap: {maps_link}\n\nAssessment link (interview se pehle bharein): {assessment_link}\nSaath laayein: {docs_list}\n\nKya aap aa payenge? Neeche se jawab dein.",
      "en": "Hello {candidate_name}, your application for {role} at {company} has been shortlisted.\n\nWalk-in interview:\nDate: {drive_date}\nTime: {slot_time}\nVenue: {branch_address}\nMap: {maps_link}\n\nAssessment link (please complete before the interview): {assessment_link}\nPlease bring: {docs_list}\n\nWill you be able to attend? Please reply using the buttons below."
    },
    "buttons": {
      "hi": [
        "Haan, aaunga",
        "Reschedule",
        "Nahi aa paunga"
      ],
      "en": [
        "Yes, I'll come",
        "Reschedule",
        "Can't come"
      ]
    }
  },
  {
    "key": "he_walkin_confirmed",
    "category": "UTILITY",
    "trigger": "Candidate taps confirm.",
    "body": {
      "hi": "Shukriya {candidate_name} ji! Aapka walk-in confirm ho gaya hai.\n\n{drive_date} ko {slot_time} baje {branch_name} par aayein. Reference ID: {reference_id}.\n\nReception par yeh ID bataiye. Koi dikkat ho to {contact_name} ko {contact_phone} par call karein.",
      "en": "Thank you {candidate_name}! Your walk-in is confirmed.\n\nPlease come on {drive_date} at {slot_time} to {branch_name}. Reference ID: {reference_id}.\n\nShare this ID at reception. For any help, call {contact_name} on {contact_phone}."
    },
    "buttons": {
      "hi": [],
      "en": []
    }
  },
  {
    "key": "he_reminder_1d",
    "category": "UTILITY",
    "trigger": "Day before the walk-in.",
    "body": {
      "hi": "Namaste {candidate_name} ji, yaad dila rahe hain ki kal {slot_time} baje {branch_name} par aapka {role} ka walk-in interview hai.\n\nSaath laayein: {docs_list}. Pata: {maps_link}\n\nPakka aa rahe hain?",
      "en": "Hello {candidate_name}, a quick reminder: your {role} walk-in interview is tomorrow at {slot_time} at {branch_name}.\n\nPlease bring: {docs_list}. Address: {maps_link}\n\nAre you still able to come?"
    },
    "buttons": {
      "hi": [
        "Haan, pakka",
        "Reschedule"
      ],
      "en": [
        "Yes, confirmed",
        "Reschedule"
      ]
    }
  },
  {
    "key": "he_reminder_2h_location",
    "category": "UTILITY",
    "trigger": "About 2 hours before the slot. Asks OPTIONAL live-location consent.",
    "body": {
      "hi": "Namaste {candidate_name} ji, aapka interview aaj {slot_time} baje {branch_name} par hai.\n\nAgar aap chahein to nikalte waqt \"Main nikal gaya\" par tap karke apni location share kar sakte hain. Isse branch aapke aane ka time jaan kar taiyari kar paayegi. Yeh poori tarah aapki marzi par hai aur aap kabhi bhi band kar sakte hain.",
      "en": "Hi {candidate_name}, your interview is today at {slot_time} at {branch_name}.\n\nIf you wish, tap \"I'm on my way\" and share your location while travelling. This helps the branch prepare for your arrival. It is entirely optional and you can stop sharing at any time."
    },
    "buttons": {
      "hi": [
        "URL: Main nikal gaya -> https://<domain>/w/{location_token}",
        "Location share nahi karunga"
      ],
      "en": [
        "URL: I'm on my way -> https://<domain>/w/{location_token}",
        "Skip location"
      ]
    }
  },
  {
    "key": "he_reschedule_offer",
    "category": "UTILITY",
    "trigger": "Candidate chose reschedule. Slot comes from the system (never invented).",
    "body": {
      "hi": "Koi baat nahi {candidate_name} ji. Aapke liye naya slot ye hai:\n\n{drive_date}, {slot_time} baje, {branch_name}\nPata: {branch_address}\n\nKya yeh theek rahega?",
      "en": "No problem {candidate_name}. Here is a new slot for you:\n\n{drive_date} at {slot_time}, {branch_name}\nAddress: {branch_address}\n\nDoes this work for you?"
    },
    "buttons": {
      "hi": [
        "Haan, theek hai",
        "Nahi, yeh bhi nahi"
      ],
      "en": [
        "Yes, this works",
        "No, this doesn't work either"
      ]
    }
  },
  {
    "key": "he_no_show_recovery",
    "category": "UTILITY",
    "trigger": "Candidate did not arrive.",
    "body": {
      "hi": "Namaste {candidate_name} ji, aaj aap {branch_name} par interview ke liye nahi aa paaye. Sab theek hai na?\n\nAgar aap abhi bhi {role} ke liye interested hain to hum naya slot de sakte hain.",
      "en": "Hello {candidate_name}, we missed you at {branch_name} for your interview today. Hope all is well.\n\nIf you are still interested in {role}, we can arrange a new slot for you."
    },
    "buttons": {
      "hi": [
        "Naya slot chahiye",
        "Interested nahi"
      ],
      "en": [
        "I need a new slot",
        "Not interested"
      ]
    }
  },
  {
    "key": "he_other_role_offer",
    "category": "MARKETING",
    "trigger": "Lead did not fit one requisition but fits another.",
    "body": {
      "hi": "Namaste {candidate_name} ji, {company} mein aapki profile ke hisaab se ek aur opening hai: {role}, {branch_name} branch par.\n\nInterested hain to hum aapko walk-in ka time bhej denge.",
      "en": "Hello {candidate_name}, {company} has another opening that matches your profile: {role} at our {branch_name} branch.\n\nIf you are interested, we will share a walk-in time with you."
    },
    "buttons": {
      "hi": [
        "Haan, batayein",
        "Interested nahi"
      ],
      "en": [
        "Yes, tell me more",
        "Not interested"
      ]
    }
  },
  {
    "key": "he_winback",
    "category": "MARKETING",
    "trigger": "Dormant lead who earlier showed interest; new drive announced.",
    "body": {
      "hi": "Namaste {candidate_name} ji, {company} mein {drive_date} ko {branch_name} par {role} ke liye walk-in drive hai.\n\nAgar aap job ki talaash mein hain to hume bataiye, hum slot book kar denge.",
      "en": "Hello {candidate_name}, {company} is hosting a walk-in drive for {role} at {branch_name} on {drive_date}.\n\nIf you are looking for a job, let us know and we will book a slot for you."
    },
    "buttons": {
      "hi": [
        "Haan, slot book karein",
        "Interested nahi"
      ],
      "en": [
        "Yes, book a slot",
        "Not interested"
      ]
    }
  },
  {
    "key": "he_missed_call",
    "category": "UTILITY",
    "trigger": "Voice call not answered after retry (BRD section 7). Gives a WhatsApp path instead of more calls.",
    "body": {
      "hi": "Namaste {candidate_name} ji, {company} ki HR team ne aapko {role} interview ke baare mein call kiya tha, par baat nahi ho payi.\n\nAapka walk-in {drive_date} ko {slot_time} baje {branch_name} par hai. Kya aap aa payenge?",
      "en": "Hello {candidate_name}, the {company} HR team tried calling you about your {role} interview but could not reach you.\n\nYour walk-in is on {drive_date} at {slot_time} at {branch_name}. Will you be able to attend?"
    },
    "buttons": {
      "hi": [
        "Haan, aaunga",
        "Reschedule",
        "Nahi aa paunga"
      ],
      "en": [
        "Yes, I'll come",
        "Reschedule",
        "Can't come"
      ]
    }
  },
  {
    "key": "he_optout_ack",
    "category": "UTILITY",
    "trigger": "Candidate sends STOP / opt-out.",
    "body": {
      "hi": "Theek hai {candidate_name} ji, ab hum aapko job se jude messages nahi bhejenge. Dobara jaankari chahiye to \"START\" likh dijiye.",
      "en": "Understood {candidate_name}. We will no longer send you job-related messages. Reply \"START\" if you want updates again."
    },
    "buttons": {
      "hi": [],
      "en": []
    }
  },
  {
    "key": "he_hr_arrival_alert",
    "category": "UTILITY",
    "trigger": "To BRANCH HR (not candidates): X candidates expected within 30 min.",
    "body": {
      "hi": "Namaste {contact_name} ji, {branch_name} par agle 30 minute mein {expected_count} candidate aane wale hain. Confirmed: {confirmed_count}, live location se: {live_count}. Board dekhein: {board_link} . Dhanyavaad.",
      "en": "Hi {contact_name}, {expected_count} candidates are expected at {branch_name} within the next 30 minutes. Confirmed: {confirmed_count}, via live location: {live_count}. View board: {board_link} . Thank you."
    },
    "buttons": {
      "hi": [],
      "en": []
    }
  }
];

const BY_KEY = new Map(HE_TEMPLATES.map((t) => [t.key, t]));

export function getTemplate(key: TemplateKey): TemplateDef {
  const t = BY_KEY.get(key);
  if (!t) throw new Error(`Unknown template ${key}`);
  return t;
}

/** Body variables in Meta slot order ({{1}}, {{2}}, ...). */
export function templateVars(key: TemplateKey, lang: Lang): string[] {
  const seen: string[] = [];
  for (const m of getTemplate(key).body[lang].matchAll(/\{([a-z_]+)\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/** Throws on a missing value so an unfilled placeholder can never reach a candidate. */
export function buildParams(key: TemplateKey, lang: Lang, ctx: Record<string, string | number | null | undefined>): string[] {
  return templateVars(key, lang).map((v) => {
    const x = ctx[v];
    if (x === null || x === undefined || String(x).trim() === "") throw new Error(`Template ${key}: missing ${v}`);
    return String(x).replace(/[\n\t]+/g, " ").slice(0, 300);
  });
}

/** Rendered text of a template (for the message log and previews). */
export function renderBody(key: TemplateKey, lang: Lang, ctx: Record<string, string | number | null | undefined>): string {
  return getTemplate(key).body[lang].replace(/\{([a-z_]+)\}/g, (_, v) => String(ctx[v] ?? `{${v}}`));
}
