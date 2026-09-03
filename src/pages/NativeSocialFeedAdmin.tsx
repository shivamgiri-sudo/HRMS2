import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Loader, RefreshCcw,
  Settings, Share2, X, Youtube,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  useSocialFeedAdminConfig,
  useSaveSocialConfig,
  useSyncSocialFeed,
  useAdminSocialProfileLinks,
  useSaveSocialProfileLinks,
  SOCIAL_LINK_DEFAULTS,
  type SocialPlatform,
  type SocialLinkPlatform,
} from "@/hooks/useSocialFeed";

// ── Platform definitions ────────────────────────────────────────────────────

const PLATFORMS: {
  key: SocialPlatform;
  label: string;
  color: string;
  pageIdLabel: string;
  pageIdPlaceholder: string;
  hasToken: boolean;
  tokenHelp: string;
}[] = [
  {
    key: "facebook",
    label: "Facebook",
    color: "#1877F2",
    pageIdLabel: "Facebook Page ID",
    pageIdPlaceholder: "e.g. 123456789012345",
    hasToken: true,
    tokenHelp:
      'In Meta Graph API Explorer, call GET /me/accounts and copy the "id" and "access_token" for your page.',
  },
  {
    key: "instagram",
    label: "Instagram",
    color: "#E1306C",
    pageIdLabel: "Instagram Business User ID",
    pageIdPlaceholder: "e.g. 17841400000000000",
    hasToken: true,
    tokenHelp:
      "Link your Instagram Business account to your Facebook Page. Then call GET /{page-id}?fields=instagram_business_account to get the IG User ID. The token is the same as your Facebook Page Token.",
  },
  {
    key: "youtube",
    label: "YouTube",
    color: "#FF0000",
    pageIdLabel: "YouTube Channel ID",
    pageIdPlaceholder: "e.g. UCxxxxxxxxxxxxxxxxxxxxxx",
    hasToken: false,
    tokenHelp:
      "Find your Channel ID in YouTube Studio → Settings → Channel → Basic info. No token required — posts are fetched via free RSS.",
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function daysUntilExpiry(expiry: string | null): number | null {
  if (!expiry) return null;
  const diff = new Date(expiry).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function ExpiryBadge({ expiry }: { expiry: string | null }) {
  const days = daysUntilExpiry(expiry);
  if (days === null) return null;
  if (days < 0)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
        <AlertTriangle className="h-3 w-3" /> Token expired
      </span>
    );
  if (days < 10)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
        <AlertTriangle className="h-3 w-3" /> Expires in {days}d
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
      <CheckCircle2 className="h-3 w-3" /> {days}d remaining
    </span>
  );
}

// ── Platform row form ────────────────────────────────────────────────────────

function PlatformRow({
  platform,
  existing,
  count,
  lastSynced,
}: {
  platform: (typeof PLATFORMS)[0];
  existing?: { page_id: string; token_expiry: string | null; enabled: boolean };
  count: number;
  lastSynced: string | null;
}) {
  const [pageId, setPageId] = useState(existing?.page_id ?? "");
  const [token, setToken] = useState("");
  const [expiryDate, setExpiryDate] = useState(
    existing?.token_expiry ? existing.token_expiry.slice(0, 10) : "",
  );
  const [saved, setSaved] = useState(false);
  const save = useSaveSocialConfig();

  const handleSave = async () => {
    if (!pageId.trim()) return;
    // Only send token_expiry if a date was actually entered
    const expiry =
      expiryDate.trim() ? `${expiryDate}T00:00:00Z` : null;

    save.mutate(
      {
        platform: platform.key,
        page_id: pageId.trim(),
        plain_token: token.trim() || undefined,
        token_expiry: expiry,
        enabled: true,
      },
      {
        onSuccess: () => {
          setSaved(true);
          setToken("");
          setTimeout(() => setSaved(false), 3000);
        },
      },
    );
  };

  const syncedLabel = lastSynced
    ? new Date(lastSynced).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "Not synced yet";

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
            style={{ backgroundColor: platform.color }}
          >
            {platform.key === "youtube" ? (
              <Youtube className="h-4 w-4" />
            ) : (
              <Share2 className="h-4 w-4" />
            )}
          </div>
          <div>
            <p className="text-sm font-black text-slate-950">{platform.label}</p>
            <p className="text-xs text-slate-400">{syncedLabel} · {count} posts cached</p>
          </div>
        </div>
        {existing?.token_expiry && (
          <ExpiryBadge expiry={existing.token_expiry} />
        )}
        {existing?.page_id && !existing.token_expiry && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
            <CheckCircle2 className="h-3 w-3" /> Configured
          </span>
        )}
      </div>

      {/* Form */}
      <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
        {/* Page ID */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">
            {platform.pageIdLabel} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            placeholder={platform.pageIdPlaceholder}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-blue-400"
          />
        </div>

        {/* Token */}
        {platform.hasToken ? (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Page Access Token
              <span className="ml-1.5 text-slate-400 font-normal">(leave blank to keep existing)</span>
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste new token here"
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-blue-400"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
            <p className="text-xs text-slate-500">No token required — uses free public RSS feed.</p>
          </div>
        )}

        {/* Token expiry */}
        {platform.hasToken && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Token Expiry Date
              <span className="ml-1.5 text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-blue-400"
            />
          </div>
        )}

        {/* Help text */}
        <div className={platform.hasToken ? "sm:col-span-2" : ""}>
          <div className="flex items-start gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
            <p className="text-xs text-blue-700">{platform.tokenHelp}</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4">
        {save.isError && (
          <p className="text-xs font-semibold text-red-600">
            Save failed — check all required fields.
          </p>
        )}
        {saved && (
          <p className="flex items-center gap-1 text-xs font-semibold text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved successfully.
          </p>
        )}
        {!save.isError && !saved && <span />}
        <button
          onClick={handleSave}
          disabled={!pageId.trim() || save.isPending}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {save.isPending ? (
            <Loader className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Save
        </button>
      </div>
    </div>
  );
}

// ── Public profile links editor ──────────────────────────────
// These are the URLs the login page icons and the feed cards open. They used to
// be hardcoded in the bundle (five copies across two files, which had drifted
// apart) — this card writes them to social_profile_link instead, so a handle can
// be corrected without a code change or a frontend deploy.

const LINK_ORDER: SocialLinkPlatform[] = [
  "website", "linkedin", "instagram", "twitter", "facebook", "youtube",
];

type LinkDraft = { profile_url: string; handle: string; enabled: boolean };

function ProfileLinksCard() {
  const { data, isLoading, isError, refetch } = useAdminSocialProfileLinks();
  const save = useSaveSocialProfileLinks();
  const [drafts, setDrafts] = useState<Record<string, LinkDraft>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Seed the inputs once the saved rows arrive; anything the API did not return
  // falls back to the same default the public page would render.
  useEffect(() => {
    if (!data) return;
    const next: Record<string, LinkDraft> = {};
    for (const platform of LINK_ORDER) {
      const row = data.find((l) => l.platform === platform);
      next[platform] = {
        profile_url: row?.profile_url ?? SOCIAL_LINK_DEFAULTS[platform].profile_url,
        handle: row?.handle ?? SOCIAL_LINK_DEFAULTS[platform].handle,
        enabled: row ? row.enabled : true,
      };
    }
    setDrafts(next);
  }, [data]);

  const update = (platform: string, patch: Partial<LinkDraft>) => {
    setDrafts((d) => ({ ...d, [platform]: { ...d[platform], ...patch } }));
    setMsg(null);
    setErr(null);
  };

  const handleSaveLinks = () => {
    setMsg(null);
    setErr(null);
    const invalid = LINK_ORDER.filter(
      (p) => !/^https?:\/\/\S+$/i.test((drafts[p]?.profile_url ?? "").trim()),
    );
    if (invalid.length) {
      setErr(
        `Enter a full URL starting with https:// for: ${invalid
          .map((p) => SOCIAL_LINK_DEFAULTS[p].label)
          .join(", ")}`,
      );
      return;
    }
    save.mutate(
      LINK_ORDER.map((platform) => ({
        platform,
        profile_url: drafts[platform].profile_url.trim(),
        handle: drafts[platform].handle.trim() || null,
        enabled: drafts[platform].enabled,
      })),
      {
        onSuccess: () => setMsg("Saved. The login page and the feed cards now use these links."),
        onError: () => setErr("Could not save. Check that you are signed in as super admin."),
      },
    );
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <div className="flex items-center gap-2">
          <Share2 className="h-4 w-4 text-slate-500" />
          <p className="text-sm font-black text-slate-950">Public Profile Links</p>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Where the social icons on the login screen and the Follow / Open buttons on{" "}
          <a href="/social-feed" className="text-blue-600 hover:underline">/social-feed</a>{" "}
          send people. Changing a URL here takes effect for everyone without a code change.
        </p>
      </div>

      {isError ? (
        <div className="flex items-center gap-3 px-6 py-4 text-sm font-semibold text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Could not load the links.
          <button onClick={() => void refetch()} className="ml-auto cursor-pointer underline">Retry</button>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader className="h-6 w-6 animate-spin text-slate-300" />
        </div>
      ) : (
        <>
          <div className="divide-y divide-slate-100">
            {LINK_ORDER.map((platform) => {
              const draft = drafts[platform];
              if (!draft) return null;
              return (
                <div key={platform} className="grid gap-3 px-6 py-4 sm:grid-cols-[110px_1fr_170px_auto] sm:items-center">
                  <p className="text-xs font-black text-slate-700">
                    {SOCIAL_LINK_DEFAULTS[platform].label}
                  </p>
                  <input
                    type="url"
                    value={draft.profile_url}
                    onChange={(e) => update(platform, { profile_url: e.target.value })}
                    placeholder={SOCIAL_LINK_DEFAULTS[platform].profile_url}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
                  />
                  <input
                    type="text"
                    value={draft.handle}
                    onChange={(e) => update(platform, { handle: e.target.value })}
                    placeholder={SOCIAL_LINK_DEFAULTS[platform].handle}
                    title="Shown on the feed card, e.g. @mascallnet"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
                  />
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) => update(platform, { enabled: e.target.checked })}
                      className="h-4 w-4 cursor-pointer accent-slate-700"
                    />
                    Show
                  </label>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-6 py-4">
            <button
              onClick={handleSaveLinks}
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              {save.isPending ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save Links
            </button>
            {msg && <span className="text-xs font-semibold text-green-700">{msg}</span>}
            {err && <span className="text-xs font-semibold text-red-700">{err}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NativeSocialFeedAdmin() {
  const { data, isLoading, isError, refetch } = useSocialFeedAdminConfig();
  const sync = useSyncSocialFeed();
  const configs = data?.configs ?? [];
  const counts = data?.counts ?? {};
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const getConfig = (platform: SocialPlatform) =>
    configs.find((c) => c.platform === platform);

  const handleSync = () => {
    setSyncMsg(null);
    sync.mutate(undefined, {
      onSuccess: (result) => {
        const parts = Object.entries(result ?? {})
          .map(([p, n]) => `${p}: ${n} posts`)
          .join(" · ");
        setSyncMsg(parts || "Sync complete — no new posts.");
      },
      onError: () => setSyncMsg("Sync failed. Check server logs."),
    });
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">

        {/* Page header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100">
              <Settings className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-950">Social Feed Admin</h1>
              <p className="text-sm text-slate-500">
                Configure platform credentials and trigger post syncs.
              </p>
            </div>
          </div>
          <button
            onClick={handleSync}
            disabled={sync.isPending}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          >
            {sync.isPending ? (
              <Loader className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            Sync Now
          </button>
        </div>

        {/* Sync result banner */}
        {syncMsg && (
          <div className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {syncMsg}
            <button onClick={() => setSyncMsg(null)} className="ml-auto cursor-pointer text-green-600 hover:text-green-800">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Error loading config */}
        {isError && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Could not load configuration.
            <button onClick={() => void refetch()} className="ml-auto cursor-pointer underline">
              Retry
            </button>
          </div>
        )}

        {/* Platform cards */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader className="h-8 w-8 animate-spin text-slate-300" />
          </div>
        ) : (
          <div className="space-y-4">
            {PLATFORMS.map((p) => {
              const cfg = getConfig(p.key);
              return (
                <PlatformRow
                  key={p.key}
                  platform={p}
                  existing={cfg ? { page_id: cfg.page_id, token_expiry: cfg.token_expiry, enabled: cfg.enabled } : undefined}
                  count={counts[p.key] ?? 0}
                  lastSynced={cfg?.last_synced_at ?? null}
                />
              );
            })}
          </div>
        )}

        {/* Public profile links */}
        <ProfileLinksCard />

        {/* X/Twitter & LinkedIn guidance */}
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <p className="text-sm font-black text-slate-950">X / Twitter & LinkedIn — No Setup Required</p>
          </div>
          <div className="divide-y divide-slate-100">
            <div className="px-6 py-4">
              <p className="text-xs font-semibold text-slate-700">X / Twitter</p>
              <p className="mt-1 text-xs text-slate-500">
                Uses the official Timeline embed widget — no API key needed.
                The feed is live at{" "}
                <a href="/social-feed" className="text-blue-600 hover:underline">
                  /social-feed → X / Twitter tab
                </a>
                .
              </p>
            </div>
            <div className="px-6 py-4">
              <p className="text-xs font-semibold text-slate-700">LinkedIn</p>
              <p className="mt-1 text-xs text-slate-500">
                LinkedIn has no free public feed API. The LinkedIn tab shows a follow card linking to the company page.
                To point it at a different page, edit the LinkedIn row in <strong>Public Profile Links</strong> above.
              </p>
            </div>
            <div className="px-6 py-4">
              <p className="text-xs font-semibold text-slate-700">Facebook (embed)</p>
              <p className="mt-1 text-xs text-slate-500">
                Facebook tab uses the official Page Plugin embed — no API setup needed. It shows live posts from
                whichever page the <strong>Facebook</strong> row in Public Profile Links points at.
              </p>
            </div>
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
