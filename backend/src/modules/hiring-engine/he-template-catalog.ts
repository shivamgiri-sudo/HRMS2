/**
 * Single source of truth for every WhatsApp template the engine sends. Bodies use named {variables};
 * Meta needs numbered {{n}} slots, which are derived per language by order of first appearance
 * (word order differs between Hinglish and English, so the numbering differs too).
 * English bodies are the exact Meta-approved T1-T11 texts (BookMyInterview template master, approved 2026-10); the
 * Hinglish ones are still drafts, so sends fall back to English until a Hindi version is approved. Changing an approved
 * body here does not change it at Meta: re-submit, or the {{n}} slots drift from what Meta expects.
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
  /** Template name approved at Meta / Pinbot per language (null = not approved yet). Seeded into he_template.pinbot_name. */
  metaName: Record<Lang, string | null>;
  category: "UTILITY" | "MARKETING";
  trigger: string;
  body: Record<Lang, string>;
  /** Quick-reply labels; entries starting with "URL:" are dynamic URL buttons (suffix = {location_token}). */
  buttons: Record<Lang, string[]>;
}

export const HE_TEMPLATES: TemplateDef[] = [
  {
    "key": "he_walkin_invite",
    "metaName": {
      "en": "t1_he_walkin_invitation",
      "hi": null
    },
    "category": "UTILITY",
    "trigger": "Candidate is invited to a walk-in (after screening/match).",
    "body": {
      "hi": "Namaste {candidate_name} ji, aapki application {role} ke liye {company} mein shortlist hui hai.\n\nWalk-in interview:\nDate: {drive_date}\nTime: {slot_time}\nJagah: {branch_address}\nMap: {maps_link}\n\nAssessment link (interview se pehle bharein): {assessment_link}\nSaath laayein: {docs_list}\n\nKya aap aa payenge? Neeche se jawab dein.",
      "en": "Hello {candidate_name},\n\nYour interview appointment for the {role} position at {company} is scheduled.\n\nDate: {drive_date}\nTime: {slot_time}\nVenue: {branch_address}\n\nLocation: {maps_link}.\nAssessment: {assessment_link}.\nDocuments required: {docs_list}.\n\nPlease confirm your attendance using the options below."
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
    "metaName": {
      "en": "t2_he_appointment_confirmed",
      "hi": null
    },
    "category": "UTILITY",
    "trigger": "Candidate taps confirm.",
    "body": {
      "hi": "Shukriya {candidate_name} ji! Aapka walk-in confirm ho gaya hai.\n\n{drive_date} ko {slot_time} baje {branch_name} par aayein. Reference ID: {reference_id}.\n\nReception par yeh ID bataiye. Koi dikkat ho to {contact_name} ko {contact_phone} par call karein.",
      "en": "Your appointment details have been recorded.\n\nName: {candidate_name}\nDate: {drive_date}\nTime: {slot_time}\nLocation: {branch_name}\n\nReference ID: {reference_id}\n\nPlease keep this Reference ID for your visit.\n\nFor assistance, contact {contact_name} at {contact_phone} for appointment-related queries."
    },
    "buttons": {
      "hi": [],
      "en": []
    }
  },
  {
    "key": "he_reminder_1d",
    "metaName": {
      "en": "t3_he_reminder_1d",
      "hi": null
    },
    "category": "UTILITY",
    "trigger": "Day before the walk-in.",
    "body": {
      "hi": "Namaste {candidate_name} ji, yaad dila rahe hain ki kal {slot_time} baje {branch_name} par aapka {role} ka walk-in interview hai.\n\nSaath laayein: {docs_list}. Pata: {maps_link}\n\nPakka aa rahe hain?",
      "en": "This is a reminder about your scheduled appointment.\n\nCandidate: {candidate_name}\nRole: {role}\nDate: {drive_date}\nTime: {slot_time}\nBranch: {branch_name}\n\nDocuments required: {docs_list}\n\nLocation details are available here: {maps_link}.\n\nPlease confirm your attendance using the option below."
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
    "metaName": {
      "en": "t4_he_reminder_2h_location",
      "hi": null
    },
    "category": "UTILITY",
    "trigger": "About 2 hours before the slot. Asks OPTIONAL live-location consent.",
    "body": {
      "hi": "Namaste {candidate_name} ji, aapka interview aaj {slot_time} baje {branch_name} par hai.\n\nAgar aap chahein to nikalte waqt \"Main nikal gaya\" par tap karke apni location share kar sakte hain. Isse branch aapke aane ka time jaan kar taiyari kar paayegi. Yeh poori tarah aapki marzi par hai aur aap kabhi bhi band kar sakte hain.",
      "en": "Your interview is scheduled for today.\n\nCandidate: {candidate_name}\nTime: {slot_time}\nBranch: {branch_name}\n\nIf you are travelling to the branch, you may optionally share your arrival location using the button below.\n\nYou can choose not to share your location."
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
    "metaName": {
      "en": "t5_he_reschedule_offer",
      "hi": null
    },
    "category": "UTILITY",
    "trigger": "Candidate chose reschedule. Slot comes from the system (never invented).",
    "body": {
      "hi": "Koi baat nahi {candidate_name} ji. Aapke liye naya slot ye hai:\n\n{drive_date}, {slot_time} baje, {branch_name}\nPata: {branch_address}\n\nKya yeh theek rahega?",
      "en": "A new appointment slot is available for {candidate_name}.\n\nDate: {drive_date}\nTime: {slot_time}\nBranch: {branch_name}\nAddress: {branch_address}\n\nPlease confirm whether this new appointment slot works for you."
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
    "metaName": {
      "en": "t6_he_no_show_recovery",
      "hi": null
    },
    "category": "UTILITY",
    "trigger": "Candidate did not arrive.",
    "body": {
      "hi": "Namaste {candidate_name} ji, aaj aap {branch_name} par interview ke liye nahi aa paaye. Sab theek hai na?\n\nAgar aap abhi bhi {role} ke liye interested hain to hum naya slot de sakte hain.",
      "en": "Your scheduled appointment was not attended today.\n\nCandidate: {candidate_name}\nBranch: {branch_name}\nRole: {role}\n\nIf you would like to reschedule the appointment, please select an option below."
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
    "metaName": {
      "en": "t7_he_other_role_offer",
      "hi": null
    },
    "category": "MARKETING",
    "trigger": "Lead did not fit one requisition but fits another.",
    "body": {
      "hi": "Namaste {candidate_name} ji, {company} mein aapki profile ke hisaab se ek aur opening hai: {role}, {branch_name} branch par.\n\nInterested hain to hum aapko walk-in ka time bhej denge.",
      "en": "Hello {candidate_name},\n\n{company} has another opening that may match your profile.\n\nPosition: {role}\nBranch: {branch_name}\n\nIf you are interested, select an option below to learn more."
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
    "metaName": {
      "en": "t8_he_winback",
      "hi": null
    },
    "category": "MARKETING",
    "trigger": "Dormant lead who earlier showed interest; new drive announced.",
    "body": {
      "hi": "Namaste {candidate_name} ji, {company} mein {drive_date} ko {branch_name} par {role} ke liye walk-in drive hai.\n\nAgar aap job ki talaash mein hain to hume bataiye, hum slot book kar denge.",
      "en": "Hello {candidate_name},\n\n{company} is hosting a walk-in drive for the {role} position at {branch_name} on {drive_date}.\n\nIf you are interested in this opportunity, select an option below and we can help you book a slot."
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
    "metaName": {
      "en": "t9_he_missed_call",
      "hi": null
    },
    "category": "UTILITY",
    "trigger": "Voice call not answered after retry (BRD section 7). Gives a WhatsApp path instead of more calls.",
    "body": {
      "hi": "Namaste {candidate_name} ji, {company} ki HR team ne aapko {role} interview ke baare mein call kiya tha, par baat nahi ho payi.\n\nAapka walk-in {drive_date} ko {slot_time} baje {branch_name} par hai. Kya aap aa payenge?",
      "en": "Your scheduled interview appointment is pending confirmation.\n\nCandidate: {candidate_name}\nCompany: {company}\nRole: {role}\nDate: {drive_date}\nTime: {slot_time}\nBranch: {branch_name}\n\nPlease confirm whether you will attend using the options below."
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
    "metaName": {
      "en": "t10_he_optout_ack",
      "hi": null
    },
    "category": "UTILITY",
    "trigger": "Candidate sends STOP / opt-out.",
    "body": {
      "hi": "Theek hai {candidate_name} ji, ab hum aapko job se jude messages nahi bhejenge. Dobara jaankari chahiye to \"START\" likh dijiye.",
      "en": "Your opt-out request has been recorded.\n\nCandidate: {candidate_name}\n\nYou will no longer receive job-related messages from us.\n\nTo receive updates again in the future, reply START."
    },
    "buttons": {
      "hi": [],
      "en": []
    }
  },
  {
    "key": "he_hr_arrival_alert",
    "metaName": {
      "en": "t11_he_hr_arrival_alert",
      "hi": null
    },
    "category": "UTILITY",
    "trigger": "To BRANCH HR (not candidates): X candidates expected within 30 min.",
    "body": {
      "hi": "Namaste {contact_name} ji, {branch_name} par agle 30 minute mein {expected_count} candidate aane wale hain. Confirmed: {confirmed_count}, live location se: {live_count}. Board dekhein: {board_link} . Dhanyavaad.",
      "en": "Candidate arrival update for {contact_name}.\n\nExpected candidates: {expected_count}\nBranch: {branch_name}\nConfirmed candidates: {confirmed_count}\nLocation shared: {live_count}\n\nView the arrival board here: {board_link}.\n\nPlease prepare for the expected arrivals."
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
