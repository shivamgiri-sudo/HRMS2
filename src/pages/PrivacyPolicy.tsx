import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, Eye, Lock, UserCheck, Database, Mail } from "lucide-react";
import hrHubLogo from "@/assets/brand/mcn-logo.png";
import Footer from "@/components/layout/Footer";
import { isProductionDomain } from "@/lib/domain";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

type GrievanceOfficer = { name: string; email: string; designation: string; sla_days: number };

const PrivacyPolicy = () => {
  const sections = [
    {
      icon: Eye,
      title: "Information We Collect",
      content: [
        "Personal identification information (name, email address, phone number, etc.)",
        "Employment-related information when you use our HR services",
        "Usage data and analytics to improve our services",
        "Device and browser information for security purposes",
        "Cookies and similar tracking technologies"
      ]
    },
    {
      icon: Database,
      title: "How We Use Your Information",
      content: [
        "To provide and maintain our HR management services",
        "To notify you about changes to our services",
        "To provide customer support and respond to inquiries",
        "To gather analysis or valuable information to improve our services",
        "To detect, prevent and address technical issues",
        "To comply with legal obligations"
      ]
    },
    {
      icon: Lock,
      title: "Data Security",
      content: [
        "We implement industry-standard security measures to protect your data",
        "All data transmissions are encrypted using SSL/TLS protocols",
        "Regular security audits and vulnerability assessments",
        "Access controls and authentication mechanisms",
        "Secure data centers with physical security measures"
      ]
    },
    {
      icon: UserCheck,
      title: "Your Rights",
      content: [
        "Right to access your personal data",
        "Right to rectify inaccurate personal data",
        "Right to erasure ('right to be forgotten')",
        "Right to restrict processing of your data",
        "Right to data portability",
        "Right to object to processing",
        "Right to withdraw consent at any time"
      ]
    },
    {
      icon: Shield,
      title: "Data Retention",
      content: [
        "We retain personal data only for as long as necessary",
        "Data is retained to fulfill the purposes outlined in this policy",
        "Legal and regulatory requirements may require longer retention",
        "You may request deletion of your data at any time",
        "Backup copies may be retained for a limited period"
      ]
    },
    {
      icon: Mail,
      title: "Contact Us",
      content: [
        "For any privacy-related questions or concerns, please contact us",
        "We aim to respond to all inquiries within 30 days",
        "You may also lodge a complaint with your local data protection authority"
      ]
    }
  ];

  const isProduction = isProductionDomain();

  const [go, setGo] = useState<GrievanceOfficer | null>(null);
  useEffect(() => {
    hrmsApi.get<{ data: GrievanceOfficer }>("/api/privacy/grievance-officer")
      .then((r) => { if (r.data?.name) setGo(r.data); })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={hrHubLogo} alt="Mas Callnet HRMS" className="h-8 w-auto" />
            <span className="text-xl font-bold">Mas Callnet HRMS</span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <Link to="/features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Features</Link>
            <Link to="/how-it-works" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">How It Works</Link>
            <Link to="/pricing" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Sign In</Button>
            </Link>
            {isProduction && (
              <a href="https://cal.com/littlemissbot/business-consultancy" target="_blank" rel="noopener noreferrer">
                <Button size="sm">Request Demo</Button>
              </a>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 md:py-28">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Shield className="h-4 w-4" />
            Your Privacy Matters
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
            Privacy Policy
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-4">
            We are committed to protecting your privacy and ensuring the security of your personal information.
          </p>
          <p className="text-sm text-muted-foreground">
            Last updated: {formatISTDate()}
          </p>
        </div>
      </section>

      {/* Introduction */}
      <section className="pb-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="max-w-4xl mx-auto">
            <CardContent className="p-8">
              <p className="text-muted-foreground leading-relaxed">
                This Privacy Policy describes how Mas Callnet HRMS ("we", "us", or "our") collects, uses, and shares 
                information about you when you use our HR management platform and related services. By using 
                our services, you agree to the collection and use of information in accordance with this policy. 
                We encourage you to read this policy carefully to understand our practices regarding your 
                personal data and how we will treat it.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Policy Sections */}
      <section className="py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto space-y-8">
            {sections.map((section, index) => (
              <Card key={index} className="overflow-hidden">
                <CardContent className="p-8">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-primary/10 text-primary shrink-0">
                      <section.icon className="h-6 w-6" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold mb-4">{section.title}</h2>
                      <ul className="space-y-3">
                        {section.content.map((item, itemIndex) => (
                          <li key={itemIndex} className="flex items-start gap-3 text-muted-foreground">
                            <div className="h-1.5 w-1.5 rounded-full bg-primary mt-2 shrink-0" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Additional Information */}
      <section className="py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="max-w-4xl mx-auto">
            <CardContent className="p-8">
              <h2 className="text-xl font-semibold mb-4">Changes to This Privacy Policy</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We may update our Privacy Policy from time to time. We will notify you of any changes by 
                posting the new Privacy Policy on this page and updating the "Last updated" date at the top 
                of this policy.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                You are advised to review this Privacy Policy periodically for any changes. Changes to this 
                Privacy Policy are effective when they are posted on this page.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* DPDP Act 2023 — Grievance Officer (§13 public disclosure) */}
      <section className="py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="max-w-4xl mx-auto border-2 border-blue-100 bg-blue-50/40">
            <CardContent className="p-8">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-blue-100 text-blue-700 shrink-0">
                  <Shield className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold mb-2">Grievance Officer — DPDP Act 2023</h2>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                    In accordance with the Digital Personal Data Protection Act 2023 and the DPDP Rules 2025,
                    MAS Callnet has designated a Grievance Officer to address privacy-related queries, concerns,
                    and complaints from data principals.
                  </p>
                  {go?.email ? (
                    <div className="rounded-xl border-2 border-blue-200 bg-white p-5 space-y-1.5">
                      <p className="text-sm font-bold text-slate-800">{go.name}</p>
                      {go.designation && <p className="text-sm text-muted-foreground">{go.designation}</p>}
                      <a href={`mailto:${go.email}`} className="text-sm text-primary font-semibold hover:underline flex items-center gap-1.5">
                        <Mail className="h-4 w-4" /> {go.email}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        We will acknowledge your grievance within 48 hours and aim to resolve it within {go.sla_days} days.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-blue-200 bg-white p-4">
                      <p className="text-sm text-muted-foreground">
                        Grievance Officer details are maintained by HR. Please contact HR via the employee self-service portal
                        or email hr@mascallnet.in.
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-3">
                    You may also exercise your rights (access, correction, nomination, withdrawal) through the
                    "Privacy &amp; DPDP" section of the employee self-service portal after login.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default PrivacyPolicy;
