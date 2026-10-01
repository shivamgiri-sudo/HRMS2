import { randomUUID } from "crypto";
import { AnalyticsError } from "./analytics.types.js";

/** Pure access and input rules for Dashboard Studio. No database here, so every rule is unit tested. */

/** isAdmin = org-wide viewer (sees/edits every dashboard). canTemplate = may flag a dashboard as a template (admin role; defaults to isAdmin). */
export type Viewer = { userId: string; roles: string[]; isAdmin: boolean; canTemplate?: boolean; processIds: Set<string>; branchIds: Set<string> };
export type PrincipalType = "role" | "branch" | "process" | "user";
export type Permission = "view" | "edit";
export type Share = { principalType: PrincipalType; principalValue: string; permission: Permission };
export type AccessLevel = "edit" | "view" | "none";

export const DASHBOARD_THEMES = ["light", "midnight", "corporate", "gold", "emerald", "contrast"] as const;
export const MAX_WIDGETS = 60;
export const MAX_SHARES = 100;
export const MAX_JSON_CHARS = 20000;
const PRINCIPAL_TYPES: PrincipalType[] = ["role", "branch", "process", "user"];
const UUID_LIKE = /^[0-9a-fA-F-]{36}$/;
const WIDGET_TYPE = /^[a-z][a-z0-9_]{1,31}$/;

function shareMatches(s: Share, v: Viewer): boolean {
  switch (s.principalType) {
    case "role": return v.roles.includes(s.principalValue);
    case "user": return s.principalValue === v.userId;
    case "branch": return v.branchIds.has(s.principalValue);
    case "process": return v.processIds.has(s.principalValue);
    default: return false;
  }
}

/** Owner and admins edit; otherwise the best matching share wins; a template is readable by everyone. */
export function accessLevel(dashboard: { ownerUserId: string; isTemplate: boolean }, shares: Share[], viewer: Viewer): AccessLevel {
  if (viewer.isAdmin || dashboard.ownerUserId === viewer.userId) return "edit";
  let level: AccessLevel = "none";
  for (const s of shares) {
    if (!shareMatches(s, viewer)) continue;
    if (s.permission === "edit") return "edit";
    level = "view";
  }
  return level === "none" && dashboard.isTemplate ? "view" : level;
}

const bad = (m: string): never => { throw new AnalyticsError(m, "INVALID_QUERY"); };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function optText(v: unknown, max: number, what: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return bad(`${what} must be text`);
  const t = v.trim();
  if (t.length > max) return bad(`${what} must be at most ${max} characters`);
  return t || null;
}

function optId(v: unknown, what: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || v.length > 36) return bad(`${what} is not a valid id`);
  return v;
}

function jsonObject(v: unknown, what: string): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  if (!isObj(v)) return bad(`${what} must be an object`);
  if (JSON.stringify(v).length > MAX_JSON_CHARS) return bad(`${what} is too large (limit ${MAX_JSON_CHARS} characters)`);
  return v;
}

export interface DashboardInput {
  name: string; description: string | null; theme: string;
  homeBranchId: string | null; homeProcessId: string | null; settings: Record<string, unknown>;
}

export function validateDashboardInput(raw: unknown): DashboardInput {
  if (!isObj(raw)) return bad("Dashboard details are missing");
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) bad("Give the dashboard a name");
  if (name.length > 128) bad("Dashboard name must be at most 128 characters");
  let theme = "light";
  if (raw.theme !== undefined && raw.theme !== null && raw.theme !== "") {
    if (typeof raw.theme !== "string" || !(DASHBOARD_THEMES as readonly string[]).includes(raw.theme)) {
      bad(`Unknown theme. Choose one of: ${DASHBOARD_THEMES.join(", ")}`);
    }
    theme = raw.theme as string;
  }
  return {
    name, theme,
    description: optText(raw.description, 500, "Description"),
    homeBranchId: optId(raw.homeBranchId, "Home branch"),
    homeProcessId: optId(raw.homeProcessId, "Home process"),
    settings: jsonObject(raw.settings, "Settings"),
  };
}

export interface WidgetInput {
  id: string; widgetType: string; title: string | null; subtitle: string | null;
  query: Record<string, unknown> | null; viz: Record<string, unknown>; layout: Record<string, unknown>;
}

export function validateWidgets(raw: unknown): WidgetInput[] {
  if (!Array.isArray(raw)) return bad("Widgets must be a list");
  if (raw.length > MAX_WIDGETS) bad(`A dashboard can hold at most ${MAX_WIDGETS} widgets`);
  const seen = new Set<string>();
  return raw.map((w, i) => {
    const at = `Widget ${i + 1}`;
    if (!isObj(w)) return bad(`${at} is not valid`);
    if (typeof w.widgetType !== "string" || !WIDGET_TYPE.test(w.widgetType)) bad(`${at} has an unknown type`);
    let id = typeof w.id === "string" && UUID_LIKE.test(w.id) ? w.id.toLowerCase() : randomUUID();
    if (seen.has(id)) id = randomUUID();
    seen.add(id);
    let query: Record<string, unknown> | null = null;
    if (w.query !== undefined && w.query !== null) {
      query = jsonObject(w.query, `${at} query`);
      if (typeof query.dataset !== "string" || !query.dataset) bad(`${at} query needs a dataset`);
    }
    return {
      id, widgetType: w.widgetType as string, query,
      title: optText(w.title, 160, `${at} title`),
      subtitle: optText(w.subtitle, 255, `${at} subtitle`),
      viz: jsonObject(w.viz, `${at} visual settings`),
      layout: jsonObject(w.layout, `${at} layout`),
    };
  });
}

export function validateShares(raw: unknown): Share[] {
  if (!Array.isArray(raw)) return bad("Shares must be a list");
  if (raw.length > MAX_SHARES) bad(`A dashboard can be shared with at most ${MAX_SHARES} people or groups`);
  const out = new Map<string, Share>();
  raw.forEach((s, i) => {
    const at = `Share ${i + 1}`;
    if (!isObj(s)) return bad(`${at} is not valid`);
    const type = s.principalType as PrincipalType;
    if (typeof type !== "string" || !PRINCIPAL_TYPES.includes(type)) bad(`${at}: share with a role, branch, process or user`);
    const value = typeof s.principalValue === "string" ? s.principalValue.trim() : "";
    if (!value || value.length > 64) bad(`${at}: who to share with is missing or too long`);
    const permission = s.permission === undefined || s.permission === null ? "view" : s.permission;
    if (permission !== "view" && permission !== "edit") bad(`${at}: permission must be view or edit`);
    const key = `${type}:${value}`;
    const prev = out.get(key);
    // A repeated principal keeps the stronger permission.
    if (!prev || permission === "edit") out.set(key, { principalType: type, principalValue: value, permission: permission as Permission });
  });
  return [...out.values()];
}
