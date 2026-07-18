import { publicRouteElements } from "./public.routes";
import { dashboardRouteElements } from "./dashboards.routes";
import { peopleRouteElements } from "./people.routes";
import { recruitmentRouteElements } from "./recruitment.routes";
import { workforceRouteElements } from "./workforce.routes";
import { payrollRouteElements } from "./payroll.routes";
import { performanceRouteElements } from "./performance.routes";
import { complianceRouteElements } from "./compliance.routes";
import { financeRouteElements } from "./finance.routes";
import { platformRouteElements } from "./platform.routes";
import { portalRouteElements } from "./portal.routes";
import { visitorRouteElements } from "./visitor.routes";

export {
  publicRouteElements,
  dashboardRouteElements,
  peopleRouteElements,
  recruitmentRouteElements,
  workforceRouteElements,
  payrollRouteElements,
  performanceRouteElements,
  complianceRouteElements,
  financeRouteElements,
  platformRouteElements,
  portalRouteElements,
  visitorRouteElements,
};

export const appRouteElements = (
  <>
    {publicRouteElements}
    {dashboardRouteElements}
    {peopleRouteElements}
    {recruitmentRouteElements}
    {workforceRouteElements}
    {payrollRouteElements}
    {performanceRouteElements}
    {complianceRouteElements}
    {financeRouteElements}
    {platformRouteElements}
    {portalRouteElements}
    {visitorRouteElements}
  </>
);
