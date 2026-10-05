/** Parses the WhatsApp Cloud-API style payload Pinbot forwards (messages + statuses). Pure. */
export interface InboundMsg { from: string; id: string; text: string }
export interface StatusEvt { id: string; status: "sent" | "delivered" | "read" | "failed"; error?: string }

const STATUS = new Set(["sent", "delivered", "read", "failed"]);

export function parseWhatsAppWebhook(body: unknown): { inbound: InboundMsg[]; statuses: StatusEvt[] } {
  const inbound: InboundMsg[] = [];
  const statuses: StatusEvt[] = [];
  const entries = (body as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return { inbound, statuses };
  for (const e of entries) {
    const changes = (e as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;
    for (const c of changes) {
      const v = (c as { value?: Record<string, unknown> }).value ?? {};
      for (const m of (Array.isArray(v.messages) ? v.messages : []) as Array<Record<string, any>>) {
        // Quick-reply buttons arrive as button.text (template) or interactive.button_reply.title; typed replies as text.body.
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
        if (m.from && m.id) inbound.push({ from: String(m.from), id: String(m.id), text: String(text) });
      }
      for (const s of (Array.isArray(v.statuses) ? v.statuses : []) as Array<Record<string, any>>) {
        if (!s.id || !STATUS.has(String(s.status))) continue;
        statuses.push({ id: String(s.id), status: s.status, error: s.errors?.[0]?.title ?? s.errors?.[0]?.message });
      }
    }
  }
  return { inbound, statuses };
}
