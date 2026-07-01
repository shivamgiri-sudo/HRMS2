import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { hrmsApi } from "@/lib/hrmsApi";
import { BadgeCelebration } from "./BadgeCelebration";

interface AwardBadgeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId?: string;
  employeeName?: string;
}

interface Badge {
  badge_id: string;
  badge_name: string;
  badge_description: string | null;
  badge_icon: string | null;
  badge_category: string;
  points_value: number;
}

interface TeamMember {
  id: string;
  full_name: string;
  employee_code: string;
}

export function AwardBadgeDialog({ isOpen, onClose, employeeId, employeeName }: AwardBadgeDialogProps) {
  const [selectedBadgeId, setSelectedBadgeId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(employeeId || "");
  const [reason, setReason] = useState("");
  const [showCelebration, setShowCelebration] = useState(false);
  const [awardedBadge, setAwardedBadge] = useState<Badge | null>(null);

  const queryClient = useQueryClient();

  // Fetch available badges
  const { data: badges = [], isLoading: loadingBadges } = useQuery({
    queryKey: ["badges-active"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: Badge[] }>("/api/engagement/badges?is_active=true");
      return res.data || [];
    },
    enabled: isOpen,
  });

  // Fetch team members (if no specific employee)
  const { data: teamMembers = [], isLoading: loadingTeam } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: TeamMember[] }>("/api/employees/my-team");
      return res.data || [];
    },
    enabled: isOpen && !employeeId,
  });

  // Award badge mutation
  const awardMutation = useMutation({
    mutationFn: async (data: { employee_id: string; badge_id: string; reason: string }) => {
      return await hrmsApi.post("/api/engagement/badges/award", data);
    },
    onSuccess: () => {
      const badge = badges.find(b => b.badge_id === selectedBadgeId);
      if (badge) {
        setAwardedBadge(badge);
        setShowCelebration(true);
      }

      toast.success("Badge awarded successfully!");
      queryClient.invalidateQueries({ queryKey: ["employee-badges"] });
      queryClient.invalidateQueries({ queryKey: ["employee-stat-card"] });

      // Reset form
      setSelectedBadgeId("");
      setSelectedEmployeeId(employeeId || "");
      setReason("");

      // Close dialog after a delay
      setTimeout(() => {
        onClose();
      }, 500);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to award badge");
    },
  });

  const handleSubmit = () => {
    if (!selectedBadgeId) {
      toast.error("Please select a badge");
      return;
    }

    if (!selectedEmployeeId) {
      toast.error("Please select an employee");
      return;
    }

    if (!reason.trim()) {
      toast.error("Please provide a reason");
      return;
    }

    awardMutation.mutate({
      employee_id: selectedEmployeeId,
      badge_id: selectedBadgeId,
      reason: reason.trim(),
    });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-purple-600" />
              Award Badge
            </DialogTitle>
            <DialogDescription>
              Recognize an employee's achievement by awarding them a badge
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Employee Selector (if not pre-selected) */}
            {!employeeId && (
              <div className="space-y-2">
                <Label htmlFor="employee">Select Employee</Label>
                {loadingTeam ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                  </div>
                ) : (
                  <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                    <SelectTrigger id="employee">
                      <SelectValue placeholder="Choose an employee..." />
                    </SelectTrigger>
                    <SelectContent>
                      {teamMembers.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.full_name} ({member.employee_code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {employeeName && (
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600">Awarding to:</p>
                <p className="font-semibold text-slate-900">{employeeName}</p>
              </div>
            )}

            {/* Badge Selector */}
            <div className="space-y-2">
              <Label htmlFor="badge">Select Badge</Label>
              {loadingBadges ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : (
                <Select value={selectedBadgeId} onValueChange={setSelectedBadgeId}>
                  <SelectTrigger id="badge">
                    <SelectValue placeholder="Choose a badge..." />
                  </SelectTrigger>
                  <SelectContent>
                    {badges.map((badge) => (
                      <SelectItem key={badge.badge_id} value={badge.badge_id}>
                        <div className="flex items-center gap-2">
                          <span>{badge.badge_icon || "🏆"}</span>
                          <span>{badge.badge_name}</span>
                          <span className="text-xs text-slate-500">({badge.points_value} pts)</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Selected Badge Preview */}
            {selectedBadgeId && badges.find(b => b.badge_id === selectedBadgeId) && (
              <div className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg border border-purple-200">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">{badges.find(b => b.badge_id === selectedBadgeId)?.badge_icon || "🏆"}</div>
                  <div className="flex-1">
                    <p className="font-bold text-sm text-slate-900">
                      {badges.find(b => b.badge_id === selectedBadgeId)?.badge_name}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      {badges.find(b => b.badge_id === selectedBadgeId)?.badge_description}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Reason */}
            <div className="space-y-2">
              <Label htmlFor="reason">Reason for Award *</Label>
              <Textarea
                id="reason"
                placeholder="Describe why this employee deserves this badge..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1"
              disabled={awardMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
              disabled={awardMutation.isPending}
            >
              {awardMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Awarding...
                </>
              ) : (
                <>
                  <Award className="h-4 w-4 mr-2" />
                  Award Badge
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Celebration Modal */}
      {awardedBadge && (
        <BadgeCelebration
          isOpen={showCelebration}
          onClose={() => setShowCelebration(false)}
          badge={awardedBadge}
        />
      )}
    </>
  );
}
