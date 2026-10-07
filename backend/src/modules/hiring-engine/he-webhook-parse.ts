/** Parses the WhatsApp Cloud-API style payload Pinbot forwards (messages + statuses). Pure. */
export interface InboundMsg { from: string; id: string; text: string }
export interface StatusEvt { id: string; status: "sent" | "delivered" | "read" | "failed"; error?: string }

const STATUS = new Set(["sent", "delivered", "read", "failed"]);

type Obj = Record<string, any>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);

/** Flattens every accepted shape (Meta envelope, entry/changes, array of either, bare value, {value}) into change values. */
function collectValues(node: unknown, out: Obj[], depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(node)) { for (const n of node.slice(0, 200)) collectValues(n, out, depth + 1); return; }
  if (!isObj(node)) return;
  if (Array.isArray(node.entry)) { collectValues(node.entry, out, depth + 1); return; }
  if (Array.isArray(node.changes)) { collectValues(node.changes, out, depth + 1); return; }
  if (isObj(node.value)) { collectValues(node.value, out, depth + 1); return; }
  if (Array.isArray(node.messages) || Array.isArray(node.statuses)) out.push(node);
}

export function parseWhatsAppWebhook(body: unknown): { inbound: InboundMsg[]; statuses: StatusEvt[] } {
  const inbound: InboundMsg[] = [];
  const statuses: StatusEvt[] = [];
  const values: Obj[] = [];
  collectValues(body, values);
  for (const v of values) {
    for (const m of (Array.isArray(v.messages) ? v.messages : []) as Array<Record<string, any>>) {
      if (!isObj(m)) continue;
      // Quick-reply buttons arrive as button.text (template) or interactive.button_reply.title; typed replies as text.body.
      const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
      if (m.from && m.id) inbound.push({ from: String(m.from), id: String(m.id), text: String(text) });
    }
    for (const s of (Array.isArray(v.statuses) ? v.statuses : []) as Array<Record<string, any>>) {
      if (!isObj(s) || !s.id || !STATUS.has(String(s.status))) continue;
      const e = s.errors?.[0];
      const reason = e?.title ?? e?.message;
      // Keep Meta's numeric code in front so metaErrorCode groups the failure.
      const error = e?.code != null && /^\d+$/.test(String(e.code)) ? `(#${e.code}) ${reason ?? ""}`.trim() : reason;
      statuses.push({ id: String(s.id), status: s.status, error });
    }
  }
  return { inbound, statuses };
}
