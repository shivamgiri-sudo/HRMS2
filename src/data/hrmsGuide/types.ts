/**
 * HRMS Guide — content model.
 *
 * The guide is the self-service manual for every role. Each role file under ./roles exports one
 * RoleGuide. Content rules (keep these when adding activities):
 *  - `path` must be a route that is actually mounted (see src/lib/mountedRoutePaths.ts). Query
 *    strings are allowed (e.g. "/profile?tab=payslips").
 *  - `menuPath` is the sidebar trail the user clicks, using the labels in
 *    src/components/layout/navConfig.tsx (e.g. "Payroll → Payslip Center").
 *  - Button / tab / field names in steps must match the labels on the real page.
 *  - Steps are auto-numbered by the page; do not number them yourself.
 *  - Data files stay plain .ts (no JSX) — icons and colours are referenced by key.
 */

export type GuideIconKey =
  | "book" | "users" | "user" | "userPlus" | "userMinus" | "userCheck" | "dollar" | "rupee"
  | "calendar" | "calendarDays" | "clock" | "chart" | "trending" | "settings" | "shield"
  | "shieldAlert" | "briefcase" | "target" | "graduation" | "clipboard" | "fileText" | "fileCheck"
  | "creditCard" | "building" | "package" | "zap" | "bell" | "inbox" | "message" | "mail"
  | "phone" | "headset" | "heart" | "sparkles" | "lock" | "key" | "log-in" | "layout"
  | "activity" | "receipt" | "wallet" | "landmark" | "upload" | "download" | "search"
  | "network" | "server" | "laptop" | "truck" | "shoppingCart" | "gauge" | "award" | "help"
  | "eye" | "video" | "map" | "gitBranch" | "rotate" | "alert" | "check" | "star" | "coffee";

export type GuideTone =
  | "indigo" | "sky" | "emerald" | "amber" | "rose" | "violet" | "teal" | "orange"
  | "slate" | "pink" | "cyan" | "lime" | "blue" | "red" | "purple" | "green";

export type GuideFrequency = "daily" | "weekly" | "monthly" | "as-needed" | "one-time" | "yearly";

export type GuideStep = {
  /** What to do — imperative, uses the on-screen label in quotes, e.g. "Click 'Apply Leave'". */
  action: string;
  /** Optional clarification: field rules, what appears, what to watch out for. */
  detail?: string;
};

export type GuideQA = {
  /** Problem / question as the user would phrase it. */
  q: string;
  /** Answer or fix. */
  a: string;
};

export type GuideActivity = {
  /** kebab-case, unique within its role guide. */
  id: string;
  title: string;
  /** One sentence: what this activity achieves. */
  description: string;
  /** Route to open. Must be a mounted route. */
  path?: string;
  /** Sidebar trail, e.g. "My Space → Leave → Apply Leave". */
  menuPath?: string;
  /** How often a person in this role typically does it. */
  frequency?: GuideFrequency;
  /** What must be true / done before starting. */
  prerequisites?: string[];
  steps: GuideStep[];
  /** What the screen looks like — so the user recognises they are in the right place. */
  screenGuide?: string;
  /** A concrete worked example with realistic values. */
  example: string;
  /** Best-practice / caution note. */
  tip?: string;
  /** What happens after the user finishes — who acts next, what they will be notified of. */
  afterThis?: string;
  /** Common problems and their fixes. */
  troubleshooting?: GuideQA[];
  /** Extra search keywords (synonyms, abbreviations, e.g. "LWP", "F&F", "comp off"). */
  tags?: string[];
};

export type GuideModule = {
  /** kebab-case, unique within its role guide. */
  id: string;
  title: string;
  icon: GuideIconKey;
  tone: GuideTone;
  /** One line shown under the module title. */
  summary?: string;
  activities: GuideActivity[];
};

export type RoleGuide = {
  /** Key used in the URL (?role=) and the registry. */
  key: string;
  roleLabel: string;
  /** What this role is responsible for in HRMS. */
  description: string;
  /**
   * AppRole / role_key values (from /api/access/me) that should land on this guide automatically.
   * The first guide whose appRoles intersect the user's roles wins, in registry priority order.
   */
  appRoles: string[];
  /** A short "your typical day / month" checklist shown at the top of the role guide. */
  routine?: { when: string; items: string[] }[];
  modules: GuideModule[];
};
