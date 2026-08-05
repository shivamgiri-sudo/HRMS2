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

const HOWTO_PREFIX = /^\s*(how\s+(do|can|would|should)\s+i|how\s+to|where\s+(do|can)\s+i)\b/i;

function matchesEntry(question: string, entry: PortalHowToEntry): boolean {
  return entry.aliases.some((pattern) => pattern.test(question));
}

export function answerPortalHowToQuestion(question: string): PortalHowToResult {
  if (!HOWTO_PREFIX.test(question)) return { handled: false };

  const entry = PORTAL_HOWTO_CATALOG.find((candidate) => matchesEntry(question, candidate));
  if (!entry) return { handled: false };

  return {
    handled: true,
    code: entry.code,
    answer: `Here's how to ${entry.title.toLowerCase()}:\n\n${entry.steps.join('\n')}`,
    route: entry.route,
  };
}
