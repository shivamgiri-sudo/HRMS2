import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installPincodeAutoFillRuntime } from "@/integrations/runtime/pincodeAutoFill.runtime";

createRoot(document.getElementById("root")!).render(<App />);
installPincodeAutoFillRuntime();
