// Plain-language label and group of every selection rule; must equal the server catalogue (parity test).
export type RuleGroup = "who" | "where" | "skills" | "availability" | "money" | "history" | "contact";
export const GROUP_ORDER: readonly RuleGroup[] = ["who", "where", "skills", "availability", "money", "history", "contact"];
export const GROUP_TITLE: Record<RuleGroup, string> = { who: "Who", where: "Where", skills: "Skills", availability: "Availability", money: "Money", history: "History", contact: "Contact" };

export const RULE_INFO: Record<string, { label: string; group: RuleGroup }> = {
  sources: { label: "Sources", group: "contact" },
  contact_recent: { label: "Not contacted in the last N days", group: "contact" },
  record_age: { label: "Record recent enough", group: "contact" },
  valid_email: { label: "Has a valid email", group: "contact" },
  location_region: { label: "Lives in the branch area", group: "where" },
  location_cities: { label: "Lives in these cities", group: "where" },
  relocation_ok: { label: "Accept people willing to relocate", group: "where" },
  age: { label: "Age", group: "who" },
  education_min: { label: "Minimum qualification", group: "who" },
  experience: { label: "Experience (years)", group: "who" },
  night_shift: { label: "Willing to work night shift", group: "availability" },
  rotational_shift: { label: "OK with rotational shifts", group: "availability" },
  certificate: { label: "Certificate (e.g. DRA)", group: "skills" },
  gender: { label: "Gender (only where the client contract requires it)", group: "who" },
  languages: { label: "Languages", group: "skills" },
  english: { label: "English level", group: "skills" },
  typing: { label: "Typing speed", group: "skills" },
  form_answer: { label: "Answer on the Meta form", group: "who" },
  notice_period: { label: "Can join within N days", group: "availability" },
  salary_fit: { label: "Current or expected salary fits the band", group: "money" },
  employer_exclude: { label: "Previous employer is not", group: "history" },
  ex_employee: { label: "Former MAS employees", group: "history" },
  skills: { label: "Skills", group: "skills" },
  education_stream: { label: "Stream", group: "who" },
  education_completed: { label: "Qualification completed", group: "who" },
  employer_include: { label: "Previous employer is", group: "history" },
  rejected_other_process: { label: "Rejected in another process before", group: "history" },
  location_radius: { label: "Within N km of the branch", group: "where" },
};
export const labelOf = (key: string): string => RULE_INFO[key]?.label ?? key;
