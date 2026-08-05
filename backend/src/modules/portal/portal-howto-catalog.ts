/**
 * Client Portal How-To Catalog — backend scaffolding only, no UI yet.
 *
 * Deliberately separate from backend/src/modules/ai/ai-howto-catalog.ts:
 * client-portal auth is a completely different system from internal RBAC. A
 * client user authenticates via a portal JWT (`role: "client"` claim) scoped
 * by a `processIds` array (see requireClientAuth middleware and
 * assertProcessAccess() in portal.controller.ts) — nothing to do with
 * expandRoles()/page_code/rbacPageMatrix.ts. Mixing the two catalogs would
 * risk an internal auth-mode check accidentally running against a portal
 * caller, or vice versa. Note: role.catalog.ts's `client_user` role_key is an
 * unrelated, disjoint vocabulary despite the similar name — never cross-check
 * against it here.
 *
 * There is no chat/Mira UI on the Client Portal today (confirmed: zero
 * references anywhere under src/pages/portal/). This catalog exists so it is
 * ready the moment a client-facing chat surface is decided on — no route is
 * wired to it and no UI renders it in this pass.
 *
 * No `auth` field on entries at all: every entry only describes one of the 8
 * routes already gated by requireClientAuth (portal.routes.ts:165-178) —
 * there is nothing else a client caller could be told how to do, and nothing
 * here should ever describe a CLIENT_PORTAL_BLOCKED_DATA topic (payroll,
 * payslip, tax_declaration, documents, attendance_reasons, raw_roster_rows,
 * grievance, disciplinary, candidate_pii, employee_personal —
 * role.catalog.ts:163-174). Enforced by a test that scans this file's own
 * title/steps text against that array directly, not a re-typed copy.
 *
 * route is always '/portal' (the overview page), not a per-process
 * '/portal/processes/:id/...' path — a client can hold multiple processIds
 * (client_user.process_ids, backend/sql/012_client_portal.sql:25-35), so
 * there is no single correct :id to hardcode. The overview page already
 * lists every process the caller can see and links onward to each dashboard.
 */

export interface PortalHowToEntry {
  code: string;
  title: string;
  aliases: RegExp[];
  steps: string[];
  route: string;
}

export const PORTAL_HOWTO_CATALOG: PortalHowToEntry[] = [
  {
    code: 'portal_overview',
    title: 'View your process overview',
    aliases: [/\boverview\b/i, /\brag\b/i, /\bmy processes?\b/i],
    steps: [
      '1. Open your portal overview.',
      '2. Each of your processes is shown with a headline RAG status and key metrics.',
    ],
    route: '/portal',
  },
  {
    code: 'portal_kpis',
    title: 'View your process KPIs',
    aliases: [/\bkpis?\b/i, /\bscorecard\b/i, /\bcsat\b/i, /\baht\b/i, /\bfcr\b/i],
    steps: [
      '1. Open your portal overview and select the process you want to review.',
      '2. The KPI scorecard shows actual vs. target with a 6-month trend.',
    ],
    route: '/portal',
  },
  {
    code: 'portal_glide_paths',
    title: 'View glide-path commitments',
    aliases: [/\bglide[- ]?path\b/i, /\bcommitment\b/i],
    steps: [
      '1. Open your portal overview and select the process.',
      '2. Glide-path commitments for that process are shown on its dashboard.',
    ],
    route: '/portal',
  },
  {
    code: 'portal_action_plans',
    title: 'View action plans',
    aliases: [/\baction plans?\b/i],
    steps: [
      '1. Open your portal overview and select the process.',
      '2. Open action plans from that process\'s dashboard.',
    ],
    route: '/portal',
  },
  {
    code: 'portal_governance',
    title: 'View governance status',
    aliases: [/\bgovernance\b/i],
    steps: [
      '1. Open your portal overview and select the process.',
      '2. Governance checklist status is shown on that process\'s dashboard.',
    ],
    route: '/portal',
  },
  {
    code: 'portal_attrition',
    title: 'View attrition for your process',
    aliases: [/\battrition\b/i],
    steps: [
      '1. Open your portal overview and select the process.',
      '2. Attrition figures for that process are shown on its dashboard.',
    ],
    route: '/portal',
  },
  {
    // Ordered before portal_commentary on purpose: its own alias set
    // ("acknowledge", "reply ... commentary") is more specific, but
    // portal_commentary's broad /\bcommentary\b/i would otherwise match
    // first purely by array position and shadow this entry — the same class
    // of bug as ai-howto-catalog.ts's resignation_raise/resignation_approve
    // shadowing found earlier, caught here by the same kind of test.
    code: 'portal_commentary_respond',
    title: 'Acknowledge or reply to a commentary',
    aliases: [/\backnowledge\b/i, /\breply\b.*\bcommentary\b/i],
    steps: [
      '1. Open the commentary on your process dashboard.',
      '2. Use Acknowledge to confirm you have read it, or Reply to respond.',
    ],
    route: '/portal',
  },
  {
    code: 'portal_commentary',
    title: 'View management commentary',
    aliases: [/\bcommentary\b/i],
    steps: [
      '1. Open your portal overview and select the process.',
      '2. Management commentary for that process is shown on its dashboard.',
    ],
    route: '/portal',
  },
];
