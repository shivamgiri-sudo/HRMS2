import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowUpCircle, ExternalLink, X } from "lucide-react";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { APP_VERSION } from "@/lib/version";
import { useState } from "react";
import { Link } from "react-router-dom";

export function UpdateNotification() {
  const { isAdminOrHR } = useIsAdminOrHR();
  const { data: versionData, isLoading } = useVersionCheck(isAdminOrHR);
  const [dismissed, setDismissed] = useState(false);

  // Only show to admins/HR when there's an update
  if (!isAdminOrHR || isLoading || !versionData?.hasUpdate || dismissed) {
    return null;
  }

  return (
    <Card className="border-primary/50 bg-primary/5">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary/10 p-2 shrink-0">
              <ArrowUpCircle className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-foreground">
                  New version available!
                </p>
                <Badge variant="secondary">
                  v{versionData.currentVersion}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                You're running v{APP_VERSION}. Update to get the latest features and security fixes.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-10 sm:ml-0">
            <Button variant="outline" size="sm" asChild>
              <Link to="/changelog">View Changes</Link>
            </Button>
            <Button size="sm" asChild>
              <a
                href={versionData.updateUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Update
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setDismissed(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
