/** Why does the portal reject uploaded rows? Raw upload-log fields and any detail the portal exposes. STRICTLY READ-ONLY (GET only). */
import "dotenv/config";
import { botConfig } from "../src/modules/hiring-engine/superbot-portal.client.js";
(async () => {
  const c = botConfig();
  if (!c) { console.log("portal not configured"); return; }
  const j = async (method: string, url: string, body?: unknown, tok?: string) => {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json", Accept: "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> | null };
  };
  const login = await j("POST", `${c.base}/login`, { email: c.email, password: c.password });
  const tok = String((login.body as { token?: unknown } | null)?.token ?? "");
  if (!tok) { console.log("sign-in failed", login.status); return; }
  const base = `${c.base}/account/${c.accountId}/campaign/${c.campaignId}`;
  const logs = await j("GET", `${base}/upload-logs`, undefined, tok);
  const list = ((logs.body?.data ?? []) as Array<Record<string, unknown>>);
  console.log("upload-logs status", logs.status, "count", list.length);
  console.log("keys of one log:", Object.keys(list[0] ?? {}).join(","));
  console.log("newest log raw:", JSON.stringify(list[0] ?? null).slice(0, 700));
  const id = list[0]?.id;
  for (const p of [`upload-logs/${id}`, `upload-logs/${id}/rejected`, `upload-logs/${id}/errors`, `upload-log/${id}`]) {
    const r = await j("GET", `${base}/${p}`, undefined, tok);
    console.log(`GET ${p} ->`, r.status, JSON.stringify(r.body).slice(0, 500));
  }
  const phones = await j("GET", `${base}/phone?per_page=3&page=1`, undefined, tok);
  const first = ((phones.body?.data as { data?: unknown[] } | undefined)?.data ?? [])[0];
  console.log("phone list status", phones.status, "keys:", Object.keys((first ?? {}) as object).join(","));
  const camp = await j("GET", base, undefined, tok);
  console.log("campaign status", camp.status, JSON.stringify(camp.body).slice(0, 900));
})();
