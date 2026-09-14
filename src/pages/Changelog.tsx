import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { APP_VERSION, ChangelogEntry, FALLBACK_VERSION_RESPONSE, isAutoUpdatingEnvironment } from "@/lib/version";
import { 
  Sparkles, 
  Bug, 
  Shield, 
  FileText, 
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  ArrowUpCircle
} from "lucide-react";
import { format } from "date-fns";

const changeTypeConfig = {
  feature: { icon: Sparkles, label: "New Feature", className: "bg-green-500/10 text-green-600 dark:text-green-400" },
  fix: { icon: Bug, label: "Bug Fix", className: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" },
  security: { icon: Shield, label: "Security", className: "bg-red-500/10 text-red-600 dark:text-red-400" },
  docs: { icon: FileText, label: "Documentation", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  breaking: { icon: AlertTriangle, label: "Breaking Change", className: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
};

const versionTypeConfig = {
  major: { label: "Major Release", className: "bg-primary text-primary-foreground" },
  minor: { label: "Minor Release", className: "bg-secondary text-secondary-foreground" },
  patch: { label: "Patch", className: "bg-muted text-muted-foreground" },
};

function ChangelogEntrySkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-6 w-48 mt-2" />
        <Skeleton className="h-4 w-full mt-1" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ChangelogEntryCard({ entry, isCurrentVersion }: { entry: ChangelogEntry; isCurrentVersion: boolean }) {
  const versionConfig = versionTypeConfig[entry.type];

  return (
    <Card className={isCurrentVersion ? "border-primary/50" : ""}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Badge className={versionConfig.className}>
              v{entry.version}
            </Badge>
            <Badge variant="outline">{versionConfig.label}</Badge>
            {isCurrentVersion && (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Current
              </Badge>
            )}
          </div>
          <span className="text-sm text-muted-foreground">
            {format(new Date(entry.date), "MMMM d, yyyy")}
          </span>
        </div>
        <CardTitle className="mt-2">{entry.title}</CardTitle>
        <CardDescription>{entry.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {entry.changes.map((change, index) => {
            const config = changeTypeConfig[change.type];
            const Icon = config.icon;
            return (
              <li key={index} className="flex items-start gap-3">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${config.className}`}>
                  <Icon className="h-3 w-3" />
                  {config.label}
                </span>
                <span className="text-sm text-foreground">{change.text}</span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function Changelog() {
  const { data: versionData, isLoading, refetch, isRefetching } = useVersionCheck();
  const effectiveVersionData = versionData ?? FALLBACK_VERSION_RESPONSE;
  
  // For auto-updating environments, always show the latest version from GitHub
  // For self-hosted: if there's no update available (they're up to date), 
  // show the latest version from GitHub since they've deployed the latest code
  // If there's an update available, show the local APP_VERSION so they know they need to update
  const displayVersion = isAutoUpdatingEnvironment() 
    ? (versionData?.currentVersion ?? APP_VERSION)
    : (effectiveVersionData.hasUpdate ? APP_VERSION : (versionData?.currentVersion ?? APP_VERSION));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Changelog</h1>
            <p className="text-muted-foreground">
              View the latest updates and improvements to Mas Callnet HRMS
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
              Check for Updates
            </Button>
            <Button size="sm" asChild>
              <a
                href="https://github.com/shivamgiri-sudo/mas-callnet-hrms"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub Releases
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </div>

        {/* Version Status Card */}
        <Card>
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-primary/10 p-3">
                {effectiveVersionData.hasUpdate ? (
                  <ArrowUpCircle className="h-6 w-6 text-primary" />
                ) : (
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                )}
              </div>
              <div>
                <p className="font-medium">
                  {effectiveVersionData.hasUpdate
                    ? "Update Available"
                    : "You're up to date!"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Current version: <strong>v{displayVersion}</strong>
                  {effectiveVersionData.hasUpdate && (
                    <> · Latest: <strong>v{effectiveVersionData.currentVersion}</strong></>
                  )}
                </p>
              </div>
            </div>
            {effectiveVersionData.hasUpdate && (
              <Button asChild>
                <a
                  href={effectiveVersionData.updateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download Update
                  <ExternalLink className="ml-1.5 h-4 w-4" />
                </a>
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Changelog Entries */}
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">Release History</h2>
          
          {isLoading ? (
            <div className="space-y-6">
              <ChangelogEntrySkeleton />
              <ChangelogEntrySkeleton />
            </div>
          ) : effectiveVersionData?.changelog && effectiveVersionData.changelog.length > 0 ? (
            <div className="space-y-6">
              {effectiveVersionData.changelog.map((entry) => (
                <ChangelogEntryCard
                  key={entry.version}
                  entry={entry}
                  isCurrentVersion={entry.version === displayVersion}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-center text-muted-foreground">
                  Unable to load changelog. Please check your connection and try again.
                </p>
                <Button variant="outline" className="mt-4" onClick={() => refetch()}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
