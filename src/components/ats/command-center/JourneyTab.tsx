import { useState } from "react";
import { Search, User, Award, Clock, CheckCircle, XCircle, Phone, Mail, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";
import { format } from "date-fns";

interface JourneyTabProps {
  onSearch?: (query: string) => void;
}

export function JourneyTab({ onSearch }: JourneyTabProps) {
  const [journeyQuery, setJourneyQuery] = useState("");
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyError, setJourneyError] = useState("");
  const [journey, setJourney] = useState<any>(null);

  async function runJourney() {
    if (!journeyQuery.trim()) {
      toast.error("Please enter a search term");
      return;
    }

    setJourneyLoading(true);
    setJourneyError("");
    setJourney(null);

    try {
      const res = await hrmsApi.get<{ success: boolean; data: any }>(
        `/api/ats-full-parity/journey?query=${encodeURIComponent(journeyQuery.trim())}`
      );

      if (!res.data) {
        setJourneyError("Candidate not found");
      } else {
        setJourney(res.data);
      }
    } catch (error: any) {
      setJourneyError(error?.message || "Search failed");
      toast.error("Failed to load candidate journey");
    } finally {
      setJourneyLoading(false);
    }
  }

  const candidate = journey?.candidate || {};
  const stageLogs = journey?.stageLogs || [];
  const confirmations = journey?.confirmations || [];

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <Card>
        <CardHeader>
          <CardTitle>Search Candidate Journey</CardTitle>
          <p className="text-sm text-slate-500">
            Search by Candidate ID, Name, Mobile, Email, or Token
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <input
              value={journeyQuery}
              onChange={(e) => setJourneyQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runJourney();
              }}
              placeholder="Enter Candidate ID, Name, Mobile, Email, or Token..."
              className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <button
              onClick={() => runJourney()}
              disabled={journeyLoading || !journeyQuery.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {journeyLoading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Search
                </>
              )}
            </button>
          </div>
          {journeyError && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">
              <XCircle className="h-4 w-4" />
              {journeyError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading State */}
      {journeyLoading && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Candidate Profile Card */}
      {journey && !journeyLoading && (
        <>
          <Card className="border-2 border-blue-200">
            <CardHeader className="bg-gradient-to-r from-blue-50 to-sky-50">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-white text-2xl font-bold">
                    {(candidate.FullName || candidate.full_name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <CardTitle className="text-2xl">
                      {candidate.FullName || candidate.full_name || "Unknown"}
                    </CardTitle>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">
                        ID: {candidate.CandidateID || candidate.candidate_code}
                      </Badge>
                      <Badge
                        variant={
                          candidate.Status === "Selected" || candidate.status === "Selected"
                            ? "secondary"
                            : candidate.Status === "Rejected" || candidate.status === "Rejected"
                            ? "destructive"
                            : "default"
                        }
                      >
                        {candidate.Status || candidate.status || "Pending"}
                      </Badge>
                      <Badge variant="outline">
                        {candidate.CurrentStage || candidate.current_stage || "Unknown Stage"}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">
                    {candidate._candidateQualityScore || 0}
                  </div>
                  <p className="text-sm text-slate-600">Quality Score</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex items-start gap-3">
                  <Phone className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-xs text-slate-500">Mobile</p>
                    <p className="font-semibold">{candidate.Mobile || candidate.mobile || "N/A"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Mail className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-xs text-slate-500">Email</p>
                    <p className="font-semibold text-sm break-all">
                      {candidate.Email || candidate.email || "N/A"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-xs text-slate-500">Branch</p>
                    <p className="font-semibold">
                      {candidate.Branch || candidate.applied_for_branch || "N/A"}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quality Metrics */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">Candidate Quality</p>
                    <p className="text-2xl font-bold text-slate-900">
                      {candidate._candidateQualityScore || 0}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      {candidate._candidateQualityLabel || "N/A"}
                    </p>
                  </div>
                  <Award className="h-8 w-8 text-amber-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">Handling Quality</p>
                    <p className="text-2xl font-bold text-slate-900">
                      {candidate._handlingQualityScore || 0}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      {candidate._handlingQualityLabel || "N/A"}
                    </p>
                  </div>
                  <User className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">Role Applied</p>
                    <p className="text-sm font-bold text-slate-900 mt-1">
                      {candidate.RoleApplied || candidate.role_applied || "N/A"}
                    </p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-emerald-500" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500">Source</p>
                    <p className="text-sm font-bold text-slate-900 mt-1">
                      {candidate.Source || candidate.source || "Direct"}
                    </p>
                  </div>
                  <Clock className="h-8 w-8 text-slate-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Stage Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Stage Timeline</CardTitle>
              <p className="text-sm text-slate-500">Candidate progression through stages</p>
            </CardHeader>
            <CardContent>
              {stageLogs.length > 0 ? (
                <div className="space-y-4">
                  {stageLogs.map((log: any, index: number) => (
                    <div key={index} className="relative pl-8 pb-4 border-l-2 border-blue-200 last:border-transparent">
                      <div className="absolute -left-2 top-0 h-4 w-4 rounded-full bg-blue-600 border-2 border-white" />
                      <div className="rounded-lg border border-slate-200 bg-white p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-slate-900">
                                {log.from_stage || "Start"} → {log.to_stage}
                              </p>
                              {index === 0 && (
                                <Badge variant="secondary">Latest</Badge>
                              )}
                            </div>
                            {log.remarks && (
                              <p className="text-sm text-slate-600 mt-1">{log.remarks}</p>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">
                            {log.stage_date ? format(new Date(log.stage_date), "MMM dd, yyyy") : "N/A"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-slate-500 py-8">No stage transitions recorded</p>
              )}
            </CardContent>
          </Card>

          {/* Confirmations */}
          {confirmations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Confirmations</CardTitle>
                <p className="text-sm text-slate-500">Candidate confirmation history</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {confirmations.map((conf: any, index: number) => (
                    <div
                      key={index}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">
                            Will Join: {conf.will_join || "N/A"}
                          </p>
                          <p className="text-sm text-slate-600 mt-1">
                            Process: {conf.process_name || "N/A"}
                          </p>
                          {conf.hr_query && (
                            <p className="text-sm text-slate-600 mt-1">
                              Query: {conf.hr_query}
                            </p>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          {conf.created_at ? format(new Date(conf.created_at), "MMM dd, yyyy") : "N/A"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
