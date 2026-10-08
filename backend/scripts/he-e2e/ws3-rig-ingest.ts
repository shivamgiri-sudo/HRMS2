// Rig helper (WS3 B1): ingest fake Live Meta leads into the isolated clone through the real ingestLead (prefetched detail, no Graph call,
// skipOutreach so nothing is sent). Refuses any DB other than 127.0.0.1:3312 / ws3_rig.
//   META_MULTI_REQ_ROUTING=<campaign id> tsx ws3-rig-ingest.ts <formId> '<json array of {leadgenId, fields:{...}}>'
if (process.env.DB_HOST !== "127.0.0.1" || process.env.DB_PORT !== "3312" || process.env.DB_NAME !== "ws3_rig") { console.error("refusing: not the ws3 clone"); process.exit(2); }
const { metaCampaignService } = await import("../../src/modules/meta-campaign/meta-campaign.service.js");
const [formId, json] = process.argv.slice(2);
const out: unknown[] = [];
for (const l of JSON.parse(json) as Array<{ leadgenId: string; fields: Record<string, string> }>) {
  const r = await metaCampaignService.ingestLead({ formId, leadgenId: l.leadgenId, skipOutreach: true,
    prefetchedDetail: { id: l.leadgenId, created_time: new Date().toISOString(), field_data: Object.entries(l.fields).map(([name, v]) => ({ name, values: [v] })) } as never });
  out.push({ leadgenId: l.leadgenId, id: r?.id ?? null, requisitionId: r?.requisitionId ?? null, screening: r?.screeningResult ?? null });
}
console.log(`RESULT ${JSON.stringify(out)}`);
process.exit(0);
