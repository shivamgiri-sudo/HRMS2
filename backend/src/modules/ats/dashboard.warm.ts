import { warmAtsOverview } from "./dashboard.overview.service.js";
import { warmInsights } from "./dashboard.insights.service.js";

/** Fills the ATS dashboard caches sequentially and keeps them hot. Called once, after boot. */
export function warmAtsDashboards() {
  warmAtsOverview();
  warmInsights();
}
