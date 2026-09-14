import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Hash, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useEmployeeCodePattern,
  useUpdateEmployeeCodePattern,
  formatEmployeeCodeWithPattern,
  EmployeeCodePattern,
} from "@/hooks/useEmployeeCodePattern";

export function EmployeeCodeSettings() {
  const { toast } = useToast();
  const { data: pattern, isLoading } = useEmployeeCodePattern();
  const updateMutation = useUpdateEmployeeCodePattern();
  
  const [formData, setFormData] = useState<EmployeeCodePattern>({
    prefix: "ACQ",
    min_digits: 3,
    separator: "",
  });
  
  // Update form when pattern is loaded
  useEffect(() => {
    if (pattern) {
      setFormData(pattern);
    }
  }, [pattern]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.prefix.trim()) {
      toast({
        title: "Error",
        description: "Prefix is required",
        variant: "destructive",
      });
      return;
    }
    
    if (formData.min_digits < 1 || formData.min_digits > 10) {
      toast({
        title: "Error",
        description: "Minimum digits must be between 1 and 10",
        variant: "destructive",
      });
      return;
    }
    
    try {
      await updateMutation.mutateAsync({
        prefix: formData.prefix.trim().toUpperCase(),
        min_digits: formData.min_digits,
        separator: formData.separator,
      });
      
      toast({
        title: "Settings saved",
        description: "Employee code pattern has been updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update settings",
        variant: "destructive",
      });
    }
  };
  
  // Preview examples
  const previewExamples = [1, 42, 100, 999].map((num) =>
    formatEmployeeCodeWithPattern(num, formData)
  );
  
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-5 w-5" />
          Employee ID Pattern
        </CardTitle>
        <CardDescription>
          Configure the format for auto-generated employee IDs
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="prefix">Prefix *</Label>
              <Input
                id="prefix"
                value={formData.prefix}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    prefix: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="e.g., EMP, ACQ, HR"
                className="font-mono uppercase"
              />
              <p className="text-xs text-muted-foreground">
                Text before the number (e.g., EMP, ACQ)
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="separator">Separator</Label>
              <Input
                id="separator"
                value={formData.separator}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    separator: e.target.value,
                  }))
                }
                placeholder="e.g., -, _, (empty)"
                className="font-mono"
                maxLength={5}
              />
              <p className="text-xs text-muted-foreground">
                Optional separator between prefix and number
              </p>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="min_digits">Minimum Digits *</Label>
              <Input
                id="min_digits"
                type="number"
                min={1}
                max={10}
                value={formData.min_digits}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    min_digits: parseInt(e.target.value) || 3,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Numbers will be padded with zeros (1-10)
              </p>
            </div>
          </div>
          
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <p className="mb-2 text-sm font-medium text-foreground">Preview</p>
            <div className="flex flex-wrap gap-2">
              {previewExamples.map((example, idx) => (
                <Badge key={idx} variant="secondary" className="font-mono">
                  {example}
                </Badge>
              ))}
            </div>
          </div>
          
          <div className="flex justify-end">
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
