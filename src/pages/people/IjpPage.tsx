import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, FileText } from "lucide-react";
import { IjpOpportunities } from "@/components/ijp/IjpOpportunities";
import { IjpMyApplications } from "@/components/ijp/IjpMyApplications";

export default function IjpPage() {
  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Internal Job Postings</h1>
        <p className="text-muted-foreground">
          Explore internal career opportunities and track your applications
        </p>
      </div>

      <Tabs defaultValue="opportunities" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="opportunities" className="gap-2">
            <Briefcase className="h-4 w-4" />
            Opportunities
          </TabsTrigger>
          <TabsTrigger value="applications" className="gap-2">
            <FileText className="h-4 w-4" />
            My Applications
          </TabsTrigger>
        </TabsList>

        <TabsContent value="opportunities" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Available Opportunities</CardTitle>
              <CardDescription>
                Browse open internal positions and check your eligibility
              </CardDescription>
            </CardHeader>
            <CardContent>
              <IjpOpportunities />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="applications" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">My Applications</CardTitle>
              <CardDescription>
                Track the status of your internal job applications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <IjpMyApplications />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
