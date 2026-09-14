import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Clock, CheckCircle, XCircle, Send } from "lucide-react";
import { useState } from "react";
import { useOnboardingRequest } from "@/hooks/useOnboardingRequest";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";

export function NonEmployeeDashboard() {
  const { user } = useAuth();
  const { request, isLoading, submitRequest } = useOnboardingRequest();
  const [message, setMessage] = useState("");

  const handleSubmit = () => {
    submitRequest.mutate({ message: message.trim() || undefined });
    setMessage("");
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Pending Review
          </Badge>
        );
      case "approved":
        return (
          <Badge variant="default" className="gap-1 bg-green-500">
            <CheckCircle className="h-3 w-3" />
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Rejected
          </Badge>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <UserPlus className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Welcome to Mas Callnet HRMS!</CardTitle>
          <CardDescription>
            {request
              ? "Your onboarding request has been submitted."
              : "You're not registered as an employee yet. Submit a request to HR to get started."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {request ? (
            <div className="space-y-4">
              <div className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Request Status</span>
                  {getStatusBadge(request.status)}
                </div>
                <p className="mt-2 text-sm">
                  Submitted on{" "}
                  {new Date(request.created_at).toLocaleDateString("en-IN", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    timeZone: "Asia/Kolkata",
                  })}
                </p>
                {request.message && (
                  <div className="mt-3 rounded bg-muted p-3">
                    <p className="text-sm font-medium">Your message:</p>
                    <p className="mt-1 text-sm text-muted-foreground">{request.message}</p>
                  </div>
                )}
              </div>
              {request.status === "pending" && (
                <p className="text-center text-sm text-muted-foreground">
                  HR will review your request and get back to you soon.
                </p>
              )}
              {request.status === "approved" && (
                <p className="text-center text-sm text-muted-foreground">
                  Your account is being set up. Please refresh the page or wait for HR to complete
                  your onboarding.
                </p>
              )}
              {request.status === "rejected" && (
                <p className="text-center text-sm text-muted-foreground">
                  Please contact HR directly for more information.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium">Request will be sent as:</p>
                <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="message" className="text-sm font-medium">
                  Message to HR (optional)
                </label>
                <Textarea
                  id="message"
                  placeholder="Introduce yourself or provide any relevant information..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                />
              </div>
              <Button
                onClick={handleSubmit}
                disabled={submitRequest.isPending}
                className="w-full gap-2"
              >
                <Send className="h-4 w-4" />
                {submitRequest.isPending ? "Submitting..." : "Request Onboarding"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
