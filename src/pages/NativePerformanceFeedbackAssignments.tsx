import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, Clock, Users } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

interface Assignment {
  id: string;
  employee_id: string;
  cycle_id: string;
  status: string;
  invited_at: string;
  // Joined data
  employee_name: string;
  designation: string;
  cycle_name: string;
  deadline: string;
}

export default function NativePerformanceFeedbackAssignments() {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAssignments();
  }, []);

  const fetchAssignments = async () => {
    try {
      const data = await hrmsApi.get("/api/performance-feedback/requests");
      setAssignments(data);
    } catch (error) {
      console.error("Failed to fetch assignments:", error);
    } finally {
      setLoading(false);
    }
  };

  const getDaysUntilDeadline = (deadline: string) => {
    const days = Math.ceil((new Date(deadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return days;
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">My Feedback Assignments</h1>
        <p className="text-gray-500 mt-1">Pending feedback requests for your team</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Pending</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{assignments.length}</p>
              </div>
              <ClipboardCheck className="w-10 h-10 text-indigo-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Due This Week</p>
                <p className="text-3xl font-bold text-orange-600 mt-1">
                  {assignments.filter(a => getDaysUntilDeadline(a.deadline) <= 7).length}
                </p>
              </div>
              <Clock className="w-10 h-10 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Team Members</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {new Set(assignments.map(a => a.employee_id)).size}
                </p>
              </div>
              <Users className="w-10 h-10 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {assignments.map((assignment) => {
          const daysUntilDeadline = getDaysUntilDeadline(assignment.deadline);
          const isUrgent = daysUntilDeadline <= 7;

          return (
            <Card key={assignment.id} className={`hover:shadow-lg transition-shadow ${isUrgent ? "border-orange-300" : ""}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{assignment.employee_name}</CardTitle>
                    <p className="text-sm text-gray-500">{assignment.designation}</p>
                  </div>
                  {isUrgent && (
                    <Badge className="bg-orange-200 text-orange-800">Urgent</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-500">Cycle</p>
                    <p className="text-sm font-medium">{assignment.cycle_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Deadline</p>
                    <p className={`text-sm font-medium ${isUrgent ? "text-orange-600" : ""}`}>
                      {formatISTDate(assignment.deadline)} ({daysUntilDeadline} days)
                    </p>
                  </div>
                  <Button
                    onClick={() => navigate(`/performance-feedback/form/${assignment.id}`)}
                    className="w-full"
                  >
                    Start Feedback
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {assignments.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <ClipboardCheck className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Pending Assignments</h3>
            <p className="text-gray-500">You don't have any feedback requests at the moment.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
