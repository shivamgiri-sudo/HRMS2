# KPI Catalogue Map

Generated from `backend/src/modules/kpi-catalogue/kpi-catalogue.seed.ts`. 21 processes, 605 KPIs. Do not edit by hand: edit the seed and re-run `npm run kpi:catalogue-map` (in `backend/`).

## Audiences

| Audience | Roles | Department | Access |
|---|---|---|---|
| agent | employee, agent, trainee | operations | view |
| team_leader | team_leader, team_lead, tl, manager, assistant_manager | operations | view |
| process_manager | process_manager, operations_manager | operations | manage |
| quality | qa, quality_analyst, qa_manager, quality_lead, branch_qa, tq_head | quality | view |
| wfm | wfm, wfm_spoc, rta, branch_wfm, ho_wfm, ho_rta | wfm | view |
| branch | branch_head, branch_manager, bm | operations | view |
| head_office | operations_head, ho_operations, ceo, coo, management | operations | view |
| trainer | trainer | training | view |
| admin | admin, super_admin | operations | manage |

## Process overview

| Process | Codes | KPIs | With data | Employee-level | Realtime |
|---|---|---|---|---|---|
| Bellavita (`bellavita`) | BELLA_VITA | 51 | 49 | 38 | 13 |
| GNC (`gnc`) | GNC, GUARDIAN_HC | 45 | 43 | 35 | 13 |
| Neemans (`neemans`) | NEEMANS | 41 | 37 | 32 | 14 |
| Appreciate Wealth (`appreciate_health`) | APPRICIATE_WEALTH, BSS_OB_NOIDA_923 | 32 | 30 | 28 | 0 |
| Housing Owner (`housing_owner`) | HOUSING_OWNER, HOUSING_COM | 27 | 25 | 23 | 0 |
| Housing Premium (`housing_premium`) | HOUSING_PREMIUM, HOUSING_COM | 27 | 25 | 23 | 0 |
| Clovia (`clovia`) | CLOVIA | 40 | 38 | 30 | 13 |
| Birlanu (`birlanu`) | BIRLANU | 23 | 20 | 16 | 0 |
| Satya Retail (`satya_retail`) | SATYA_RETAIL, BSS_OB_NOIDA_1045, IDAM, VST | 21 | 19 | 17 | 0 |
| Lawyer Panel - Feedback (`lp_feedback`) | ERESOLUTION, BSS_OB_NOIDA_1005 | 24 | 22 | 20 | 0 |
| Lawyer Panel - Onboarding (`lp_onboarding`) | ERESOLUTION, BSS_OB_NOIDA_1005 | 25 | 23 | 21 | 0 |
| Dalmia Cement (`dalmia`) | DALMIA_CEMENT | 33 | 31 | 20 | 13 |
| SBI Card Collections (`sbi_card`) | SBI_CARD | 28 | 20 | 18 | 0 |
| DU Bangladesh (`du_bangladesh`) | DU_DIGITAL, BSS_IB_NOIDA_654 | 28 | 26 | 20 | 13 |
| Viega (`viega`) | VIEGA | 28 | 26 | 20 | 13 |
| Exicom (`exicom`) | EXICOM | 28 | 26 | 20 | 13 |
| Bla Bli Blu (live dialer) (`bla_bli_blu`) | BLA_BLI_BLU | 51 | 43 | 21 | 19 |
| Reginald (live dialer) (`reginald`) | REGINALD | 24 | 18 | 15 | 3 |
| Finnable (live dialer) (`finnable`) | FINNABLE | 17 | 14 | 13 | 1 |
| All processes (operations, workforce, training) (`_global`) | - | 9 | 9 | 3 | 0 |
| GS1 / GS1 (`gs1`) | GS1 | 3 | 0 | 0 | 0 |

## KPIs per process

### Bellavita (`bellavita`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Sales / orders | sales | count | higher | both | db_masmis.bb_sale + bb_apr (bellavita-sale-dashboard.service) | COUNT(DISTINCT order_id) where sale made | upload | date, lob, agent, sale_source | agent, team_leader, process_manager, branch, head_office, admin |
| Revenue | sales | currency | higher | both | db_masmis.bb_sale + bb_apr (bellavita-sale-dashboard.service) | SUM(order amount) | upload | date, lob, agent, sale_source | agent, team_leader, process_manager, branch, head_office, admin |
| Average order value (AOV) | sales | currency | higher | both | db_masmis.bb_sale + bb_apr (bellavita-sale-dashboard.service) | revenue / orders | upload | date, lob, agent, sale_source | agent, team_leader, process_manager, branch, head_office, admin |
| Conversion % | sales | percent | higher | both | db_masmis.bb_sale + bb_apr (bellavita-sale-dashboard.service) | sales / connected (or / calls when connected is unmapped) | upload | date, lob, agent, sale_source | agent, team_leader, process_manager, branch, head_office, admin |
| Target achievement % | sales | percent | higher | both | db_masmis.bb_sale + bb_apr (bellavita-sale-dashboard.service) | revenue / (monthly target prorated by days) | upload | date, lob, agent, sale_source | agent, team_leader, process_manager, branch, head_office, admin |
| Revenue per agent | sales | currency | higher | process | db_masmis.bb_sale + bb_apr (bellavita-sale-dashboard.service) | revenue / active agents | upload | date, team, lob | process_manager, branch, head_office, admin |
| Prepaid % | sales | percent | higher | both | db_masmis.bb_sale | prepaid orders / orders | upload | date, agent, lob | agent, team_leader, process_manager, branch, head_office, admin |
| RTO % | sales | percent | lower | both | db_masmis.bb_sale | RTO orders / orders | upload | date, agent, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Net turnover | sales | currency | higher | process | db_masmis.bb_sale | turnover - cancelled / RTO value | upload | date, lob | process_manager, branch, head_office, admin |
| Cart unique connected | abandon_cart | count | higher | both | db_masmis.bb_cart + bb_apr | COUNT(DISTINCT cart_id) connected | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Cart connect % | abandon_cart | percent | higher | both | db_masmis.bb_cart | unique connected / base workable cases | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Cart same-day connect | abandon_cart | count | higher | both | db_masmis.bb_cart | unique connected on allocation day | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Cart cases per agent (CPA) | abandon_cart | ratio | higher | process | db_masmis.bb_cart + bb_apr | base cases / agents logged in | upload | date | process_manager, branch, head_office, admin |
| Cart value recovered | abandon_cart | currency | higher | both | db_masmis.bb_cart | SUM(cart value) of converted carts | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Chat first response in TAT % | chat | percent | higher | both | db_masmis.new_bb_chat (bellavita-chat-overview) | FRT within target / chats | upload | date, agent, chat_type | agent, team_leader, process_manager, branch, head_office, admin |
| Chat repeat 24/48/72h % | chat | percent | lower | process | db_masmis.new_bb_chat | repeat contacts within window / unique | upload | date | process_manager, branch, head_office, admin |
| Chat conversion (unique) | chat | percent | higher | both | db_masmis.new_bb_chat + bb_sale (campaign Chat) | orders / unique chats | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Chat tickets | chat | count | higher | both | db_masmis.bb_chat (bellavita-chat-dashboard.service) | COUNT(tickets) | upload | date, agent, team, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Resolved % | chat | percent | higher | both | db_masmis.bb_chat (bellavita-chat-dashboard.service) | resolved tickets / tickets | upload | date, agent, team, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Average first response time | chat | minutes | lower | both | db_masmis.bb_chat (bellavita-chat-dashboard.service) | AVG(frt_1) in minutes | upload | date, agent, team, lob | agent, team_leader, process_manager, branch, head_office, admin |
| First response within 60s % | chat | percent | higher | both | db_masmis.bb_chat (bellavita-chat-dashboard.service) | tickets with first response <= 60s / tickets | upload | date, agent, team, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Resolution time | chat | seconds | lower | both | db_masmis.bb_chat (bellavita-chat-dashboard.service) | AVG(resolution time) | upload | date, agent, team, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Repeat chat % | chat | percent | lower | process | db_masmis.bb_chat (bellavita-chat-dashboard.service) | repeat contacts (by phone) / unique | upload | date, lob | process_manager, branch, head_office, admin |
| Calls offered | inbound | count | higher | both | dialer_db.cdr_in_11_5 via call-master/inbound-projects | COUNT(calls offered) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls answered | inbound | count | higher | both | dialer_db.cdr_in_11_5 via call-master/inbound-projects | COUNT(calls answered by agent) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls abandoned | inbound | count | lower | process | dialer_db.cdr_in_11_5 via call-master/inbound-projects | offered - answered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Answer level % | inbound | percent | higher | both | dialer_db.cdr_in_11_5 via call-master/inbound-projects | answered / offered | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Service level % | inbound | percent | higher | both | dialer_db.cdr_in_11_5 via call-master/inbound-projects | answered within threshold / answered (threshold 20s pattern A, 30s pattern B) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Abandon % | inbound | percent | lower | process | dialer_db.cdr_in_11_5 via call-master/inbound-projects | abandoned / offered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Average handle time (AHT) | inbound | seconds | lower | both | dialer_db.cdr_in_11_5 via call-master/inbound-projects | (talk + hold + ACW) / handled | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Talk time | inbound | seconds | lower | both | dialer_db.cdr_in_11_5 via call-master/inbound-projects | SUM(talk seconds) per agent / period | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| After-call work (ACW) | inbound | seconds | lower | both | dialer_db.cdr_in_11_5 via call-master/inbound-projects | AVG(wrap seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Hold time | inbound | seconds | lower | both | dialer_db.cdr_in_11_5 via call-master/inbound-projects | AVG(hold seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique callers | inbound | count | higher | process | dialer_db.cdr_in_11_5 via call-master/inbound-projects | COUNT(DISTINCT caller number) | realtime | date, campaign | process_manager, branch, head_office, admin |
| Repeat callers % | inbound | percent | lower | process | dialer_db.cdr_in_11_5 via call-master/inbound-projects | repeat callers / unique callers | realtime | date, campaign | process_manager, branch, head_office, admin |
| Agents logged in vs required | inbound | count | higher | process | dialer_db.cdr_in_11_5 via call-master/inbound-projects | distinct handled agents / required headcount (project mandate) | realtime | date, hour | process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### GNC (`gnc`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Sales / orders | sales | count | higher | both | db_masmis.gnc_sale + gnc_allocation + gnc_apr (gnc-sale-dashboard.service) | COUNT(DISTINCT order_id) where sale made | upload | date, campaign, team, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Revenue | sales | currency | higher | both | db_masmis.gnc_sale + gnc_allocation + gnc_apr (gnc-sale-dashboard.service) | SUM(order amount) | upload | date, campaign, team, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Average order value (AOV) | sales | currency | higher | both | db_masmis.gnc_sale + gnc_allocation + gnc_apr (gnc-sale-dashboard.service) | revenue / orders | upload | date, campaign, team, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Conversion % | sales | percent | higher | both | db_masmis.gnc_sale + gnc_allocation + gnc_apr (gnc-sale-dashboard.service) | sales / connected (or / calls when connected is unmapped) | upload | date, campaign, team, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Target achievement % | sales | percent | higher | both | db_masmis.gnc_sale + gnc_allocation + gnc_apr (gnc-sale-dashboard.service) | revenue / (monthly target prorated by days) | upload | date, campaign, team, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Revenue per agent | sales | currency | higher | process | db_masmis.gnc_sale + gnc_allocation + gnc_apr (gnc-sale-dashboard.service) | revenue / active agents | upload | date, team, lob | process_manager, branch, head_office, admin |
| Allocation connected | allocation | count | higher | both | db_masmis.gnc_allocation | COUNT(connected allocations) | upload | date, agent, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Same-day connected | allocation | percent | higher | both | db_masmis.gnc_allocation | connected on allocation day / allocated | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Abandon-cart conversion % | abandon_cart | percent | higher | both | db_masmis.gnc_allocation + gnc_sale (campaign Abandon Cart) | sales / connected | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Prepaid % | sales | percent | higher | both | db_masmis.gnc_sale | prepaid orders / orders | upload | date, agent, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| LOB monthly target achievement % | sales | percent | higher | both | mas_hrms.gnc_lob_target (gnc-targets.service) | revenue / (per-agent or fixed target x days) | upload | month, lob, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Chat response in TAT (60 min) % | chat | percent | higher | both | db_masmis.gnc_chat | responses within 60 min / tickets | upload | date, agent, qrc_bucket | agent, team_leader, process_manager, branch, head_office, admin |
| Chat tickets | chat | count | higher | both | db_masmis.gnc_chat (gnc-chat-dashboard.service) | COUNT(tickets) | upload | date, agent, team, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Resolved % | chat | percent | higher | both | db_masmis.gnc_chat (gnc-chat-dashboard.service) | resolved tickets / tickets | upload | date, agent, team, lob | agent, team_leader, process_manager, branch, head_office, admin |
| First response within 60s % | chat | percent | higher | both | db_masmis.gnc_chat (gnc-chat-dashboard.service) | tickets with first response <= 60s / tickets | upload | date, agent, team, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Resolution time | chat | seconds | lower | both | db_masmis.gnc_chat (gnc-chat-dashboard.service) | AVG(resolution time) | upload | date, agent, team, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Repeat chat % | chat | percent | lower | process | db_masmis.gnc_chat (gnc-chat-dashboard.service) | repeat contacts (by phone) / unique | upload | date, lob | process_manager, branch, head_office, admin |
| Calls offered | inbound | count | higher | both | dialer_db.cdr_in_4 via call-master/inbound-projects | COUNT(calls offered) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls answered | inbound | count | higher | both | dialer_db.cdr_in_4 via call-master/inbound-projects | COUNT(calls answered by agent) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls abandoned | inbound | count | lower | process | dialer_db.cdr_in_4 via call-master/inbound-projects | offered - answered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Answer level % | inbound | percent | higher | both | dialer_db.cdr_in_4 via call-master/inbound-projects | answered / offered | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Service level % | inbound | percent | higher | both | dialer_db.cdr_in_4 via call-master/inbound-projects | answered within threshold / answered (threshold 20s pattern A, 30s pattern B) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Abandon % | inbound | percent | lower | process | dialer_db.cdr_in_4 via call-master/inbound-projects | abandoned / offered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Average handle time (AHT) | inbound | seconds | lower | both | dialer_db.cdr_in_4 via call-master/inbound-projects | (talk + hold + ACW) / handled | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Talk time | inbound | seconds | lower | both | dialer_db.cdr_in_4 via call-master/inbound-projects | SUM(talk seconds) per agent / period | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| After-call work (ACW) | inbound | seconds | lower | both | dialer_db.cdr_in_4 via call-master/inbound-projects | AVG(wrap seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Hold time | inbound | seconds | lower | both | dialer_db.cdr_in_4 via call-master/inbound-projects | AVG(hold seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique callers | inbound | count | higher | process | dialer_db.cdr_in_4 via call-master/inbound-projects | COUNT(DISTINCT caller number) | realtime | date, campaign | process_manager, branch, head_office, admin |
| Repeat callers % | inbound | percent | lower | process | dialer_db.cdr_in_4 via call-master/inbound-projects | repeat callers / unique callers | realtime | date, campaign | process_manager, branch, head_office, admin |
| Agents logged in vs required | inbound | count | higher | process | dialer_db.cdr_in_4 via call-master/inbound-projects | distinct handled agents / required headcount (project mandate) | realtime | date, hour | process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Neemans (`neemans`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Sales / orders | sales | count | higher | both | db_masmis.neemans_sale_raw + neemans_allocation + neemans_apr (neemans-performance-dashboard) | COUNT(DISTINCT order_id) where sale made | upload | date, agent, team | agent, team_leader, process_manager, branch, head_office, admin |
| Revenue | sales | currency | higher | both | db_masmis.neemans_sale_raw + neemans_allocation + neemans_apr (neemans-performance-dashboard) | SUM(order amount) | upload | date, agent, team | agent, team_leader, process_manager, branch, head_office, admin |
| Average order value (AOV) | sales | currency | higher | both | db_masmis.neemans_sale_raw + neemans_allocation + neemans_apr (neemans-performance-dashboard) | revenue / orders | upload | date, agent, team | agent, team_leader, process_manager, branch, head_office, admin |
| Conversion % | sales | percent | higher | both | db_masmis.neemans_sale_raw + neemans_allocation + neemans_apr (neemans-performance-dashboard) | sales / connected (or / calls when connected is unmapped) | upload | date, agent, team | agent, team_leader, process_manager, branch, head_office, admin |
| Target achievement % | sales | percent | higher | both | db_masmis.neemans_sale_raw + neemans_allocation + neemans_apr (neemans-performance-dashboard) | revenue / (monthly target prorated by days) | upload | date, agent, team | agent, team_leader, process_manager, branch, head_office, admin |
| Revenue per agent | sales | currency | higher | process | db_masmis.neemans_sale_raw + neemans_allocation + neemans_apr (neemans-performance-dashboard) | revenue / active agents | upload | date, team, lob | process_manager, branch, head_office, admin |
| Prepaid % | sales | percent | higher | both | db_masmis.neemans_sale_raw (final_status RTO) | prepaid orders / orders | upload | date, agent, lob | agent, team_leader, process_manager, branch, head_office, admin |
| RTO % | sales | percent | lower | both | db_masmis.neemans_sale_raw (final_status RTO) | RTO orders / orders | upload | date, agent, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Allocation connect % | allocation | percent | higher | both | db_masmis.neemans_allocation | connected / allocated (calling_status) | upload | date, agent, sub_scenario | agent, team_leader, process_manager, branch, head_office, admin |
| Target vs achievement | sales | percent | higher | both | nms_Agent_Details.monthly_target + neemans_month_targets | revenue / monthly target | upload | month, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Chat CSAT **(no data)** | chat | ratio | higher | both | db_masmis.neemans_chat | AVG(csat) | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Abandoned cart value **(no data)** | abandon_cart | currency | higher | both | db_masmis.neemans_cart | SUM(cart value) by disposition | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls offered | inbound | count | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | COUNT(calls offered) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls answered | inbound | count | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | COUNT(calls answered by agent) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls abandoned | inbound | count | lower | process | dialer_db.cdr_in_249 via call-master/inbound-projects | offered - answered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Answer level % | inbound | percent | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | answered / offered | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Service level % | inbound | percent | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | answered within threshold / answered (threshold 20s pattern A, 30s pattern B) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Abandon % | inbound | percent | lower | process | dialer_db.cdr_in_249 via call-master/inbound-projects | abandoned / offered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Average handle time (AHT) | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | (talk + hold + ACW) / handled | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Talk time | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | SUM(talk seconds) per agent / period | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| After-call work (ACW) | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | AVG(wrap seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Hold time | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | AVG(hold seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique callers | inbound | count | higher | process | dialer_db.cdr_in_249 via call-master/inbound-projects | COUNT(DISTINCT caller number) | realtime | date, campaign | process_manager, branch, head_office, admin |
| Repeat callers % | inbound | percent | lower | process | dialer_db.cdr_in_249 via call-master/inbound-projects | repeat callers / unique callers | realtime | date, campaign | process_manager, branch, head_office, admin |
| Agents logged in vs required | inbound | count | higher | process | dialer_db.cdr_in_249 via call-master/inbound-projects | distinct handled agents / required headcount (project mandate) | realtime | date, hour | process_manager, branch, head_office, admin |
| First contact resolution % | inbound | percent | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | calls resolved on first contact / handled | realtime | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Appreciate Wealth (`appreciate_health`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Calling achievement % | outbound | percent | higher | both | db_masmis.aw_out / aw_billing (appreciate-wealth-outbound-center) | calls / calling target | upload | date, agent, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Connectivity % | outbound | percent | higher | both | db_masmis.aw_billing + aw_out | connected / dials | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls | outbound | count | higher | both | db_masmis.aw_billing + aw_out | SUM(total_calls) | upload | date, agent, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Connected calls | outbound | count | higher | both | db_masmis.aw_billing + aw_out | SUM(connected_calls) | upload | date, agent, lob | agent, team_leader, process_manager, branch, head_office, admin |
| Average talk per connected call | outbound | seconds | lower | both | db_masmis.aw_billing + aw_out | SUM(total_talk_time) / connected calls | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | db_masmis.aw_billing + aw_out | SUM(total_login_time) / 3600 | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| AHT (with / without pickup) | outbound | seconds | lower | both | db_masmis.aw_billing | (talk + wrap) / calls | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | db_masmis.aw_billing (talk / wrap / idle / pause / login) | (talk + wrap) / (login - pause) | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | db_masmis.aw_billing login status | late logins / days | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Wrap / break exceed | workforce | minutes | lower | both | db_masmis.aw_billing | minutes over wrap / break limit | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Product achievement - LRS | sales | percent | higher | both | db_masmis.aw_out sales outcomes | LRS count / INR vs target | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Product achievement - Trade | sales | percent | higher | both | db_masmis.aw_out sales outcomes | Trade count / INR vs target | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Product achievement - Mutual Fund | sales | percent | higher | both | db_masmis.aw_out sales outcomes | MF count / INR vs target | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Inbound answer level % | inbound | percent | higher | both | db_masmis.aw_inbound | answered / offered | upload | date, agent, lob | agent, team_leader, process_manager, branch, head_office, admin |
| CDR AHT / talk / wrap / hold | inbound | seconds | lower | both | db_masmis.aw_new_cdr | avg talk + wrap + hold | upload | date, agent, call_type | agent, team_leader, process_manager, branch, head_office, admin |
| Productive % | workforce | percent | higher | both | appreciate-wealth-control-center.service | productive time / login time | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Billing amount (mandate x FTE rate) | billing | currency | higher | process | db_masmis.aw_mandate | mandate FTE x per-FTE rate | upload | month, lob | process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Housing Owner (`housing_owner`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Sales / orders | sales | count | higher | both | db_masmis.owner_sale + Owner_cdr + owner_agent_details (housing-owner-dashboard.service) | COUNT(DISTINCT order_id) where sale made | upload | date, agent, tl, am | agent, team_leader, process_manager, branch, head_office, admin |
| Revenue | sales | currency | higher | both | db_masmis.owner_sale + Owner_cdr + owner_agent_details (housing-owner-dashboard.service) | SUM(order amount) | upload | date, agent, tl, am | agent, team_leader, process_manager, branch, head_office, admin |
| Average order value (AOV) | sales | currency | higher | both | db_masmis.owner_sale + Owner_cdr + owner_agent_details (housing-owner-dashboard.service) | revenue / orders | upload | date, agent, tl, am | agent, team_leader, process_manager, branch, head_office, admin |
| Conversion % | sales | percent | higher | both | db_masmis.owner_sale + Owner_cdr + owner_agent_details (housing-owner-dashboard.service) | sales / connected (or / calls when connected is unmapped) | upload | date, agent, tl, am | agent, team_leader, process_manager, branch, head_office, admin |
| Target achievement % | sales | percent | higher | both | db_masmis.owner_sale + Owner_cdr + owner_agent_details (housing-owner-dashboard.service) | revenue / (monthly target prorated by days) | upload | date, agent, tl, am | agent, team_leader, process_manager, branch, head_office, admin |
| Revenue per agent | sales | currency | higher | process | db_masmis.owner_sale + Owner_cdr + owner_agent_details (housing-owner-dashboard.service) | revenue / active agents | upload | date, team, lob | process_manager, branch, head_office, admin |
| Dials | outbound | count | higher | both | db_masmis.Owner_cdr | COUNT(dial rows) | upload | date, hour, agent, team, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Connected calls | outbound | count | higher | both | db_masmis.Owner_cdr | COUNT(connected dials) | upload | date, hour, agent, team, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Connect % | outbound | percent | higher | both | db_masmis.Owner_cdr | connected / dials | upload | date, hour, agent, team, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Average talk time | outbound | seconds | lower | both | db_masmis.Owner_cdr | SUM(talk) / connected | upload | date, hour, agent, team, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Calls per login hour | outbound | ratio | higher | both | process-dashboard (pd.metrics) | calls / (login seconds / 3600) | upload | date, hour, agent, team, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| TQ / MQ / BQ bucket | sales | percent | higher | both | housing-owner-dashboard.service | achievement >= 80% TQ, 50-79% MQ, < 50% BQ | upload | date, agent, tl, am | agent, team_leader, process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Housing Premium (`housing_premium`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Sales / orders | sales | count | higher | both | db_masmis.pre_sale + pre_agent_details + Pre_cdr (housing-premium-dashboard.service) | COUNT(DISTINCT order_id) where sale made | upload | date, week, slot, agent, tl, center | agent, team_leader, process_manager, branch, head_office, admin |
| Revenue | sales | currency | higher | both | db_masmis.pre_sale + pre_agent_details + Pre_cdr (housing-premium-dashboard.service) | SUM(order amount) | upload | date, week, slot, agent, tl, center | agent, team_leader, process_manager, branch, head_office, admin |
| Average order value (AOV) | sales | currency | higher | both | db_masmis.pre_sale + pre_agent_details + Pre_cdr (housing-premium-dashboard.service) | revenue / orders | upload | date, week, slot, agent, tl, center | agent, team_leader, process_manager, branch, head_office, admin |
| Conversion % | sales | percent | higher | both | db_masmis.pre_sale + pre_agent_details + Pre_cdr (housing-premium-dashboard.service) | sales / connected (or / calls when connected is unmapped) | upload | date, week, slot, agent, tl, center | agent, team_leader, process_manager, branch, head_office, admin |
| Target achievement % | sales | percent | higher | both | db_masmis.pre_sale + pre_agent_details + Pre_cdr (housing-premium-dashboard.service) | revenue / (monthly target prorated by days) | upload | date, week, slot, agent, tl, center | agent, team_leader, process_manager, branch, head_office, admin |
| Revenue per agent | sales | currency | higher | process | db_masmis.pre_sale + pre_agent_details + Pre_cdr (housing-premium-dashboard.service) | revenue / active agents | upload | date, team, lob | process_manager, branch, head_office, admin |
| Dials | outbound | count | higher | both | db_masmis.Pre_cdr | COUNT(dial rows) | upload | date, hour, agent, team, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Connected calls | outbound | count | higher | both | db_masmis.Pre_cdr | COUNT(connected dials) | upload | date, hour, agent, team, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Connect % | outbound | percent | higher | both | db_masmis.Pre_cdr | connected / dials | upload | date, hour, agent, team, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Average talk time | outbound | seconds | lower | both | db_masmis.Pre_cdr | SUM(talk) / connected | upload | date, hour, agent, team, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Calls per login hour | outbound | ratio | higher | both | process-dashboard (pd.metrics) | calls / (login seconds / 3600) | upload | date, hour, agent, team, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| TQ / MQ / BQ bucket | sales | percent | higher | both | housing-premium-dashboard.service | achievement >= 80% TQ, 50-79% MQ, < 50% BQ | upload | date, agent, tl | agent, team_leader, process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Clovia (`clovia`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Calls offered | inbound | count | higher | both | dialer_db.cdr_in_250 via call-master/inbound-projects | COUNT(calls offered) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls answered | inbound | count | higher | both | dialer_db.cdr_in_250 via call-master/inbound-projects | COUNT(calls answered by agent) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls abandoned | inbound | count | lower | process | dialer_db.cdr_in_250 via call-master/inbound-projects | offered - answered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Answer level % | inbound | percent | higher | both | dialer_db.cdr_in_250 via call-master/inbound-projects | answered / offered | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Service level % | inbound | percent | higher | both | dialer_db.cdr_in_250 via call-master/inbound-projects | answered within threshold / answered (threshold 20s pattern A, 30s pattern B) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Abandon % | inbound | percent | lower | process | dialer_db.cdr_in_250 via call-master/inbound-projects | abandoned / offered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Average handle time (AHT) | inbound | seconds | lower | both | dialer_db.cdr_in_250 via call-master/inbound-projects | (talk + hold + ACW) / handled | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Talk time | inbound | seconds | lower | both | dialer_db.cdr_in_250 via call-master/inbound-projects | SUM(talk seconds) per agent / period | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| After-call work (ACW) | inbound | seconds | lower | both | dialer_db.cdr_in_250 via call-master/inbound-projects | AVG(wrap seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Hold time | inbound | seconds | lower | both | dialer_db.cdr_in_250 via call-master/inbound-projects | AVG(hold seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique callers | inbound | count | higher | process | dialer_db.cdr_in_250 via call-master/inbound-projects | COUNT(DISTINCT caller number) | realtime | date, campaign | process_manager, branch, head_office, admin |
| Repeat callers % | inbound | percent | lower | process | dialer_db.cdr_in_250 via call-master/inbound-projects | repeat callers / unique callers | realtime | date, campaign | process_manager, branch, head_office, admin |
| Agents logged in vs required | inbound | count | higher | process | dialer_db.cdr_in_250 via call-master/inbound-projects | distinct handled agents / required headcount (project mandate) | realtime | date, hour | process_manager, branch, head_office, admin |
| CSAT (IVR feedback) | inbound | percent | higher | process | db_masmis.cl_feedback | positive responses / responses; response rate | upload | date, lob | process_manager, branch, head_office, admin |
| Rechurn calls % | inbound | percent | lower | process | db_masmis.cl_rechurn_call | rechurn / calls | upload | date | process_manager, branch, head_office, admin |
| Email closure % | email | percent | higher | both | db_masmis.cl_email_raw | closed / assigned | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Emails assigned | email | count | higher | both | db_masmis.cl_email_raw | SUM(total_mail_assigned) | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Email touch % | email | percent | higher | both | db_masmis.cl_email_raw | touched / assigned | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Chat accepted within 60s % | chat | percent | higher | both | db_masmis.cl_chat | accepted <= 60s / chats | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Chat customer rating | chat | ratio | higher | both | db_masmis.cl_chat | AVG(star_rating_value) | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Chats handled | chat | count | higher | both | db_masmis.cl_chat | COUNT(chats) per agent-day | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Chat wait to accept | chat | seconds | lower | both | db_masmis.cl_chat | AVG(wait_time) | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Outbound connect % (> 10s) | outbound | percent | higher | both | db_masmis.cl_outbound | connected dials / dials | upload | date, hour, agent, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Outbound dials | outbound | count | higher | both | db_masmis.cl_outbound | COUNT(dials) per agent-day | upload | date, agent, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Outbound average talk | outbound | seconds | lower | both | db_masmis.cl_outbound | AVG(length_sec) of connected dials | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Birlanu (`birlanu`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Enquiries received | funnel | count | higher | process | db_masmis.birlanu_sale | COUNT(enquiries) | upload | date, brand, product, zone, source | process_manager, branch, head_office, admin |
| Enquiry connect % | funnel | percent | higher | both | db_masmis.birlanu_sale | connected / enquiries | upload | date, agent, source | agent, team_leader, process_manager, branch, head_office, admin |
| Leads qualified | funnel | count | higher | both | db_masmis.birlanu_sale | Sub Sub Calling Status = 'Lead assign to Sales team' | upload | date, agent, source | agent, team_leader, process_manager, branch, head_office, admin |
| Lead conversion % | funnel | percent | higher | both | db_masmis.birlanu_sale | leads converted / leads qualified | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Volume (MT) | sales | count | higher | process | db_masmis.birlanu_sale | SUM(volume MT) | upload | month, brand, product, zone | process_manager, branch, head_office, admin |
| Value (INR lacs) | sales | currency | higher | process | db_masmis.birlanu_sale | SUM(value) / 100000 | upload | month, brand, product, zone | process_manager, branch, head_office, admin |
| Lead TAT within target % | funnel | percent | higher | process | db_masmis.birlanu_sale | leads actioned within TAT / leads | upload | date, tat_bucket | process_manager, branch, head_office, admin |
| Agent productivity (APR) **(no data)** | workforce | ratio | higher | employee | db_masmis.birlanu_apr | login / talk per agent-day | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Satya Retail (`satya_retail`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Shops allocated | allocation | count | higher | both | db_masmis.satya_allocation | COUNT(DISTINCT uid + unique_flag) per agent-day | upload | date, agent, beat, warehouse | agent, team_leader, process_manager, branch, head_office, admin |
| Calls made | outbound | count | higher | both | db_masmis.satya_cdr | COUNT(call rows) per agent-day | upload | date, agent, beat | agent, team_leader, process_manager, branch, head_office, admin |
| Connected | outbound | count | higher | both | db_masmis.satya_allocation | COUNT(DISTINCT uid + unique_flag where disposition = Connected) | upload | date, agent, beat | agent, team_leader, process_manager, branch, head_office, admin |
| Orders placed | sales | count | higher | both | db_masmis.satya_allocation | COUNT(DISTINCT uid + unique_flag where sub_disposition = Order Placed) | upload | date, agent, beat | agent, team_leader, process_manager, branch, head_office, admin |
| Order conversion % | sales | percent | higher | both | db_masmis.satya_allocation | orders / connected | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Pending shops | allocation | count | lower | process | db_masmis.satya_allocation | allocated - attempted (excl. VDCL sentinel) | upload | date, beat | process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Lawyer Panel - Feedback (`lp_feedback`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Unique leadset | outbound | count | higher | both | db_masmis.lp_feedback_apr + lp_feedback_cdr (lp-call-dashboard.shared) | COUNT(unique_flag = '1') | upload | date, week, hour, lead_source, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Overall calls | outbound | count | higher | both | db_masmis.lp_feedback_apr + lp_feedback_cdr (lp-call-dashboard.shared) | COUNT(CDR rows) | upload | date, week, hour, lead_source, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Overall connected % | outbound | percent | higher | both | db_masmis.lp_feedback_apr + lp_feedback_cdr (lp-call-dashboard.shared) | connected / overall calls | upload | date, week, hour, lead_source, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique connected | outbound | count | higher | both | db_masmis.lp_feedback_apr + lp_feedback_cdr (lp-call-dashboard.shared) | COUNT(connected AND unique_flag = '1') | upload | date, week, hour, lead_source, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique connectivity % | outbound | percent | higher | both | db_masmis.lp_feedback_apr + lp_feedback_cdr (lp-call-dashboard.shared) | unique connected / unique leadset | upload | date, week, hour, lead_source, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Login count | workforce | count | higher | process | db_masmis.lp_feedback_apr + lp_feedback_cdr (lp-call-dashboard.shared) | COUNT(DISTINCT agent) with login | upload | date | process_manager, branch, head_office, admin |
| Shrinkage % | workforce | percent | lower | both | db_masmis.lp_feedback_apr + lp_feedback_cdr (lp-call-dashboard.shared) | (login - net login) / login | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | db_masmis.lp_feedback_apr + lp_feedback_cdr (lp-call-dashboard.shared) | handle time / (login - break) | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Average talk per agent-day | outbound | seconds | lower | both | db_masmis.lp_feedback_apr + lp_feedback_cdr (lp-call-dashboard.shared) | SUM(talk) / agent-days | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Lawyer Panel - Onboarding (`lp_onboarding`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Unique leadset | outbound | count | higher | both | db_masmis.lp_onboarding_apr + lp_onboarding_cdr (lp-call-dashboard.shared) | COUNT(unique_flag = '1') | upload | date, week, hour, lead_source, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Overall calls | outbound | count | higher | both | db_masmis.lp_onboarding_apr + lp_onboarding_cdr (lp-call-dashboard.shared) | COUNT(CDR rows) | upload | date, week, hour, lead_source, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Overall connected % | outbound | percent | higher | both | db_masmis.lp_onboarding_apr + lp_onboarding_cdr (lp-call-dashboard.shared) | connected / overall calls | upload | date, week, hour, lead_source, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique connected | outbound | count | higher | both | db_masmis.lp_onboarding_apr + lp_onboarding_cdr (lp-call-dashboard.shared) | COUNT(connected AND unique_flag = '1') | upload | date, week, hour, lead_source, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique connectivity % | outbound | percent | higher | both | db_masmis.lp_onboarding_apr + lp_onboarding_cdr (lp-call-dashboard.shared) | unique connected / unique leadset | upload | date, week, hour, lead_source, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Login count | workforce | count | higher | process | db_masmis.lp_onboarding_apr + lp_onboarding_cdr (lp-call-dashboard.shared) | COUNT(DISTINCT agent) with login | upload | date | process_manager, branch, head_office, admin |
| Shrinkage % | workforce | percent | lower | both | db_masmis.lp_onboarding_apr + lp_onboarding_cdr (lp-call-dashboard.shared) | (login - net login) / login | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | db_masmis.lp_onboarding_apr + lp_onboarding_cdr (lp-call-dashboard.shared) | handle time / (login - break) | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Average talk per agent-day | outbound | seconds | lower | both | db_masmis.lp_onboarding_apr + lp_onboarding_cdr (lp-call-dashboard.shared) | SUM(talk) / agent-days | upload | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Qualified and handed over | funnel | count | higher | both | db_masmis.lp_onboarding_apr + lp_onboarding_cdr (lp-call-dashboard.shared) | COUNT(disposition = qualified and handed over) | upload | date, week, hour, lead_source, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Dalmia Cement (`dalmia`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Calls offered | inbound | count | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | COUNT(calls offered) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls answered | inbound | count | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | COUNT(calls answered by agent) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls abandoned | inbound | count | lower | process | dialer_db.cdr_in_249 via call-master/inbound-projects | offered - answered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Answer level % | inbound | percent | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | answered / offered | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Service level % | inbound | percent | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | answered within threshold / answered (threshold 20s pattern A, 30s pattern B) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Abandon % | inbound | percent | lower | process | dialer_db.cdr_in_249 via call-master/inbound-projects | abandoned / offered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Average handle time (AHT) | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | (talk + hold + ACW) / handled | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Talk time | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | SUM(talk seconds) per agent / period | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| After-call work (ACW) | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | AVG(wrap seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Hold time | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | AVG(hold seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique callers | inbound | count | higher | process | dialer_db.cdr_in_249 via call-master/inbound-projects | COUNT(DISTINCT caller number) | realtime | date, campaign | process_manager, branch, head_office, admin |
| Repeat callers % | inbound | percent | lower | process | dialer_db.cdr_in_249 via call-master/inbound-projects | repeat callers / unique callers | realtime | date, campaign | process_manager, branch, head_office, admin |
| Agents logged in vs required | inbound | count | higher | process | dialer_db.cdr_in_249 via call-master/inbound-projects | distinct handled agents / required headcount (project mandate) | realtime | date, hour | process_manager, branch, head_office, admin |
| Tagging % | inbound | percent | higher | process | db_masmis.dalmia_dd_raw | tagged calls / calls | upload | date, language | process_manager, branch, head_office, admin |
| QRC mix (Query / Request / Complaint) | inbound | count | lower | process | db_masmis.dalmia_dd_raw (SUB SCENARIO 1) | COUNT by QRC class | upload | date | process_manager, branch, head_office, admin |
| Leads connected / qualified | funnel | count | higher | process | db_masmis.dalmia_dd_raw (by lead source) | data received -> connected -> qualified | upload | date, lead_source | process_manager, branch, head_office, admin |
| Outbound connect % | outbound | percent | higher | process | db_masmis.dalmia_outbound_raw | connected / unique calls | upload | date | process_manager, branch, head_office, admin |
| Utilization % | workforce | percent | higher | process | db_masmis.dalmia_apr_raw | utilisation from APR | upload | date | process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### SBI Card Collections (`sbi_card`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Agent calls | collections | count | higher | both | db_masmis.sbi_card_agent_mis | SUM(calls) | upload | date, agent, team, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Agent contacts | collections | count | higher | both | db_masmis.sbi_card_agent_mis | SUM(contacts) | upload | date, agent, team | agent, team_leader, process_manager, branch, head_office, admin |
| Contact rate % | collections | percent | higher | both | db_masmis.sbi_card_agent_mis | contacts / calls | upload | date, agent, team | agent, team_leader, process_manager, branch, head_office, admin |
| Promise-to-pay (PTP) | collections | count | higher | both | db_masmis.sbi_card_agent_mis | SUM(ptp) | upload | date, agent, team | agent, team_leader, process_manager, branch, head_office, admin |
| Payment after dial (PAD) | collections | count | higher | both | db_masmis.sbi_card_agent_mis | SUM(pad) | upload | date, agent, team | agent, team_leader, process_manager, branch, head_office, admin |
| Amount collected | collections | currency | higher | both | db_masmis.sbi_card_agent_mis | SUM(amt_collected) | upload | date, agent, team, bucket | agent, team_leader, process_manager, branch, head_office, admin |
| Dialer downtime | workforce | minutes | lower | process | db_masmis.sbi_card_downtime | SUM(downtime minutes) | upload | date | process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |
| Contact Rate % (Collections) **(no data)** | client_sla | percent | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target n/a from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Connect Rate % (Collections) **(no data)** | client_sla | percent | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target n/a from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| PTP Rate % (Collections) **(no data)** | client_sla | percent | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target n/a from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Amount Collected (Collections) **(no data)** | client_sla | currency | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target n/a from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Calls per Agent (Collections) **(no data)** | client_sla | count | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target n/a from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Login Leakage (avg per agent per day) (Collections) **(no data)** | client_sla | seconds | lower | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target n/a from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |

### DU Bangladesh (`du_bangladesh`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Calls offered | inbound | count | higher | both | dialer_db.cdr_in_4 via call-master/inbound-projects | COUNT(calls offered) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls answered | inbound | count | higher | both | dialer_db.cdr_in_4 via call-master/inbound-projects | COUNT(calls answered by agent) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls abandoned | inbound | count | lower | process | dialer_db.cdr_in_4 via call-master/inbound-projects | offered - answered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Answer level % | inbound | percent | higher | both | dialer_db.cdr_in_4 via call-master/inbound-projects | answered / offered | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Service level % | inbound | percent | higher | both | dialer_db.cdr_in_4 via call-master/inbound-projects | answered within threshold / answered (threshold 20s pattern A, 30s pattern B) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Abandon % | inbound | percent | lower | process | dialer_db.cdr_in_4 via call-master/inbound-projects | abandoned / offered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Average handle time (AHT) | inbound | seconds | lower | both | dialer_db.cdr_in_4 via call-master/inbound-projects | (talk + hold + ACW) / handled | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Talk time | inbound | seconds | lower | both | dialer_db.cdr_in_4 via call-master/inbound-projects | SUM(talk seconds) per agent / period | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| After-call work (ACW) | inbound | seconds | lower | both | dialer_db.cdr_in_4 via call-master/inbound-projects | AVG(wrap seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Hold time | inbound | seconds | lower | both | dialer_db.cdr_in_4 via call-master/inbound-projects | AVG(hold seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique callers | inbound | count | higher | process | dialer_db.cdr_in_4 via call-master/inbound-projects | COUNT(DISTINCT caller number) | realtime | date, campaign | process_manager, branch, head_office, admin |
| Repeat callers % | inbound | percent | lower | process | dialer_db.cdr_in_4 via call-master/inbound-projects | repeat callers / unique callers | realtime | date, campaign | process_manager, branch, head_office, admin |
| Agents logged in vs required | inbound | count | higher | process | dialer_db.cdr_in_4 via call-master/inbound-projects | distinct handled agents / required headcount (project mandate) | realtime | date, hour | process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Viega (`viega`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Calls offered | inbound | count | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | COUNT(calls offered) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls answered | inbound | count | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | COUNT(calls answered by agent) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls abandoned | inbound | count | lower | process | dialer_db.cdr_in_249 via call-master/inbound-projects | offered - answered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Answer level % | inbound | percent | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | answered / offered | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Service level % | inbound | percent | higher | both | dialer_db.cdr_in_249 via call-master/inbound-projects | answered within threshold / answered (threshold 20s pattern A, 30s pattern B) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Abandon % | inbound | percent | lower | process | dialer_db.cdr_in_249 via call-master/inbound-projects | abandoned / offered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Average handle time (AHT) | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | (talk + hold + ACW) / handled | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Talk time | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | SUM(talk seconds) per agent / period | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| After-call work (ACW) | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | AVG(wrap seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Hold time | inbound | seconds | lower | both | dialer_db.cdr_in_249 via call-master/inbound-projects | AVG(hold seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique callers | inbound | count | higher | process | dialer_db.cdr_in_249 via call-master/inbound-projects | COUNT(DISTINCT caller number) | realtime | date, campaign | process_manager, branch, head_office, admin |
| Repeat callers % | inbound | percent | lower | process | dialer_db.cdr_in_249 via call-master/inbound-projects | repeat callers / unique callers | realtime | date, campaign | process_manager, branch, head_office, admin |
| Agents logged in vs required | inbound | count | higher | process | dialer_db.cdr_in_249 via call-master/inbound-projects | distinct handled agents / required headcount (project mandate) | realtime | date, hour | process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Exicom (`exicom`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Calls offered | inbound | count | higher | both | dialer_db.cdr_in_9 via call-master/inbound-projects | COUNT(calls offered) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls answered | inbound | count | higher | both | dialer_db.cdr_in_9 via call-master/inbound-projects | COUNT(calls answered by agent) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls abandoned | inbound | count | lower | process | dialer_db.cdr_in_9 via call-master/inbound-projects | offered - answered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Answer level % | inbound | percent | higher | both | dialer_db.cdr_in_9 via call-master/inbound-projects | answered / offered | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Service level % | inbound | percent | higher | both | dialer_db.cdr_in_9 via call-master/inbound-projects | answered within threshold / answered (threshold 20s pattern A, 30s pattern B) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Abandon % | inbound | percent | lower | process | dialer_db.cdr_in_9 via call-master/inbound-projects | abandoned / offered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Average handle time (AHT) | inbound | seconds | lower | both | dialer_db.cdr_in_9 via call-master/inbound-projects | (talk + hold + ACW) / handled | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Talk time | inbound | seconds | lower | both | dialer_db.cdr_in_9 via call-master/inbound-projects | SUM(talk seconds) per agent / period | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| After-call work (ACW) | inbound | seconds | lower | both | dialer_db.cdr_in_9 via call-master/inbound-projects | AVG(wrap seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Hold time | inbound | seconds | lower | both | dialer_db.cdr_in_9 via call-master/inbound-projects | AVG(hold seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique callers | inbound | count | higher | process | dialer_db.cdr_in_9 via call-master/inbound-projects | COUNT(DISTINCT caller number) | realtime | date, campaign | process_manager, branch, head_office, admin |
| Repeat callers % | inbound | percent | lower | process | dialer_db.cdr_in_9 via call-master/inbound-projects | repeat callers / unique callers | realtime | date, campaign | process_manager, branch, head_office, admin |
| Agents logged in vs required | inbound | count | higher | process | dialer_db.cdr_in_9 via call-master/inbound-projects | distinct handled agents / required headcount (project mandate) | realtime | date, hour | process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |

### Bla Bli Blu (live dialer) (`bla_bli_blu`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Calls offered | inbound | count | higher | both | dialer_db.cdr_in_10_4 via call-master/inbound-projects | COUNT(calls offered) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls answered | inbound | count | higher | both | dialer_db.cdr_in_10_4 via call-master/inbound-projects | COUNT(calls answered by agent) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Calls abandoned | inbound | count | lower | process | dialer_db.cdr_in_10_4 via call-master/inbound-projects | offered - answered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Answer level % | inbound | percent | higher | both | dialer_db.cdr_in_10_4 via call-master/inbound-projects | answered / offered | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Service level % | inbound | percent | higher | both | dialer_db.cdr_in_10_4 via call-master/inbound-projects | answered within threshold / answered (threshold 20s pattern A, 30s pattern B) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Abandon % | inbound | percent | lower | process | dialer_db.cdr_in_10_4 via call-master/inbound-projects | abandoned / offered | realtime | date, hour, campaign, agent | process_manager, branch, head_office, admin |
| Average handle time (AHT) | inbound | seconds | lower | both | dialer_db.cdr_in_10_4 via call-master/inbound-projects | (talk + hold + ACW) / handled | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Talk time | inbound | seconds | lower | both | dialer_db.cdr_in_10_4 via call-master/inbound-projects | SUM(talk seconds) per agent / period | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| After-call work (ACW) | inbound | seconds | lower | both | dialer_db.cdr_in_10_4 via call-master/inbound-projects | AVG(wrap seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Hold time | inbound | seconds | lower | both | dialer_db.cdr_in_10_4 via call-master/inbound-projects | AVG(hold seconds) | realtime | date, hour, campaign, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Unique callers | inbound | count | higher | process | dialer_db.cdr_in_10_4 via call-master/inbound-projects | COUNT(DISTINCT caller number) | realtime | date, campaign | process_manager, branch, head_office, admin |
| Repeat callers % | inbound | percent | lower | process | dialer_db.cdr_in_10_4 via call-master/inbound-projects | repeat callers / unique callers | realtime | date, campaign | process_manager, branch, head_office, admin |
| Agents logged in vs required | inbound | count | higher | process | dialer_db.cdr_in_10_4 via call-master/inbound-projects | distinct handled agents / required headcount (project mandate) | realtime | date, hour | process_manager, branch, head_office, admin |
| APR wait / talk / dispo / pause | workforce | seconds | higher | employee | dialer_db.vicidial_agent_log_10_4 (inbound.service APR) | SUM per agent by pause code (LB/TB/WB) | realtime | date, agent, pause_code | agent, team_leader, process_manager, branch, head_office, admin |
| Disposition mix | inbound | count | higher | process | dialer_db.data_master_in Category1/2 | COUNT by disposition | realtime | date, category | process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |
| Conversion Target % (ABC) | client_sla | percent | higher | process | kpi_daily_actual CONVERSION_RATE | Client SLA target 13.5 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Sale Target (ABC) | client_sla | count | higher | process | kpi_daily_actual SALES_COUNT | Client SLA target 3248 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Gross Revenue Target (ABC) | client_sla | currency | higher | process | kpi_daily_actual REVENUE | Client SLA target 1949063 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Prepaid Target % (ABC) **(no data)** | client_sla | percent | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 85 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| RTO Target % (ABC) | client_sla | percent | lower | process | kpi_daily_actual RTO_RATE | Client SLA target 5 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| AOV Target (ABC) | client_sla | currency | higher | process | kpi_daily_actual AOV | Client SLA target 600 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Net Revenue (ABC) **(no data)** | client_sla | currency | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 1651748 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| ROI (ABC) **(no data)** | client_sla | ratio | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 5 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| AL % (Inbound) | inbound | percent | higher | process | dialer_db.cdr_in_10_4 campaign Blabliblu_IN (al_pct) | Client SLA target 95 from the Process KPI sheet | realtime | date, lob | process_manager, branch, head_office, admin |
| Abn % (Inbound) | inbound | percent | lower | process | dialer_db.cdr_in_10_4 campaign Blabliblu_IN (abn_pct) | Client SLA target 5 from the Process KPI sheet | realtime | date, lob | process_manager, branch, head_office, admin |
| SL % (Inbound) | inbound | percent | higher | process | dialer_db.cdr_in_10_4 campaign Blabliblu_IN (sl_pct) | Client SLA target 90 from the Process KPI sheet | realtime | date, lob | process_manager, branch, head_office, admin |
| ACHT (In Sec) (Inbound) | client_sla | seconds | lower | process | kpi_daily_actual AHT | Client SLA target 240 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Repeat Calls (Inbound) | inbound | percent | lower | process | dialer_db.cdr_in_10_4 campaign Blabliblu_IN (repeat_pct) | Client SLA target 10 from the Process KPI sheet | realtime | date, lob | process_manager, branch, head_office, admin |
| Conversion Target % (Upgrade) | client_sla | percent | higher | process | kpi_daily_actual CONVERSION_RATE | Client SLA target 12 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Sale Target (Upgrade) | client_sla | count | higher | process | kpi_daily_actual SALES_COUNT | Client SLA target 647.22 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Gross Revenue Target (Upgrade) | client_sla | currency | higher | process | kpi_daily_actual REVENUE | Client SLA target 388332 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Prepaid Target % (Upgrade) **(no data)** | client_sla | percent | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 85 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| RTO Target % (Upgrade) | client_sla | percent | lower | process | kpi_daily_actual RTO_RATE | Client SLA target 5 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| AOV Target (Upgrade) | client_sla | currency | higher | process | kpi_daily_actual AOV | Client SLA target 600 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Net Revenue (Upgrade) **(no data)** | client_sla | currency | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 329095 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| ROI (Upgrade) **(no data)** | client_sla | ratio | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 5 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |

### Reginald (live dialer) (`reginald`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Cart calls (ABC campaigns) | outbound | count | higher | both | dialer_db.cdr_ob_25 (reginald-cart.service) | COUNT(calls) | realtime | date, agent, campaign | agent, team_leader, process_manager, branch, head_office, admin |
| Cart connected | outbound | count | higher | both | dialer_db.cdr_ob_25 | COUNT(connected) | realtime | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Analyst APR (login / talk / pause) | workforce | seconds | higher | employee | dialer_db.vicidial_agent_log_10_25 | SUM per analyst | realtime | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |
| Email Closure (Email) **(no data)** | client_sla | seconds | lower | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 172800 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Email Closure (MO) **(no data)** | client_sla | seconds | lower | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 172800 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Sale Target (ABC) | client_sla | count | higher | process | kpi_daily_actual SALES_COUNT | Client SLA target 1440 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Revenue Target (ABC) | client_sla | currency | higher | process | kpi_daily_actual REVENUE | Client SLA target 2450000 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| ROI (ABC) **(no data)** | client_sla | ratio | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 11.67 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Reshipment (RTO) **(no data)** | client_sla | seconds | lower | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 3600 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |

### Finnable (live dialer) (`finnable`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Agent login / talk / pause | workforce | seconds | higher | employee | dialer_db.vicidial_agent_log_10_25 campaign FINNABLE (apr.service) | SUM per agent | realtime | date, agent | agent, team_leader, process_manager, branch, head_office, admin |
| Attendance % | workforce | percent | higher | both | kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record | P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped | daily | date, agent, team, branch | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Login hours | workforce | hours | higher | employee | attendance_daily_record.dialler_minutes | dialler_minutes / 60 | daily | date, agent | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Late login % | workforce | percent | lower | both | attendance_daily_record.late_mark | late days / present days | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Break / AUX minutes | workforce | minutes | lower | employee | break_sessions / break_daily_summary | SUM(duration_seconds)/60 per shift | hourly | date, agent, break_type | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Occupancy % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + dispo) / (talk + wait + dispo) | hourly | date, hour, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Utilization % | workforce | percent | higher | both | process-dashboard APR (pd.metrics) | (talk + wait + dispo) / login | hourly | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Schedule adherence % **(no data)** | workforce | percent | higher | both | wfm_rta_exception / roster | in-adherence minutes / scheduled minutes | daily | date, agent, team | agent, team_leader, process_manager, wfm, branch, head_office, admin |
| Shrinkage % **(no data)** | workforce | percent | lower | process | employee_performance_daily_snapshot.team_shrinkage_pct | (login - net login) / login | daily | date, team, branch | process_manager, branch, head_office, admin |
| QA score % | quality | percent | higher | both | qa_audit.quality_percentage / call_quality_assessment | AVG(quality_percentage) | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Fatal rate % | quality | percent | lower | both | qa_audit.fatal_triggered | fatal audits / total audits | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Top-quartile (TQ) agents % | quality | percent | higher | process | call-master tq/mq/bq buckets | agents with QA >= 80 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Bottom-quartile (BQ) agents % | quality | percent | lower | process | call-master tq/mq/bq buckets | agents with QA < 60 / audited agents | daily | date, team | quality, process_manager, branch, head_office, admin |
| Customer experience score | quality | percent | higher | both | call-master avg_cx | mean of CX parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Compliance % | quality | percent | higher | both | call-master avg_compliance | mean of compliance parameter flags / 5 | daily | date, agent, team, scenario | agent, team_leader, process_manager, quality, branch, head_office, admin |
| Audits completed | quality | count | higher | both | qa_audit | COUNT(audits) | daily | date, agent, auditor | quality, process_manager, head_office, admin |
| PAN Submission (Finnable) **(no data)** | client_sla | count | higher | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 100 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |

### All processes (operations, workforce, training) (`_global`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Headcount | workforce | count | higher | process | employees (ops-command) | COUNT(active employees) | daily | branch, process, lob, team | process_manager, branch, head_office, admin, wfm |
| Attendance % | workforce | percent | higher | process | ops-command attendance tab | present / planned | daily | branch, process, lob, team, analyst | team_leader, process_manager, branch, head_office, admin, wfm |
| Live login % (planned vs logged in) | workforce | percent | higher | process | ops-command Live Today tab | logged in / planned | hourly | branch, process, team | team_leader, process_manager, branch, head_office, admin, wfm |
| Attrition % | workforce | percent | lower | process | ops-command attrition tab | exits / average headcount | daily | branch, process, lob | process_manager, branch, head_office, admin |
| Agents on PIP | workforce | count | lower | process | employee_performance_daily_snapshot.pip_status | COUNT(pip_status active) | daily | branch, process, team | team_leader, process_manager, branch, head_office, admin |
| Training at risk | training | count | lower | process | ops-command quality tab | agents with open training need / total | daily | branch, process | process_manager, branch, head_office, admin, trainer, quality |
| Course completion % | training | percent | higher | both | lms_learner_progress | completed / assigned | daily | date, course, batch, agent | agent, team_leader, trainer, process_manager, head_office, admin |
| Assessment score | training | percent | higher | both | lms_assessment_scores | AVG(score) | daily | date, course, batch, agent | agent, team_leader, trainer, process_manager, head_office, admin |
| Certified % | training | percent | higher | both | lms_certification_snapshot | certified / required | daily | batch, process | trainer, process_manager, head_office, admin |

### GS1 / GS1 (`gs1`)

| KPI | Theme | Unit | Better | Grain | Source | Formula | Fresh | Dimensions | Audience |
|---|---|---|---|---|---|---|---|---|---|
| Email — response w/ resolution (Email) **(no data)** | client_sla | seconds | lower | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 3600 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Data Cart — download & update (Data Cart) **(no data)** | client_sla | seconds | lower | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 3600 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |
| Approval — verify product data (Approval) **(no data)** | client_sla | seconds | lower | process | process_metric_actual (hand-entered / uploaded / Studio process grain) | Client SLA target 14400 from the Process KPI sheet | upload | date, lob | process_manager, branch, head_office, admin |

## Role and department matrix (KPI count per process)

| Process | agent | team_leader | process_manager | quality | wfm | branch | head_office | trainer | admin |
|---|---|---|---|---|---|---|---|---|---|
| bellavita | 37 | 37 | 51 | 7 | 7 | 50 | 51 | 0 | 51 |
| gnc | 34 | 34 | 45 | 7 | 7 | 44 | 45 | 0 | 45 |
| neemans | 31 | 31 | 41 | 7 | 7 | 40 | 41 | 0 | 41 |
| appreciate_health | 27 | 27 | 32 | 7 | 7 | 31 | 32 | 0 | 32 |
| housing_owner | 22 | 22 | 27 | 7 | 7 | 26 | 27 | 0 | 27 |
| housing_premium | 22 | 22 | 27 | 7 | 7 | 26 | 27 | 0 | 27 |
| clovia | 29 | 29 | 40 | 7 | 7 | 39 | 40 | 0 | 40 |
| birlanu | 15 | 15 | 23 | 7 | 7 | 22 | 23 | 0 | 23 |
| satya_retail | 16 | 16 | 21 | 7 | 7 | 20 | 21 | 0 | 21 |
| lp_feedback | 19 | 19 | 24 | 7 | 7 | 23 | 24 | 0 | 24 |
| lp_onboarding | 20 | 20 | 25 | 7 | 7 | 24 | 25 | 0 | 25 |
| dalmia | 19 | 19 | 33 | 7 | 7 | 32 | 33 | 0 | 33 |
| sbi_card | 17 | 17 | 28 | 7 | 7 | 27 | 28 | 0 | 28 |
| du_bangladesh | 19 | 19 | 28 | 7 | 7 | 27 | 28 | 0 | 28 |
| viega | 19 | 19 | 28 | 7 | 7 | 27 | 28 | 0 | 28 |
| exicom | 19 | 19 | 28 | 7 | 7 | 27 | 28 | 0 | 28 |
| bla_bli_blu | 20 | 20 | 51 | 7 | 7 | 50 | 51 | 0 | 51 |
| reginald | 14 | 14 | 24 | 7 | 7 | 23 | 24 | 0 | 24 |
| finnable | 12 | 12 | 17 | 7 | 7 | 16 | 17 | 0 | 17 |
| _global | 2 | 5 | 9 | 1 | 3 | 6 | 9 | 4 | 9 |
| gs1 | 0 | 0 | 3 | 0 | 0 | 3 | 3 | 0 | 3 |

## Known conflicts between the existing KPI models

| Type | What is wrong | Resolution in the catalogue |
|---|---|---|
| rating_scale_mismatch | kpi_rating_config uses S/A/B/C/D at 100/90/75/60/0; kpi-score-engine ratingForScore uses Outstanding/Exceeds/Meets/Needs Improvement at 95/85/75/60. | One scale: kpi_rating_scale 'standard_sabcd' (S/A/B/C/D). |
| weight_not_normalised | kpi_master_config.weightage defaults to 100 per metric and is never normalised, so an employee's weights can sum to 300+. | Weights normalised to 100 at read time (kpi-catalogue.resolve.ts). |
| duplicate_definition | The same KPI is defined independently in kpi_template, kpi_master_config, kpi_process_config, kpi_role_template_metric, kpi_studio_definition and portal_kpi_config, each resolved in a different order. | One catalogue row per process + metric; one resolution order: employee > role+process > process > department > designation. |
| hardcoded_registry | kpi-metric-registry.ts hard-codes targets and metrics for 5 processes; most are not_tracked / no_data. | Seed derives those processes from the registry so they cannot diverge; hasData:false marks missing feeds. |
| score_cap | Score cap is fixed at 120 for most scoring types; max_achievement is only honoured by the floor-gated types. | Documented; scoring change is out of scope for the catalogue. |
| attendance_granularity | ATTENDANCE_PCT only holds 0 / 50 / 100 per day, a poor continuous metric. | Catalogue records the definition; floor-gating stays opt-in. |
| no_feed | ADHERENCE, SHRINKAGE and OCCUPANCY are defined in kpi_metric_master but no job produces rows; only 13 of 93 metrics have data. | Catalogue marks them hasData:false so pages say 'no data', never 0. |
| realtime_gap | kpi_daily_actual is a 24h interval sync; the only direct live reads are dialer CDR queries (5 min cache) and the process-dashboard stream. | freshness per KPI (realtime / hourly / daily / upload) so each page states how live a number is. |

The live drift check (`GET /api/kpi-catalogue/drift`) adds row-level conflicts from the database: direction / unit / target mismatches, Studio definitions not linked to the catalogue, weights not summing to 100, metrics with no feed, and legacy-only metrics.
