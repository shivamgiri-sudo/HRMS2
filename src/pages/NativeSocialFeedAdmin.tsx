import { useState } from "react";
import { AlertTriangle, CheckCircle, Loader2, RefreshCw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useSocialFeedAdminConfig,
  useSaveSocialConfig,
  useSyncSocialFeed,
  type SocialPlatform,
} from "@/hooks/useSocialFeed";

const PLATFORMS: { key: SocialPlatform; label: string; tokenLabel: string; pageIdLabel: string; tokenHelp: string }[] = [
  {
    key: "facebook",
    label: "Facebook",
    tokenLabel: "Page Access Token",
    pageIdLabel: "Facebook Page ID",
    tokenHelp: "Generate a permanent Page Access Token in Meta for Developers → Tools → Graph API Explorer.",
  },
  {
    key: "instagram",
    label: "Instagram",
    tokenLabel: "Instagram Access Token",
    pageIdLabel: "Instagram Business User ID",
    tokenHelp: "Link your Instagram Business account to your Facebook Page. Get the IG User ID from the Graph API Explorer.",
  },
  {
    key: "youtube",
    label: "YouTube",
    tokenLabel: "Not required (public RSS)",
    pageIdLabel: "YouTube Channel ID",
    tokenHelp: "Find your Channel ID in YouTube Studio → Settings → Channel → Basic info.",
  },
];

function daysUntilExpiry(expiry: string | null): number | null {
  if (!expiry) return null;
  const diff = new Date(expiry).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function TokenExpiryBadge({ expiry }: { expiry: string | null }) {
  const days = daysUntilExpiry(expiry);
  if (days === null) return null;
  if (days < 0) return <span className="text-xs font-semibold text-rose-600">Expired</span>;
  if (days < 10) return <span className="flex items-center gap-1 text-xs font-semibold text-amber-600"><AlertTriangle className="h-3 w-3" /> Expires in {days}d</span>;
  return <span className="text-xs text-slate-400">Expires in {days}d</span>;
}

function PlatformCard({
  platform,
  existing,
  count,
  lastSynced,
}: {
  platform: typeof PLATFORMS[0];
  existing?: { page_id: string; token_expiry: string | null; enabled: boolean };
  count: number;
  lastSynced: string | null;
}) {
  const [pageId, setPageId] = useState(existing?.page_id ?? "");
  const [token, setToken] = useState("");
  const [expiry, setExpiry] = useState(existing?.token_expiry?.slice(0, 10) ?? "");

  const save = useSaveSocialConfig();

  const handleSave = () => {
    save.mutate({
      platform: platform.key,
      page_id: pageId.trim(),
      plain_token: token.trim() || undefined,
      token_expiry: expiry ? `${expiry}T00:00:00Z` : null,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>{platform.label}</span>
          <span className="text-xs font-normal text-slate-400">{count} cached posts</span>
        </CardTitle>
        <CardDescription className="text-xs">
          {lastSynced
            ? `Last synced: ${new Date(lastSynced).toLocaleString("en-IN")}`
            : "Not yet synced"}
          {existing?.token_expiry && (
            <span className="ml-2">
              · <TokenExpiryBadge expiry={existing.token_expiry} />
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">{platform.pageIdLabel}</Label>
          <Input
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            placeholder={`Enter ${platform.pageIdLabel}`}
            className="h-8 text-sm"
          />
        </div>

        {platform.key !== "youtube" && (
          <div className="space-y-1.5">
            <Label className="text-xs">{platform.tokenLabel}</Label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Leave blank to keep existing token"
              className="h-8 text-sm"
            />
            <p className="text-[11px] text-slate-400">{platform.tokenHelp}</p>
          </div>
        )}

        {platform.key !== "youtube" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Token Expiry Date</Label>
            <Input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="h-8 text-sm"
            />
            <p className="text-[11px] text-slate-400">Facebook tokens can be made permanent; Instagram tokens expire in ~60 days.</p>
          </div>
        )}

        <Button
          size="sm"
          disabled={!pageId.trim() || save.isPending}
          onClick={handleSave}
          className="w-full"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
          <span className="ml-1.5">Save</span>
        </Button>

        {save.isSuccess && (
          <p className="text-center text-xs text-green-600">Saved successfully.</p>
        )}
        {save.isError && (
          <p className="text-center text-xs text-rose-600">Save failed. Check inputs.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function NativeSocialFeedAdmin() {
  const { data, isLoading } = useSocialFeedAdminConfig();
  const sync = useSyncSocialFeed();
  const configs = data?.configs ?? [];
  const counts = data?.counts ?? {};

  const getConfig = (platform: SocialPlatform) =>
    configs.find((c) => c.platform === platform);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-slate-500" />
            <h1 className="text-xl font-bold text-slate-900">Social Feed Admin</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Configure platform credentials and trigger manual syncs.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
          className="flex items-center gap-1.5"
        >
          {sync.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          Sync Now
        </Button>
      </div>

      {sync.isSuccess && sync.data && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Sync complete — {Object.entries(sync.data).map(([p, n]) => `${p}: ${n}`).join(", ")} new posts fetched.
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {PLATFORMS.map((p) => {
            const cfg = getConfig(p.key);
            return (
              <PlatformCard
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

      {/* X/Twitter and LinkedIn guidance */}
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 space-y-2">
        <p className="font-semibold text-slate-700">X / Twitter setup (one-time)</p>
        <p className="text-xs">
          Go to <a href="https://publish.twitter.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">publish.twitter.com</a>, enter the company X profile URL, and copy the generated embed snippet.
          Paste it into <code className="rounded bg-slate-200 px-1 text-[11px]">src/pages/NativeSocialFeed.tsx</code> inside the <code className="rounded bg-slate-200 px-1 text-[11px]">TwitterEmbed</code> component.
          No backend config needed.
        </p>
        <p className="mt-2 font-semibold text-slate-700">LinkedIn</p>
        <p className="text-xs">
          LinkedIn does not offer a free post feed API. The LinkedIn tab shows a follow card linking to the company page.
          Update the URL in <code className="rounded bg-slate-200 px-1 text-[11px]">NativeSocialFeed.tsx → LinkedInCard</code>.
        </p>
      </div>
    </div>
  );
}
