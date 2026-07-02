import { dialerQuery } from '../../db/dialerDb.js';

export interface InboundCall {
  employee_code: string;
  employee_name: string | null;
  call_time: Date;
  call_date: Date;
  campaign: string | null;
  customer_phone: string | null;
  disposition: string | null;
  duration_sec: string | null;
  talk_sec: string | null;
  queue_sec: string | null;
  hold_sec: string | null;
  acw_sec: string | null;
}

export interface OutboundCall {
  employee_code: string;
  call_start: Date;
  call_end: Date;
  call_date: Date;
  campaign: string | null;
  customer_phone: string | null;
  status: string | null;
  duration_sec: string | null;
  talk_sec: string | null;
  wait_sec: string | null;
  dispo_sec: string | null;
}

export interface CallSummary {
  inbound: {
    total_calls: number;
    total_duration_sec: number;
    total_talk_sec: number;
    total_acw_sec: number;
  };
  outbound: {
    total_calls: number;
    total_duration_sec: number;
    total_talk_sec: number;
    total_dispo_sec: number;
  };
}

export class CallDataSync {
  /**
   * Get inbound calls for employee on specific date (last 3 months only)
   */
  async getInboundCalls(employeeCode: string, date: string): Promise<InboundCall[]> {
    return dialerQuery<InboundCall>(`
      SELECT
        AgentId as employee_code,
        AgentName as employee_name,
        Time as call_time,
        CallDate as call_date,
        CampaignName as campaign,
        PhoneNumber as customer_phone,
        Disposition as disposition,
        CallDurationSecond as duration_sec,
        Talkduration as talk_sec,
        QueueDuration as queue_sec,
        HoldTime as hold_sec,
        Acwduration as acw_sec
      FROM vw_inbound_cdr
      WHERE AgentId = ?
        AND CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      ORDER BY Time ASC
    `, [employeeCode, date]);
  }

  /**
   * Get outbound calls for employee on specific date (last 3 months only)
   */
  async getOutboundCalls(employeeCode: string, date: string): Promise<OutboundCall[]> {
    return dialerQuery<OutboundCall>(`
      SELECT
        Agent as employee_code,
        StartTime as call_start,
        EndTime as call_end,
        CallDate as call_date,
        campaign_id as campaign,
        PhoneNumber as customer_phone,
        CallStatus as status,
        CallDuration as duration_sec,
        talk_sec,
        WaitSec as wait_sec,
        DispoSec as dispo_sec
      FROM vw_outbound_cdr
      WHERE Agent = ?
        AND CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      ORDER BY StartTime ASC
    `, [employeeCode, date]);
  }

  /**
   * Get daily call summary for employee (last 3 months only)
   */
  async getDailySummary(employeeCode: string, date: string): Promise<CallSummary> {
    // Inbound summary
    const inboundResults = await dialerQuery(`
      SELECT
        COUNT(*) as total_calls,
        SUM(CAST(COALESCE(CallDurationSecond, 0) AS UNSIGNED)) as total_duration_sec,
        SUM(CAST(COALESCE(Talkduration, 0) AS UNSIGNED)) as total_talk_sec,
        SUM(CAST(COALESCE(Acwduration, 0) AS UNSIGNED)) as total_acw_sec
      FROM vw_inbound_cdr
      WHERE AgentId = ?
        AND CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    `, [employeeCode, date]);

    // Outbound summary
    const outboundResults = await dialerQuery(`
      SELECT
        COUNT(*) as total_calls,
        SUM(CAST(COALESCE(CallDuration, 0) AS UNSIGNED)) as total_duration_sec,
        SUM(CAST(COALESCE(talk_sec, 0) AS UNSIGNED)) as total_talk_sec,
        SUM(CAST(COALESCE(DispoSec, 0) AS UNSIGNED)) as total_dispo_sec
      FROM vw_outbound_cdr
      WHERE Agent = ?
        AND CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
    `, [employeeCode, date]);

    const inbound = inboundResults[0] || {
      total_calls: 0,
      total_duration_sec: 0,
      total_talk_sec: 0,
      total_acw_sec: 0,
    };

    const outbound = outboundResults[0] || {
      total_calls: 0,
      total_duration_sec: 0,
      total_talk_sec: 0,
      total_dispo_sec: 0,
    };

    return {
      inbound: {
        total_calls: Number(inbound.total_calls),
        total_duration_sec: Number(inbound.total_duration_sec),
        total_talk_sec: Number(inbound.total_talk_sec),
        total_acw_sec: Number(inbound.total_acw_sec),
      },
      outbound: {
        total_calls: Number(outbound.total_calls),
        total_duration_sec: Number(outbound.total_duration_sec),
        total_talk_sec: Number(outbound.total_talk_sec),
        total_dispo_sec: Number(outbound.total_dispo_sec),
      },
    };
  }

  /**
   * Get call volume by hour for employee (last 3 months only)
   */
  async getCallVolumeByHour(employeeCode: string, date: string) {
    return dialerQuery(`
      SELECT
        HOUR(Time) as hour,
        COUNT(*) as call_count,
        SUM(CAST(COALESCE(Talkduration, 0) AS UNSIGNED)) as total_talk_sec
      FROM vw_inbound_cdr
      WHERE AgentId = ?
        AND CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      GROUP BY HOUR(Time)
      ORDER BY hour ASC
    `, [employeeCode, date]);
  }

  /**
   * Get disposition breakdown for employee (last 3 months only)
   */
  async getDispositionBreakdown(employeeCode: string, date: string) {
    return dialerQuery(`
      SELECT
        Disposition as disposition,
        COUNT(*) as count
      FROM vw_inbound_cdr
      WHERE AgentId = ?
        AND CallDate = DATE(?)
        AND CallDate >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
        AND Disposition IS NOT NULL
      GROUP BY Disposition
      ORDER BY count DESC
    `, [employeeCode, date]);
  }
}
