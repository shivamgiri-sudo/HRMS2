/**
 * Client Portal "how do I…" answering — backend scaffolding only, no route
 * wired and no UI. See portal-howto-catalog.ts's header for the full
 * rationale (separate auth system from internal Mira, no chat UI exists on
 * the client portal today).
 *
 * No RBAC check inside this service at all, unlike ai-howto.service.ts's
 * answerHowToQuestion(): by the time any caller could reach this function,
 * requireClientAuth has already guaranteed a valid, process-scoped portal
 * caller — there is nothing further to authorize, since every catalog entry
 * only describes routes already behind that same middleware.
 */
import { PORTAL_HOWTO_CATALOG, type PortalHowToEntry } from './portal-howto-catalog.js';

export interface PortalHowToResult {
  handled: boolean;
  code?: string;
  answer?: string;
  route?: string;
}

// Kept in sync with ai-howto.service.ts's HOWTO_TRIGGERS: that file's
// anchored `^\s*(...)` version let real "I don't know how to X" / "...the
// path from where I can X" phrasing fall through unmatched even though the
// catalog entry itself was correct — same bug would exist here once this
// scaffolding gets a caller, so it's fixed here too rather than left latent.
const HOWTO_TRIGGERS: RegExp[] = [
  /\bhow\s+to\b/i,
  /\bhow\s+(do|can|would|should)\s+i\b/i,
  /\bwhere\s+(do|can|is|are)\s+i\b/i,
  /\bwhere\s+i\s+can\b/i,
  /\b(the\s+)?path\s+(to|for|from)\b/i,
  /\bwhich\s+(page|screen|tab|menu)\b/i,
  /\b(don'?t|doesn'?t|do\s+not|does\s+not)\s+know\s+(how|where)\s+to\b/i,
  /\b(don'?t|doesn'?t|do\s+not|does\s+not)\s+know\s+the\s+(path|way)\b/i,
  /\bnot\s+sure\s+how\s+to\b/i,
  /\bno\s+idea\s+how\s+to\b/i,
];

function looksLikeHowToQuestion(question: string): boolean {
  return HOWTO_TRIGGERS.some((pattern) => pattern.test(question));
}

function matchesEntry(question: string, entry: PortalHowToEntry): boolean {
  return entry.aliases.some((pattern) => pattern.test(question));
}

export function answerPortalHowToQuestion(question: string): PortalHowToResult {
  if (!looksLikeHowToQuestion(question)) return { handled: false };

  const entry = PORTAL_HOWTO_CATALOG.find((candidate) => matchesEntry(question, candidate));
  if (!entry) return { handled: false };

  return {
    handled: true,
    code: entry.code,
    answer: `Here's how to ${entry.title.toLowerCase()}:\n\n${entry.steps.join('\n')}`,
    route: entry.route,
  };
}
