/**
 * Process Operations — Visual Demo Page (Full Drill-Down + Depth Analysis Edition)
 * Every metric, tile and data-point is clickable → right-side drawer with
 * historical trend chart, depth analysis, trend status and action items.
 * Route: /process-operations-demo  (no auth required)
 */
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Briefcase,
  CheckCircle2, ChevronDown, ChevronRight, Clock, Hourglass,
  Info, Target, TrendingDown, TrendingUp, Users, Users2,
  UserCheck, UserPlus, X, Zap,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  LabelList, Legend, Line, LineChart, PolarAngleAxis, PolarGrid,
  PolarRadiusAxis, Radar, RadarChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useState, useCallback } from "react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const GAS_TOPBAR = "radial-gradient(circle at 88% 12%,rgba(79,209,255,.18),transparent 24%),linear-gradient(118deg,#071b35 0%,#124d82 48%,#0f7890 100%)";
const GAS_BRIEF  = "radial-gradient(circle at 92% 18%,rgba(40,202,193,.20),transparent 28%),linear-gradient(132deg,#0a2848 0%,#124c72 61%,#176f81 100%)";
const GAS_ACCENT = "linear-gradient(90deg,#2f6fed,#10b8d4,#18a866,#e89b19,#7c5ce5)";
const C_BLUE   = "#2f6fed";
const C_GREEN  = "#10b981";
const C_AMBER  = "#f59e0b";
const C_RED    = "#ef4444";
const C_PURPLE = "#7c5ce5";
const C_SLATE  = "#64748b";
const TT = { fontSize:11, borderRadius:8, border:"1px solid #e2e8f0", boxShadow:"0 4px 12px rgba(0,0,0,.10)" };
const AX = { fontSize:10, fill:"#94A3B8" };

// ── Types ─────────────────────────────────────────────────────────────────────
type Trend = "positive" | "negative" | "action";
interface DrillData {
  label:string; value:string; target?:string;
  trend:Trend; delta:string; deltaNote?:string; unit:string;
  history:{ date:string; v:number }[];
  analysis:string; actions?:string[]; related?:string[];
}

// ── Drill-down data map ───────────────────────────────────────────────────────
const DD: Record<string, DrillData> = {
  "Revenue":{label:"Revenue",value:"₹48.2L",trend:"positive",delta:"+₹3.1L",deltaNote:"vs Aug-26",unit:"L",
    history:[{date:"Apr-26",v:40.1},{date:"May-26",v:41.8},{date:"Jun-26",v:43.2},{date:"Jul-26",v:44.9},{date:"Aug-26",v:45.1},{date:"Sep-26",v:48.2}],
    analysis:"Revenue grew 6.9% MoM, driven by a 12% increase in scored calls (funnel improvement). Cost breakdown: GRN ₹12.8L + Salary ₹18.4L + Overhead ₹10.1L = ₹41.3L. EBIT = ₹6.9L (14.3% margin). Revenue recognised via direct data feed — status: Recognized.",
    related:["Operating %","Rev / Agent","GRN (vendor)"]},

  "Operating %":{label:"Operating %",value:"14.3%",target:"≥ 12%",trend:"positive",delta:"+1.8pp",deltaNote:"vs Aug-26",unit:"%",
    history:[{date:"Apr-26",v:10.2},{date:"May-26",v:11.4},{date:"Jun-26",v:12.1},{date:"Jul-26",v:12.8},{date:"Aug-26",v:12.7},{date:"Sep-26",v:14.3}],
    analysis:"Op% = EBIT ÷ Revenue = ₹6.9L ÷ ₹48.2L = 14.3%. Cost breakdown: GRN ₹12.8L + Salary ₹18.4L + Overhead ₹10.1L = ₹41.3L total costs. Revenue grew 6.9% MoM while total costs grew only 2.1%, driving margin expansion. Payroll finalisation pending — actual may shift ±0.6pp.",
    actions:["Confirm payroll run date to lock Sep EBIT","Review GRN invoice matching for Sep month-end"],
    related:["Revenue","Agent Salary","EBIT"]},

  "Quality Score":{label:"Quality Score",value:"76%",target:"≥ 80%",trend:"action",delta:"-4pp vs target",unit:"%",
    history:[{date:"Apr-26",v:80},{date:"May-26",v:78},{date:"Jun-26",v:79},{date:"Jul-26",v:77},{date:"Aug-26",v:75},{date:"Sep-26",v:76}],
    analysis:"Quality has been on a slow decline since Apr-26. The two weakest parameters are Empathy (71.8%) and FCR (68.2%). These co-move with the green-floor surge — agents in first 30 days score 14pp lower on empathy than tenured agents.",
    actions:["Accelerate empathy coaching for <30-day cohort","Add FCR check at disposition tagging","Push audit coverage to 100% for green floor agents"],
    related:["EMPATHY %","FCR %","OVERALL SCORE"]},

  "HC vs Mandate":{label:"HC vs Mandate",value:"-3",target:"0 or above",trend:"action",delta:"-3 seats",unit:"",
    history:[{date:"Apr-26",v:2},{date:"May-26",v:1},{date:"Jun-26",v:0},{date:"Jul-26",v:-1},{date:"Aug-26",v:-2},{date:"Sep-26",v:-3}],
    analysis:"Headcount gap has widened every month since Jun. 3 exits in Sep (2 resignations, 1 termination). 2 requisitions open but pipeline has only 7 candidates — insufficient to fill 3 positions at current offer-acceptance rate of 67%.",
    actions:["Escalate hiring to fill 3 open positions before Oct","Review exit-interview data for Sep — pattern check","Update roster to reflect 17 HC until positions filled"],
    related:["Open Positions","Active HC","ATTRITION %"]},

  "Rev / Agent":{label:"Rev / Agent",value:"₹2.4L",trend:"positive",delta:"+₹0.2L",deltaNote:"vs Aug-26",unit:"L",
    history:[{date:"Apr-26",v:1.9},{date:"May-26",v:2.0},{date:"Jun-26",v:2.1},{date:"Jul-26",v:2.2},{date:"Aug-26",v:2.2},{date:"Sep-26",v:2.4}],
    analysis:"Rev/Agent = ₹48.2L ÷ 20 (mandate HC) = ₹2.41L ≈ ₹2.4L. Using mandate denominator (not actual 17 HC) to avoid artificial inflation from the HC gap. Actual Rev/Active Agent = ₹48.2L ÷ 17 = ₹2.83L — but this is inflated by the understaffing. True productivity signal is the mandate-based figure.",
    actions:["Do not use actual-HC Rev/Agent as a positive signal while HC is below mandate — use mandate-based figure only"],
    related:["Revenue","Active HC","HC vs Mandate"]},

  "ATTRITION %":{label:"Attrition %",value:"28.6%",target:"≤ 20%",trend:"negative",delta:"+8.6pp over target",unit:"%",
    history:[{date:"Apr-26",v:18},{date:"May-26",v:20},{date:"Jun-26",v:22},{date:"Jul-26",v:24},{date:"Aug-26",v:26.1},{date:"Sep-26",v:28.6}],
    analysis:"Attrition is accelerating — 3 exits in Sep (2 voluntary, 1 involuntary). Exit interviews cite commute distance, night shift timing and stagnant incentives. At current rate the process could drop to 12 HC by Mar-27.",
    actions:["HR to action exit interview findings within 7 days","Review incentive structure — last revision Apr-25","Flag to Branch Head for retention intervention","Consider flexi-timing pilot for night-shift agents"],
    related:["Active HC","Open Positions","HC vs Mandate"]},

  "Active HC":{label:"Active Headcount",value:"17",target:"20 mandate",trend:"action",delta:"-1 MoM",unit:"",
    history:[{date:"Apr-26",v:22},{date:"May-26",v:21},{date:"Jun-26",v:20},{date:"Jul-26",v:19},{date:"Aug-26",v:18},{date:"Sep-26",v:17}],
    analysis:"Headcount has declined every month for 6 months. Attrition rate of 28% annualised is significantly above the 20% ceiling. Without new joins, HC will drop to 14–15 by Dec.",
    actions:["Freeze further attrition approvals until backfill confirmed","Fast-track the 2 open requisitions"],
    related:["HC vs Mandate","ATTRITION %","Open Positions"]},

  "Open Positions":{label:"Open Positions",value:"3",trend:"action",delta:"3 unfilled",unit:"",
    history:[{date:"Apr-26",v:0},{date:"May-26",v:0},{date:"Jun-26",v:1},{date:"Jul-26",v:1},{date:"Aug-26",v:2},{date:"Sep-26",v:3}],
    analysis:"3 positions remain unfilled across 2 active requisitions. At current pipeline velocity (7 candidates, 67% offer acceptance), expected fill time is 3–5 weeks.",
    actions:["Review all 7 pipeline candidates this week","Consider internal transfer from over-staffed process"],
    related:["Active HC","ATTRITION %"]},

  "GRN (vendor)":{label:"GRN (vendor cost)",value:"₹12.8L",trend:"positive",delta:"-₹0.4L",deltaNote:"vs Aug",unit:"L",
    history:[{date:"Apr-26",v:13.1},{date:"May-26",v:13.4},{date:"Jun-26",v:13.0},{date:"Jul-26",v:13.2},{date:"Aug-26",v:13.2},{date:"Sep-26",v:12.8}],
    analysis:"Vendor GRN cost dropped slightly due to one vendor billing cycle shift. Confirm Oct invoice to ensure no carry-forward.",related:["Revenue","EBIT"]},

  "Agent Salary":{label:"Agent Salary",value:"₹18.4L",trend:"positive",delta:"~est.",deltaNote:"payroll pending",unit:"L",
    history:[{date:"Apr-26",v:17.8},{date:"May-26",v:18.0},{date:"Jun-26",v:18.1},{date:"Jul-26",v:18.2},{date:"Aug-26",v:18.3},{date:"Sep-26",v:18.4}],
    analysis:"Estimated based on current headcount × average CTC. Actual will be confirmed after payroll run. Typically varies ±₹0.3L due to LWP deductions and variable pay.",
    actions:["Run payroll for Sep before month-end close"]},

  "EBIT":{label:"EBIT",value:"₹6.9L",trend:"positive",delta:"+₹0.8L",deltaNote:"vs Aug-26",unit:"L",
    history:[{date:"Apr-26",v:4.6},{date:"May-26",v:5.0},{date:"Jun-26",v:5.4},{date:"Jul-26",v:5.8},{date:"Aug-26",v:6.1},{date:"Sep-26",v:6.9}],
    analysis:"EBIT = Revenue (₹48.2L) − GRN (₹12.8L) − Salary (₹18.4L) − Overhead (₹10.1L) = ₹6.9L. Overhead includes infra, rent and management. Op% = 6.9 ÷ 48.2 = 14.3%. Salary is pre-payroll estimate — final EBIT updates post run.",
    actions:["Confirm payroll run to lock Sep EBIT"],related:["Operating %","Revenue","Agent Salary"]},

  "OCCUPANCY %":{label:"Occupancy %",value:"85.7%",target:"≥ 80%",trend:"positive",delta:"+2.3pp",deltaNote:"vs Aug",unit:"%",
    history:[{date:"Apr-26",v:81},{date:"May-26",v:82},{date:"Jun-26",v:84},{date:"Jul-26",v:84},{date:"Aug-26",v:83.4},{date:"Sep-26",v:85.7}],
    analysis:"Occupancy is healthy and trending up. On days where roster adherence drops (3 instances in Sep), occupancy dips to ~79%. At full 20 HC, occupancy would be ~83%.",related:["UTILISATION %","AVAIL %"]},

  "AHT SEC":{label:"Average Handle Time",value:"312s",target:"≤ 300s",trend:"action",delta:"+12s over target",unit:"s",
    history:[{date:"Apr-26",v:295},{date:"May-26",v:298},{date:"Jun-26",v:302},{date:"Jul-26",v:308},{date:"Aug-26",v:310},{date:"Sep-26",v:312}],
    analysis:"AHT has risen 17s over 6 months. Green-floor agents average 338s vs 291s for tenured agents. The increase is within-call duration (not ACW), suggesting coaching is the primary lever.",
    actions:["Identify top 5 longest-AHT agents — schedule call reviews","Benchmark top 3 agents' call structure and share recording","Target: bring AHT to ≤300s by end Oct"],
    related:["ACW SEC","OCCUPANCY %"]},

  "ACW SEC":{label:"After Call Work (ACW)",value:"48s",target:"≤ 60s",trend:"positive",delta:"-4s",deltaNote:"vs Aug",unit:"s",
    history:[{date:"Apr-26",v:55},{date:"May-26",v:54},{date:"Jun-26",v:52},{date:"Jul-26",v:51},{date:"Aug-26",v:52},{date:"Sep-26",v:48}],
    analysis:"ACW is well within target and improving. Agents are completing wrap efficiently. The AHT overrun is not driven by ACW — it sits within call duration itself."},

  "UTILISATION %":{label:"Utilisation %",value:"78.3%",target:"≥ 75%",trend:"positive",delta:"+1.1pp",unit:"%",
    history:[{date:"Apr-26",v:74},{date:"May-26",v:75},{date:"Jun-26",v:76},{date:"Jul-26",v:77},{date:"Aug-26",v:77.2},{date:"Sep-26",v:78.3}],
    analysis:"Utilisation is on target and gently improving. Reflects good queue management. Would likely hold above target even at 20 HC."},

  "AVAIL %":{label:"Availability %",value:"91.2%",target:"≥ 90%",trend:"positive",delta:"+0.4pp",unit:"%",
    history:[{date:"Apr-26",v:88},{date:"May-26",v:89},{date:"Jun-26",v:90},{date:"Jul-26",v:90},{date:"Aug-26",v:90.8},{date:"Sep-26",v:91.2}],
    analysis:"Availability is on target. One data point on 08-Sep (81%) from a system outage is excluded from MTD calc."},

  "SHRINKAGE %":{label:"Shrinkage %",value:"18.4%",target:"≤ 20%",trend:"positive",delta:"-0.9pp",unit:"%",
    history:[{date:"Apr-26",v:22},{date:"May-26",v:21},{date:"Jun-26",v:20},{date:"Jul-26",v:19},{date:"Aug-26",v:19.3},{date:"Sep-26",v:18.4}],
    analysis:"Shrinkage improved after roster adherence enforcement. Planned leave is 11%, unplanned 7.4%. Process is now within the ≤20% target range."},

  "OVERALL SCORE":{label:"Overall Quality Score",value:"74.2%",target:"≥ 80%",trend:"negative",delta:"-5.8pp vs target",unit:"%",
    history:[{date:"Apr-26",v:80},{date:"May-26",v:79},{date:"Jun-26",v:78},{date:"Jul-26",v:77},{date:"Aug-26",v:75.1},{date:"Sep-26",v:74.2}],
    analysis:"Overall quality has declined 5.8pp since Apr. Tenured agents (>90 days) average 82.4%; green-floor average 68.1%. Score will self-recover as the cohort matures (3–4 months) without coaching intervention.",
    actions:["Intensify coaching for green-floor cohort","Set weekly improvement targets per agent — 2pp per week","Review QA form weighting — empathy currently 20%"],
    related:["EMPATHY %","FCR %","ATTRITION %"]},

  "EMPATHY %":{label:"Empathy & Rapport Score",value:"71.8%",target:"≥ 75%",trend:"action",delta:"-3.2pp vs target",unit:"%",
    history:[{date:"Apr-26",v:76},{date:"May-26",v:75},{date:"Jun-26",v:74},{date:"Jul-26",v:73},{date:"Aug-26",v:72.5},{date:"Sep-26",v:71.8}],
    analysis:"Empathy is the single largest gap metric. Analysis of 47 flagged calls shows agents skip the personalised acknowledgement step under high AHT pressure. AHT pressure → rushed calls → empathy failure is a chain reaction.",
    actions:["Create 'forced pause' coaching drill for acknowledgement step","Score empathy separately in daily feedback reviews","Correlate AHT and empathy scores per agent to identify pressure-driven failures"]},

  "COMPLIANCE %":{label:"Script Compliance %",value:"81.4%",target:"≥ 80%",trend:"positive",delta:"+1.4pp vs target",unit:"%",
    history:[{date:"Apr-26",v:78},{date:"May-26",v:79},{date:"Jun-26",v:80},{date:"Jul-26",v:80},{date:"Aug-26",v:80.8},{date:"Sep-26",v:81.4}],
    analysis:"Script compliance is on target and improving. Compliance team ran a refresher in Aug — visible positive effect. Continue monthly refresher cadence."},

  "FCR %":{label:"First Call Resolution %",value:"68.2%",target:"≥ 70%",trend:"action",delta:"-1.8pp vs target",unit:"%",
    history:[{date:"Apr-26",v:73},{date:"May-26",v:72},{date:"Jun-26",v:71},{date:"Jul-26",v:70},{date:"Aug-26",v:69.1},{date:"Sep-26",v:68.2}],
    analysis:"FCR has declined steadily. 87 repeat calls this month (4.7% of volume). Root cause: 62% are unresolved queries (agent lacked system access or knowledge), 28% are customer-initiated follow-ups. Knowledge base gaps are the primary lever.",
    actions:["Audit top 10 repeat-call reasons against agent knowledge base","Update FAQs for top 5 unresolved query types","Set FCR weekly target: W1 68% → W4 71%"],
    related:["CSAT","OVERALL SCORE"]},

  "FATAL %":{label:"Fatal Error Rate",value:"3.1%",target:"≤ 5%",trend:"positive",delta:"-1.9pp vs target",unit:"%",
    history:[{date:"Apr-26",v:5.2},{date:"May-26",v:4.8},{date:"Jun-26",v:4.2},{date:"Jul-26",v:3.9},{date:"Aug-26",v:3.4},{date:"Sep-26",v:3.1}],
    analysis:"Fatal errors (incorrect information, abusive language, data breach, disconnection without resolution) are declining. 3 fatal calls this month — 2 incorrect info, 1 agent-initiated disconnection."},

  "CSAT":{label:"Customer Satisfaction Score",value:"72",target:"≥ 75",trend:"action",delta:"-3 vs target",unit:"",
    history:[{date:"Apr-26",v:76},{date:"May-26",v:75},{date:"Jun-26",v:74},{date:"Jul-26",v:73},{date:"Aug-26",v:72.5},{date:"Sep-26",v:72}],
    analysis:"CSAT declined in line with quality score drop. Customer verbatim most frequently mentions: 'agent didn't understand my problem' (empathy) and 'had to call back again' (FCR). Both map directly to quality gaps.",
    actions:["Share verbatim feedback with agents weekly","Link CSAT score to agent incentive structure"],
    related:["FCR %","EMPATHY %","NPS"]},

  "NPS":{label:"Net Promoter Score",value:"+18",target:"≥ +20",trend:"action",delta:"-2 vs target",unit:"",
    history:[{date:"Apr-26",v:24},{date:"May-26",v:23},{date:"Jun-26",v:22},{date:"Jul-26",v:21},{date:"Aug-26",v:20},{date:"Sep-26",v:18}],
    analysis:"NPS declining at 1 point per month. Detractors grew from 8% to 11% since Apr. Passives converting to detractors is the main shift — resolution reliability (FCR) is the top stated reason.",
    related:["CSAT","FCR %"]},

  "OPENING %":{label:"Opening % (Conversion)",value:"44.8%",target:"≥ 40%",trend:"positive",delta:"+4.8pp vs target",unit:"%",
    history:[{date:"Apr-26",v:38},{date:"May-26",v:40},{date:"Jun-26",v:41},{date:"Jul-26",v:43},{date:"Aug-26",v:43.5},{date:"Sep-26",v:44.8}],
    analysis:"Opening stage is strong — agents consistently pitching. Top 3 performers average 52%. Bottom quartile is 26pp below top — coaching can close that gap."},

  "OFFER %":{label:"Offer % (Conversion)",value:"30.1%",target:"≥ 28%",trend:"positive",delta:"+2.1pp vs target",unit:"%",
    history:[{date:"Apr-26",v:26},{date:"May-26",v:27},{date:"Jun-26",v:28},{date:"Jul-26",v:29},{date:"Aug-26",v:29.4},{date:"Sep-26",v:30.1}],
    analysis:"Offer rate improving steadily. Revised objection-handling script introduced Jul-26 is showing measurable impact. Continue reinforcement."},

  "SALE %":{label:"Sale % (Conversion)",value:"19.4%",target:"≥ 18%",trend:"positive",delta:"+1.4pp vs target",unit:"%",
    history:[{date:"Apr-26",v:16},{date:"May-26",v:17},{date:"Jun-26",v:18},{date:"Jul-26",v:19},{date:"Aug-26",v:18.8},{date:"Sep-26",v:19.4}],
    analysis:"Sale conversion crossed target in Jul-26 and has held. Revenue growth is directly attributable to this plus volume growth."},

  "SCORED %":{label:"Scored Calls % (Coverage)",value:"88.7%",target:"≥ 85%",trend:"positive",delta:"+3.7pp vs target",unit:"%",
    history:[{date:"Apr-26",v:84},{date:"May-26",v:85},{date:"Jun-26",v:86},{date:"Jul-26",v:87},{date:"Aug-26",v:87.9},{date:"Sep-26",v:88.7}],
    analysis:"Scored call coverage above target. Push toward 90% in Oct by ensuring all green-floor agents have 100% scoring coverage."},

  "AUDIT COVERAGE %":{label:"Audit Coverage %",value:"94.1%",target:"≥ 90%",trend:"positive",delta:"+4.1pp vs target",unit:"%",
    history:[{date:"Apr-26",v:89},{date:"May-26",v:90},{date:"Jun-26",v:91},{date:"Jul-26",v:92},{date:"Aug-26",v:93},{date:"Sep-26",v:94.1}],
    analysis:"QA team auditing 94.1% of eligible calls. 5.9% gap is from weekend overflow calls not assigned to auditors. Allocate 1 weekend QA shift to close this."},

  "DATA ACCURACY %":{label:"Data Accuracy %",value:"99.3%",target:"≥ 98%",trend:"positive",delta:"+1.3pp vs target",unit:"%",
    history:[{date:"Apr-26",v:98},{date:"May-26",v:98.5},{date:"Jun-26",v:98.8},{date:"Jul-26",v:99},{date:"Aug-26",v:99.1},{date:"Sep-26",v:99.3}],
    analysis:"Data accuracy is excellent. The 0.7% errors are predominantly duplicate entries from the IVR-to-agent transfer flow."},

  "GATE PASS %":{label:"Gate Pass %",value:"96.0%",target:"≥ 95%",trend:"positive",delta:"+1pp vs target",unit:"%",
    history:[{date:"Apr-26",v:94},{date:"May-26",v:94.5},{date:"Jun-26",v:95},{date:"Jul-26",v:95},{date:"Aug-26",v:95.6},{date:"Sep-26",v:96.0}],
    analysis:"Gate pass adherence on target. 2 agents had repeated exceptions in Sep — both are on coaching PIPs for punctuality."},

  "PUNCTUALITY %":{label:"Punctuality %",value:"84.2%",target:"≥ 90%",trend:"negative",delta:"-5.8pp vs target",unit:"%",
    history:[{date:"Apr-26",v:88},{date:"May-26",v:87},{date:"Jun-26",v:86},{date:"Jul-26",v:85},{date:"Aug-26",v:84.8},{date:"Sep-26",v:84.2}],
    analysis:"Punctuality is declining and sits 5.8pp below target. Night-shift agents (7 of 17) have the worst adherence at 79.4%. Commute issues are the stated reason per team leader reports.",
    actions:["HR to conduct commute-impact survey this week","WFM to assess ±15min buffer on night-shift login window","Flag to Branch Head — punctuality linked to attrition risk"],
    related:["ATTRITION %","GATE PASS %"]},
};

// ── Demo chart series ─────────────────────────────────────────────────────────
const WF = [
  {date:"01-Sep",agC:18,ramp:32,plan:20,pres:17},{date:"02-Sep",agC:19,ramp:31,plan:20,pres:18},
  {date:"03-Sep",agC:22,ramp:33,plan:20,pres:16},{date:"04-Sep",agC:21,ramp:33,plan:20,pres:17},
  {date:"05-Sep",agC:24,ramp:35,plan:20,pres:15},{date:"08-Sep",agC:26,ramp:36,plan:20,pres:15},
  {date:"09-Sep",agC:23,ramp:34,plan:20,pres:16},{date:"10-Sep",agC:20,ramp:34,plan:20,pres:17},
  {date:"11-Sep",agC:19,ramp:32,plan:20,pres:18},{date:"12-Sep",agC:17,ramp:30,plan:20,pres:19},
  {date:"15-Sep",agC:15,ramp:28,plan:20,pres:19},{date:"16-Sep",agC:16,ramp:27,plan:20,pres:20},
];
const EXITS = [{w:"01-Sep",e:2},{w:"08-Sep",e:1},{w:"15-Sep",e:3},{w:"22-Sep",e:0}];
const FUNNEL = [
  {d:"01-Sep",O:42,F:28,S:18,Sc:88},{d:"04-Sep",O:45,F:30,S:20,Sc:90},
  {d:"08-Sep",O:38,F:24,S:15,Sc:85},{d:"11-Sep",O:44,F:29,S:19,Sc:89},
  {d:"15-Sep",O:47,F:32,S:22,Sc:92},{d:"19-Sep",O:43,F:27,S:17,Sc:87},
];
const RADAR = [
  {ax:"Opening",v:44,full:"Opening Call Quality"},{ax:"Empathy",v:72,full:"Empathy & Rapport"},
  {ax:"FCR",v:68,full:"First Call Resolution"},{ax:"Compliance",v:81,full:"Script Compliance"},
  {ax:"Closure",v:76,full:"Call Closure"},
];
const RISK_DATA = [
  {n:"Customer on hold >5m",v:8.7},{n:"Incorrect info given",v:6.1},
  {n:"Abusive language",v:4.2},{n:"Disconnection",v:2.9},
];
const AUDIT = [
  {d:"01-Sep",s:72},{d:"04-Sep",s:68},{d:"08-Sep",s:75},
  {d:"11-Sep",s:71},{d:"15-Sep",s:78},{d:"19-Sep",s:74},
];
const SCENARIO = [
  {d:"01-Sep",C:8,Q:14,R:6,S:4},{d:"04-Sep",C:6,Q:16,R:8,S:5},
  {d:"08-Sep",C:11,Q:12,R:5,S:3},{d:"11-Sep",C:7,Q:18,R:7,S:6},
  {d:"15-Sep",C:5,Q:15,R:9,S:7},
];
const REPEAT = [
  {d:"01-Sep",U:145,R:12},{d:"04-Sep",U:158,R:9},
  {d:"08-Sep",U:139,R:16},{d:"11-Sep",U:162,R:11},{d:"15-Sep",U:155,R:8},
];
const KPI_SECTIONS = [
  {key:"ops",   label:"Operations", pass:5,fail:2,metrics:["OCCUPANCY %","AHT SEC","ACW SEC","UTILISATION %","AVAIL %","SHRINKAGE %","ATTRITION %"]},
  {key:"qual",  label:"Quality",    pass:4,fail:3,metrics:["OVERALL SCORE","EMPATHY %","COMPLIANCE %","FCR %","FATAL %","CSAT","NPS"]},
  {key:"conv",  label:"Conversion", pass:4,fail:0,metrics:["OPENING %","OFFER %","SALE %","SCORED %"]},
  {key:"hyg",   label:"Hygiene",    pass:2,fail:0,metrics:["AUDIT COVERAGE %","DATA ACCURACY %"]},
  {key:"cond",  label:"Conduct",    pass:1,fail:1,metrics:["GATE PASS %","PUNCTUALITY %"]},
];
const TV: Record<string,{val:string;target?:string;status:"pass"|"fail"|"none";delta:string;trend:Trend}> = {
  "OCCUPANCY %":     {val:"85.7%",target:"≥ 80%", status:"pass",delta:"+2.3pp",trend:"positive"},
  "AHT SEC":         {val:"312s", target:"≤ 300s",status:"fail",delta:"+12s",  trend:"action"},
  "ACW SEC":         {val:"48s",  target:"≤ 60s", status:"pass",delta:"-4s",   trend:"positive"},
  "UTILISATION %":   {val:"78.3%",target:"≥ 75%", status:"pass",delta:"+1.1pp",trend:"positive"},
  "AVAIL %":         {val:"91.2%",target:"≥ 90%", status:"pass",delta:"+0.4pp",trend:"positive"},
  "SHRINKAGE %":     {val:"18.4%",target:"≤ 20%", status:"pass",delta:"-0.9pp",trend:"positive"},
  "ATTRITION %":     {val:"28.6%",target:"≤ 20%", status:"fail",delta:"+8.6pp",trend:"negative"},
  "OVERALL SCORE":   {val:"74.2%",target:"≥ 80%", status:"fail",delta:"-5.8pp",trend:"negative"},
  "EMPATHY %":       {val:"71.8%",target:"≥ 75%", status:"fail",delta:"-3.2pp",trend:"action"},
  "COMPLIANCE %":    {val:"81.4%",target:"≥ 80%", status:"pass",delta:"+1.4pp",trend:"positive"},
  "FCR %":           {val:"68.2%",target:"≥ 70%", status:"fail",delta:"-1.8pp",trend:"action"},
  "FATAL %":         {val:"3.1%", target:"≤ 5%",  status:"pass",delta:"-1.9pp",trend:"positive"},
  "CSAT":            {val:"72",   target:"≥ 75",   status:"fail",delta:"-3",    trend:"action"},
  "NPS":             {val:"+18",  target:"≥ +20",  status:"fail",delta:"-2",    trend:"action"},
  "OPENING %":       {val:"44.8%",target:"≥ 40%", status:"pass",delta:"+4.8pp",trend:"positive"},
  "OFFER %":         {val:"30.1%",target:"≥ 28%", status:"pass",delta:"+2.1pp",trend:"positive"},
  "SALE %":          {val:"19.4%",target:"≥ 18%", status:"pass",delta:"+1.4pp",trend:"positive"},
  "SCORED %":        {val:"88.7%",target:"≥ 85%", status:"pass",delta:"+3.7pp",trend:"positive"},
  "AUDIT COVERAGE %":{val:"94.1%",target:"≥ 90%", status:"pass",delta:"+4.1pp",trend:"positive"},
  "DATA ACCURACY %": {val:"99.3%",target:"≥ 98%", status:"pass",delta:"+1.3pp",trend:"positive"},
  "GATE PASS %":     {val:"96.0%",target:"≥ 95%", status:"pass",delta:"+1pp",  trend:"positive"},
  "PUNCTUALITY %":   {val:"84.2%",target:"≥ 90%", status:"fail",delta:"-5.8pp",trend:"negative"},
};

// ── Colour helpers ────────────────────────────────────────────────────────────
const tc  = (t:Trend) => t==="positive"?C_GREEN:t==="negative"?C_RED:C_AMBER;
const tbg = (t:Trend) => t==="positive"?"#ecfdf5":t==="negative"?"#fef2f2":"#fffbeb";
const bc  = (v:number) => v>=80?C_GREEN:v>=65?C_AMBER:C_RED;

// ── Drill-Down Drawer ─────────────────────────────────────────────────────────
function DrillDrawer({ ddKey, onClose }:{ ddKey:string|null; onClose:()=>void }) {
  const d = ddKey ? DD[ddKey] : null;
  if (!d) return null;
  const col = tc(d.trend);
  const bg  = tbg(d.trend);
  const StatusIcon = d.trend==="positive" ? TrendingUp : d.trend==="negative" ? TrendingDown : Zap;
  const statusLabel = d.trend==="positive"?"Positive Trend":d.trend==="negative"?"Declining Trend":"Action Required";
  const maxV = Math.max(...d.history.map(h=>h.v), 1);
  const targetNum = d.target ? parseFloat(d.target.replace(/[^0-9.]/g,"")) : NaN;

  return (
    <>
      <div onClick={onClose} style={{ position:"fixed",inset:0,zIndex:200,background:"rgba(10,34,55,.40)",backdropFilter:"blur(3px)" }} />
      <div style={{ position:"fixed",top:0,right:0,bottom:0,zIndex:201,width:"min(540px,100vw)",background:"#fff",boxShadow:"-12px 0 48px rgba(10,34,55,.20)",display:"flex",flexDirection:"column",overflowY:"auto" }}>

        {/* Header */}
        <div style={{ padding:"18px 20px",background:GAS_BRIEF,color:"#fff",flexShrink:0 }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12 }}>
            <div>
              <div style={{ fontSize:9,color:"#8dd9eb",textTransform:"uppercase",letterSpacing:1.4,fontWeight:900,marginBottom:4 }}>Metric Deep-Dive · Sep-26</div>
              <h2 style={{ margin:0,fontSize:21,fontWeight:950,color:"#fff",lineHeight:1.2 }}>{d.label}</h2>
            </div>
            <button onClick={onClose} style={{ background:"rgba(255,255,255,.15)",border:"none",color:"#fff",borderRadius:9,padding:"7px 9px",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",gap:5 }}>
              <X size={15}/><span style={{ fontSize:10,fontWeight:700 }}>Close</span>
            </button>
          </div>
          {/* Value + trend + target */}
          <div style={{ display:"flex",alignItems:"flex-end",gap:16 }}>
            <div>
              <div style={{ fontSize:42,fontWeight:950,lineHeight:1,letterSpacing:"-1px" }}>{d.value}</div>
              {d.deltaNote && <div style={{ fontSize:10,color:"rgba(255,255,255,.55)",marginTop:2 }}>{d.deltaNote}</div>}
            </div>
            <div style={{ paddingBottom:4 }}>
              <div style={{ display:"inline-flex",alignItems:"center",gap:5,padding:"5px 9px",borderRadius:999,background:bg,border:`1px solid ${col}33`,marginBottom:6 }}>
                <StatusIcon size={11} style={{ color:col }} />
                <span style={{ fontSize:10,fontWeight:900,color:col }}>{statusLabel}</span>
              </div>
              <div style={{ fontSize:15,fontWeight:800,color:d.trend==="positive"?"#45d49a":d.trend==="negative"?"#ff7c7e":"#ffd283" }}>{d.delta}</div>
            </div>
            {d.target && (
              <div style={{ marginLeft:"auto",textAlign:"right",paddingBottom:4 }}>
                <div style={{ fontSize:8,color:"rgba(255,255,255,.5)",textTransform:"uppercase",letterSpacing:.5 }}>Target</div>
                <div style={{ fontSize:17,fontWeight:900,color:"rgba(255,255,255,.9)" }}>{d.target}</div>
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex:1,padding:"18px 20px",display:"flex",flexDirection:"column",gap:18 }}>

          {/* ── Trend chart ── */}
          <section>
            <DrawerHead icon={TrendingUp} label="Historical Trend — 6 months" />
            <div style={{ height:155 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.history} margin={{ top:10,right:6,bottom:0,left:-10 }}>
                  <defs>
                    <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={col} stopOpacity={0.22}/>
                      <stop offset="95%" stopColor={col} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="date" tick={{...AX,fontSize:9}} tickLine={false} axisLine={false} />
                  <YAxis tick={{...AX,fontSize:9}} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TT} formatter={(v:number) => [`${v}${d.unit}`,d.label]} />
                  {!isNaN(targetNum) && <ReferenceLine y={targetNum} stroke={C_BLUE} strokeDasharray="4 2" strokeWidth={1.5} label={{ value:`Target ${d.target}`,position:"insideTopRight",fontSize:8,fill:C_BLUE }} />}
                  <Area type="monotone" dataKey="v" stroke={col} fill="url(#dg)" strokeWidth={2.5} dot={{ r:3,fill:col }} isAnimationActive={false}>
                    <LabelList dataKey="v" position="top" style={{ fontSize:8.5,fill:col,fontWeight:800 }} formatter={(v:number) => `${v}${d.unit}`} />
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Mini bar grid */}
            <div style={{ display:"flex",gap:5,marginTop:8 }}>
              {d.history.map((h,i) => (
                <div key={i} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2 }}>
                  <div style={{ width:"100%",height:28,borderRadius:3,background:"#f1f5f9",overflow:"hidden",display:"flex",alignItems:"flex-end" }}>
                    <div style={{ width:"100%",height:`${(h.v/maxV)*100}%`,background:bc(h.v),borderRadius:"2px 2px 0 0",minHeight:3 }} />
                  </div>
                  <span style={{ fontSize:7,color:"#94a3b8" }}>{h.date}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── Trend interpretation banner ── */}
          <div style={{ padding:"12px 14px",borderRadius:11,background:bg,border:`1px solid ${col}22`,display:"flex",alignItems:"flex-start",gap:10 }}>
            <StatusIcon size={15} style={{ color:col,flexShrink:0,marginTop:1 }} />
            <div>
              <div style={{ fontSize:11.5,fontWeight:900,color:col,marginBottom:4 }}>{statusLabel}</div>
              <div style={{ fontSize:11,color:"#374151",lineHeight:1.6 }}>{d.analysis}</div>
            </div>
          </div>

          {/* ── Actions ── */}
          {d.actions && d.actions.length > 0 && (
            <section>
              <DrawerHead icon={Zap} label="Actions Required" color={C_RED} />
              <div style={{ display:"flex",flexDirection:"column",gap:7 }}>
                {d.actions.map((a,i) => (
                  <div key={i} style={{ display:"flex",gap:9,padding:"9px 11px",borderRadius:9,background:"#fffbeb",border:"1px solid #fde68a",alignItems:"flex-start" }}>
                    <div style={{ width:20,height:20,borderRadius:5,background:C_AMBER,color:"#fff",flexShrink:0,display:"grid",placeItems:"center",fontSize:9,fontWeight:900 }}>{i+1}</div>
                    <span style={{ fontSize:11,color:"#374151",lineHeight:1.55 }}>{a}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Related metrics ── */}
          {d.related && d.related.length > 0 && (
            <section>
              <DrawerHead icon={ChevronRight} label="Related Metrics — click to explore" />
              <div style={{ display:"flex",flexWrap:"wrap",gap:7 }}>
                {d.related.map(r => (
                  <div key={r} style={{ padding:"5px 11px",borderRadius:999,background:"#f1f5f9",border:"1px solid #e2e8f0",fontSize:10,fontWeight:700,color:"#374151",cursor:"pointer",transition:"background .15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background="#dbeafe"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background="#f1f5f9"; }}>
                    {r}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function DrawerHead({ icon:Icon, label, color=C_BLUE }:{ icon:typeof TrendingUp; label:string; color?:string }) {
  return (
    <div style={{ display:"flex",alignItems:"center",gap:7,marginBottom:9 }}>
      <div style={{ width:22,height:22,borderRadius:6,background:`${color}18`,display:"grid",placeItems:"center" }}>
        <Icon size={12} style={{ color }} />
      </div>
      <span style={{ fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".6px",color:"#374151" }}>{label}</span>
    </div>
  );
}

// ── Trend chip ────────────────────────────────────────────────────────────────
function TrendChip({ trend, delta }:{ trend:Trend; delta:string }) {
  const col = tc(trend);
  const Icon = trend==="positive"?ArrowUpRight:trend==="negative"?ArrowDownRight:AlertTriangle;
  return (
    <div style={{ display:"inline-flex",alignItems:"center",gap:3,padding:"2px 6px",borderRadius:999,background:tbg(trend),border:`1px solid ${col}33` }}>
      <Icon size={8} style={{ color:col }} />
      <span style={{ fontSize:8.5,fontWeight:800,color:col }}>{delta}</span>
    </div>
  );
}

// ── Clickable KPI strip tile ──────────────────────────────────────────────────
function KpiTile({ ddKey,label,value,sub,color,trend,delta,onOpen }:
  { ddKey:string;label:string;value:string;sub?:string;color:string;trend:Trend;delta:string;onOpen:(k:string)=>void }) {
  return (
    <div onClick={() => onOpen(ddKey)} role="button" tabIndex={0}
      style={{ position:"relative",minHeight:94,padding:"12px 15px",borderRadius:16,color:"#fff",overflow:"hidden",boxShadow:"0 10px 24px rgba(16,35,57,.12)",background:color,cursor:"pointer",transition:"transform .15s,box-shadow .15s" }}
      onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(-3px)";(e.currentTarget as HTMLElement).style.boxShadow="0 16px 34px rgba(16,35,57,.20)";}}
      onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="none";(e.currentTarget as HTMLElement).style.boxShadow="0 10px 24px rgba(16,35,57,.12)";}}>
      <div aria-hidden style={{ position:"absolute",width:72,height:72,borderRadius:"50%",right:-18,top:-24,background:"rgba(255,255,255,.13)" }} />
      <div style={{ fontSize:8.5,textTransform:"uppercase",letterSpacing:".45px",fontWeight:900,opacity:.88 }}>{label}</div>
      <div style={{ fontSize:27,fontWeight:950,marginTop:3,lineHeight:1.1,letterSpacing:"-0.5px" }}>{value}</div>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:5 }}>
        {sub && <div style={{ fontSize:9,opacity:.82,fontWeight:700 }}>{sub}</div>}
        <TrendChip trend={trend} delta={delta} />
      </div>
      <div style={{ position:"absolute",bottom:7,right:9,opacity:.50 }}><Info size={11}/></div>
    </div>
  );
}

// ── Clickable health tile ─────────────────────────────────────────────────────
function HealthTile({ ddKey,label,value,caption,tone,icon:Icon,fillPct,fillGood,trend,delta,onOpen }:
  { ddKey:string;label:string;value:string;caption?:string;tone?:"good"|"bad"|"neutral";icon?:typeof Users;fillPct?:number;fillGood?:boolean;trend:Trend;delta:string;onOpen:(k:string)=>void }) {
  const noData = value==="—"||value==="no data";
  const color  = tone==="good"?C_GREEN:tone==="bad"?C_RED:C_SLATE;
  return (
    <div onClick={() => !noData && onOpen(ddKey)}
      style={{ position:"relative",overflow:"hidden",borderRadius:11,border:"1px solid #e2e8f0",background:"#fff",padding:"9px 10px",minWidth:118,cursor:noData?"default":"pointer",transition:"box-shadow .15s,border-color .15s" }}
      onMouseEnter={e=>{if(!noData){(e.currentTarget as HTMLElement).style.boxShadow="0 6px 18px rgba(16,35,57,.10)";(e.currentTarget as HTMLElement).style.borderColor=`${color}44`;}}}
      onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.boxShadow="none";(e.currentTarget as HTMLElement).style.borderColor="#e2e8f0";}}>
      {!noData && <div style={{ position:"absolute",inset:"0 auto 0 0",width:3,background:color,borderRadius:"3px 0 0 3px" }} />}
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:5,paddingLeft:noData?0:6 }}>
        <p style={{ fontSize:9,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:".4px",margin:0 }}>{label}</p>
        {Icon && <span style={{ flexShrink:0,borderRadius:6,padding:3,background:noData?"transparent":`${color}18` }}><Icon size={11} style={{ color:noData?"#94a3b8":color }} /></span>}
      </div>
      <p style={{ fontSize:14,fontWeight:800,margin:"3px 0 0",paddingLeft:noData?0:6,color:noData?"#94a3b8":color }}>{value}</p>
      {caption && <p style={{ fontSize:9,color:"#94a3b8",margin:"2px 0 0",paddingLeft:6 }}>{caption}</p>}
      {fillPct !== undefined && (
        <div style={{ marginTop:5,height:3,borderRadius:99,background:"#f1f5f9",overflow:"hidden",paddingLeft:6 }}>
          <div style={{ height:"100%",borderRadius:99,width:`${Math.min(100,Math.max(4,fillPct))}%`,background:fillGood?C_GREEN:C_RED }} />
        </div>
      )}
      {!noData && <div style={{ marginTop:6,paddingLeft:6 }}><TrendChip trend={trend} delta={delta} /></div>}
    </div>
  );
}

// ── Clickable KPI metric tile ─────────────────────────────────────────────────
function MetricTile({ label,onOpen }:{ label:string; onOpen:(k:string)=>void }) {
  const d = TV[label];
  if (!d) return null;
  const sc = d.status==="pass"?C_GREEN:d.status==="fail"?C_RED:C_SLATE;
  return (
    <div onClick={() => onOpen(label)}
      style={{ position:"relative",background:"#fff",border:`1px solid ${d.status==="fail"?"#fecaca":d.status==="pass"?"#a7f3d0":"#e2e8f0"}`,borderRadius:12,padding:"10px 11px",overflow:"hidden",cursor:"pointer",transition:"transform .12s,box-shadow .12s",boxShadow:"0 2px 8px rgba(16,35,57,.05)" }}
      onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(-2px)";(e.currentTarget as HTMLElement).style.boxShadow="0 8px 20px rgba(16,35,57,.12)";}}
      onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="none";(e.currentTarget as HTMLElement).style.boxShadow="0 2px 8px rgba(16,35,57,.05)";}}>
      <div style={{ position:"absolute",inset:"0 auto 0 0",width:3,background:sc,borderRadius:"3px 0 0 3px" }} />
      <div style={{ paddingLeft:7 }}>
        <div style={{ fontSize:8.5,textTransform:"uppercase",letterSpacing:".4px",color:"#6d7b8c",fontWeight:900,marginBottom:3 }}>{label}</div>
        <div style={{ fontSize:24,fontWeight:950,lineHeight:1,color:sc }}>{d.val}</div>
        <div style={{ marginTop:6,display:"flex",alignItems:"center",justifyContent:"space-between",gap:4 }}>
          {d.target && (
            <div style={{ display:"flex",alignItems:"center",gap:3 }}>
              {d.status==="pass" ? <CheckCircle2 size={9} style={{ color:C_GREEN }} /> : <AlertTriangle size={9} style={{ color:C_RED }} />}
              <span style={{ fontSize:8.5,color:d.status==="pass"?C_GREEN:C_RED,fontWeight:700 }}>{d.target}</span>
            </div>
          )}
          <TrendChip trend={d.trend} delta={d.delta} />
        </div>
      </div>
      <div style={{ position:"absolute",top:5,right:6,opacity:.3 }}><Info size={9}/></div>
    </div>
  );
}

// ── Layout atoms ──────────────────────────────────────────────────────────────
function Card({ title,subtitle,children }:{ title:string; subtitle?:string; children:React.ReactNode }) {
  return (
    <div style={{ background:"#fff",border:"1px solid #dce4ed",borderRadius:17,boxShadow:"0 12px 30px rgba(16,35,57,.07)",padding:"14px 16px",position:"relative",overflow:"hidden" }}>
      <div style={{ position:"absolute",left:0,top:0,width:4,height:52,background:"linear-gradient(180deg,#2f6fed,#10b8d4)",borderRadius:"0 0 7px 0" }} />
      <div style={{ paddingLeft:8,marginBottom:10 }}>
        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:2 }}>
          <div style={{ width:8,height:8,borderRadius:"50%",background:`linear-gradient(135deg,${C_BLUE},#10b8d4)`,boxShadow:`0 0 0 3px ${C_BLUE}18` }} />
          <h3 style={{ margin:0,color:"#102f4b",fontSize:14,fontWeight:800 }}>{title}</h3>
        </div>
        {subtitle && <p style={{ margin:"2px 0 0 16px",fontSize:11,color:"#64748b" }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function ZoneDivider({ label }:{ label:string }) {
  return (
    <div style={{ display:"flex",alignItems:"center",gap:12,padding:"4px 0" }}>
      <div style={{ flex:1,height:1,background:"#dce4ed" }} />
      <span style={{ fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:"1.2px",color:"#94a3b8",whiteSpace:"nowrap" }}>{label}</span>
      <div style={{ flex:1,height:1,background:"#dce4ed" }} />
    </div>
  );
}

function Collapsible({ title,defaultOpen=false,children }:{ title:string; defaultOpen?:boolean; children:React.ReactNode }) {
  const [open,setOpen] = useState(defaultOpen);
  return (
    <div style={{ background:"#fff",border:"1px solid #dce4ed",borderRadius:14,overflow:"hidden",boxShadow:"0 4px 12px rgba(16,35,57,.05)" }}>
      <button onClick={() => setOpen(o=>!o)} style={{ width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 16px",background:"none",border:"none",cursor:"pointer",textAlign:"left" }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ width:7,height:7,borderRadius:"50%",background:C_BLUE }} />
          <span style={{ fontSize:13,fontWeight:800,color:"#102f4b" }}>{title}</span>
        </div>
        <ChevronDown size={14} style={{ color:"#64748b",transform:open?"rotate(180deg)":"none",transition:".2s" }} />
      </button>
      {open && <div style={{ borderTop:"1px solid #f1f5f9",padding:"14px 16px" }}>{children}</div>}
    </div>
  );
}

function Signal({ name,value,note }:{ name:string; value:string; note?:string }) {
  return (
    <div style={{ padding:"7px 8px",border:"1px solid rgba(255,255,255,.12)",borderRadius:9,background:"rgba(255,255,255,.075)" }}>
      <div style={{ fontSize:9,color:"#91dce8",textTransform:"uppercase",letterSpacing:.7,fontWeight:900 }}>{name}</div>
      <div style={{ fontSize:18,fontWeight:900,color:"#fff",lineHeight:1.15,marginTop:2 }}>{value}</div>
      {note && <div style={{ fontSize:8.5,color:"rgba(255,255,255,.55)",marginTop:2 }}>{note}</div>}
    </div>
  );
}

function ScoreRing({ pct }:{ pct:number }) {
  const c = pct>=80?C_GREEN:pct>=55?C_AMBER:C_RED;
  return (
    <div style={{ width:68,height:68,borderRadius:"50%",flexShrink:0,background:`conic-gradient(${c} 0% ${pct}%, rgba(255,255,255,.12) ${pct}% 100%)`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 0 0 3px rgba(255,255,255,.08),0 0 18px ${c}44` }}>
      <div style={{ width:50,height:50,borderRadius:"50%",background:"#0d2d4a",display:"flex",alignItems:"center",justifyContent:"center" }}>
        <span style={{ fontSize:15,fontWeight:900,color:"#fff" }}>{pct}%</span>
      </div>
    </div>
  );
}

function HealthSub({ label,color,children }:{ label:string; color:string; children:React.ReactNode }) {
  return (
    <div>
      <p style={{ margin:"0 0 8px",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".5px",color:"#64748b",display:"flex",alignItems:"center",gap:6 }}>
        <span style={{ width:4,height:16,borderRadius:9,background:color,display:"inline-block" }} />{label}
      </p>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(118px,1fr))",gap:8 }}>
        {children}
      </div>
    </div>
  );
}

function SectionBlock({ sec,onOpen }:{ sec:typeof KPI_SECTIONS[0]; onOpen:(k:string)=>void }) {
  return (
    <div style={{ background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:14,overflow:"hidden" }}>
      <div style={{ padding:"10px 14px",background:"linear-gradient(135deg,#f1f5f9,#e8edf4)",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <div style={{ width:10,height:10,borderRadius:3,background:C_BLUE }} />
          <span style={{ fontSize:12,fontWeight:900,color:"#102f4b",textTransform:"uppercase",letterSpacing:".5px" }}>{sec.label}</span>
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <span style={{ fontSize:10,fontWeight:700,color:C_GREEN,background:"#ecfdf5",border:"1px solid #a7f3d0",borderRadius:99,padding:"2px 8px" }}>{sec.pass} passing</span>
          {sec.fail>0 && <span style={{ fontSize:10,fontWeight:700,color:C_RED,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:99,padding:"2px 8px" }}>{sec.fail} failing</span>}
        </div>
      </div>
      <div style={{ padding:10,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:8 }}>
        {sec.metrics.map(m => <MetricTile key={m} label={m} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ProcessOperationsDemoPage() {
  const [ddKey,  setDdKey]  = useState<string|null>(null);
  const [activeSec, setActiveSec] = useState<string|null>(null);
  const open = useCallback((k:string) => setDdKey(k), []);

  return (
    <div style={{ minHeight:"100vh",background:"radial-gradient(circle at 5% 2%,rgba(47,111,237,.09),transparent 24%),linear-gradient(180deg,#f1f5fa 0,#f7f9fc 310px,#f4f7fa 100%)" }}>

      <DrillDrawer ddKey={ddKey} onClose={() => setDdKey(null)} />

      {/* ── TOPBAR ─────────────────────────────────────────────────────────── */}
      <div style={{ position:"sticky",top:0,zIndex:100,background:"#fff",boxShadow:"0 5px 22px rgba(10,34,55,.12)" }}>
        <div style={{ height:4,background:GAS_ACCENT }} />
        <div style={{ minHeight:72,padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,background:GAS_TOPBAR,position:"relative",overflow:"hidden" }}>
          <div aria-hidden style={{ position:"absolute",width:260,height:260,borderRadius:"50%",right:-80,top:-170,background:"linear-gradient(135deg,rgba(255,255,255,.13),rgba(255,255,255,0))",pointerEvents:"none" }} />
          <div style={{ zIndex:1 }}>
            <div style={{ color:"#8dd9eb",fontSize:9,fontWeight:900,letterSpacing:1.4,textTransform:"uppercase",marginBottom:3 }}>MAS PeopleOS · Demo Mode</div>
            <h1 style={{ margin:0,fontSize:20,color:"#fff",display:"flex",alignItems:"center",gap:8 }}><Activity size={18}/>Process Operations</h1>
            <p style={{ margin:"3px 0 0",color:"#c9dceb",fontWeight:650,fontSize:11 }}>Click any tile, metric or chart bar to drill into its trend, analysis and actions</p>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:10,zIndex:1,flexWrap:"wrap",justifyContent:"flex-end" }}>
            <div style={{ background:"rgba(255,255,255,.14)",border:"1px solid rgba(255,255,255,.22)",borderRadius:10,padding:"6px 14px",color:"#fff",fontSize:11,fontWeight:700,minWidth:220,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8 }}>
              <span>HDFC Inbound Support</span><ChevronDown size={12}/>
            </div>
            <div style={{ display:"inline-flex",borderRadius:10,background:"rgba(255,255,255,.10)",padding:3 }}>
              {["WTD","MTD","Trend"].map(p => (
                <button key={p} style={{ borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:900,border:0,cursor:"pointer",background:p==="MTD"?"#fff":"transparent",color:p==="MTD"?"#183b59":"#d0e8f5" }}>{p}</button>
              ))}
            </div>
            <div style={{ display:"inline-flex",borderRadius:10,background:"rgba(255,255,255,.10)",padding:3 }}>
              {["KPI Metrics","Sales Dashboard","Live Dashboard"].map((v,i) => (
                <button key={v} style={{ borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:900,border:0,cursor:"pointer",background:i===0?"#fff":"transparent",color:i===0?"#183b59":"#d0e8f5" }}>{v}</button>
              ))}
            </div>
            <div style={{ height:34,padding:"0 12px",border:"1px solid rgba(255,255,255,.19)",borderRadius:999,background:"rgba(255,255,255,.09)",display:"flex",alignItems:"center",gap:8,color:"#e9f8f4",fontWeight:850,fontSize:11 }}>
              <div style={{ width:8,height:8,borderRadius:"50%",background:"#45e59b",boxShadow:"0 0 0 5px rgba(69,229,155,.13)",animation:"pulse 2.2s ease-in-out infinite" }} />
              LIVE
            </div>
          </div>
        </div>
      </div>

      {/* ── CONTENT ────────────────────────────────────────────────────────── */}
      <main style={{ maxWidth:1880,margin:"auto",padding:"18px 20px 56px" }}>
        <div style={{ display:"flex",flexDirection:"column",gap:14 }}>

          {/* ── CEO KPI STRIP (all clickable) ──────────────────────────────── */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:10 }}>
            <KpiTile ddKey="Revenue"       label="Revenue"       value="₹48.2L" sub="this month"               color="linear-gradient(135deg,#1e3a5f,#2f6fed)" trend="positive" delta="+₹3.1L MoM" onOpen={open} />
            <KpiTile ddKey="Operating %"   label="Operating %"   value="14.3%"  sub="₹6.9L EBIT ÷ ₹48.2L Rev"  color="linear-gradient(135deg,#047857,#10b981)" trend="positive" delta="+1.8pp MoM" onOpen={open} />
            <KpiTile ddKey="Quality Score" label="Quality Score" value="76%"    sub="18 on target · 6 failing"  color="linear-gradient(135deg,#b45309,#f59e0b)" trend="action"   delta="-4pp vs target" onOpen={open} />
            <KpiTile ddKey="HC vs Mandate" label="HC vs Mandate" value="-3"     sub="below mandate"             color="linear-gradient(135deg,#be123c,#f43f5e)" trend="negative" delta="-1 seat MoM" onOpen={open} />
            <KpiTile ddKey="Rev / Agent"   label="Rev / Agent"   value="₹2.4L"  sub="monthly productivity"      color="linear-gradient(135deg,#5b21b6,#7c5ce5)" trend="positive" delta="+₹0.2L MoM" onOpen={open} />
          </div>

          {/* ── EXECUTIVE BRIEF + ACTION BOARD ─────────────────────────────── */}
          <div style={{ display:"grid",gridTemplateColumns:"minmax(0,1.1fr) minmax(0,.9fr)",gap:14 }}>
            <div style={{ padding:"16px 18px",borderRadius:16,border:"1px solid #1b5770",color:"#fff",position:"relative",overflow:"hidden",background:GAS_BRIEF }}>
              <div aria-hidden style={{ position:"absolute",width:220,height:220,borderRadius:"50%",right:-80,bottom:-125,border:"35px solid rgba(255,255,255,.035)",pointerEvents:"none" }} />
              <div style={{ position:"relative" }}>
                <div style={{ marginBottom:5,color:"#91dce8",fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:1.25 }}>Process Performance Brief</div>
                <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:14 }}>
                  <h3 style={{ margin:0,fontSize:20,color:"#fff" }}>HDFC Inbound Support</h3>
                  <span style={{ padding:"5px 9px",borderRadius:999,background:"rgba(255,255,255,.10)",border:"1px solid rgba(255,255,255,.14)",fontSize:9,fontWeight:800,color:"#d7eef5",whiteSpace:"nowrap" }}>Sep-26</span>
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:14,margin:"12px 0" }}>
                  <ScoreRing pct={76} />
                  <div>
                    <span style={{ display:"inline-flex",padding:"5px 8px",borderRadius:999,background:"rgba(232,155,25,.16)",color:"#ffd283",border:"1px solid rgba(255,203,106,.24)",fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:.5 }}>WATCH</span>
                    <p style={{ margin:"7px 0 0",color:"#d2e5ee",lineHeight:1.45,fontSize:11.5,fontWeight:600,maxWidth:500 }}>18 of 24 targeted metrics are on track. Quality and FCR are primary gaps — both correlated to green-floor agent wave entering this month.</p>
                  </div>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7 }}>
                  <Signal name="Headcount"  value="17"    note="of 20 mandate" />
                  <Signal name="Quality"    value="76%"   note="18 pass · 6 fail" />
                  <Signal name="Rev/Agent"  value="₹2.4L" note="monthly" />
                  <Signal name="HC Gap"     value="-3"    note="below mandate" />
                </div>
              </div>
            </div>
            <div style={{ padding:"16px 18px",borderRadius:16,border:"1px solid #1b5770",color:"#fff",background:GAS_BRIEF,display:"flex",flexDirection:"column" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                <h3 style={{ margin:0,color:"#fff",fontSize:18 }}>Action Board</h3>
                <span style={{ padding:"4px 7px",borderRadius:999,background:"rgba(255,255,255,.12)",border:"1px solid rgba(255,255,255,.14)",fontSize:8,fontWeight:900,textTransform:"uppercase",color:"#d5ecf6" }}>4 items</span>
              </div>
              {[
                {s:"critical",t:"Understaffed by 3 vs mandate",     b:"17 active HC against a sanctioned 20.",dd:"HC vs Mandate"},
                {s:"critical",t:"AHT 312s — 4% above 300s target",  b:"Green-floor agents averaging 338s vs 291s for tenured.",dd:"AHT SEC"},
                {s:"warning", t:"FCR at 68.2%, target ≥ 70%",        b:"87 repeat calls (4.7%). Knowledge base gaps are root cause.",dd:"FCR %"},
                {s:"warning", t:"Attrition at 28.6% annualised",     b:"3 exits in Sep. Night-shift commute & incentive stagnation cited.",dd:"ATTRITION %"},
              ].map((item,i) => (
                <div key={i} onClick={() => open(item.dd)}
                  style={{ display:"flex",gap:10,padding:"8px 9px",borderRadius:9,border:"1px solid rgba(255,255,255,.10)",background:"rgba(255,255,255,.07)",marginBottom:6,cursor:"pointer",transition:"background .15s" }}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background="rgba(255,255,255,.13)";}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="rgba(255,255,255,.07)";}}>
                  <div style={{ width:22,height:22,borderRadius:7,flexShrink:0,display:"grid",placeItems:"center",background:item.s==="critical"?"rgba(229,72,77,.25)":"rgba(232,155,25,.22)",fontSize:10,fontWeight:900,color:"#fff" }}>{i+1}</div>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:11,fontWeight:800,color:item.s==="critical"?"#ffb4b7":"#ffd283" }}>{item.t}</div>
                    <div style={{ fontSize:10,color:"rgba(255,255,255,.55)",marginTop:2 }}>{item.b}</div>
                  </div>
                  <ChevronRight size={12} style={{ color:"rgba(255,255,255,.35)",flexShrink:0,marginTop:2 }} />
                </div>
              ))}
            </div>
          </div>

          {/* ── STICKY SECTION NAV ──────────────────────────────────────────── */}
          <div style={{ position:"sticky",top:72,zIndex:90,background:"#f1f5fa",padding:"6px 0",marginLeft:-20,marginRight:-20,paddingLeft:20,paddingRight:20,borderBottom:"1px solid #dce4ed",boxShadow:"0 4px 12px rgba(16,35,57,.06)",display:"flex",gap:8,overflowX:"auto" }}>
            {KPI_SECTIONS.map(s => (
              <button key={s.key} onClick={() => setActiveSec(a => a===s.key?null:s.key)}
                style={{ flexShrink:0,borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:800,border:"1px solid",cursor:"pointer",transition:".15s",background:activeSec===s.key?"#2f6fed":"#fff",color:activeSec===s.key?"#fff":"#374151",borderColor:activeSec===s.key?"#2f6fed":"#dce4ed",boxShadow:activeSec===s.key?"0 4px 12px rgba(47,111,237,.30)":"none" }}>
                {s.label}
                <span style={{ marginLeft:6,fontSize:9,fontWeight:900,padding:"1px 5px",borderRadius:99,background:activeSec===s.key?"rgba(255,255,255,.22)":s.fail>0?"#fef2f2":"#ecfdf5",color:activeSec===s.key?"#fff":s.fail>0?C_RED:C_GREEN }}>{s.pass+s.fail}</span>
              </button>
            ))}
            <div style={{ marginLeft:"auto",display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
              <Clock size={11} style={{ color:"#94a3b8" }} />
              <span style={{ fontSize:10,color:"#94a3b8",fontWeight:600 }}>Last updated 2 min ago</span>
            </div>
          </div>

          {/* ── ZONE 1: BUSINESS HEALTH ─────────────────────────────────────── */}
          <Collapsible title="Business Health — Revenue, Headcount & Hiring" defaultOpen>
            <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
              <HealthSub label="Revenue & Margin" color={C_BLUE}>
                <HealthTile ddKey="Revenue"      label="Revenue"       value="₹48.2L"  caption="Recognized"     tone="good"    icon={TrendingUp}   trend="positive" delta="+₹3.1L"  onOpen={open} />
                <HealthTile ddKey="GRN (vendor)"  label="GRN (vendor)"  value="₹12.8L"  caption="vendor cost"   tone="neutral"                      trend="positive" delta="-₹0.4L"  onOpen={open} />
                <HealthTile ddKey="Agent Salary"  label="Agent Salary"  value="₹18.4L"  caption="est. pre-payroll" tone="neutral" icon={Users}       trend="positive" delta="~est."   onOpen={open} />
                <HealthTile ddKey="EBIT"          label="EBIT"          value="₹6.9L"   caption="after all costs" tone="good"                        trend="positive" delta="+₹0.8L"  onOpen={open} />
                <HealthTile ddKey="Operating %"   label="Operating %"   value="14.3%"   caption="EBIT ÷ Revenue" tone="good"                         trend="positive" delta="+1.8pp"  onOpen={open} />
                <HealthTile ddKey="Rev / Agent"   label="Rev/Agent"     value="₹2.4L"   caption="productivity"   tone="neutral"                      trend="positive" delta="+₹0.2L"  onOpen={open} />
              </HealthSub>
              <HealthSub label="Headcount vs Mandate" color={C_PURPLE}>
                <HealthTile ddKey="Active HC"    label="Active HC"     value="17"      caption="of 20 sanctioned" tone="bad"    icon={Users}        fillPct={85} fillGood={false} trend="negative" delta="-1 MoM"     onOpen={open} />
                <HealthTile ddKey="HC vs Mandate" label="Mandate"      value="20"      caption="sanctioned seats" tone="neutral" icon={Target}                                  trend="positive" delta="stable"       onOpen={open} />
                <HealthTile ddKey="HC vs Mandate" label="Gap"          value="-3"      caption="below mandate"    tone="bad"    icon={AlertTriangle}                           trend="action"   delta="-3 seats"     onOpen={open} />
                <HealthTile ddKey="Open Positions" label="Open Positions" value="3"    caption="yet to fill"      tone="bad"    icon={Target}                                  trend="action"   delta="3 open"        onOpen={open} />
                <HealthTile ddKey="HC vs Mandate" label="Buffer"       value="+0"      caption="above mandate"    tone="neutral" icon={ArrowUpRight}                          trend="action"   delta="0"             onOpen={open} />
                <HealthTile ddKey="ATTRITION %"  label="Attrition"     value="28.6%"   caption="annualised"       tone="bad"    icon={TrendingDown}                           trend="negative" delta="+2.5pp"         onOpen={open} />
              </HealthSub>
              <HealthSub label="Hiring Pipeline" color={C_AMBER}>
                <HealthTile ddKey="Open Positions" label="Open Reqs"     value="2"  caption="requisitions"    tone="neutral" icon={Briefcase} trend="positive" delta="stable"    onOpen={open} />
                <HealthTile ddKey="Open Positions" label="Open Positions" value="3" caption="yet to fill"     tone="bad"     icon={Target}   trend="action"   delta="3 open"     onOpen={open} />
                <HealthTile ddKey="Open Positions" label="Hired (all)"   value="45" caption="via requisition" tone="good"    icon={UserPlus} trend="positive" delta="+3"         onOpen={open} />
                <HealthTile ddKey="Open Positions" label="Pending"       value="3"  caption="req − fulfilled" tone="bad"     icon={Hourglass} trend="action"  delta="3 short"    onOpen={open} />
                <HealthTile ddKey="Open Positions" label="Candidates"    value="7"  caption="in pipeline"     tone="neutral" icon={Users2}   trend="positive" delta="stable"     onOpen={open} />
              </HealthSub>
            </div>
          </Collapsible>

          {/* ── ZONE 2: ROOT CAUSE vs WORKFORCE ────────────────────────────── */}
          <Collapsible title="Root Cause vs. Workforce — Why Quality Dipped" defaultOpen>
            <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
              <div style={{ display:"flex",gap:8,padding:"9px 12px",borderRadius:10,background:"#eff6ff",border:"1px solid #bfdbfe",alignItems:"flex-start" }}>
                <Info size={13} style={{ color:C_BLUE,flexShrink:0,marginTop:1 }} />
                <span style={{ fontSize:10.5,color:"#1e40af",lineHeight:1.55 }}>Complaints and green-floor share are rising together — the quality dip is a training-cohort effect, not a process failure. As the Sep cohort matures (90+ days), both lines should self-correct.</span>
              </div>
              <div>
                <p style={{ margin:"0 0 6px",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".5px",color:"#64748b" }}>Agent complaints vs. ≤30-day tenure share (%)</p>
                <div style={{ height:190 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={WF} margin={{ top:8,right:24,bottom:0,left:0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="date" tick={AX} tickLine={false} axisLine={false} minTickGap={22} />
                      <YAxis unit="%" tick={AX} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={TT} formatter={(v:number,n:string)=>[`${v.toFixed(1)}%`,n==="agC"?"Agent complaints":"≤30-day tenure"]} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:10,paddingTop:6 }} formatter={(n:string)=>n==="agC"?"Agent complaints %":"≤30-day tenure (green floor) %"} />
                      <Line type="monotone" dataKey="agC"  stroke={C_RED}   strokeWidth={2.5} dot={{ r:3,fill:C_RED }}   isAnimationActive={false} name="agC">
                        <LabelList dataKey="agC"  position="top"    style={{ fontSize:8,fill:C_RED,fontWeight:700 }}   formatter={(v:number)=>v===26?`${v}%`:""} />
                      </Line>
                      <Line type="monotone" dataKey="ramp" stroke={C_AMBER} strokeWidth={2} strokeDasharray="4 2" dot={{ r:2,fill:C_AMBER }} isAnimationActive={false} name="ramp">
                        <LabelList dataKey="ramp" position="bottom" style={{ fontSize:8,fill:C_AMBER,fontWeight:700 }} formatter={(v:number)=>v===27?`${v}%`:""} />
                      </Line>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1.5fr 1fr",gap:12 }}>
                <div>
                  <p style={{ margin:"0 0 6px",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".5px",color:"#64748b" }}>Rostered vs. present headcount</p>
                  <div style={{ height:155 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={WF} margin={{ top:4,right:24,bottom:0,left:0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="date" tick={AX} tickLine={false} axisLine={false} minTickGap={22} />
                        <YAxis tick={AX} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={TT} formatter={(v:number,n:string)=>[v,n==="plan"?"Rostered":"Present"]} />
                        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:10 }} formatter={(n:string)=>n==="plan"?"Rostered":"Present"} />
                        <ReferenceLine y={20} stroke={C_PURPLE} strokeDasharray="4 2" strokeWidth={1.5} label={{ value:"Mandate 20",position:"insideTopRight",fontSize:8,fill:C_PURPLE }} />
                        <Line type="monotone" dataKey="plan" stroke={C_PURPLE} strokeWidth={2} dot={false} isAnimationActive={false} name="plan" />
                        <Line type="monotone" dataKey="pres" stroke={C_BLUE}   strokeWidth={2} strokeDasharray="4 2" dot={{ r:2,fill:C_BLUE }} isAnimationActive={false} name="pres" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div>
                  <p style={{ margin:"0 0 6px",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".5px",color:"#64748b" }}>Exits by week — click bars</p>
                  <div style={{ height:155 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={EXITS} margin={{ top:16,right:8,bottom:0,left:-24 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="w" tick={AX} tickLine={false} axisLine={false} />
                        <YAxis tick={AX} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={TT} formatter={(v:number)=>[v,"Exits"]} />
                        <Bar dataKey="e" fill={C_RED} radius={[4,4,0,0]} isAnimationActive={false} onClick={() => open("ATTRITION %")} style={{ cursor:"pointer" }}>
                          <LabelList dataKey="e" position="top" style={{ fontSize:11,fill:C_RED,fontWeight:800 }} formatter={(v:number)=>v>0?v:""} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          </Collapsible>

          {/* ── ZONE 3: QUALITY & RISK ──────────────────────────────────────── */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
            <Card title="Quality Radar — parameter breakdown" subtitle="Hover each axis for label · all values clickable">
              <div style={{ height:220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={RADAR} outerRadius="68%" margin={{ top:10,right:30,bottom:10,left:30 }}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="ax" tick={{ fontSize:11,fill:"#475569",fontWeight:600 }} />
                    <PolarRadiusAxis domain={[0,100]} tick={{ fontSize:9,fill:"#94A3B8" }} />
                    <Tooltip contentStyle={TT} labelFormatter={(_,p)=>p?.[0]?.payload?.full??""} formatter={(v:number)=>[`${v}%`,""]} />
                    <Radar dataKey="v" stroke={C_GREEN} fill={C_GREEN} fillOpacity={0.25} strokeWidth={2}>
                      <LabelList dataKey="v" position="outside" style={{ fontSize:11,fill:"#047857",fontWeight:700 }} formatter={(v:number)=>`${v}%`} />
                    </Radar>
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Customer Risk Flags" subtitle="% of examined calls with each risk · click a bar">
              <div style={{ height:220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={RISK_DATA} layout="vertical" margin={{ top:4,right:50,bottom:0,left:8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" unit="%" tick={AX} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="n" width={160} tick={{ fontSize:10,fill:"#475569" }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={TT} formatter={(v:number)=>[`${v.toFixed(1)}%`,""]} />
                    <Bar dataKey="v" fill={C_RED} radius={[0,4,4,0]} barSize={16} onClick={() => open("FATAL %")} style={{ cursor:"pointer" }}>
                      <LabelList dataKey="v" position="right" style={{ fontSize:10,fill:C_RED,fontWeight:700 }} formatter={(v:number)=>`${v.toFixed(1)}%`} />
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Trend charts */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
            <Card title="Conversion Funnel — daily trend" subtitle="Click the Sale line to drill in">
              <div style={{ height:195 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={FUNNEL} margin={{ top:4,right:16,bottom:0,left:-14 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="d" tick={AX} tickLine={false} axisLine={false} />
                    <YAxis domain={[0,100]} unit="%" tick={AX} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={TT} formatter={(v:number,n:string)=>[`${v.toFixed(1)}%`,n]} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:10 }} formatter={(n:string)=>({O:"Opening",F:"Offer",S:"Sale",Sc:"Scored"}[n]??n)} />
                    <Line type="monotone" dataKey="Sc" stroke={C_SLATE}  strokeWidth={1.5} strokeDasharray="4 2" dot={{ r:2,fill:C_SLATE }}  isAnimationActive={false} />
                    <Line type="monotone" dataKey="O"  stroke={C_BLUE}   strokeWidth={2}   dot={{ r:2.5,fill:C_BLUE }}  isAnimationActive={false} onClick={() => open("OPENING %")} style={{ cursor:"pointer" }}>
                      <LabelList dataKey="O" position="top" style={{ fontSize:8,fill:C_BLUE,fontWeight:700 }} formatter={(v:number)=>v===47?`${v}%`:""} />
                    </Line>
                    <Line type="monotone" dataKey="F"  stroke={C_PURPLE} strokeWidth={2}   dot={{ r:2.5,fill:C_PURPLE }} isAnimationActive={false} onClick={() => open("OFFER %")} style={{ cursor:"pointer" }} />
                    <Line type="monotone" dataKey="S"  stroke={C_GREEN}  strokeWidth={2}   dot={{ r:2.5,fill:C_GREEN }}  isAnimationActive={false} onClick={() => open("SALE %")} style={{ cursor:"pointer" }}>
                      <LabelList dataKey="S" position="top" style={{ fontSize:8,fill:C_GREEN,fontWeight:700 }} formatter={(v:number)=>v===22?`${v}%`:""} />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Agent Audit Score — daily" subtitle="Green ≥ 80 · Amber 65–79 · Red < 65 · click any bar">
              <div style={{ height:195 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={AUDIT} margin={{ top:16,right:8,bottom:0,left:-24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="d" tick={AX} tickLine={false} axisLine={false} />
                    <YAxis domain={[0,100]} tick={AX} tickLine={false} axisLine={false} />
                    <ReferenceLine y={80} stroke={C_GREEN} strokeDasharray="4 3" strokeWidth={1.5} label={{ value:"80% target",position:"insideTopRight",fontSize:8,fill:C_GREEN }} />
                    <Tooltip contentStyle={TT} formatter={(_:number,__:string,item:any)=>[`${item.payload.s}%`,"Score"]} />
                    <Bar dataKey="s" radius={[4,4,0,0]} isAnimationActive={false} onClick={() => open("OVERALL SCORE")}>
                      {AUDIT.map((d,i)=><Cell key={i} fill={bc(d.s)} style={{ cursor:"pointer" }} />)}
                      <LabelList dataKey="s" position="top" style={{ fontSize:9,fill:"#475569",fontWeight:700 }} formatter={(v:number)=>`${v}%`} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* ── ZONE DIVIDER ────────────────────────────────────────────────── */}
          <ZoneDivider label="Operations Detail — Managers & QA" />

          <Collapsible title="Day-wise Scenario Audit — Call type breakdown" defaultOpen>
            <div style={{ height:195 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={SCENARIO} margin={{ top:8,right:8,bottom:0,left:-20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="d" tick={AX} tickLine={false} axisLine={false} />
                  <YAxis tick={AX} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TT} formatter={(v:number,n:string)=>[v,{C:"Complaint",Q:"Query",R:"Request",S:"Sale Done"}[n]??n]} />
                  <Legend wrapperStyle={{ fontSize:10 }} formatter={(n:string)=>({C:"Complaint",Q:"Query",R:"Request",S:"Sale Done"}[n]??n)} />
                  <Bar dataKey="C" stackId="s" fill={C_RED}    isAnimationActive={false} onClick={() => open("FATAL %")}  style={{ cursor:"pointer" }}><LabelList dataKey="C" position="inside" style={{ fontSize:9,fill:"#fff",fontWeight:700 }} formatter={(v:number)=>v>0?v:""} /></Bar>
                  <Bar dataKey="Q" stackId="s" fill={C_BLUE}   isAnimationActive={false}><LabelList dataKey="Q" position="inside" style={{ fontSize:9,fill:"#fff",fontWeight:700 }} formatter={(v:number)=>v>0?v:""} /></Bar>
                  <Bar dataKey="R" stackId="s" fill={C_AMBER}  isAnimationActive={false}><LabelList dataKey="R" position="inside" style={{ fontSize:9,fill:"#fff",fontWeight:700 }} formatter={(v:number)=>v>0?v:""} /></Bar>
                  <Bar dataKey="S" stackId="s" fill={C_GREEN}  radius={[4,4,0,0]} isAnimationActive={false} onClick={() => open("SALE %")} style={{ cursor:"pointer" }}><LabelList dataKey="S" position="top" style={{ fontSize:9,fill:"#475569",fontWeight:700 }} formatter={(v:number)=>v>0?v:""} /></Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Collapsible>

          <Collapsible title="Repeat Analysis — Unique vs Repeat callers">
            <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12 }}>
              {([["1,843","Unique callers","positive","+5.2%","FCR %"],["87","Repeat calls","action","+8","FCR %"],["4.7%","Repeat share","action","+0.3pp","FCR %"]] as [string,string,Trend,string,string][]).map(([v,l,tr,dl,dd]) => (
                <div key={l} onClick={() => open(dd)}
                  style={{ border:`1px solid ${tc(tr)}33`,borderRadius:9,padding:"8px 10px",cursor:"pointer",transition:"box-shadow .15s,border-color .15s" }}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.boxShadow="0 4px 12px rgba(16,35,57,.08)";}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.boxShadow="none";}}>
                  <div style={{ fontSize:19,fontWeight:900,color:"#102f4b" }}>{v}</div>
                  <div style={{ fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:".4px",marginTop:2 }}>{l}</div>
                  <div style={{ marginTop:5 }}><TrendChip trend={tr} delta={dl} /></div>
                </div>
              ))}
            </div>
            <div style={{ height:135 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={REPEAT} margin={{ top:4,right:8,bottom:0,left:-24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="d" tick={AX} tickLine={false} axisLine={false} />
                  <YAxis tick={AX} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TT} formatter={(v:number,n:string)=>[v,n==="U"?"Unique":"Repeat"]} />
                  <Legend wrapperStyle={{ fontSize:10 }} formatter={(n:string)=>n==="U"?"Unique Callers":"Repeat Callers"} />
                  <Area type="monotone" dataKey="U" stroke={C_BLUE}  fill={C_BLUE}  fillOpacity={0.12} strokeWidth={1.5} isAnimationActive={false} />
                  <Area type="monotone" dataKey="R" stroke={C_AMBER} fill={C_AMBER} fillOpacity={0.25} strokeWidth={1.5} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Collapsible>

          {/* ── ZONE DIVIDER ────────────────────────────────────────────────── */}
          <ZoneDivider label="Analyst Drill-Downs" />

          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
            {[
              {t:"Fatal Calls Analysis",          dd:"FATAL %"},
              {t:"Score Components Breakdown",    dd:"OVERALL SCORE"},
              {t:"ACHT Categorization",           dd:"AHT SEC"},
              {t:"Critical Signals",              dd:"EMPATHY %"},
              {t:"Fatal Root-Cause Analysis",     dd:"FATAL %"},
              {t:"Fraud Call Detection",          dd:"COMPLIANCE %"},
            ].map(({ t,dd }) => (
              <Collapsible key={t} title={t}>
                <div onClick={() => open(dd)}
                  style={{ height:72,display:"flex",alignItems:"center",justifyContent:"center",gap:8,color:C_BLUE,fontSize:12,fontWeight:700,background:"#f8fafc",borderRadius:8,cursor:"pointer",border:"1px dashed #dce4ed",transition:"background .15s" }}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background="#eff6ff";}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="#f8fafc";}}>
                  <Info size={14}/> View depth analysis →
                </div>
              </Collapsible>
            ))}
          </div>

          {/* ── ZONE DIVIDER ────────────────────────────────────────────────── */}
          <ZoneDivider label="KPI Metric Sections" />

          {/* ── ZONE 6: KPI METRIC SECTIONS (all clickable) ─────────────────── */}
          <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
            {KPI_SECTIONS.map(s => <SectionBlock key={s.key} sec={s} onOpen={open} />)}
          </div>

        </div>
      </main>

      <style>{`@keyframes pulse{50%{box-shadow:0 0 0 8px rgba(69,229,155,0)}}`}</style>
    </div>
  );
}
