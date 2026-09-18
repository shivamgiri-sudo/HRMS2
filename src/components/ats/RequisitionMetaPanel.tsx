/**
 * META Campaign panel for the requisition detail view.
 *
 * This is the manual link the whole automation depends on, and it is worth being explicit about
 * why it cannot be automated away: META's Lead Gen webhook payload identifies the source only by
 * `form_id`. It never carries a requisition code, a campaign name, or anything else of ours. So
 * until somebody records "Lead Form 123456 belongs to requisition REQ-2609-AB12", an arriving lead
 * has no requisition to be screened against — it is stored, but it sits unscreened with
 * screening_result = 'pending' and no ATS candidate.
 *
 * The panel therefore does three things, in order of importance:
 *   1. Lets marketing paste the Lead Gen Form ID and META Campaign ID.
 *   2. Says loudly, when no form ID is linked, what the consequence is.
 *   3. Shows the live counters for the linked campaign, so the link can be verified as working
 *      rather than merely saved.
 *
 * Writes go to POST/PATCH /api/meta/campaigns, whose role gate is narrower than the read gate —
 * a wrong Form ID silently routes candidates into the wrong requisition, which is why the backend
 * also enforces that one form ID maps to exactly one campaign (UNIQUE on meta_campaign.meta_form_id)
 * and returns a 409 naming the requisition that already owns it.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Link2, Megaphone, RefreshCcw, Save } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

type Campaign = {
  id: string;
  requisitionId: string;
  campaignName: string;
  campaignStatus: "draft" | "active" | "paused" | "completed" | "archived";
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaFormId: string | null;
  impressions: number;
  reach: number;
  clicks: number;
  leadsCount: number;
  spendInr: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

const STATUSES = ["draft", "active", "paused", "completed", "archived"] as const;

function Counter({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

export default function RequisitionMetaPanel({
  requisitionId,
  requisitionCode,
  designationName,
  canEdit,
}: {
  requisitionId: string;
  requisitionCode: string;
  designationName: string | null;
  canEdit: boolean;
}) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [form, setForm] = useState({
    campaignName: "",
    metaCampaignId: "",
    metaFormId: "",
    campaignStatus: "draft" as Campaign["campaignStatus"],
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Campaign[] }>(
        `/api/meta/campaigns?requisitionId=${encodeURIComponent(requisitionId)}`
      );
      const found = res.data?.[0] ?? null;
      setCampaign(found);
      setForm({
        campaignName: found?.campaignName ?? `${designationName ?? "Recruitment"} — ${requisitionCode}`,
        metaCampaignId: found?.metaCampaignId ?? "",
        metaFormId: found?.metaFormId ?? "",
        campaignStatus: found?.campaignStatus ?? "draft",
      });
    } catch (err: unknown) {
      setError((err as { message?: string })?.message || "Unable to load campaign link");
    } finally {
      setLoading(false);
    }
  }, [requisitionId, requisitionCode, designationName]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError("");
    setOkMsg("");
    try {
      const body = {
        campaignName: form.campaignName.trim(),
        metaCampaignId: form.metaCampaignId.trim() || null,
        metaFormId: form.metaFormId.trim() || null,
        campaignStatus: form.campaignStatus,
      };
      if (campaign) {
        await hrmsApi.patch(`/api/meta/campaigns/${campaign.id}`, body);
      } else {
        await hrmsApi.post("/api/meta/campaigns", { requisitionId, ...body });
      }
      setOkMsg(
        body.metaFormId
          ? "Linked. Leads from this form will now be screened against this requisition."
          : "Saved. Add the Lead Gen Form ID to start routing leads."
      );
      await load();
    } catch (err: unknown) {
      // A 409 here is the useful case: the backend names the requisition that already owns this
      // form ID, which is exactly what the operator needs to resolve the clash.
      setError((err as { message?: string })?.message || "Unable to save campaign link");
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    setSaving(true);
    setError("");
    setOkMsg("");
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { synced: number; failed: number } }>(
        `/api/meta/campaigns/${campaign?.id}/sync`
      );
      const d = res.data;
      setOkMsg(
        d && d.synced > 0
          ? `Metrics refreshed for ${d.synced} campaign(s).`
          : "Nothing was synced — check that a META Campaign ID is set and the API token is configured."
      );
      await load();
    } catch (err: unknown) {
      setError((err as { message?: string })?.message || "Sync failed");
    } finally {
      setSaving(false);
    }
  };

  const linked = Boolean(campaign?.metaFormId);
  const inr = (v: number) => `₹${Number(v || 0).toLocaleString("en-IN")}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Megaphone className="h-4 w-4 text-blue-600" /> META Campaign Link
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        META's lead webhook identifies a lead only by its Lead Gen Form ID. Recording that ID here is what lets an
        incoming lead be matched to this requisition and screened automatically.
      </p>

      {loading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-200/70" />
          ))}
        </div>
      ) : (
        <>
          {!linked && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-900">
                <span className="font-bold">No Lead Gen Form ID linked. </span>
                Leads from this campaign will still be received and stored, but they cannot be screened or turned into
                candidates until the form ID is recorded here.
              </p>
            </div>
          )}

          {linked && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p className="text-xs text-emerald-900">
                Linked to form <span className="font-mono font-bold">{campaign?.metaFormId}</span>. Incoming leads are
                screened against this requisition's age band, education and minimum experience.
              </p>
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-700">Campaign Name</label>
              <input
                value={form.campaignName}
                onChange={(e) => setForm((f) => ({ ...f, campaignName: e.target.value }))}
                disabled={!canEdit}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                placeholder="e.g. CSE Hiring — Mumbai — Sep"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Lead Gen Form ID</label>
              <input
                value={form.metaFormId}
                onChange={(e) => setForm((f) => ({ ...f, metaFormId: e.target.value }))}
                disabled={!canEdit}
                className="w-full rounded-lg border px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                placeholder="123456789012345"
              />
              <p className="mt-1 text-[11px] text-slate-400">Leads Center → Form Library</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">META Campaign ID</label>
              <input
                value={form.metaCampaignId}
                onChange={(e) => setForm((f) => ({ ...f, metaCampaignId: e.target.value }))}
                disabled={!canEdit}
                className="w-full rounded-lg border px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                placeholder="23851234567890123"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Ads Manager URL: act_xxxx/campaigns/<span className="font-mono">this part</span>. Needed for
                impressions and spend only.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Campaign Status</label>
              <select
                value={form.campaignStatus}
                onChange={(e) => setForm((f) => ({ ...f, campaignStatus: e.target.value as Campaign["campaignStatus"] }))}
                disabled={!canEdit}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">Only active/paused/completed are synced nightly.</p>
            </div>
          </div>

          {error && (
            <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
              {error}
            </div>
          )}
          {okMsg && (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
              {okMsg}
            </div>
          )}

          {canEdit && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => void save()}
                disabled={saving || !form.campaignName.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {campaign ? "Update Link" : "Link Campaign"}
              </button>
              {campaign?.metaCampaignId && (
                <button
                  onClick={() => void syncNow()}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  <RefreshCcw className={`h-3.5 w-3.5 ${saving ? "animate-spin" : ""}`} /> Sync Metrics Now
                </button>
              )}
              <a
                href="/ats/meta-campaigns"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Campaign Dashboard
              </a>
            </div>
          )}

          {campaign && (
            <div className="mt-4">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                <Link2 className="h-3 w-3" /> Live counters
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
                <Counter label="Impressions" value={Number(campaign.impressions || 0).toLocaleString("en-IN")} />
                <Counter label="Reach" value={Number(campaign.reach || 0).toLocaleString("en-IN")} />
                <Counter label="Clicks" value={Number(campaign.clicks || 0).toLocaleString("en-IN")} />
                <Counter label="Leads" value={Number(campaign.leadsCount || 0).toLocaleString("en-IN")} />
                <Counter label="Spend" value={inr(campaign.spendInr)} />
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {campaign.lastSyncError ? (
                  <span className="font-semibold text-rose-600">Last sync failed: {campaign.lastSyncError}</span>
                ) : campaign.lastSyncedAt ? (
                  <>
                    Ad metrics last synced {new Date(campaign.lastSyncedAt).toLocaleString("en-IN")}. META finalises
                    spend up to 24h late, so today's figure is provisional. Lead count updates in real time from the
                    webhook and does not wait for a sync.
                  </>
                ) : (
                  <>
                    Ad metrics have never been synced. Lead count still updates in real time from the webhook — only
                    impressions, reach, clicks and spend depend on the sync.
                  </>
                )}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
