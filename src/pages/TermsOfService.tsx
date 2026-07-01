import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Users, CreditCard, AlertTriangle, Scale, Ban } from "lucide-react";
import hrHubLogo from "@/assets/brand/mcn-logo.png";
import Footer from "@/components/layout/Footer";
import { isProductionDomain } from "@/lib/domain";

const TermsOfService = () => {
  const sections = [
    {
      icon: Users,
      title: "Account Terms",
      content: [
        "You must be 18 years or older to use this service",
        "You must provide accurate and complete registration information",
        "You are responsible for maintaining the security of your account credentials",
        "You are responsible for all activities that occur under your account",
        "You must notify us immediately of any unauthorized use of your account",
        "One person or legal entity may not maintain more than one account"
      ]
    },
    {
      icon: FileText,
      title: "Acceptable Use",
      content: [
        "You agree to use the service only for lawful purposes",
        "You must not violate any applicable laws or regulations",
        "You must not infringe upon the rights of others",
        "You must not attempt to gain unauthorized access to our systems",
        "You must not transmit any malicious code or harmful content",
        "You must not use the service to send spam or unsolicited communications"
      ]
    },
    {
      icon: CreditCard,
      title: "Payment Terms",
      content: [
        "Paid plans are billed in advance on a monthly or annual basis",
        "All fees are exclusive of applicable taxes unless stated otherwise",
        "You are responsible for providing accurate billing information",
        "Failure to pay may result in suspension or termination of your account",
        "Refunds are provided in accordance with our refund policy",
        "Prices are subject to change with reasonable notice"
      ]
    },
    {
      icon: Ban,
      title: "Prohibited Activities",
      content: [
        "Reselling or redistributing the service without authorization",
        "Using the service for any illegal or fraudulent activities",
        "Attempting to reverse engineer or decompile the software",
        "Interfering with or disrupting the service or servers",
        "Collecting or harvesting user data without consent",
        "Impersonating another person or entity"
      ]
    },
    {
      icon: AlertTriangle,
      title: "Limitation of Liability",
      content: [
        "The service is provided 'as is' without warranties of any kind",
        "We do not guarantee uninterrupted or error-free service",
        "We are not liable for any indirect, incidental, or consequential damages",
        "Our total liability shall not exceed the fees paid in the past 12 months",
        "Some jurisdictions do not allow limitation of liability, so these may not apply",
        "We are not responsible for third-party services or content"
      ]
    },
    {
      icon: Scale,
      title: "Governing Law",
      content: [
        "These terms shall be governed by applicable laws",
        "Any disputes shall be resolved through appropriate legal channels",
        "You agree to submit to the jurisdiction of competent courts",
        "If any provision is found unenforceable, others remain in effect",
        "These terms constitute the entire agreement between parties",
        "Waiver of any term shall not constitute ongoing waiver"
      ]
    }
  ];

  const isProduction = isProductionDomain();

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
            <FileText className="h-4 w-4" />
            Legal Agreement
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
            Terms of Service
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-4">
            Please read these terms carefully before using our services.
          </p>
          <p className="text-sm text-muted-foreground">
            Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </section>

      {/* Introduction */}
      <section className="pb-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="max-w-4xl mx-auto">
            <CardContent className="p-8">
              <p className="text-muted-foreground leading-relaxed">
                Welcome to Mas Callnet HRMS. By accessing or using our HR management platform and services, you agree to 
                be bound by these Terms of Service ("Terms"). If you disagree with any part of these terms, 
                you may not access the service. These Terms apply to all visitors, users, and others who 
                access or use the service.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Terms Sections */}
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

      {/* Termination */}
      <section className="py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="max-w-4xl mx-auto">
            <CardContent className="p-8">
              <h2 className="text-xl font-semibold mb-4">Termination</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                We may terminate or suspend your account immediately, without prior notice or liability, for 
                any reason whatsoever, including without limitation if you breach the Terms. Upon termination, 
                your right to use the service will immediately cease.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                If you wish to terminate your account, you may simply discontinue using the service or contact 
                us to request account deletion. All provisions of the Terms which by their nature should survive 
                termination shall survive termination.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Contact */}
      <section className="py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="max-w-4xl mx-auto">
            <CardContent className="p-8">
              <h2 className="text-xl font-semibold mb-4">Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed">
                If you have any questions about these Terms, please contact us. We will make every effort to 
                resolve any issues and answer your questions in a timely manner.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default TermsOfService;
