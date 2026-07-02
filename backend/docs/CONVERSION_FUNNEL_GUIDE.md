# Conversion Funnel Analytics Guide

## Overview

The Conversion Funnel system tracks customer progression through multi-stage sales processes across four primary channels:
- **Inbound**: Incoming calls from customers
- **Outbound**: Proactive outbound calls to customers
- **Chat**: Real-time chat interactions
- **Email**: Email-based customer interactions

## Funnel Stages by Channel

### 1. Inbound Process Funnel
```
Call Connect (100%) 
    ↓ 
Concern Identified (~85%)
    ↓
Offer Prepared (~70%)
    ↓
Offer Presented (~65%)
    ↓
Sale Completed (~40%)
```

**Metrics Tracked:**
- `call_initiated_at`: When the call started
- `call_connected_at`: When agent connected
- `concern_identified_at`: When issue/concern was identified
- `offer_presented_at`: When offer was presented
- `sale_completed_at`: When sale was finalized
- `sale_amount`: Value of the sale
- `iq_score`: Interaction Quality score
- `csat_score`: Customer Satisfaction score

### 2. Outbound Process Funnel
```
Dial Initiated (100%)
    ↓
Call Connected (~70%)
    ↓
Talk 30s+ (~65%)
    ↓
Sale Completed (~45%)
```

**Metrics Tracked:**
- `dial_initiated_at`: When dial was initiated
- `dial_attempted_count`: Number of dial attempts
- `connection_established_at`: When customer picked up
- `talk_duration_secs`: Duration of conversation
- `connection_quality`: Quality indicator (excellent/good/poor/dropped)
- `sale_completed_at`: When sale was finalized
- `sale_amount`: Value of the sale
- `attempt_number`: Which attempt resulted in sale

### 3. Chat Process Funnel
```
Chat Initiated (100%)
    ↓
First Response (~95%)
    ↓
Issue Resolved (~85%)
    ↓
Upsell Offered (~70%)
    ↓
Sale Completed (~50%)
```

**Metrics Tracked:**
- `chat_initiated_at`: When chat was started
- `first_response_at`: When agent responded
- `first_response_time_secs`: Time to first response
- `issue_identified_at`: When issue was identified
- `resolution_accepted_at`: When customer accepted resolution
- `resolution_time_secs`: Total resolution time
- `upsell_offered_at`: When upsell was offered
- `upsell_accepted_at`: When customer accepted upsell
- `sale_completed_at`: When sale was finalized
- `sale_amount`: Value of the sale
- `message_count`: Total messages in conversation
- `csat_score`: Customer Satisfaction score

### 4. Email Process Funnel
```
Email Received (100%)
    ↓
First Response (~90%)
    ↓
Issue Resolved (~80%)
    ↓
Upsell Offered (~60%)
    ↓
Sale Completed (~40%)
```

**Metrics Tracked:**
- `email_received_at`: When email was received
- `email_subject`: Email subject
- `email_category`: Category of inquiry
- `first_response_at`: When first response was sent
- `response_time_hours`: Time to first response
- `response_count`: Number of responses
- `resolution_provided_at`: When resolution was sent
- `customer_confirmed_at`: When customer confirmed resolution
- `upsell_offered_at`: When upsell was offered
- `upsell_accepted_at`: When customer accepted upsell
- `sale_completed_at`: When sale was finalized
- `sale_amount`: Value of the sale
- `email_exchange_count`: Total email exchanges
- `total_time_hours`: Total time from receipt to close

## Database Schema

### Core Tables

#### `conversion_funnel_event`
Main event table tracking all funnel progression entries.

```sql
- id: UUID (PRIMARY KEY)
- process_type: 'inbound' | 'outbound' | 'chat' | 'email'
- funnel_stage: Current stage in the funnel
- contact_id: Unique identifier per channel
- employee_id: Agent/Employee handling
- process_master_id: Process reference
- customer_id: Customer identifier
- stage_entered_at: When entered current stage
- stage_exited_at: When exited stage (if applicable)
- stage_duration_secs: Duration in stage
- status: 'pending' | 'completed' | 'abandoned' | 'converted'
- conversion_flag: 0 or 1
```

#### `inbound_funnel_detail`
Inbound-specific metrics and timestamps.

#### `outbound_funnel_detail`
Outbound-specific metrics and call attempt tracking.

#### `chat_funnel_detail`
Chat-specific metrics including response times and message counts.

#### `email_funnel_detail`
Email-specific metrics including response times and exchange counts.

#### `funnel_stage_config`
Configuration for each funnel stage including SLAs and targets.

#### `funnel_daily_snapshot`
Daily aggregated metrics for dashboards and reporting.

#### `funnel_org_performance`
Organization-level performance metrics by department/branch.

#### `funnel_employee_performance`
Employee-level performance metrics and rankings.

## API Endpoints

### Record Events

#### POST `/api/kpi/conversion-funnel/inbound`
Record an inbound call event.

**Request Body:**
```json
{
  "contact_id": "string (required)",
  "employee_id": "string (optional)",
  "customer_id": "string (optional)",
  "call_initiated_at": "ISO datetime (required)",
  "call_connected_at": "ISO datetime (optional)",
  "concern_identified_at": "ISO datetime (optional)",
  "offer_presented_at": "ISO datetime (optional)",
  "sale_completed_at": "ISO datetime (optional)",
  "sale_amount": "number (optional)",
  "iq_score": "number (optional)",
  "csat_score": "number (optional)"
}
```

#### POST `/api/kpi/conversion-funnel/outbound`
Record an outbound call event.

**Request Body:**
```json
{
  "contact_id": "string (required)",
  "employee_id": "string (optional)",
  "customer_id": "string (optional)",
  "dial_initiated_at": "ISO datetime (required)",
  "connection_established_at": "ISO datetime (optional)",
  "talk_start_at": "ISO datetime (optional)",
  "talk_end_at": "ISO datetime (optional)",
  "talk_duration_secs": "number (optional)",
  "sale_completed_at": "ISO datetime (optional)",
  "sale_amount": "number (optional)",
  "attempt_number": "number (optional)"
}
```

#### POST `/api/kpi/conversion-funnel/chat`
Record a chat event.

**Request Body:**
```json
{
  "contact_id": "string (required)",
  "employee_id": "string (optional)",
  "customer_id": "string (optional)",
  "chat_initiated_at": "ISO datetime (required)",
  "first_response_at": "ISO datetime (optional)",
  "resolution_accepted_at": "ISO datetime (optional)",
  "upsell_accepted_at": "ISO datetime (optional)",
  "sale_completed_at": "ISO datetime (optional)",
  "sale_amount": "number (optional)",
  "message_count": "number (optional)",
  "csat_score": "number (optional)"
}
```

#### POST `/api/kpi/conversion-funnel/email`
Record an email event.

**Request Body:**
```json
{
  "contact_id": "string (required)",
  "employee_id": "string (optional)",
  "customer_id": "string (optional)",
  "email_received_at": "ISO datetime (required)",
  "email_subject": "string (optional)",
  "first_response_at": "ISO datetime (optional)",
  "resolution_provided_at": "ISO datetime (optional)",
  "upsell_offered_at": "ISO datetime (optional)",
  "sale_completed_at": "ISO datetime (optional)",
  "sale_amount": "number (optional)",
  "email_exchange_count": "number (optional)"
}
```

### Query Endpoints

#### GET `/api/kpi/conversion-funnel/metrics/:processType?days=30`
Get funnel metrics for a specific process.

**Response:**
```json
{
  "success": true,
  "process_type": "inbound",
  "days_back": 30,
  "metrics": [
    {
      "funnel_stage": "call_connect",
      "stage_count": 1000,
      "conversions": 400,
      "conversion_pct": 40.00,
      "avg_duration_secs": 180
    },
    ...
  ]
}
```

#### GET `/api/kpi/conversion-funnel/report/summary`
Get comprehensive conversion funnel summary.

**Response:**
```json
{
  "success": true,
  "summary": {
    "total_entries": 5000,
    "unique_processes": 4,
    "total_conversions": 1800,
    "overall_conversion_rate": 36.00,
    "total_revenue": 450000.00,
    "data_start": "2024-05-21",
    "data_end": "2024-06-20"
  },
  "by_process": [
    {
      "process_type": "inbound",
      "entries": 2000,
      "conversions": 800,
      "conversion_rate": 40.00
    },
    ...
  ]
}
```

#### GET `/api/kpi/conversion-funnel/report/bottlenecks`
Identify bottleneck stages with highest drop-off rates.

**Response:**
```json
{
  "success": true,
  "bottlenecks": [
    {
      "process_type": "outbound",
      "funnel_stage": "dial_initiated",
      "stage_entries": 5000,
      "drop_off_pct": 30.00,
      "severity": "WARNING"
    },
    {
      "process_type": "email",
      "funnel_stage": "first_response",
      "stage_entries": 900,
      "drop_off_pct": 10.00,
      "severity": "NORMAL"
    }
    ...
  ]
}
```

## Command Line Analytics

### Run Conversion Funnel Report
```bash
npm run conversion-funnel-report
```

This generates a comprehensive text report with:
1. Overall conversion funnel by process
2. Funnel summary by process type
3. Detailed Inbound funnel analysis
4. Detailed Outbound funnel analysis
5. Detailed Chat funnel analysis
6. Detailed Email funnel analysis
7. Bottleneck analysis by process
8. Overall performance summary

**Sample Output:**
```
PROCESS        | STAGE                    | COUNT    | CONVERSION_PCT | BOTTLENECK
inbound        | call_connect             | 1000     | 100.00%        | HEALTHY
inbound        | concern_identified       | 850      | 85.00%         | HEALTHY
inbound        | offer_prepared           | 595      | 70.00%         | WARNING
inbound        | offer_presented          | 387      | 65.00%         | WARNING
inbound        | sale_completed           | 232      | 60.00%         | CRITICAL

outbound       | dial_initiated           | 5000     | 100.00%        | HEALTHY
outbound       | call_connected           | 3500     | 70.00%         | CRITICAL
outbound       | talk_30s                 | 2275     | 65.00%         | WARNING
outbound       | sale_completed           | 1023     | 45.00%         | CRITICAL

chat           | chat_initiated           | 800      | 100.00%        | HEALTHY
chat           | first_response           | 760      | 95.00%         | HEALTHY
chat           | issue_resolved           | 680      | 85.00%         | NORMAL
chat           | upsell_offered           | 560      | 70.00%         | NORMAL
chat           | sale_completed           | 400      | 50.00%         | WARNING

email          | email_received           | 1200     | 100.00%        | HEALTHY
email          | first_response           | 1080     | 90.00%         | HEALTHY
email          | issue_resolved           | 960      | 80.00%         | NORMAL
email          | upsell_offered           | 720      | 60.00%         | WARNING
email          | sale_completed           | 480      | 40.00%         | CRITICAL
```

## Key Metrics Explained

### Conversion Percentage
- Percentage of entries at each stage that result in conversion
- Formula: (Conversions at stage / Total entries at stage) × 100
- **Target:** Higher is better; varies by process and stage

### Drop-off Percentage
- Percentage of entries lost between consecutive stages
- Formula: (1 - Current stage entries / Previous stage entries) × 100
- **Severity:** 
  - CRITICAL: > 50% drop-off
  - WARNING: 30-50% drop-off
  - NORMAL: < 30% drop-off

### Stage Duration
- Average time spent in each stage (in seconds)
- Important for identifying process delays

### Bottleneck
- Stages with critical drop-off or low conversion rates
- Priority for optimization

## Usage Examples

### Example 1: Recording an Inbound Sale

```bash
curl -X POST http://localhost:3001/api/kpi/conversion-funnel/inbound \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "contact_id": "INBD-2024-06-21-001",
    "employee_id": "emp-123",
    "customer_id": "cust-456",
    "call_initiated_at": "2024-06-21T10:00:00Z",
    "call_connected_at": "2024-06-21T10:01:00Z",
    "concern_identified_at": "2024-06-21T10:03:00Z",
    "offer_presented_at": "2024-06-21T10:08:00Z",
    "sale_completed_at": "2024-06-21T10:12:00Z",
    "sale_amount": 5000,
    "iq_score": 4.5,
    "csat_score": 4.8
  }'
```

### Example 2: Recording an Outbound Call

```bash
curl -X POST http://localhost:3001/api/kpi/conversion-funnel/outbound \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "contact_id": "OUTB-2024-06-21-005",
    "employee_id": "emp-789",
    "customer_id": "cust-321",
    "dial_initiated_at": "2024-06-21T14:00:00Z",
    "connection_established_at": "2024-06-21T14:02:00Z",
    "talk_start_at": "2024-06-21T14:02:30Z",
    "talk_end_at": "2024-06-21T14:08:45Z",
    "talk_duration_secs": 375,
    "sale_completed_at": "2024-06-21T14:08:45Z",
    "sale_amount": 3500,
    "attempt_number": 1
  }'
```

## Performance Tuning

### Database Indexes
All critical fields are indexed for fast queries:
- `process_type` + `funnel_stage` + `stage_entered_at`
- `employee_id`
- `customer_id`
- `conversion_flag`

### Query Optimization
- Daily snapshots prevent expensive real-time aggregations
- Partitioning by `process_type` for faster filtering
- Pre-calculated drop-off metrics in reporting views

### Recommended Indexes for High-Volume Operations
```sql
CREATE INDEX idx_funnel_process_stage_date 
  ON conversion_funnel_event(process_type, funnel_stage, stage_entered_at);

CREATE INDEX idx_funnel_employee_date 
  ON conversion_funnel_event(employee_id, stage_entered_at);

CREATE INDEX idx_funnel_customer_conversion 
  ON conversion_funnel_event(customer_id, conversion_flag);
```

## Troubleshooting

### No data appearing in queries
1. Verify events are being recorded via API
2. Check that `stage_entered_at` is within the query date range
3. Ensure roles have proper permissions

### Slow query performance
1. Check if indexes are properly created
2. Verify date range in queries (use narrow windows if possible)
3. Consider archiving old data to separate tables

### Incorrect conversion rates
1. Verify `conversion_flag` is being set correctly
2. Check that `sale_completed_at` is populated for conversions
3. Ensure no duplicate records exist (use UNIQUE constraints)

## Integration Points

### With KPI Module
- Funnel conversions can feed into KPI metrics
- Agent performance rankings based on funnel conversion rates
- Department/branch KPIs influenced by process funnel health

### With Employee Performance
- Individual conversion rates by process
- Performance tiers (top 10%, median, bottom 10%)
- Benchmarking against department averages

### With Quality Management
- CSAT scores captured at conversion point
- IQ scores linked to conversion outcomes
- Quality coaching based on drop-off analysis

## Maintenance

### Daily Tasks
- Snapshot calculations run automatically
- Review critical bottlenecks (>50% drop-off)
- Check for data entry errors

### Weekly Tasks
- Review process-level conversion trends
- Identify emerging bottlenecks
- Plan intervention for underperforming stages

### Monthly Tasks
- Archive old events (>90 days)
- Recalibrate SLA targets
- Update employee performance rankings

## Future Enhancements

1. **Predictive Analytics**: Forecast conversion likelihood based on early stages
2. **A/B Testing**: Compare funnel performance across variations
3. **Real-time Alerts**: Notify managers of critical drop-offs
4. **Automated Interventions**: Trigger coaching based on conversion patterns
5. **Channel Attribution**: Track customer journey across multiple channels
6. **Cohort Analysis**: Segment and compare customer cohorts
