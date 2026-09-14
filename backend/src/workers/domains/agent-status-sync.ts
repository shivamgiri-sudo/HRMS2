import { dialerQuery } from '../../db/dialerDb.js';

export interface AgentStatus {
  employee_code: string;
  last_activity: Date;
  status: string;
  campaign_id: string | null;
  user_group: string | null;
  pause_type: string | null;
  seconds_ago: number;
}

export interface AgentActivity {
  event_time: Date;
  status: string;
  campaign_id: string | null;
  pause_sec: number;
  wait_sec: number;
  talk_sec: number;
  dispo_sec: number;
  dead_sec: number;
  pause_type: string;
}

export interface ActiveAgent {
  employee_code: string;
  login_time: Date;
  campaign_id: string | null;
  user_group: string | null;
}

export class AgentStatusSync {
  /**
   * Get current agent status from dialer
   */
  async getCurrentAgentStatus(employeeCode: string): Promise<AgentStatus | null> {
    const results = await dialerQuery<AgentStatus>(`
      SELECT
        user as employee_code,
        event_time as last_activity,
        status,
        campaign_id,
        user_group,
        pause_type,
        TIMESTAMPDIFF(SECOND, event_time, NOW()) as seconds_ago
      FROM vicidial_agent_log_11_5
      WHERE user = ?
      ORDER BY event_time DESC
      LIMIT 1
    `, [employeeCode]);

    return results[0] || null;
  }

  /**
   * Get all agents currently logged in (last hour activity, last 3 months data only)
   */
  async getActiveAgents(): Promise<ActiveAgent[]> {
    return dialerQuery<ActiveAgent>(`
      SELECT
        user as employee_code,
        MIN(event_time) as login_time,
        campaign_id,
        user_group
      FROM vicidial_agent_log_11_5
      WHERE event_time >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
        AND event_time >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
        AND status IN ('LOGIN', 'PAUSED', 'READY')
      GROUP BY user, campaign_id, user_group
      ORDER BY login_time DESC
    `);
  }

  /**
   * Get agent activity for date range (last 3 months only)
   */
  async getAgentActivity(
    employeeCode: string,
    startDate: string,
    endDate: string
  ): Promise<AgentActivity[]> {
    return dialerQuery<AgentActivity>(`
      SELECT
        event_time,
        status,
        campaign_id,
        pause_sec,
        wait_sec,
        talk_sec,
        dispo_sec,
        dead_sec,
        pause_type
      FROM vicidial_agent_log_11_5
      WHERE user = ?
        AND event_time BETWEEN ? AND ?
        AND event_time >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      ORDER BY event_time ASC
    `, [employeeCode, startDate, endDate]);
  }

  /**
   * Get daily agent summary (last 3 months only)
   */
  async getDailySummary(employeeCode: string, date: string) {
    const results = await dialerQuery(`
      SELECT
        user as employee_code,
        DATE(event_time) as activity_date,
        COUNT(*) as total_activities,
        SUM(pause_sec) as total_pause_sec,
        SUM(wait_sec) as total_wait_sec,
        SUM(talk_sec) as total_talk_sec,
        SUM(dispo_sec) as total_dispo_sec,
        SUM(dead_sec) as total_dead_sec,
        MIN(event_time) as first_activity,
        MAX(event_time) as last_activity
      FROM vicidial_agent_log_11_5
      WHERE user = ?
        AND DATE(event_time) = DATE(?)
        AND event_time >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      GROUP BY user, DATE(event_time)
    `, [employeeCode, date]);

    return results[0] || null;
  }

  /**
   * Check if agent is currently active (activity in last 5 minutes, last 3 months data)
   */
  async isAgentActive(employeeCode: string): Promise<boolean> {
    const results = await dialerQuery(`
      SELECT 1
      FROM vicidial_agent_log_11_5
      WHERE user = ?
        AND event_time >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
        AND event_time >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
      LIMIT 1
    `, [employeeCode]);

    return results.length > 0;
  }
}
