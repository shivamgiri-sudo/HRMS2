import { Link } from "react-router-dom";
import { Github } from "lucide-react";
import logo from "@/assets/brand/mcn-logo.png";
const Footer = () => {
  return <footer className="bg-background border-t py-16">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <img src={logo} alt="Mas Callnet HRMS" className="h-8 w-auto" />
            </Link>
            <p className="text-sm text-muted-foreground">
              Modern HR management for growing teams. Streamline your workforce operations.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-4 text-sm">Product</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link to="/features" className="hover:text-foreground transition-colors">Features</Link></li>
              <li><Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link></li>
              <li><Link to="/how-it-works" className="hover:text-foreground transition-colors">How It Works</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4 text-sm">Company</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><a href="#" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">About Us</a></li>
              <li><a href="#" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Careers</a></li>
              <li><a href="#" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">Contact Us</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4 text-sm">Legal</h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li><Link to="/privacy-policy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms-of-service" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
              <li><Link to="/security" className="hover:text-foreground transition-colors">Security</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Mas Callnet HRMS. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            
            <a href="https://github.com/shivamgiri-sudo/mas-callnet-hrms" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
              <Github className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>;
};
export default Footer;