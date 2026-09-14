import { useState, useEffect } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, X, Shield, Globe } from "lucide-react";
import { z } from "zod";

interface DomainWhitelistValue {
  enabled: boolean;
  domains: string[];
}

const domainSchema = z.string()
  .trim()
  .min(1, "Domain cannot be empty")
  .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/, "Invalid domain format (e.g., company.com)");

const DomainWhitelistSettings = () => {
  const [newDomain, setNewDomain] = useState("");
  const [domainError, setDomainError] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['domain-whitelist-settings'],
    queryFn: async () => {
      const result = await hrmsApi.get<{success: boolean; data: {setting_key: string; setting_value: any} | null}>('/api/org/settings/domain_whitelist');
      return (result as any).data ?? null;
    },
  });

  const settingValue: DomainWhitelistValue = (settings?.setting_value as unknown as DomainWhitelistValue) || { enabled: false, domains: [] };

  const updateMutation = useMutation({
    mutationFn: async (newValue: DomainWhitelistValue) => {
      await hrmsApi.put('/api/org/settings/domain_whitelist', { setting_value: newValue });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domain-whitelist-settings'] });
      toast({
        title: "Settings Updated",
        description: "Domain whitelist settings have been saved.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to update settings. Please try again.",
        variant: "destructive",
      });
      console.error("Update error:", error);
    }
  });

  const handleToggleEnabled = (enabled: boolean) => {
    updateMutation.mutate({ ...settingValue, enabled });
  };

  const handleAddDomain = () => {
    setDomainError("");
    const result = domainSchema.safeParse(newDomain);
    
    if (!result.success) {
      setDomainError(result.error.errors[0].message);
      return;
    }

    const domainToAdd = result.data.toLowerCase();
    
    if (settingValue.domains.includes(domainToAdd)) {
      setDomainError("Domain already exists");
      return;
    }

    updateMutation.mutate({
      ...settingValue,
      domains: [...settingValue.domains, domainToAdd]
    });
    setNewDomain("");
  };

  const handleRemoveDomain = (domain: string) => {
    updateMutation.mutate({
      ...settingValue,
      domains: settingValue.domains.filter(d => d !== domain)
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>Domain Whitelisting</CardTitle>
          </div>
          <CardDescription>
            Control which email domains can register for your organization. When enabled, only users with whitelisted email domains can sign up.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="domain-whitelist-toggle">Enable Domain Whitelisting</Label>
              <p className="text-sm text-muted-foreground">
                {settingValue.enabled 
                  ? "Only whitelisted domains can register" 
                  : "Anyone can register with any email domain"}
              </p>
            </div>
            <Switch
              id="domain-whitelist-toggle"
              checked={settingValue.enabled}
              onCheckedChange={handleToggleEnabled}
              disabled={updateMutation.isPending}
            />
          </div>

          {settingValue.enabled && (
            <>
              <div className="border-t pt-4">
                <Label className="flex items-center gap-2 mb-3">
                  <Globe className="h-4 w-4" />
                  Allowed Domains
                </Label>
                
                <div className="flex gap-2 mb-4">
                  <div className="flex-1">
                    <Input
                      placeholder="company.com"
                      value={newDomain}
                      onChange={(e) => {
                        setNewDomain(e.target.value);
                        setDomainError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddDomain();
                        }
                      }}
                      disabled={updateMutation.isPending}
                    />
                    {domainError && (
                      <p className="text-sm text-destructive mt-1">{domainError}</p>
                    )}
                  </div>
                  <Button 
                    onClick={handleAddDomain} 
                    disabled={updateMutation.isPending || !newDomain.trim()}
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Add
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {settingValue.domains.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No domains added yet. Add at least one domain to enable registration.
                    </p>
                  ) : (
                    settingValue.domains.map((domain) => (
                      <Badge key={domain} variant="secondary" className="gap-1 pr-1">
                        {domain}
                        <button
                          onClick={() => handleRemoveDomain(domain)}
                          className="ml-1 rounded-full p-0.5 hover:bg-destructive/20 hover:text-destructive"
                          disabled={updateMutation.isPending}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              {settingValue.enabled && settingValue.domains.length === 0 && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                  <p className="text-sm text-destructive">
                    ⚠️ Warning: No domains added. New users won't be able to sign up until at least one domain is whitelisted.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DomainWhitelistSettings;
