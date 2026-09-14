import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Settings, Save } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

type OrgChartSettings = {
  defaultScope: "my-chain" | "my-team" | "process" | "branch" | "company";
  layoutDirection: "top-down" | "left-right";
  nodeDetailLevel: "minimal" | "standard" | "full";
  autoExpand: boolean;
  showDataQualityPanel: boolean;
};

const DEFAULT_SETTINGS: OrgChartSettings = {
  defaultScope: "my-chain",
  layoutDirection: "top-down",
  nodeDetailLevel: "standard",
  autoExpand: false,
  showDataQualityPanel: true,
};

export default function OrgChartSettings() {
  const [settings, setSettings] = useState<OrgChartSettings>(DEFAULT_SETTINGS);
  const [isDirty, setIsDirty] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("orgChartSettings");
    if (saved) {
      try {
        setSettings(JSON.parse(saved));
      } catch {
        // Invalid JSON, keep defaults
      }
    }
  }, []);

  const updateSetting = <K extends keyof OrgChartSettings>(key: K, value: OrgChartSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const saveSettings = () => {
    localStorage.setItem("orgChartSettings", JSON.stringify(settings));
    setIsDirty(false);
    toast.success("Settings saved successfully");
  };

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    setIsDirty(true);
    toast.info("Settings reset to defaults");
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#1B3A5C] text-white">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#1B3A5C]">Org Chart Settings</h1>
              <p className="text-sm text-slate-500">Customize your org chart viewing preferences</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={resetSettings} variant="outline" size="sm">
              Reset to Defaults
            </Button>
            <Button onClick={saveSettings} disabled={!isDirty} size="sm">
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </div>

        {/* Settings cards */}
        <div className="grid gap-6">
          {/* Default Scope */}
          <Card>
            <CardHeader>
              <CardTitle>Default Scope</CardTitle>
              <CardDescription>
                The default scope to load when you open the org chart page
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="defaultScope">Default Scope</Label>
                <Select
                  value={settings.defaultScope}
                  onValueChange={(value) => updateSetting("defaultScope", value as OrgChartSettings["defaultScope"])}
                >
                  <SelectTrigger id="defaultScope" className="w-full sm:w-[300px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="my-chain">My Reporting Chain</SelectItem>
                    <SelectItem value="my-team">My Team</SelectItem>
                    <SelectItem value="process">Process</SelectItem>
                    <SelectItem value="branch">Branch</SelectItem>
                    <SelectItem value="company">Company-wide</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">
                  Note: Only scopes available based on your role will be shown
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Layout Direction */}
          <Card>
            <CardHeader>
              <CardTitle>Layout Direction</CardTitle>
              <CardDescription>
                Choose how the org chart tree is oriented
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="layoutDirection">Direction</Label>
                <Select
                  value={settings.layoutDirection}
                  onValueChange={(value) => updateSetting("layoutDirection", value as OrgChartSettings["layoutDirection"])}
                >
                  <SelectTrigger id="layoutDirection" className="w-full sm:w-[300px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="top-down">Top to Bottom</SelectItem>
                    <SelectItem value="left-right">Left to Right</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Node Detail Level */}
          <Card>
            <CardHeader>
              <CardTitle>Node Detail Level</CardTitle>
              <CardDescription>
                How much information to show on each employee node
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="nodeDetailLevel">Detail Level</Label>
                <Select
                  value={settings.nodeDetailLevel}
                  onValueChange={(value) => updateSetting("nodeDetailLevel", value as OrgChartSettings["nodeDetailLevel"])}
                >
                  <SelectTrigger id="nodeDetailLevel" className="w-full sm:w-[300px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minimal">Minimal (Name + Designation)</SelectItem>
                    <SelectItem value="standard">Standard (+ Branch, Process)</SelectItem>
                    <SelectItem value="full">Full (+ Department, Direct Reports)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Behavior Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Behavior</CardTitle>
              <CardDescription>
                Control automatic behaviors when loading the org chart
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="autoExpand">Auto-expand nodes</Label>
                  <p className="text-xs text-slate-500">
                    Automatically expand all nodes when loading the chart
                  </p>
                </div>
                <Switch
                  id="autoExpand"
                  checked={settings.autoExpand}
                  onCheckedChange={(checked) => updateSetting("autoExpand", checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="showDataQualityPanel">Show data quality panel</Label>
                  <p className="text-xs text-slate-500">
                    Display data quality warnings by default
                  </p>
                </div>
                <Switch
                  id="showDataQualityPanel"
                  checked={settings.showDataQualityPanel}
                  onCheckedChange={(checked) => updateSetting("showDataQualityPanel", checked)}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
