import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import type { AiGenerateResponse, AiInsight } from './ai-provider.types.js';
import { MIRA_NAME } from './ai-account.service.js';

export type CompanyIntent = 'leadership' | 'branch_heads' | 'locations' | 'contact' | 'overview' | 'careers' | 'services' | 'unknown';

interface CompanyFact {
  key: string;
  category: string;
  title: string;
  content: string;
  sourceUrl: string;
}

const OFFICIAL_ORIGIN = 'https://mascallnet.ai';
const OFFICIAL_PAGES = [
  { key: 'website-home', path: '/', title: 'MAS Callnet' },
  { key: 'website-about', path: '/about/', title: 'About MAS Callnet' },
  { key: 'website-contact', path: '/contact-us/', title: 'MAS Callnet contact and offices' },
  { key: 'website-careers', path: '/careers/', title: 'MAS Callnet careers' },
  { key: 'website-openings', path: '/current-openings/', title: 'MAS Callnet current openings' },
] as const;

const FALLBACK_FACTS: CompanyFact[] = [
  {
    key: 'company-overview', category: 'overview', title: 'Company overview', sourceUrl: `${OFFICIAL_ORIGIN}/about/`,
    content: 'MAS Callnet was founded in 2003 and provides AI-enabled business process outsourcing, customer experience and process management services. The company reports 23+ years in operation, 250+ clients served, four delivery centres, 2,500+ team members, 24/7 service availability and 97% client retention.',
  },
  {
    key: 'company-leadership', category: 'leadership', title: 'Company leadership', sourceUrl: `${OFFICIAL_ORIGIN}/about/`,
    content: 'Deepak Kashyap is CEO & Co-Founder. Ashwani Wadhwa is Chairman & Co-Founder. Bhavana Harjani is COO & Director.',
  },
  {
    key: 'company-purpose', category: 'overview', title: 'Mission, vision and values', sourceUrl: `${OFFICIAL_ORIGIN}/about/`,
    content: 'MAS Callnet’s mission is to combine AI-led process automation with human expertise to create enhanced customer experiences. Its stated values include excellence, innovation, integrity, partnership and people development. The 2GTHR@MAS community programme supports employee growth through workshops, mentorship, skill building and collaboration.',
  },
  {
    key: 'company-contact', category: 'contact', title: 'Official contact', sourceUrl: `${OFFICIAL_ORIGIN}/contact-us/`,
    content: 'Customer support email: care@teammas.co.in. Sales email: sales@teammas.in. Main contact number: +91 96671 95550.',
  },
  {
    key: 'company-locations', category: 'locations', title: 'Noida and Ahmedabad offices', sourceUrl: `${OFFICIAL_ORIGIN}/contact-us/`,
    content: 'Noida offices: Trapezoid IT Park, 1st Floor, C-27, C Block, Phase 2, Sector 62, Noida – 201309; and Okaya Centre, Tower I, 3rd Floor, Units 301 & 302, A-5, Sector 62, Noida – 201301. Ahmedabad offices: F-15, Jal Darshan Co-operative Society Commercial Building, Ashram Road, Ahmedabad – 380006; and Offices 401–411, Neelkanth Avenue-01, Ashram Road, Ahmedabad – 380014.',
  },
  {
    key: 'company-careers', category: 'careers', title: 'Careers', sourceUrl: `${OFFICIAL_ORIGIN}/careers/`,
    content: 'MAS Callnet publishes career opportunities through its official careers and current-openings pages. Roles may be available in Noida, Ahmedabad and remote arrangements depending on the vacancy.',
  },
  {
    key: 'company-services', category: 'services', title: 'Services and capabilities', sourceUrl: OFFICIAL_ORIGIN,
    content: 'MAS Callnet provides customer support, back-office and process management services supported by technology, automation, quality controls and industry-specific delivery capabilities.',
  },
];

const INTENT_PATTERNS: Array<{ intent: CompanyIntent; patterns: RegExp[] }> = [
  { intent: 'leadership', patterns: [/\bceo\b/i, /\bchairman\b/i, /\bcoo\b/i, /\bfounders?\b/i, /\bmanagement\b/i, /\bleadership\b/i, /company ka ceo/i, /maalik kaun/i] },
  { intent: 'branch_heads', patterns: [/branch heads?/i, /head of (?:the )?branch/i, /noida head/i, /ahmedabad head/i, /branch ka head/i] },
  { intent: 'locations', patterns: [/\boffices?\b/i, /\blocations?\b/i, /\bbranches?\b/i, /\boffice address\b/i, /office kaha/i, /branch kaha/i] },
  { intent: 'contact', patterns: [/contact (?:details|number|email|info)/i, /how (?:do i |can i )?(?:contact|reach)\b/i, /customer support/i, /support email/i, /sales (?:inquiry|email)/i, /\bhelpline\b/i] },
  { intent: 'careers', patterns: [/career/i, /opening/i, /vacanc/i, /job at/i, /hiring/i] },
  { intent: 'services', patterns: [/what (?:services|does (?:mas|the company) (?:do|offer|provide))/i, /services (?:do|does|offered|provided)/i, /business process/i, /\bbpo\b/i, /capabilit/i] },
  // The company's own name is a subject marker, not a question about the company.
  // "/mas callnet/" here matched anything that merely mentioned it, so "how many
  // employees does MAS Callnet have in Mumbai?" was answered with the company
  // overview and leadership. Naming the company now decides nothing; the question
  // has to actually ask for an overview.
  { intent: 'overview', patterns: [/about (?:mas|the )?compan(?:y|ies)/i, /about mas callnet/i, /\bcompany (?:overview|information|profile|background|history)\b/i, /tell me about (?:mas|the company)/i, /2gthr/i, /\bmission\b/i, /\bvision\b/i, /\bcore values\b/i] },
];

let factCache: { expiresAt: number; facts: CompanyFact[] } | null = null;
const CACHE_TTL_MS = 10 * 60_000;

/** Test seam — mirrors clearMiraCacheForUser in ai-account.service.ts. Also
 *  useful in real code paths (e.g. right after a batch edit to
 *  ai_company_knowledge) if refreshOfficialCompanyKnowledge()'s live network
 *  scrape isn't wanted just to invalidate the cache. */
export function clearCompanyKnowledgeCache(): void {
  factCache = null;
}

export function detectCompanyIntent(question: string): CompanyIntent {
  const value = String(question || '').trim();
  for (const item of INTENT_PATTERNS) if (item.patterns.some((pattern) => pattern.test(value))) return item.intent;
  return 'unknown';
}

function cleanHtml(raw: string): string {
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14_000);
}

async function facts(): Promise<CompanyFact[]> {
  if (factCache && factCache.expiresAt > Date.now()) return factCache.facts;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT knowledge_key, category, title, content_text, source_url
      FROM ai_company_knowledge WHERE active_status = 1 AND is_public = 1 ORDER BY category, knowledge_key`);
    const dbFacts = rows.map((row) => ({
      key: String(row.knowledge_key), category: String(row.category), title: String(row.title),
      content: String(row.content_text), sourceUrl: String(row.source_url || OFFICIAL_ORIGIN),
    }));
    const merged = dbFacts.length ? dbFacts : FALLBACK_FACTS;
    factCache = { expiresAt: Date.now() + CACHE_TTL_MS, facts: merged };
    return merged;
  } catch (error) {
    console.warn('[Mira Company] Knowledge table unavailable, using approved built-in facts:', error instanceof Error ? error.message : error);
    factCache = { expiresAt: Date.now() + 60_000, facts: FALLBACK_FACTS };
    return FALLBACK_FACTS;
  }
}

async function branchHeads(): Promise<Array<{ branch: string; city: string; state: string; head: string }>> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT b.branch_name, b.city, b.state,
        GROUP_CONCAT(DISTINCT e.full_name ORDER BY e.full_name SEPARATOR ', ') AS branch_head_name
      FROM branch_master b
      LEFT JOIN user_assignment_scope uas ON uas.branch_id = b.id AND uas.role_key = 'branch_head' AND uas.active_status = 1
      LEFT JOIN employees e ON e.user_id = uas.user_id AND e.active_status = 1
      WHERE b.active_status = 1
      GROUP BY b.id, b.branch_name, b.city, b.state
      ORDER BY b.branch_name`);
    return rows.map((row) => ({
      branch: String(row.branch_name || 'Branch'), city: String(row.city || ''), state: String(row.state || ''),
      head: String(row.branch_head_name || 'Not assigned in HRMS'),
    }));
  } catch (error) {
    console.warn('[Mira Company] Branch-head lookup failed:', error instanceof Error ? error.message : error);
    return [];
  }
}

function localResponse(answer: string, sourceContexts: string[], insights: AiInsight[] = []): AiGenerateResponse {
  return {
    answer, provider: 'mira-company-knowledge', model: 'approved-company-knowledge-v1', latencyMs: 1,
    safetyBlocked: false, fallbackUsed: false, generatedAt: new Date().toISOString(),
    sourceContexts, dataConfidence: { overall: 1 }, insights,
  };
}

export async function answerCompanyQuestion(question: string): Promise<AiGenerateResponse | null> {
  const intent = detectCompanyIntent(question);
  if (intent === 'unknown') return null;
  if (intent === 'branch_heads') {
    const heads = await branchHeads();
    if (!heads.length) return localResponse('Branch-head assignments are not currently available in HRMS. Please check the organisation chart or contact HR.', ['hrms:branch_head_assignments']);
    const lines = heads.map((item) => `• ${item.branch}${item.city ? ` (${item.city}${item.state ? `, ${item.state}` : ''})` : ''}: ${item.head}`);
    return localResponse(`Here are the current branch-head assignments recorded in HRMS:\n\n${lines.join('\n')}\n\nThese assignments come from the live HRMS organisation scope and may change when HR updates roles.`, ['hrms:branch_head_assignments'], [{ key: 'branch-count', label: `${heads.length} active branches`, count: heads.length, severity: 'low' }]);
  }
  const allFacts = await facts();
  const selected = allFacts.filter((fact) => fact.category === intent || (intent === 'overview' && ['overview', 'leadership'].includes(fact.category)));
  const useful = selected.length ? selected : allFacts.filter((fact) => fact.category === 'overview');
  const answer = useful.map((fact) => `${fact.title}:\n${fact.content}`).join('\n\n');
  return localResponse(answer, useful.map((fact) => `official:${fact.sourceUrl}`));
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((token) => token.length > 2));
}

export function companyKnowledgeMissResponse(): AiGenerateResponse {
  return localResponse(
    `I couldn't find that in HRMS or the approved MAS Callnet sources. Try asking about your attendance, salary, leave, shift, documents, company leadership, branch heads, offices, contact details or careers.`,
    ['approved_company_sources:no_match'],
    [{ key: 'source-not-found', label: 'No approved source matched', severity: 'low' }],
  );
}

export async function getPublicCompanyContext(question: string): Promise<Record<string, unknown>> {
  const allFacts = await facts();
  const queryTokens = tokens(question);
  const ranked = allFacts.map((fact) => {
    const haystack = tokens(`${fact.title} ${fact.category} ${fact.content}`);
    let score = 0;
    for (const token of queryTokens) if (haystack.has(token)) score += 1;
    return { fact, score };
  }).sort((a, b) => b.score - a.score);
  const selected = ranked.filter((item) => item.score > 0).slice(0, 5).map((item) => item.fact);
  const contextFacts = selected.length ? selected : allFacts.filter((fact) => ['overview', 'leadership', 'contact'].includes(fact.category)).slice(0, 5);
  return {
    company_name: 'MAS Callnet',
    knowledge_scope: 'approved_public_company_information_only',
    facts: contextFacts.map((fact) => ({ title: fact.title, content: fact.content.slice(0, 3_000), source_url: fact.sourceUrl })),
    source_contexts: contextFacts.map((fact) => `official:${fact.sourceUrl}`),
    data_confidence: { company_public_knowledge: 1 },
    safe_mode: true,
  };
}

export async function refreshOfficialCompanyKnowledge(): Promise<{ refreshed: number; pages: string[] }> {
  const pages: string[] = [];
  for (const page of OFFICIAL_PAGES) {
    const url = new URL(page.path, OFFICIAL_ORIGIN);
    if (url.origin !== OFFICIAL_ORIGIN) throw new Error('Company knowledge URL is outside the official allowlist');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'MAS-HRMS-Mira-Knowledge/1.0' } });
      if (!response.ok) throw new Error(`Official page returned ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) throw new Error('Official page did not return HTML');
      const content = cleanHtml(await response.text());
      if (content.length < 100) throw new Error('Official page content was unexpectedly short');
      await db.execute(`INSERT INTO ai_company_knowledge
        (id, knowledge_key, category, title, content_text, source_url, source_title, is_public, active_status, refreshed_at)
        VALUES (UUID(), ?, 'website_page', ?, ?, ?, ?, 1, 1, NOW())
        ON DUPLICATE KEY UPDATE title = VALUES(title), content_text = VALUES(content_text), source_url = VALUES(source_url),
          source_title = VALUES(source_title), active_status = 1, refreshed_at = NOW(), updated_at = NOW()`,
      [page.key, page.title, content, url.toString(), page.title]);
      pages.push(url.toString());
    } finally {
      clearTimeout(timeout);
    }
  }
  factCache = null;
  return { refreshed: pages.length, pages };
}

export async function companyKnowledgeStatus(): Promise<{ source: string; facts: number; lastRefreshedAt: string | null }> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS fact_count, MAX(refreshed_at) AS refreshed_at
      FROM ai_company_knowledge WHERE active_status = 1 AND is_public = 1`);
    return { source: OFFICIAL_ORIGIN, facts: Number(rows[0]?.fact_count || 0), lastRefreshedAt: rows[0]?.refreshed_at ? new Date(String(rows[0].refreshed_at)).toISOString() : null };
  } catch {
    return { source: OFFICIAL_ORIGIN, facts: FALLBACK_FACTS.length, lastRefreshedAt: null };
  }
}

/**
 * The instruction previously required every reply to come from approved context,
 * which made Mira refuse "hello" — a greeting is not a claim about the company,
 * but the rule could not tell the two apart. It now separates them: facts stay
 * strictly grounded, conversation does not need a source.
 */
export const COMPANY_SYSTEM_INSTRUCTION = `You are ${MIRA_NAME}, MAS Callnet's HRMS assistant.

Two different things, and the difference matters:

FACTS — anything about MAS Callnet's people, offices, policies, processes, dates or numbers, and anything about an employee's own HR record — must come only from the approved context supplied with this request. Never invent, infer, estimate or fill a gap from general knowledge. If the approved context does not contain a fact you are asked for, say exactly: "I couldn't find that in HRMS or the approved MAS Callnet sources."

CONVERSATION is not a fact. Greetings, thanks, apologies, small talk, clarifying questions, and explaining what you can help with need no approved source. Reply warmly and briefly in the person's own language, then point them to something you can actually help with. Never answer a greeting with the not-found line.

Never mention a training-data date, knowledge cutoff, model memory, browsing limitation, or phrases such as "as an AI".
Never request or reveal another employee's personal information.

Never describe how this system is built. Do not mention services, routing, providers, context, approved sources as a mechanism, or which component should have answered — the person is talking to you, and telling them to use "the self-account service" is telling them to use you. If a question about their own HRMS record reaches you, it means the lookup did not return data: say you could not retrieve it right now and name the HRMS page where they can see it themselves.
When facts are available, lead with the answer, include useful specifics, and keep the response concise.
Use the person's name when the context gives it, and refer back to earlier turns when the question depends on them.`;
