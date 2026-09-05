# Mira — Draggable Float Button + HRMS Guide Upgrade

**Date:** 2026-09-03  
**Scope:** Frontend drag UX, multilingual session preference, deep HRMS knowledge base, routing integration  
**Modules affected:** `src/components/ai/AmbientStrip.tsx`, `src/components/ai/CommandPalette.tsx`, `backend/src/modules/ai/ai-howto.service.ts`, `backend/src/modules/ai/ai-conversation.service.ts`, `backend/src/modules/ai/ai-insights.routes.ts`  
**New files:** `backend/src/modules/ai/mira-hrms-knowledge.ts`, `backend/src/modules/ai/mira-language-detect.ts`

---

## 1. Draggable Float Button

### Component: `AmbientStrip.tsx`

Replace the hardcoded `fixed bottom-5 right-4` with React state-driven position.

**State:**
```ts
const [pos, setPos] = useState({ x: 24, y: 80 }); // px from right/bottom
const dragging = useRef(false);
const dragStart = useRef({ mx: 0, my: 0, x: 0, y: 0 });
const moved = useRef(false); // suppresses click when drag happened
```

**Drag logic:**
- `onPointerDown` on the button: record `pointerId`, capture pointer (`setPointerCapture`), store start positions, set `dragging.current = true`, `moved.current = false`
- `onPointerMove`: if dragging, compute delta from start, update `pos`, clamp to viewport, set `moved.current = true` if delta > 4px
- `onPointerUp`: release capture, `dragging.current = false`; if `!moved.current` → call `onOpen()`
- Clamping: `x ∈ [16, window.innerWidth - 80]`, `y ∈ [16, window.innerHeight - 80]`
- CSS: `style={{ right: pos.x, bottom: pos.y }}` on the outer div; `transition: box-shadow 200ms` always; no position transition during drag (0ms)

**Cursor:** `cursor-grab` idle, `cursor-grabbing` during drag (applied via `dragging` ref to avoid re-render)

**Tooltip:** suppressed while `moved.current` is true (add `pointer-events-none opacity-0` during drag)

**Touch:** `touch-action: none` + `user-select: none` on the button to prevent scroll interference

**No localStorage** — position resets on reload by design.

**Accessibility:** `aria-label` preserved. `onKeyDown` Enter/Space still calls `onOpen()` (keyboard users are unaffected by drag).

---

## 2. Language Detection & Session Preference

### New file: `mira-language-detect.ts`

```ts
export type DetectedLang = 'en' | 'hi' | 'te' | 'ta' | 'mr' | 'bn' | 'gu' | 'kn' | 'ml' | 'pa';

export interface LangInfo { code: DetectedLang; name: string; rtl: boolean; }

const LANG_MAP: LangInfo[] = [
  { code: 'hi', name: 'हिंदी',    rtl: false, range: [0x0900, 0x097F] },
  { code: 'mr', name: 'मराठी',    rtl: false, range: [0x0900, 0x097F] }, // Devanagari shared
  { code: 'te', name: 'తెలుగు',   rtl: false, range: [0x0C00, 0x0C7F] },
  { code: 'ta', name: 'தமிழ்',    rtl: false, range: [0x0B80, 0x0BFF] },
  { code: 'bn', name: 'বাংলা',     rtl: false, range: [0x0980, 0x09FF] },
  { code: 'gu', name: 'ગુજરાતી',  rtl: false, range: [0x0A80, 0x0AFF] },
  { code: 'kn', name: 'ಕನ್ನಡ',    rtl: false, range: [0x0C80, 0x0CFF] },
  { code: 'ml', name: 'മലയാളം',   rtl: false, range: [0x0D00, 0x0D7F] },
  { code: 'pa', name: 'ਪੰਜਾਬੀ',   rtl: false, range: [0x0A00, 0x0A7F] },
];
```

- `detectLanguage(text: string): LangInfo | null` — count non-Latin chars per script range; if ≥ 30% of non-whitespace chars are in a range, return that lang. Returns `null` for English/ambiguous Roman script.
- Devanagari collision (Hindi vs Marathi): can't distinguish by script alone; default to `hi`. Not critical — both use same script, LLM handles dialect correctly when told "respond in Devanagari Hindi/Marathi".

### `ai-conversation.service.ts` changes

Add to `Thread`:
```ts
preferredLanguage?: LangInfo;
consecutiveForeignCount: number; // consecutive messages in a non-default lang
```

On each `recordTurn()` call, run `detectLanguage(question)`:
- Non-null result + matches current `preferredLanguage` → increment `consecutiveForeignCount`
- Non-null result + different from `preferredLanguage` + `consecutiveForeignCount >= 2` → update `preferredLanguage`, reset counter
- Non-null result + no current preference → set immediately (first detection wins)
- Null (English) + current preference set → decrement counter toward 0; clear preference when counter hits 0 after 3 consecutive English messages

### System prompt injection (`ai-insights.routes.ts`)

Where `COMPANY_SYSTEM_INSTRUCTION` is used, prepend:
```ts
const langInstruction = thread.preferredLanguage
  ? `Respond in ${thread.preferredLanguage.name} (${thread.preferredLanguage.code}). Maintain this language for the entire session unless the user clearly switches for 2+ consecutive messages.\n\n`
  : '';
const instruction = langInstruction + COMPANY_SYSTEM_INSTRUCTION;
```

### Frontend badge (`CommandPalette.tsx`)

The `/api/ai/session` response already returns session info. Add `detectedLanguage?: { code: string; name: string }` to the session payload (read from the active thread). Show in header:
```tsx
{session.detectedLanguage && (
  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
    🌐 {session.detectedLanguage.name}
  </span>
)}
```
Badge appears only when a non-English language is active. No badge = English (clean default).

---

## 3. Deep HRMS Knowledge Base

### New file: `mira-hrms-knowledge.ts`

Same module pattern as `ai-howto-catalog.ts`. Each entry:

```ts
export interface KnowledgeEntry {
  code: string;
  title: string;
  aliases: RegExp[];           // topic detection regexps
  knowledge: string;           // 200–500 word deep-context block
  relatedHowTo?: string[];     // codes from HOWTO_CATALOG to also inject
}
```

**Coverage (first pass — most-asked, highest impact):**

| Code | Title |
|------|-------|
| `payroll_pf_esic` | PF and ESIC computation rules |
| `payroll_gross_net` | Gross vs net salary, component breakdown |
| `payroll_lwp` | LWP deduction, attendance linkage |
| `payroll_payslip_fields` | What every payslip field means |
| `leave_balance_types` | CL/EL/SL/ML caps, carry-forward, encashment |
| `leave_overlap_rules` | Overlap checks, sandwich rule, week-off charge |
| `attendance_apr_rules` | APR logic, absent-when-no-record rule, biometric vs APR |
| `attendance_regularization` | Window limits, who can raise, approval chain |
| `wfm_roster_lifecycle` | Draft→publish→acknowledge→lock→payroll-ready stages |
| `wfm_roster_lock` | What locks a roster, correction after lock |
| `bulk_upload_guide` | Each upload type, common errors, shift-code vs time |
| `exit_fnf_stages` | Clearance stages, provisional flag, settlement items |
| `ats_lifecycle` | Candidate stages, offer letter, conversion to employee |
| `rbac_roles` | What each role can see/do (employee vs branch_head vs wfm etc.) |
| `client_portal_scope` | What clients can and cannot see, data boundaries |

Each knowledge block is written at **developer depth**: the exact business rules the code implements, field names, threshold values, database column semantics, what triggers what, and what common errors mean — not marketing language.

Example (excerpt for `payroll_pf_esic`):
```
PF is computed on "structure gross" — the sum of fixed salary components 
(basic, HRA, DA, special allowance) as defined in the employee's salary 
structure, before any attendance proration. Incentives and performance pay 
are excluded from the PF base. Employee share: 12% of basic (capped at 
₹1,800/month when basic > ₹15,000). Employer share: 12% of basic (3.67% 
to EPF, 8.33% to EPS, capped at ₹1,250 EPS when basic > ₹15,000). 
ESIC applies only when gross salary ≤ ₹21,000/month; rate: 0.75% employee, 
3.25% employer on gross. Once an employee crosses ₹21,000 gross they are 
exempted for the rest of that contribution period (April–September or 
October–March). The statutory_config table controls all thresholds — 
payroll is blocked if no approved config exists for the period.
```

### `ai-howto.service.ts` changes

Add `findDeepKnowledge(question: string, roleKeys: string[]): KnowledgeEntry | null` — same regex-match pattern as `answerHowToQuestion`. Returns first matching entry.

In `ai-insights.routes.ts` `/ask/stream` handler, after existing howto check:
```ts
const knowledge = findDeepKnowledge(question, user.roleKeys);
if (knowledge) {
  systemInstruction += `\n\n### HRMS Context\n${knowledge.knowledge}`;
}
```

Both howto steps AND deep knowledge inject when both match — user gets navigation guidance + business rule explanation in one answer.

---

## 4. Files Changed / Created

| File | Change |
|------|--------|
| `src/components/ai/AmbientStrip.tsx` | Rewrite: drag logic, pointer events, clamped position state |
| `src/components/ai/CommandPalette.tsx` | Add language badge in header; read `detectedLanguage` from session |
| `backend/src/modules/ai/mira-language-detect.ts` | New: Unicode script detection util |
| `backend/src/modules/ai/mira-hrms-knowledge.ts` | New: deep knowledge catalog (~15 entries first pass) |
| `backend/src/modules/ai/ai-conversation.service.ts` | Add `preferredLanguage` + `consecutiveForeignCount` to Thread |
| `backend/src/modules/ai/ai-howto.service.ts` | Export `findDeepKnowledge()` |
| `backend/src/modules/ai/ai-insights.routes.ts` | Inject language instruction + knowledge block into system prompt |

---

## 5. What This Does NOT Change

- Mira's self-account data lookup paths (salary, attendance, leave balance) — unchanged
- `ai-howto-catalog.ts` — no edits; new knowledge catalog is additive alongside it  
- Chat panel layout, voice input, streaming, action confirmation flow — unchanged
- Backend auth, role checks, rate limiting — unchanged
- PII redaction, `externalSafe` conversation memory rules — unchanged

---

## 6. Test Plan

1. **Drag:** button moves with pointer; click without drag still opens chat; button stays within viewport on all 4 edges; touch drag works on mobile
2. **Language:** send a Hindi question → badge appears → subsequent English questions → badge stays until 3 consecutive English; send Telugu → badge updates
3. **Knowledge:** ask "how is PF calculated" → response includes actual threshold values (not generic); ask "what does LWP mean on my payslip" → explains deduction logic; ask in Hindi → same response in Hindi
4. **Howto + knowledge together:** ask "how do I apply for leave and how many days can I take" → gets navigation steps AND leave-balance rules in one answer
5. **Build:** `npm run build` zero errors; `cd backend && npx tsc --noEmit` zero errors
